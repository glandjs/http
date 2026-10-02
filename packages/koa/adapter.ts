import {
  HttpServerAdapter,
  contentTypeFor,
  isReadableStream,
  toVerb,
  type HttpApplicationOptions,
  type HttpEventBroker,
  type HttpEventRecord,
  type MiddlewareEntry,
  type ReplyPayload,
  type RouteAction,
  type SseStream,
} from '@glandjs/http';
import { HttpEvent, isCoreVerb } from '@glandjs/http';
import { HttpStatus } from '@medishn/toolkit';
import Koa, { type Middleware, type ParameterizedContext } from 'koa';
import Router from '@koa/router';
import type { Server } from 'node:http';
import { KoaContext } from './context';

/**
 * The Koa adapter.
 *
 * Koa has the closest middleware model to Gland's, so this adapter is mostly
 * plumbing:
 *
 * - `app.use` takes `(ctx, next)`, which *is* the Gland contract, so the onion
 *   is real — `await next()` genuinely waits, and a downstream `throw` reaches
 *   an upstream `catch`.
 * - `@koa/router` provides matching and `ctx.params`. It is a required
 *   dependency because Koa deliberately has no router, and Gland's route table
 *   needs one.
 * - Body parsing is `koa-bodyparser`, loaded on request rather than bundled,
 *   because parsing is a security decision — limits, encodings, content types —
 *   and Koa's answer to it is a well-known package rather than a rewrite.
 *
 * ### Why the router is mounted, not merged
 *
 * `setGlobalPrefix` mounts the router at the prefix rather than prepending it to
 * each route. Prepending works until a controller declares a wildcard, and then
 * two routes collide — a bug that is invisible until it is a 404 in production.
 * Mounting keeps one source of truth for the prefix.
 *
 * @typeParam TEvents - the application's channel event map
 */
export class KoaAdapter<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpServerAdapter<Server, Koa, ParameterizedContext, ParameterizedContext, KoaContext<TEvents>, TEvents> {
  /** The router every route is registered on. */
  private readonly router: Router = new Router();

  /** Whether the router has been mounted on the application. */
  private mounted = false;

  /** Body parser options, applied at initialisation. */
  private parserOptions: Record<string, unknown> | null = null;

  /** Whether `koa-bodyparser` should be loaded. */
  private wantsBodyParser = false;

  constructor(options?: HttpApplicationOptions) {
    super(new Koa(), options, 'HTTP:Koa');
  }

  // ── Set-up ─────────────────────────────────────────────────────────────

  protected async onInitialize(options?: HttpApplicationOptions): Promise<void> {
    const app = this.instance;

    // `poweredBy: false` is a no-op here. Koa sets no `X-Powered-By` of its own —
    // that is Express — and its `app.context.remove()` delegates are not
    // available during construction, so the option is accepted and ignored
    // rather than half-applied. A reverse proxy that adds the header is a
    // proxy's configuration, not the adapter's.

    // Koa's own error boundary. Gland's `dispatch` already catches inside a
    // route, but a throw from Gland *middleware* propagates here, and the
    // default handler would answer with Koa's HTML error page.
    app.on('error', (error: unknown) => {
      this.logger.error('Koa application error', error instanceof Error ? error.stack : String(error));
    });

    this.logger.info('Koa adapter initialized');
  }

  /**
   * Registers `koa-bodyparser`.
   *
   * Loaded rather than bundled: it is the single most security-sensitive
   * dependency in an HTTP stack, and pinning it here would put that choice in
   * Gland's hands rather than the application's.
   */
  public bodyParser(options: Parameters<HttpServerAdapter<Server, Koa, ParameterizedContext, ParameterizedContext, KoaContext<TEvents>, TEvents>['bodyParser']>[0]): void {
    if (options === false) {
      this.wantsBodyParser = false;
      this.parserOptions = null;
      return;
    }

    const record = options as unknown as Record<string, unknown>;
    this.wantsBodyParser = true;
    this.parserOptions = {
      // A 100 kB default. `koa-bodyparser`'s own default is 1 MB, which is
      // generous for JSON and is part of why the CVE history of this package is
      // what it is.
      jsonLimit: jsonLimit(record) ?? '100kb',
      formLimit: '100kb',
      textLimit: '100kb',
      // Multipart is not handled here: streaming a file upload through a
      // buffering parser is how a 10 MB video becomes a 10 MB heap spike.
      enableTypes: ['json', 'form', 'text'],
    };
  }

  public useStaticAssets(root: string, options: Record<string, unknown> = {}): void {
    const { prefix, ...staticOptions } = options;
    const serve = loadOptional<(root: string, opts?: object) => Middleware>('koa-static');
    const mount = serve(root, staticOptions as never);
    this.queue.push({ value: prefix ? [prefix, mount] : [mount], kind: 'raw' });
  }

  // ── Routes ─────────────────────────────────────────────────────────────

  public registerRoute(method: string, path: string, action: RouteAction<ParameterizedContext, ParameterizedContext, KoaContext<TEvents>>): void {
    const entry = this.pendingRoute ?? { method, verb: method.toLowerCase(), path, action, origin: 'manual' as const };
    const target = this.registrationTarget();
    const verb = toVerb(method);

    const handler: Middleware = async (ctx, next) => {
      await this.dispatch(entry, ctx, next);
    };

    if (isCoreVerb(verb) || verb === 'all') {
      // `router.register` rather than `router.get`, so the seven core verbs go
      // through one code path and `ALL` does not need its own branch.
      target.register(path, [method as never], handler);
      return;
    }

    // WebDAV and friends: `@koa/router` accepts any method string, so nothing
    // has to be emulated here — the reason Koa is the least surprising of the
    // five for a `@Propfind()` controller.
    target.register(path, [method as never], handler);
    this.logger.debug(`Registered ${method} on the Koa router (${verb})`);
  }

  // ── Middleware ─────────────────────────────────────────────────────────

  /**
   * Koa's `use` already has the Gland signature, so this is a pass-through.
   *
   * That is not quite true of the *ordering*: Koa runs `use` in registration
   * order, and Gland flushes the queue in registration order too, so the two
   * agree. It is the one adapter where the bridge really is free.
   */
  public useOne(...args: unknown[]): unknown {
    return this.instance.use(...(args as Middleware[]));
  }

  /**
   * Wraps one Gland middleware in Koa's `(ctx, next)` signature.
   *
   * The result is the middleware function itself when the arity already matches,
   * which keeps the stack introspectable — `app.middleware` still shows the
   * user's own functions rather than Gland's wrappers.
   */
  public bridgeGland(entry: MiddlewareEntry): Middleware {
    const middleware = entry.value as (ctx: KoaContext<TEvents>, next: () => Promise<void>) => unknown;
    const prefixes = (Array.isArray(entry.path) ? entry.path : entry.path ? [entry.path] : []).map(String);

    return async (ctx: ParameterizedContext, next: () => Promise<void>) => {
      const path = ctx.path;
      if (prefixes.length > 0 && !prefixes.some((prefix) => matchesPrefix(path, prefix))) {
        await next();
        return;
      }

      const glandCtx = this.createContext(ctx);
      // Koa's onion already matches Gland's: `next()` returns a promise, a
      // downstream `throw` propagates through it, and an upstream `catch` sees
      // it. The bridge is a one-line adapter over that, which is why this is
      // the shortest of the five implementations.
      const bridge: (error?: unknown) => Promise<void> = async (error) => {
        if (error) throw error;
        await next();
      };

      glandCtx.next = bridge;
      await middleware(glandCtx, bridge);
    };
  }

  // ── Context ────────────────────────────────────────────────────────────

  /**
   * Returns the Koa context wrapped as a Gland context, creating it once.
   *
   * Koa passes the same object through the whole onion, so the memoisation key
   * is a symbol on the Koa context itself. The previous implementation stored
   * the Gland context on `req.ctx`, which was a different object per phase on
   * Koa and would have produced a fresh, empty `ctx.state` in the handler.
   */
  public createContext(ctx: ParameterizedContext, events: HttpEventBroker<TEvents> = this.events): KoaContext<TEvents> {
    const host = ctx as ParameterizedContext & { [CONTEXT_KEY]?: KoaContext<TEvents> };
    if (host[CONTEXT_KEY]) return host[CONTEXT_KEY] as KoaContext<TEvents>;

    const glandCtx = new KoaContext<TEvents>(events, ctx);
    Object.defineProperty(ctx, CONTEXT_KEY, { value: glandCtx, enumerable: false, configurable: true, writable: true });

    // Koa emits `close` on the socket, which fires for both a completed response
    // and an aborted one; `ctx.res.writableEnded` distinguishes them.
    ctx.res.once('close', () => {
      if (!ctx.res.writableEnded) glandCtx.aborted = true;
    });

    return glandCtx;
  }

  /**
   * Copies `ctx.params` from the Koa context, once `@koa/router` has filled it.
   *
   * The same late-binding problem as Express: a Gland middleware reaches the
   * context before the router has matched, so the context it produced — the one
   * memoised for the request — has no parameters.
   */
  protected override syncParams(ctx: KoaContext<TEvents>, req: ParameterizedContext): void {
    if (req.params) ctx.params = req.params as Record<string, string>;
  }

  // ── Replies ────────────────────────────────────────────────────────────

  public responded(ctx: KoaContext<TEvents>): boolean {
    return ctx.responded;
  }

  public async write(ctx: KoaContext<TEvents>, payload: ReplyPayload): Promise<void> {
    ctx.wrote();
    const target = ctx.res;

    if (payload.status) target.status = payload.status;
    if (payload.headers) ctx.setHeaders(payload.headers as never);

    const contentType = contentTypeFor(payload);
    if (contentType && !target.response.get('Content-Type')) target.type = contentType;
    if (payload.filename) ctx.attachment(payload.filename);

    switch (payload.kind) {
      case 'empty':
        // Koa needs an explicit `null`; an unset body is what produces a 204 by
        // default, and a 200-with-no-body needs `ctx.body = ''`.
        target.body = payload.status === 200 || payload.status === 201 ? '' : null;
        return;

      case 'json':
        // Assigning `ctx.body` rather than calling `ctx.json` lets Koa's own
        // content-type negotiation run, and it is the only path that sets
        // `Content-Length` correctly for a nested object.
        target.body = payload.body;
        return;

      case 'text':
        target.body = payload.body === undefined ? '' : String(payload.body);
        return;

      case 'buffer':
        target.body = payload.body as Buffer;
        return;

      case 'stream':
        await this.pipeStream(ctx, payload.body as NodeJS.ReadableStream);
        return;

      case 'sse': {
        const sse = payload.body as SseStream;
        for (const [name, value] of Object.entries(sse.headers)) target.set(name, value);
        target.status = HttpStatus.OK;
        // Koa owns the body stream from here: setting `ctx.body` to the readable
        // is how it pipes, and it will not add `Content-Length` for a stream.
        target.body = sse;
        return;
      }

      case 'redirect':
        target.redirect(String(payload.body));
        target.status = payload.status ?? HttpStatus.FOUND;
        return;

      case 'file':
        void ctx.sendFile(String(payload.body));
        return;

      default:
        target.body = payload.body;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  public listen(port: number, options: { host?: string; message?: string } = {}): void {
    const host = options.host ?? 'localhost';
    const app = this.instance;
    const server = app.listen(port, host);

    server.on('error', (error) => this.crash(`Koa server error on ${host}:${port}`, error));
    server.on('listening', () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      this.boundPort = bound;
      this.events.safeEmit(HttpEvent.ServerListening, {
        host,
        port: bound,
        url: `http${this.options?.https ? 's' : ''}://${host}:${bound}`,
        message: options.message,
        timestamp: new Date().toISOString(),
      });
      this.logger.info(options.message ?? `Koa listening on ${host}:${bound}`);
    });

    this.server = server;
  }

  public async close(): Promise<void> {
    const startedAt = Date.now();
    const server = this.server;
    if (!server) {
      this.publishClosed(startedAt, true);
      return;
    }

    // Koa has no `close()` that drains. `server.close()` waits for in-flight
    // requests and refuses new ones, which is the same guarantee Fastify gives
    // and the reason it beats `closeAllConnections()` for a server with
    // keep-alive clients.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
    });

    this.server = undefined;
    this.boundPort = undefined;
    this.publishClosed(startedAt, false);
    this.logger.info('Koa server closed');
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Mounts the terminal 404, behind the router.
   *
   * `@koa/router` leaves `ctx.status` at `404` and `ctx.body` unset when nothing
   * matched, and Koa would then answer with its own body. This replaces it with
   * the same problem document every other adapter produces.
   */
  protected override afterRoutes(): void {
    this.instance.use(async (ctx: ParameterizedContext, next: () => Promise<void>) => {
      await next();
      // Only a genuine miss. A handler that set a body, or a status other than
      // Koa's default, has already answered.
      if (ctx.status !== HttpStatus.NOT_FOUND || ctx.body !== undefined) return;
      await this.notFound(this.createContext(ctx));
    });
    this.logger.debug('Koa 404 handler mounted');
  }

  /** The router, mounted on first use. */
  private registrationTarget(): Router {
    if (!this.mounted) {
      this.mounted = true;
      // The body parser has to be first: a Gland middleware that reads
      // `ctx.body` would otherwise see `undefined` for every request.
      if (this.wantsBodyParser) {
        this.instance.use(loadOptional<Middleware>('koa-bodyparser')(this.parserOptions ?? {}));
      }
      // The router carries **no** prefix. `HttpServerAdapter.route()` has already
      // applied the global prefix to every path, so setting one here as well
      // would produce `/api/api/products` for every route. `app.use(router)`
      // rather than `app.use(prefix, router)` for the same reason.
      this.instance.use(this.router.routes());
      this.instance.use(this.router.allowedMethods());
      this.logger.debug(`Koa router mounted (prefix "${this.prefix}" already applied to the paths)`);
    }
    return this.router;
  }

  private async pipeStream(ctx: KoaContext<TEvents>, source: NodeJS.ReadableStream): Promise<void> {
    if (!isReadableStream(source)) {
      ctx.res.body = '';
      return;
    }

    const streamHeaders = (source as { getHeaders?: () => Record<string, string> }).getHeaders?.();
    if (streamHeaders && ctx.res.response.get('Content-Type') === undefined && streamHeaders.type) {
      ctx.res.type = streamHeaders.type;
    }

    // Koa pipes a stream set as `ctx.body` itself, on the way out. Assigning it
    // is therefore the whole implementation, and `pipeline` is not used here for
    // that reason — it would compete with Koa for the same stream.
    ctx.res.body = source;
  }
}

/** Symbol key under which the Gland context is memoised on a Koa context. */
const CONTEXT_KEY = Symbol.for('@glandjs/http:koa-context');

/** JSON body limit, in the units `koa-bodyparser` expects. */
function jsonLimit(options: Record<string, unknown>): string | number | undefined {
  const json = options.json as { limit?: number | string } | boolean | undefined;
  if (json && typeof json === 'object') return json.limit;
  const limit = options.limit as number | string | undefined;
  if (limit === undefined) return undefined;
  return typeof limit === 'number' ? `${limit}b` : limit;
}

/** Whether `path` starts with `prefix` on a segment boundary. */
function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix === '/' || prefix === '') return true;
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === normalized || path.startsWith(`${normalized}/`);
}

/**
 * Requires an optional Koa companion package, with a message that says what to
 * install.
 *
 * `loadPackage` from `@glandjs/common` does the same, but it is a peer
 * dependency here and a static import of its types is not worth the coupling for
 * two calls. The message is the part that matters.
 */
function loadOptional<T>(name: string): T {
  try {
    return require(name) as T;
  } catch {
    throw new Error(`The "${name}" package is missing. Install it to use the Koa feature that needs it.`);
  }
}
