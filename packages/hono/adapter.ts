import {
  HttpServerAdapter,
  contentTypeFor,
  isReadableStream,
  toNamedWildcard,
  type HttpApplicationOptions,
  type HttpEventBroker,
  type HttpEventRecord,
  type MiddlewareEntry,
  type ReplyPayload,
  type RouteAction,
  type SseStream,
} from '@glandjs/http';
import { HttpEvent } from '@glandjs/http';
import { HttpStatus } from '@medishn/toolkit';
import { Hono } from 'hono';
import type { Context as HonoContext, Env, Next } from 'hono';
import { Readable } from 'node:stream';
import type { Server } from 'node:http';
import { HonoRequestContext, parseFetchBody, type FetchBodyInit } from './context';

/**
 * The Hono adapter.
 *
 * Hono runs on a Fetch `Request`/`Response` pair, which makes it the only
 * adapter here that also works on Cloudflare Workers, Deno Deploy, Bun and
 * Lambda. Two consequences are worth knowing before choosing it:
 *
 * - **Body reading is explicit.** Hono hands out the raw `Request` and does not
 *   buffer it, so this adapter reads the body once in a middleware and hands the
 *   parsed value to `ctx.body`. Without that, `ctx.body` would be `undefined`
 *   everywhere — and a Fetch body can only be read once, so a second attempt
 *   would hang rather than return nothing.
 * - **The middleware onion is real.** Hono's `next` is the same promise-based
 *   hand-off as Koa's, so `await next()` waits and a downstream `throw` reaches
 *   an upstream `catch`.
 *
 * ### Listening
 *
 * Hono has no server. On Node, `@hono/node-server` provides one and is loaded on
 * demand; on an edge runtime there is nothing to bind and the application
 * exports `app.fetch` instead. {@link HonoAdapter.listen} says so rather than
 * failing, because an edge deployment is a normal way to use this adapter rather
 * than a mistake.
 *
 * @typeParam TEvents - the application's channel event map
 */
export class HonoAdapter<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpServerAdapter<Server, Hono<Env>, HonoContext<Env, any>, Response, HonoRequestContext<TEvents>, TEvents> {
  /** The Node server, when {@link HonoAdapter.listen} was able to create one. */
  private nodeServer?: { close: (callback: () => void) => void; address?: () => { port: number } | string | null; once?: (event: string, cb: () => void) => void };

  /** Whether body parsers were requested, for the start-up log line. */
  private parserCount = 0;

  constructor(options?: HttpApplicationOptions) {
    super(new Hono<Env>(), options, 'HTTP:Hono');
  }

  // ── Set-up ─────────────────────────────────────────────────────────────

  protected async onInitialize(): Promise<void> {
    const app = this.instance;

    if (this.options?.poweredBy === false) {
      // Hono sets no `X-Powered-By` of its own, so this only matters for a
      // reverse proxy that adds one. Cheap to assert, cheaper than to debug.
      app.use('*', async (ctx, next) => {
        await next();
        ctx.res.headers.delete('X-Powered-By');
      });
    }

    app.use('*', async (honoCtx, next) => {
      // Gated on `parserCount`, not unconditional. A fetch `Request` body is a
      // one-shot stream, so reading it has to happen exactly once and in a
      // middleware — but *having* to read it is not the same as *being asked* to
      // read it. `bodyParser: false` means no parser is installed, and the
      // documented default is that a JSON post reaches the handler with no body
      // rather than a parsed one nobody asked for.
      if (this.parserCount > 0 && canHaveBody(honoCtx.req.method)) {
        const text = await honoCtx.req.text();
        const ctx = this.createContext(honoCtx, new Response(), this.events);
        ctx.rawText = text;
        ctx.parsedBody = parseFetchBody(text, honoCtx.req.header('content-type'));
      }
      await next();
    });

    // Both handlers route through the shared renderer, so a Hono application
    // answers a 404 and a 500 with the same problem document as the other four
    // adapters rather than with Hono's own `{ error, status }` shape.
    app.notFound(async (honoCtx) => {
      const ctx = this.createContext(honoCtx, new Response(), this.events);
      await this.notFound(ctx);
      const response = ctx.response ?? (ctx.written ? ctx.res : new Response(null, { status: HttpStatus.NOT_FOUND }));
      honoCtx.res = response;
      return response;
    });

    app.onError(async (error, honoCtx) => {
      const ctx = this.createContext(honoCtx, new Response(), this.events);
      this.logger.error('Unhandled Hono error', error instanceof Error ? (error.stack ?? error.message) : String(error));
      await this.safelyRenderError(error, ctx);

      // `safelyRenderError` writes through `ctx.send`, which produces `ctx.res`
      // and not `ctx.response` — the fetch response is only built by
      // {@link HonoAdapter.write}. Falling straight through to the generic 500
      // therefore *discards* the problem document and reports a bare error, which
      // is what made every Hono failure look like an unrelated one.
      const response = ctx.response ?? (ctx.written ? ctx.res : Response.json({ error: 'Internal Server Error' }, { status: HttpStatus.INTERNAL_SERVER_ERROR }));
      honoCtx.res = response;
      return response;
    });

    this.logger.info('Hono adapter configured');
  }

  public bodyParser(options: Parameters<HttpServerAdapter<Server, Hono<Env>, HonoContext<Env, any>, Response, HonoRequestContext<TEvents>, TEvents>['bodyParser']>[0]): void {
    if (options === false) {
      this.parserCount = 0;
      return;
    }

    this.parserCount += 1;

    // Hono has no parser registry: the pre-hook installed in `onInitialize`
    // decides by content type. Recording the intent lets the adapter report the
    // two options it genuinely cannot honour, rather than leaving the caller to
    // discover it at runtime.
    if (options.raw === true) {
      this.logger.warn('ctx.body cannot be a Buffer on Hono — a fetch body is read as text. Remove app.raw() and parse ctx.rawText yourself.');
    }
    if (options.multipart) {
      this.logger.warn('Hono handles multipart through `c.req.parseBody()`. Remove app.multipart() and call it in the handler.');
    }
  }

  public useStaticAssets(root: string, options: Record<string, unknown> = {}): void {
    const { prefix, ...staticOptions } = options;
    this.defer((app) => {
      const module = loadOptional<{ serveStatic: (opts: object) => (c: HonoContext<Env, any>, next: Next) => Promise<Response> }>('hono/serve-static');
      app.use((prefix as string) || '*', module.serveStatic({ root, ...staticOptions }));
    });
  }

  // ── Routes ─────────────────────────────────────────────────────────────

  public registerRoute(method: string, path: string, action: RouteAction<HonoContext<Env, any>, Response, HonoRequestContext<TEvents>>): void {
    const entry = this.pendingRoute ?? { method, verb: method.toLowerCase(), path, action, origin: 'manual' as const };
    const url = toNamedWildcard(path, 'splat');
    const verb = method.toLowerCase();

    const handler = async (honoCtx: HonoContext<Env, any>): Promise<Response> => {
      const ctx = this.createContext(honoCtx, new Response(), this.events);
      await this.dispatch(entry, honoCtx, ctx.res);

      // Hono requires a `Response` from every handler, and there are three ways
      // to end up with one:
      //
      // - `ctx.response` — the adapter's own writer, the normal path
      // - `ctx.res` — a fluent `ctx.json()` / `ctx.throw()` the handler called
      //   directly. Without this a `return ctx.throw(404)` becomes a `204`: the
      //   error handler wrote the response, `written` was set, `write()` was
      //   skipped, and the handler had nothing to return.
      // - a `204` — a handler that answered nothing
      const response = ctx.response ?? (ctx.written ? ctx.res : new Response(null, { status: HttpStatus.NO_CONTENT }));

      // Hono's `c.res` is the response a framework-native `useRaw()` middleware
      // built. The adapter's is authoritative for status and body, but a header
      // that middleware added — `c.header('x-request-id', id)`, a CORS allow-list
      // — would otherwise be silently dropped, which makes `useRaw` look broken
      // for the one thing people use it for. The adapter's own headers win on a
      // conflict, because they were chosen deliberately for this reply.
      honoCtx.res = honoCtx.res?.headers ? mergeForeignHeaders(response, honoCtx.res) : response;
      return honoCtx.res;
    };
    // Hono's `on()` takes any method string, so a WebDAV verb needs no
    // emulation — the same as Koa, and the reason these two are the least
    // surprising for an extended method set.
    this.instance.on(verb === 'all' ? '*' : (method.toUpperCase() as never), url, handler as never);

    if (verb === 'all') {
      this.logger.debug('Registered a catch-all route via Hono\'s "*" method');
    }
  }

  // ── Middleware ─────────────────────────────────────────────────────────

  /**
   * Hono's `use` already has the Gland signature, so this is a pass-through.
   */
  public useOne(...args: unknown[]): unknown {
    const [first, second] = args;
    if (typeof first === 'string' && typeof second === 'function') {
      return this.instance.use(first, second as never);
    }
    return this.instance.use('*', first as never);
  }

  /**
   * Wraps one Gland middleware in Hono's `(c, next)` signature.
   *
   * Path scoping is checked at request time rather than by mounting once per
   * path, so `app.use(['/a', '/b'], mw)` mounts a single entry.
   */
  public bridgeGland(entry: MiddlewareEntry, _request?: HonoContext<Env, any>, _response?: Response, _next?: unknown): (c: HonoContext<Env, any>, next: Next) => Promise<void> {
    const middleware = entry.value as (ctx: HonoRequestContext<TEvents>, next: () => Promise<void>) => unknown;
    const prefixes = (Array.isArray(entry.path) ? entry.path : entry.path ? [entry.path] : []).map(String);

    return async (honoCtx: HonoContext<Env, any>, next: Next) => {
      const path = new URL(honoCtx.req.url).pathname;
      if (prefixes.length > 0 && !prefixes.some((prefix) => matchesPrefix(path, prefix))) {
        await next();
        return;
      }

      const ctx = this.createContext(honoCtx, new Response(), this.events);
      const bridge: (error?: unknown) => Promise<void> = async (error) => {
        if (error) throw error;
        await next();
      };
      ctx.next = bridge;
      await middleware(ctx, bridge);

      // A middleware that answers instead of calling `next()` — a CORS preflight,
      // a rate-limit rejection, a cache hit — never reaches the route handler, so
      // nothing else would hand Hono a `Response`. Without this, Hono's dispatcher
      // throws "Context is not finalized" and the short circuit becomes a `500`,
      // which is the exact opposite of what it was for.
      if (ctx.written && ctx.res && !honoCtx.res?.body) honoCtx.res = ctx.res;
    };
  }

  // ── Context ────────────────────────────────────────────────────────────

  /**
   * Returns the request's context, creating it once.
   *
   * Memoised on the Hono context, which is the object every middleware and the
   * handler share. The Fetch `Request` is also shared, but it belongs to the
   * caller and hanging a symbol off it would be rude.
   */
  public createContext(honoCtx: HonoContext<Env, any>, _res?: Response, events: HttpEventBroker<TEvents> = this.events): HonoRequestContext<TEvents> {
    const host = honoCtx as HonoContext<Env, any> & { [CONTEXT_KEY]?: HonoRequestContext<TEvents> };
    if (host[CONTEXT_KEY]) return host[CONTEXT_KEY] as HonoRequestContext<TEvents>;

    const ctx = new HonoRequestContext<TEvents>(events, honoCtx);
    Object.defineProperty(honoCtx, CONTEXT_KEY, { value: ctx, enumerable: false, configurable: true, writable: true });
    return ctx;
  }

  /**
   * Copies the route parameters onto the context, once Hono has matched.
   *
   * `c.req.param()` reads Hono's own store, which is only populated inside a
   * route handler — and the context a Gland middleware produced is the one the
   * handler reuses.
   */
  protected override syncParams(ctx: HonoRequestContext<TEvents>, req: HonoContext<Env, any>): void {
    const params = req.req.param();
    if (params && Object.keys(params).length > 0) ctx.params = params as Record<string, string>;
  }

  // ── Replies ────────────────────────────────────────────────────────────

  public responded(ctx: HonoRequestContext<TEvents>): boolean {
    return ctx.responded;
  }

  public async write(ctx: HonoRequestContext<TEvents>, payload: ReplyPayload): Promise<void> {
    ctx.wrote();
    await this.composeResponse(ctx, payload);

    // The single point where a fetch response becomes the handler's return
    // value. Hono returns whatever the handler returns, and nothing reads
    // `ctx.res` — so a branch that only set `ctx.res` produced a `204` with an
    // empty body, for every route, with no error anywhere.
    //
    // `??=` rather than `=`: the stream and SSE branches assign the *streaming*
    // response to `ctx.response` directly, and overwriting it here discarded the
    // body. A streamed reply then arrived as a `200` with nothing in it.
    ctx.response ??= ctx.res;
  }

  /** Builds the response for one {@link ReplyPayload}. */
  private async composeResponse(ctx: HonoRequestContext<TEvents>, payload: ReplyPayload): Promise<void> {
    if (payload.status) ctx.status(payload.status);
    if (payload.headers) ctx.setHeaders(payload.headers as never);

    const contentType = contentTypeFor(payload);
    if (contentType && !ctx.getResponseHeader('content-type')) ctx.setHeader('content-type', contentType);
    if (payload.filename) ctx.attachment(payload.filename);

    switch (payload.kind) {
      case 'empty':
        ctx.end();
        return;

      case 'json':
        ctx.json(payload.body);
        return;

      case 'text':
        ctx.text(payload.body === undefined ? '' : String(payload.body));
        return;

      case 'buffer':
        ctx.response = new Response(payload.body as FetchBodyInit, { status: ctx.res?.status ?? 200, headers: ctx.res?.headers });
        return;

      case 'stream':
        await this.pipeStream(ctx, payload.body as NodeJS.ReadableStream);
        return;

      case 'sse': {
        const sse = payload.body as SseStream;
        const headers = new Headers(ctx.res?.headers);
        for (const [name, value] of Object.entries(sse.headers)) headers.set(name, value);
        await this.pipeStream(ctx, sse, headers);
        return;
      }

      case 'redirect':
        ctx.redirect(String(payload.body), payload.status ?? HttpStatus.FOUND);
        return;

      case 'file':
        await ctx.sendFile(String(payload.body));
        return;

      default:
        ctx.json(payload.body);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Starts a Node server, if one can be started.
   *
   * Hono is runtime-agnostic, so "listen" is Node-specific. On an edge runtime
   * the right move is to export `app.fetch` and there is nothing to bind; that
   * is a log line rather than an error, because it is the intended deployment.
   */
  public listen(port: number, options: { host?: string; message?: string } = {}): void {
    const host = options.host ?? 'localhost';
    const app = this.instance;

    if (typeof process === 'undefined' || !process.versions?.node) {
      this.logger.info('Hono is running on a non-Node runtime — export `app.fetch` instead of calling listen().');
      return;
    }

    const nodeServer = loadOptional<{ serve: (opts: object) => { close: (cb: () => void) => void; address?: () => { port: number } | string | null; once?: (e: string, cb: () => void) => void } }>(
      '@hono/node-server',
    );

    try {
      const server = nodeServer.serve({ fetch: app.fetch, port, hostname: host });
      this.nodeServer = server;

      // The *bound* port, not the requested one. `listen(0)` asks the OS for a
      // free port, and reporting `0` as the address makes every subsequent
      // request fail with `fetch failed` rather than with anything diagnosable.
      const resolvePort = (): number => {
        const address = server.address?.();
        return typeof address === 'object' && address ? address.port : port;
      };

      const announce = (): void => {
        const bound = resolvePort();
        this.boundPort = bound;
        this.events.safeEmit(HttpEvent.ServerListening, {
          host,
          port: bound,
          url: `http${this.options?.https ? 's' : ''}://${host}:${bound}`,
          message: options.message,
          timestamp: new Date().toISOString(),
        });
        this.logger.info(options.message ?? `Hono listening on ${host}:${bound}`);
      };

      if (server.address && server.once) {
        // `@hono/node-server`'s `serve()` binds asynchronously.
        server.once('listening', announce);
      } else {
        announce();
      }
    } catch (error) {
      this.crash(`Hono failed to listen on ${host}:${port}`, error);
    }
  }

  public async close(): Promise<void> {
    const startedAt = Date.now();
    const server = this.nodeServer;
    if (!server) {
      this.publishClosed(startedAt, true);
      return;
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.nodeServer = undefined;
    this.boundPort = undefined;
    this.publishClosed(startedAt, false);
    this.logger.info('Hono server closed');
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async pipeStream(ctx: HonoRequestContext<TEvents>, source: NodeJS.ReadableStream, headers?: Headers): Promise<void> {
    const status = ctx.res?.status ?? 200;

    if (!isReadableStream(source)) {
      ctx.response = new Response(null, { status, headers: headers ?? ctx.res?.headers });
      return;
    }

    try {
      // Node 18+ converts a readable to a web stream natively. The check comes
      // first because `Readable.toWeb` throws on a non-stream — which, in a
      // handler, becomes a `500` with no indication that the body was the problem.
      const readable = source as Readable;
      ctx.response = new Response(readable.readableObjectMode ? objectModeToWeb(readable) : (Readable.toWeb(readable) as ReadableStream), {
        status,
        headers: headers ?? ctx.res?.headers,
      });
    } catch (error) {
      this.logger.error('Could not convert a reply stream to a fetch stream', error instanceof Error ? error.stack : String(error));
      ctx.response = Response.json({ error: 'Internal Server Error' }, { status: HttpStatus.INTERNAL_SERVER_ERROR });
    }
  }
}

/**
 * Copies the headers a framework-native middleware added onto the adapter's
 * response.
 *
 * Only headers the adapter's response does not already carry. A `c.res` built
 * by `useRaw` is otherwise discarded wholesale, so `c.header('x-request-id', …)`
 * in a raw middleware would never reach the client — and a header is most of
 * what a raw middleware is for.
 *
 * What this cannot do is change the status or the body. A Fetch `Response` is
 * immutable, and the adapter's is the one the handler's return value describes.
 * A `useRaw` middleware on Hono can therefore observe and add headers, and can
 * short-circuit by returning its own `Response` — it cannot amend a reply the
 * handler already composed.
 */
function mergeForeignHeaders(response: Response, foreign: Response): Response {
  const merged = new Headers(response.headers);
  foreign.headers.forEach((value, name) => {
    if (!merged.has(name)) merged.set(name, value);
  });

  if ([...merged].every(([name, value]) => response.headers.get(name) === value)) return response;
  return new Response(response.body, { status: response.status, headers: merged });
}

/** Symbol key under which the Gland context is memoised on a Hono context. */
const CONTEXT_KEY = Symbol.for('@glandjs/http:hono-context');

/** Whether a method can carry a body. */
function canHaveBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

/**
 * Adapts an object-mode readable to a byte stream.
 *
 * `Readable.from(['a', 'b'])` produces an **object-mode** stream, and
 * `Readable.toWeb` refuses those — it throws, and the handler turns into a `500`
 * for what is an ordinary `return Readable.from([...])`. Hono targets edge
 * runtimes, which have no object mode, so the chunks are stringified on the way
 * through.
 *
 * A `Buffer` or string chunk passes through unchanged; an object is
 * `JSON.stringify`-ed, which is what a caller streaming JSON fragments means.
 */
function objectModeToWeb(readable: Readable): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = readable[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }

      if (value === undefined || value === null) return;

      if (typeof value === 'string' || value instanceof Uint8Array || Buffer.isBuffer(value)) {
        controller.enqueue(typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value as Uint8Array));
        return;
      }

      controller.enqueue(encoder.encode(JSON.stringify(value)));
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

/** Requires an optional Hono helper, with a message that says what to install. */
function loadOptional<T>(name: string): T {
  try {
    return require(name) as T;
  } catch {
    throw new Error(`The "${name}" package is missing. Install it to use the Hono feature that needs it.`);
  }
}

/** Whether `path` starts with `prefix` on a segment boundary. */
function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix === '/' || prefix === '') return true;
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === normalized || path.startsWith(`${normalized}/`);
}
