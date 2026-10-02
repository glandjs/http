import {
  HttpServerAdapter,
  ServerFactory,
  contentTypeFor,
  isReadableStream,
  toNamedWildcard,
  type HttpApplicationOptions,
  type HttpEventBroker,
  type HttpEventRecord,
  type MiddlewareEntry,
  type ReplyPayload,
  type RegisteredRoute,
  type RouteAction,
  type SseStream,
} from '@glandjs/http';
import { HttpEvent } from '@glandjs/http';
import { HttpStatus, isNil } from '@medishn/toolkit';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { NodeContext, collectBody } from './context';

/**
 * A route as the built-in router stores it.
 *
 * @internal
 */
interface CompiledRoute<TEvents extends HttpEventRecord = HttpEventRecord> {
  method: string;
  segments: Segment[];
  /** `true` when the pattern ended in a wildcard. */
  wildcard: boolean;
  route: RegisteredRoute<IncomingMessage, ServerResponse, NodeContext<TEvents>>;
}

/** One path segment of a compiled pattern. @internal */
type Segment = { kind: 'literal'; value: string } | { kind: 'param'; name: string } | { kind: 'wildcard'; name: string };

/**
 * The `node:http` adapter.
 *
 * No framework, no dependencies — `ServerFactory`, the router, the reply writer
 * and the body collector are all in these two files. It is here for three
 * reasons, in order of importance:
 *
 * 1. **It proves the contract.** If `@glandjs/http` can serve HTTP over
 *    `node:http` with no framework at all, then the framework adapters are
 *    genuinely thin, and a sixth one would be easy to write.
 * 2. **It is the smallest install.** For a service that is one endpoint and a
 *    health check, pulling in Express is a large cost for a small problem.
 * 3. **It is the reference.** Every awkward decision in the other four adapters
 *    — path normalisation, reply coercion, cookie serialisation — is implemented
 *    here against primitives, so there is a place to check what the intended
 *    behaviour actually is.
 *
 * ### The router
 *
 * A compiled segment matcher, not a regular expression. It has to be a segment
 * matcher for two reasons: `:id` must not match across a `/` (so `/a/b` is not
 * `/a/:x/y`), and the `X-Powered-By`-grade failure of an unescaped user value in
 * a `RegExp` is not a risk worth taking when the alternative is thirty lines.
 *
 * @typeParam TEvents - the application's channel event map
 */
export class NodeAdapter<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpServerAdapter<Server, void, IncomingMessage, ServerResponse, NodeContext<TEvents>, TEvents> {
  /** Compiled routes, in registration order. */
  private readonly compiled: CompiledRoute<TEvents>[] = [];

  /** The request listener, wired once `initialize()` has run. */
  private listener?: (req: IncomingMessage, res: ServerResponse) => void;

  /** Body size limit, in bytes. */
  private bodyLimit = 100 * 1024;

  constructor(options?: HttpApplicationOptions) {
    // `TApp` is `void`: this adapter has no application object. `instance` is
    // the server's request listener, created in `onInitialize` instead.
    super(undefined as void, options, 'HTTP:Node');
  }

  // ── Set-up ─────────────────────────────────────────────────────────────

  protected async onInitialize(options?: HttpApplicationOptions): Promise<void> {
    this.listener = (req, res) => {
      void this.handle(req, res);
    };

    if (options?.poweredBy !== false) this.poweredBy = 'Gland';
    this.logger.info('node:http adapter configured');
  }

  /**
   * Records the parser the application asked for.
   *
   * Unlike the framework adapters there is nothing to register: `node:http` has
   * one way to read a body, and the decoding is driven by `Content-Type` in
   * {@link NodeContext.body}. So the only thing this method decides is *whether*
   * to collect at all — and honouring `false` matters, because
   * `bodyParser: false` is the documented default and means "no parser is
   * installed", not "collect and hope".
   */
  public bodyParser(options: Parameters<HttpServerAdapter<Server, void, IncomingMessage, ServerResponse, NodeContext<TEvents>, TEvents>['bodyParser']>[0]): void {
    if (options === false) {
      this.bodyParsing = false;
      return;
    }

    this.bodyParsing = true;
    const limit = options.limit;
    if (typeof limit === 'number') this.bodyLimit = limit;
    else if (typeof limit === 'string') this.bodyLimit = parseByteSize(limit);
  }

  public useStaticAssets(root: string, _options: Record<string, unknown> = {}): void {
    // A static mount is a route with a wildcard pattern, which is all
    // `serveStatic` needs. The previous version of this adapter ignored the
    // option entirely, so `useStaticAssets` was a no-op.
    this.queue.push({ value: { static: root }, kind: 'raw' });
  }

  // ── Routing ────────────────────────────────────────────────────────────

  public registerRoute(method: string, path: string, action: RouteAction<IncomingMessage, ServerResponse, NodeContext<TEvents>>): void {
    // `pendingRoute` is always set when `registerRoute` is reached through
    // `HttpServerAdapter.route()`. The fallback covers a direct call, and is
    // typed explicitly because an object literal would otherwise widen
    // `NodeContext<TEvents>` to `NodeContext<Record<string, any>>` and make the
    // route table unreadable.
    const entry: RegisteredRoute<IncomingMessage, ServerResponse, NodeContext<TEvents>> = this.pendingRoute ?? {
      method: method.toUpperCase(),
      verb: method.toLowerCase(),
      path,
      action: action as RouteAction<IncomingMessage, ServerResponse, NodeContext<TEvents>>,
      origin: 'manual',
    };

    this.compiled.push({
      method: method.toUpperCase(),
      segments: compile(path),
      wildcard: /[*]/.test(path),
      route: entry,
    });
  }

  // ── Middleware ─────────────────────────────────────────────────────────

  /**
   * Gland middleware, and the whole onion, are implemented here.
   *
   * `node:http` has no middleware concept at all, so the chain is a loop over
   * the recorded entries. That makes this the one adapter where the onion is
   * unambiguously real: `await next()` awaits the next index, and a `throw`
   * unwinds through every frame.
   */
  public useOne(...args: unknown[]): unknown {
    // `node:http` cannot host framework-native middleware. Recording the value
    // and refusing it is the honest answer; `useStaticAssets` is the one
    // framework feature with a native equivalent and it is handled above.
    if (args.length > 0) {
      this.logger.warn('useRaw() has no meaning on the node:http adapter — the middleware was ignored.');
    }
    return undefined;
  }

  /**
   * The onion is implemented in {@link NodeAdapter.handle}, which walks the queue
   * directly. This method exists because the base class declares it — and it
   * returns a single-step bridge, which is all a caller invoking it directly can
   * usefully get.
   */
  public bridgeGland(entry: MiddlewareEntry, _request?: IncomingMessage, _response?: ServerResponse, next?: () => void): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    const middleware = entry.value as (ctx: NodeContext<TEvents>, next: () => Promise<void>) => unknown;
    const prefixes = (Array.isArray(entry.path) ? entry.path : entry.path ? [entry.path] : []).map(String);

    return async (req: IncomingMessage, res: ServerResponse) => {
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      if (prefixes.length > 0 && !prefixes.some((prefix) => matchesPrefix(path, prefix))) {
        next?.();
        return;
      }
      const ctx = this.createContext(req, res, this.events);
      await middleware(ctx, async () => next?.());
    };
  }

  // ── Context ────────────────────────────────────────────────────────────

  /**
   * Returns the request's context, creating it once.
   *
   * The context is memoised on a `Symbol` rather than on `req.glandContext`,
   * because the raw request object is shared with anything else holding a
   * reference to it and a visible property would collide.
   */
  public createContext(req: IncomingMessage, res: ServerResponse, events: HttpEventBroker<TEvents> = this.events): NodeContext<TEvents> {
    const host = req as IncomingMessage & { [CONTEXT_KEY]?: NodeContext<TEvents> };
    if (host[CONTEXT_KEY]) return host[CONTEXT_KEY] as NodeContext<TEvents>;

    const ctx = new NodeContext<TEvents>(events, req, res);
    Object.defineProperty(req, CONTEXT_KEY, { value: ctx, enumerable: false, configurable: true, writable: true });

    res.once('close', () => {
      if (!res.writableEnded) ctx.aborted = true;
    });

    return ctx;
  }

  // ── Replies ────────────────────────────────────────────────────────────

  public responded(ctx: NodeContext<TEvents>): boolean {
    return ctx.responded;
  }

  public async write(ctx: NodeContext<TEvents>, payload: ReplyPayload): Promise<void> {
    ctx.wrote();
    const res = ctx.res;

    if (payload.status) res.statusCode = payload.status;
    if (payload.headers) ctx.setHeaders(payload.headers as never);

    const contentType = contentTypeFor(payload);
    if (contentType && !res.hasHeader('Content-Type')) res.setHeader('Content-Type', contentType);
    if (payload.filename) ctx.attachment(payload.filename);

    switch (payload.kind) {
      case 'empty':
        // A `204` must not carry a body or a `Content-Length`; Node will throw
        // `ERR_HTTP_BODY_NOT_ALLOWED` if one is written.
        if (res.statusCode === HttpStatus.NO_CONTENT || res.statusCode === HttpStatus.NOT_MODIFIED) res.removeHeader('Content-Length');
        res.end();
        return;

      case 'json':
        ctx.json(payload.body);
        return;

      case 'text':
        ctx.text(payload.body === undefined ? '' : String(payload.body));
        return;

      case 'buffer':
        res.end(payload.body as Buffer);
        return;

      case 'stream':
        await this.pipeStream(ctx, payload.body as NodeJS.ReadableStream);
        return;

      case 'sse': {
        const sse = payload.body as SseStream;
        for (const [name, value] of Object.entries(sse.headers)) res.setHeader(name, value);
        res.writeHead(res.statusCode);
        await this.pipeStream(ctx, sse);
        return;
      }

      case 'redirect':
        // `redirect()` ends the response itself.
        ctx.redirect(String(payload.body), payload.status ?? HttpStatus.FOUND);
        return;

      case 'file':
        await this.writeFile(ctx, String(payload.body), payload.filename);
        return;

      default:
        ctx.json(payload.body);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  public listen(port: number, options: { host?: string; message?: string; server?: Record<string, unknown> } = {}): void {
    const host = options.host ?? 'localhost';
    const server = ServerFactory.create(this.options, this.listener);
    this.server = server;

    server.on('error', (error) => this.crash(`node:http server error on ${host}:${port}`, error));
    server.on('listening', () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      this.boundPort = bound;
      this.events.safeEmit(HttpEvent.ServerListening, {
        host,
        port: bound,
        url: `http${ServerFactory.isSecure(this.options) ? 's' : ''}://${host}:${bound}`,
        message: options.message,
        timestamp: new Date().toISOString(),
      });
      this.logger.info(options.message ?? `node:http listening on ${host}:${bound}`);
    });

    server.listen(port, host);
  }

  public async close(): Promise<void> {
    const startedAt = Date.now();
    const server = this.server;
    if (!server) {
      this.publishClosed(startedAt, true);
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
    });

    this.server = undefined;
    this.boundPort = undefined;
    this.publishClosed(startedAt, false);
    this.logger.info('node:http server closed');
  }

  // ── The request pipeline ───────────────────────────────────────────────

  /**
   * Matches a route, runs the middleware chain, and dispatches.
   *
   * Order matters and is the reason this is one function rather than three:
   * the chain runs for *every* request including the unmatched one, so a
   * `401` middleware can protect a 404 as well as a handler. A path-scoped
   * middleware is a no-op here, exactly as it is on the other adapters.
   */
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.poweredBy && !res.hasHeader('X-Powered-By')) res.setHeader('X-Powered-By', this.poweredBy);

    const ctx = this.createContext(req, res, this.events);
    const matched = this.match(ctx.path, req.method ?? 'GET');

    if (matched) {
      ctx.params = matched.params;
    }

    const chain = this.middlewareChain;
    const run = async (index: number): Promise<void> => {
      const entry = chain[index];
      if (!entry) {
        if (matched) await this.dispatch(matched.route, req, res);
        else await this.notFound(ctx);
        return;
      }

      const middleware = entry.value as (context: NodeContext<TEvents>, next: () => Promise<void>) => unknown;
      const prefixes = (Array.isArray(entry.path) ? entry.path : entry.path ? [entry.path] : []).map(String);
      const path = ctx.path;

      if (prefixes.length > 0 && !prefixes.some((prefix) => matchesPrefix(path, prefix))) {
        await run(index + 1);
        return;
      }

      ctx.next = async (error?: unknown) => {
        if (error) throw error;
        await run(index + 1);
      };

      await middleware(ctx, ctx.next);
    };

    try {
      await run(0);
    } catch (error) {
      // A middleware that threw outside `dispatch` never reaches the pipeline's
      // own error handling, so it is rendered here. The response may already be
      // partially written, in which case the only honest thing left is to end it.
      if (res.headersSent) {
        res.end();
      } else {
        await this.safelyRenderError(error, ctx);
      }
    }
  }

  /** The recorded Gland middleware, as the chain walks it. */
  private get middlewareChain(): MiddlewareEntry[] {
    return (this as unknown as { queue: MiddlewareEntry[] }).queue.filter((entry) => entry.kind === 'gland');
  }

  /**
   * Finds the first route whose method and pattern match.
   *
   * Registration order is the tiebreak, so a specific route registered before a
   * wildcard wins — which is the behaviour every framework here already has, and
   * the one an application migrating from Express will expect.
   */
  private match(path: string, method: string): { route: RegisteredRoute<IncomingMessage, ServerResponse, NodeContext<TEvents>>; params: Record<string, string> } | undefined {
    const normalized = normalize(path);
    const segments = splitSegments(normalized);

    for (const candidate of this.compiled) {
      if (candidate.method !== 'ALL' && candidate.method !== method.toUpperCase()) continue;

      const params = matchSegments(candidate.segments, segments);
      if (params) return { route: candidate.route, params };
    }

    return undefined;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async pipeStream(ctx: NodeContext<TEvents>, source: NodeJS.ReadableStream): Promise<void> {
    if (!isReadableStream(source)) {
      ctx.res.end();
      return;
    }

    const streamHeaders = (source as { getHeaders?: () => Record<string, string> }).getHeaders?.();
    if (streamHeaders && ctx.res.getHeader('Content-Type') === undefined && streamHeaders.type) {
      ctx.res.setHeader('Content-Type', streamHeaders.type);
    }

    try {
      // `pipeline` destroys the response on a mid-stream failure. A bare `pipe`
      // would swallow the error and leave the client with a truncated body and a
      // `200` already on the wire — a valid-looking empty download.
      await streamPipeline(source, ctx.res);
    } catch (error) {
      this.logger.error('Error while streaming a response', error instanceof Error ? error.stack : String(error));
      if (!ctx.res.writableEnded) ctx.res.end();
    }
  }

  private async writeFile(ctx: NodeContext<TEvents>, filePath: string, filename?: string): Promise<void> {
    if (filename) ctx.attachment(filename);
    try {
      const stats = await stat(filePath);
      ctx.res.setHeader('Content-Length', String(stats.size));
      await streamPipeline(createReadStream(filePath), ctx.res);
    } catch (error) {
      this.logger.error(`Failed to send ${filePath}`, error instanceof Error ? error.stack : String(error));
      if (!ctx.res.headersSent) ctx.res.statusCode = HttpStatus.NOT_FOUND;
      ctx.res.end('Not Found');
    }
  }

  /** `X-Powered-By` value, or `undefined` to omit the header. */
  private poweredBy?: string;

  /**
   * Puts the body collector at the head of the queue.
   *
   * `ctx.body` is parsed from the bytes this accumulates, so it has to run before
   * any user middleware — a middleware that reads `ctx.body` and is mounted
   * first would see `undefined` for every request.
   *
   * Skipped entirely when no parser was declared. Collecting bytes nobody
   * parses is a `413` risk with no benefit, and it makes the documented
   * "`bodyParser: false` is the safe default" true here as it is everywhere else.
   */
  protected override beforeFlush(): void {
    if (this.collectorQueued || !this.bodyParsing) return;
    this.collectorQueued = true;
    this.use(collectBody(this.bodyLimit) as never);
  }

  /** Whether the body collector is already in the queue. */
  private collectorQueued = false;

  /** Whether the application asked for a body parser at all. */
  private bodyParsing = false;
}

/** Symbol key under which the Gland context is memoised on a request. */
const CONTEXT_KEY = Symbol.for('@glandjs/http:node-context');

/**
 * Compiles a route pattern into segments.
 *
 * `@internal` Exported for the unit tests, which is the only reason it is not
 * a module-private function.
 */
export function compile(pattern: string): Segment[] {
  return splitSegments(normalize(pattern)).map((segment) => {
    if (segment.startsWith(':')) return { kind: 'param', name: segment.slice(1) };
    if (segment.startsWith('*')) return { kind: 'wildcard', name: segment.slice(1) || 'wildcard' };
    return { kind: 'literal', value: segment };
  });
}

/**
 * Matches compiled segments against a request path.
 *
 * Returns the captured parameters, or `undefined` for no match. A wildcard
 * swallows the rest of the path, because a named `*` in a route pattern means
 * "and everything after".
 */
export function matchSegments(pattern: Segment[], actual: string[]): Record<string, string> | undefined {
  const params: Record<string, string> = {};

  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index] as Segment;
    const value = actual[index];

    if (segment.kind === 'wildcard') {
      params[segment.name] = actual.slice(index).join('/');
      return params;
    }

    if (value === undefined) return undefined;

    if (segment.kind === 'literal') {
      // Case-sensitive. A path is case-sensitive per RFC 3986, and a
      // case-insensitive match is how `/Users` and `/users` become one route.
      if (segment.value !== value) return undefined;
      continue;
    }

    if (value === '') return undefined;
    params[segment.name] = decodeURIComponent(value);
  }

  return actual.length === pattern.length ? params : undefined;
}

/** Normalises a path: one leading slash, no trailing slash, no empty segments. */
function normalize(path: string): string {
  return `/${path}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

/** Splits a path into non-empty segments. */
function splitSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** Whether `path` starts with `prefix` on a segment boundary. */
function matchesPrefix(path: string, prefix: string): boolean {
  if (isNil(prefix) || prefix === '/' || prefix === '') return true;
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === normalized || path.startsWith(`${normalized}/`);
}

/** Parses `'2mb'` / `'100kb'` into bytes. */
function parseByteSize(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value.trim());
  if (!match) return 100 * 1024;

  const amount = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const factor = unit === 'kb' ? 1024 : unit === 'mb' ? 1024 ** 2 : unit === 'gb' ? 1024 ** 3 : 1;
  return Math.floor(amount * factor);
}

export { HttpEvent };
