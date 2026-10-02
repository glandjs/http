import {
  HttpReply,
  HttpServerAdapter,
  ServerFactory,
  contentTypeFor,
  isReadableStream,
  toNamedWildcard,
  type HttpEventBroker,
  type MiddlewareEntry,
  type ReplyPayload,
  type RouteAction,
  type SseStream,
} from '@glandjs/http';
import { HttpEvent, ROUTABLE_VERBS, isCoreVerb, type CoreHttpVerb } from '@glandjs/http';
import { HttpStatus } from '@medishn/toolkit';
import express, {
  json as jsonParser,
  raw as rawParser,
  text as textParser,
  urlencoded as urlencodedParser,
  type Application,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { loadPackage } from '@glandjs/common';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type { Server } from 'node:http';
import type { HttpEventRecord } from '@glandjs/http';
import { ExpressContext } from './context';

/**
 * The Express adapter.
 *
 * Express is the easiest framework to adapt and the easiest to adapt *badly*,
 * because two of its affordances — `app.use` and `next()` — do not fit the
 * Gland model. This adapter handles both explicitly rather than pretending.
 *
 * ### `app.use` is split in two
 *
 * Gland's `use()` is a promise-based onion. Express's is a synchronous
 * hand-off. Rather than infer intent from a function's arity — the previous
 * adapter treated any 2- or 3-argument function as Gland middleware, which
 * silently mis-typed every Express handler — the two are separate:
 *
 * - `app.use((ctx, next) => …)` — Gland middleware, on the onion
 * - `app.useRaw(express.static('./public'))` — Express middleware, unmolested
 *
 * ### `next()` cannot be awaited
 *
 * `await next()` resolves as soon as Express hands control downstream, so an
 * upstream `try/catch` will not see a downstream throw. The error still reaches
 * the error handler — `next(err)` is called for you — but you cannot *measure*
 * what happened after the hand-off. Koa, Fastify, Hono and `node:http` all
 * support the real thing. This is the one behavioural difference between the
 * adapters, and it is a property of Express rather than of Gland.
 *
 * ### Method fallbacks
 *
 * Express 5 exposes seven verbs. `@Propfind()` and the rest of WebDAV are
 * registered with `router.all()` plus a method guard, so a controller can
 * declare them and get a correct 405-free route instead of a silent 404.
 *
 * @typeParam TEvents - the application's channel event map
 */
export class ExpressAdapter<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpServerAdapter<Server, Application, Request, Response, ExpressContext<TEvents>, TEvents> {
  /**
   * Where routes go once a global prefix is set.
   *
   * The previous implementation created a `Router` in `setGlobalPrefix()` and
   * mounted it, but then registered routes on the *application* — so the
   * mounted router stayed empty and the prefix did nothing. The router is now
   * the registration target whenever a prefix exists.
   */
  private router: ExpressRouter = express.Router();

  /** Whether {@link ExpressAdapter.router} is the registration target. */
  private usingRouter = false;

  /**
   * Where routes go.
   *
   * The application itself, with no mounted router. `HttpServerAdapter.route()`
   * has already applied the global prefix to every path, so mounting a `Router`
   * at the same prefix as well would make every route live at
   * `/api/api/products` — which is what the previous implementation did, and
   * why every request 404'd.
   */

  constructor() {
    super(express(), undefined, 'HTTP:Express');
  }

  // ── Set-up ─────────────────────────────────────────────────────────────

  protected async onInitialize(): Promise<void> {
    const app = this.instance;

    if (this.options?.trustProxy !== undefined) app.set('trust proxy', this.options.trustProxy as never);
    if (this.options?.poweredBy !== undefined) app.set('x-powered-by', this.options.poweredBy === false ? false : this.options.poweredBy);

    this.logger.info('Express adapter configured');
  }

  /**
   * Mounts the terminal 404, behind every route.
   *
   * `app.use()` in the right place would be wrong: a middleware mounted before a
   * matching route answers first, so a 404 registered alongside the parsers
   * returns "not found" for every request the application ever serves.
   */
  protected override afterRoutes(): void {
    this.instance.use((req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) return next();
      void this.notFound(this.createContext(req, res, this.events));
    });
  }

  /**
   * Records body parsers, in the order they were requested.
   *
   * Each key is independent, so `app.json(); app.urlencoded()` installs both,
   * and `false` for a key leaves that parser out. The parsers go into the
   * middleware queue rather than being applied directly, which is what puts
   * them ahead of every route — Express skips middleware mounted after a
   * matching route, and the previous version applied them from `listen()`,
   * which is too late.
   *
   * Because they share the queue, they are mounted where you called them. The
   * parsers declared in `HttpApplicationOptions.bodyParser` are queued first, by
   * the constructor, so a middleware that reads `ctx.body` sees a parsed body.
   */
  public bodyParser(options: Parameters<HttpServerAdapter<Server, Application, Request, Response, ExpressContext<TEvents>, TEvents>['bodyParser']>[0]): void {
    if (options === false) return;

    const limit = options.limit;

    if (options.json !== false) {
      const json = typeof options.json === 'object' ? options.json : {};
      this.queue.push({
        kind: 'raw',
        value: [
          jsonParser({
            limit: json.limit ?? limit,
            strict: json.strict ?? true,
            // `jsonSuffix: false` narrows the match to bare `application/json`,
            // which is what the flag means; leaving it undefined would let a
            // `+json` suffix through regardless of the option.
            ...(json.jsonSuffix === false ? { type: 'application/json' } : {}),
          }),
        ],
      });
    }

    if (options.urlencoded !== false) {
      const urlencoded = typeof options.urlencoded === 'object' ? options.urlencoded : {};
      // `depth` and `parameterLimit` are `qs` options — they only exist when
      // `extended` is on, and passing them with `extended: false` is silently
      // ignored by Express. Dropping them here keeps the call honest.
      const extended = urlencoded.extended === true;
      this.queue.push({
        kind: 'raw',
        value: [
          urlencodedParser({
            limit: urlencoded.limit ?? limit,
            extended,
            ...(extended ? { parameterLimit: urlencoded.parameterLimit, depth: urlencoded.depth } : {}),
          } as never),
        ],
      });
    }

    if (options.text !== false) {
      const text = typeof options.text === 'object' ? options.text : {};
      this.queue.push({ kind: 'raw', value: [textParser({ limit: text.limit ?? limit, defaultCharset: text.defaultCharset })] });
    }

    if (options.raw !== false) {
      const raw = typeof options.raw === 'object' ? options.raw : {};
      this.queue.push({ kind: 'raw', value: [rawParser({ limit: raw.limit ?? limit, type: '*/*' })] });
    }

    if (options.multipart) {
      // Express has no built-in multipart parser, and pretending otherwise would
      // mean silently dropping every file upload. Failing at configuration time
      // is the only honest option.
      throw new Error('Express cannot parse multipart/form-data on its own. Install `multer` and mount it with `app.useRaw(uploader)`, then read `req.file` in your controller.');
    }
  }

  /**
   * Records a static mount.
   *
   * @param root - directory on disk
   * @param options - `prefix` for the URL, plus `express.static` options
   */
  public useStaticAssets(root: string, options: Record<string, unknown> = {}): void {
    const { prefix, ...staticOptions } = options;
    const mount = express.static(root, staticOptions as never);
    this.queue.push({ value: prefix ? [prefix, mount] : [mount], kind: 'raw' });
  }
  // ── Routes ─────────────────────────────────────────────────────────────

  public registerRoute(method: string, path: string, action: RouteAction<Request, Response, ExpressContext<TEvents>>): void {
    const target = this.instance as unknown as RouteRegistrar;
    // Express 4 spells a catch-all `*`; Express 5 wants a name. Both are
    // accepted, and a bare `*` is translated so a controller can declare it once.
    const routePath = toNamedWildcard(path, '_gland');
    const verb = method.toLowerCase();

    // Closed over rather than looked up later: `registerRoute` is called before
    // the entry reaches the route table, and by the time a request arrives that
    // table may hold dozens of routes.
    const entry = this.pendingRoute ?? { method, verb, path, action, origin: 'manual' as const };

    const handler: RequestHandler = (req, res, next) => {
      void this.dispatch(entry, req, res).catch(next);
    };

    if (isCoreVerb(verb) || verb === 'all') {
      target[verb as keyof RouteRegistrar](routePath, handler);
      return;
    }

    // Not a verb Express knows. `all()` plus a guard gives a working route
    // instead of a `TypeError: router.propfind is not a function` at boot.
    target.all(routePath, (req: Request, res: Response, next: NextFunction) => {
      if (req.method.toLowerCase() !== verb) return next();
      handler(req, res, next);
    });

    this.logger.debug(`Registered ${method} via an Express method guard (${verb} is not a native verb)`);
  }

  // ── Middleware ─────────────────────────────────────────────────────────

  public useOne(...args: unknown[]): unknown {
    return this.instance.use(...(args as never[]));
  }

  /**
   * Wraps one Gland middleware in Express's `(req, res, next)` signature.
   *
   * Path scoping is applied here rather than at mount time so that
   * `app.use(['/a', '/b'], mw)` mounts once and checks both prefixes — Express's
   * own `use(prefix, mw)` would need one mount per path and would evaluate the
   * prefix against the full URL, including any global prefix already added to
   * `path`.
   */
  public bridgeGland(entry: MiddlewareEntry, request?: Request, response?: Response, next?: NextFunction): RequestHandler {
    const middleware = entry.value as (ctx: ExpressContext<TEvents>, next: (error?: unknown) => Promise<void>) => unknown;
    const prefixes = (Array.isArray(entry.path) ? entry.path : entry.path ? [entry.path] : []).map((prefix) => prefix as string);

    return (req: Request, res: Response, done: NextFunction) => {
      if (prefixes.length > 0 && !prefixes.some((prefix) => matchesPrefix(req.path, prefix))) return done();

      const ctx = this.createContext(req, res, this.events);
      const bridge = this.bridgeNext(done as never);
      ctx.next = bridge;

      try {
        const result = middleware(ctx, bridge);
        // Awaited so a *synchronous* throw in the middleware is caught here
        // rather than becoming an unhandled rejection. Express cannot await the
        // downstream half, and that limitation is documented, not hidden.
        if (isThenable(result)) {
          Promise.resolve(result).catch((error: unknown) => done(error));
        }
      } catch (error) {
        done(error);
      }
    };
  }

  // ── Context ────────────────────────────────────────────────────────────

  /**
   * Returns the request's context, creating it once.
   *
   * Memoised on `req.ctx`. Express exposes the same request object to every
   * middleware and to the route handler, which makes it the one reliable place
   * to hang a single context — and it means `ctx.state` set in a middleware is
   * the same `ctx.state` the handler sees.
   */
  public createContext(req: Request, res: Response, events: HttpEventBroker<TEvents> = this.events): ExpressContext<TEvents> {
    const existing = (req as Request & { glandContext?: ExpressContext<TEvents> }).glandContext;
    if (existing) return existing;

    const ctx = new ExpressContext<TEvents>(events, req, res);
    Object.defineProperty(req, 'glandContext', { value: ctx, enumerable: false, configurable: true, writable: true });

    // A client that hangs up mid-response is normal — a closed tab, a cancelled
    // fetch. Marking it means a handler can bail out instead of writing to a
    // destroyed socket.
    res.on('close', () => {
      if (!res.writableEnded) ctx.aborted = true;
    });

    return ctx;
  }

  /**
   * Copies `req.params` onto the context, once the router has filled them.
   *
   * Express populates params inside the route handler, so a context first built
   * by a middleware has none. Without this, `ctx.params` is `{}` for every
   * parameterised route — and a handler reading `ctx.params.id` fails with a
   * confusing "cannot read property of undefined" instead of an obvious "no such
   * parameter".
   */
  protected override syncParams(ctx: ExpressContext<TEvents>, req: Request): void {
    if (req.params) ctx.params = req.params as Record<string, string>;
  }

  // ── Replies ────────────────────────────────────────────────────────────

  public responded(ctx: ExpressContext<TEvents>): boolean {
    return ctx.responded;
  }

  /**
   * Writes a resolved payload.
   *
   * Ordered from most specific to least: a status and headers first so every
   * branch benefits, then the kind. `sse` is checked before `stream` because an
   * `SseStream` *is* a `Readable` — the difference is the three headers and the
   * flush that a raw pipe would not set.
   */
  public async write(ctx: ExpressContext<TEvents>, payload: ReplyPayload): Promise<void> {
    ctx.wrote();
    const res = ctx.res;

    if (payload.status) res.status(payload.status);
    if (payload.headers) ctx.setHeaders(payload.headers as never);

    const contentType = contentTypeFor(payload);
    if (contentType && !res.getHeader('Content-Type')) res.setHeader('Content-Type', contentType);
    if (payload.filename) ctx.attachment(payload.filename);

    switch (payload.kind) {
      case 'empty':
        res.end();
        return;

      case 'json':
        res.json(payload.body);
        return;

      case 'text':
        res.send(payload.body === undefined ? '' : String(payload.body));
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
        res.flushHeaders?.();
        await this.pipeStream(ctx, sse);
        return;
      }

      case 'redirect':
        res.redirect(payload.status ?? HttpStatus.FOUND, String(payload.body));
        return;

      case 'file':
        res.sendFile(String(payload.body), (payload.fileOptions ?? {}) as never, (error) => {
          if (error) res.status(HttpStatus.NOT_FOUND).json({ error: 'Not Found' });
        });
        return;

      default:
        res.json(payload.body);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  public listen(port: number, options: { host?: string; message?: string; server?: Record<string, unknown> } = {}): void {
    const host = options.host ?? 'localhost';

    // Re-entrant: `app.listen(3000).listen(3001)` in a test would otherwise
    // leak a socket, and `close()` would then find two.
    if (this.server) {
      this.logger.warn(`Already listening on port ${this.boundPort}; ignoring the request to listen on ${host}:${port}.`);
      return;
    }

    // The server is created here, not in `onInitialize`, because the request
    // listener is the Express application — which only becomes final after the
    // middleware queue and every route have been mounted.
    this.server = ServerFactory.create(this.options, this.instance as never);

    const server = this.server;
    server.on('error', (error) => this.crash(`Express server error on ${host}:${port}`, error));
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
      this.logger.info(options.message ?? `Express listening on ${host}:${bound}`);
    });

    server.listen(port, host);
  }

  public async close(): Promise<void> {
    const startedAt = Date.now();
    const server = this.server;
    // `listening`, not merely `server`. `listen()` creates the handle and then
    // binds, so a `close()` racing the bind — or following a `listen()` that
    // never ran — finds a `Server` that rejects `close()` with "Server is not
    // running". Reporting that as a crash is noise, not information.
    if (!server || !server.listening) {
      this.publishClosed(startedAt, true);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // `server.close()` waits for every keep-alive connection to drain, which
      // on a default 5 s keep-alive means a 5 s shutdown. Nuking the idle
      // sockets turns that into an immediate one without cutting off a request
      // that is still being written.
      server.closeIdleConnections?.();
    }).catch((error: unknown) => this.crash('Error while closing the Express server', error));

    this.server = undefined;
    this.boundPort = undefined;
    this.publishClosed(startedAt, false);
    this.logger.info('Express server closed');
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Pipes a readable to the response, with the stream's own headers honoured.
   *
   * `pipeline` rather than `pipe` so a mid-stream error destroys the response
   * instead of leaving a truncated body with a `200` already sent — a `pipe`
   * failure is silent, and the client sees a valid-looking empty download.
   */
  private async pipeStream(ctx: ExpressContext<TEvents>, source: NodeJS.ReadableStream): Promise<void> {
    if (!isReadableStream(source)) {
      ctx.res.end();
      return;
    }

    const res = ctx.res;
    const streamHeaders = (source as { getHeaders?: () => Record<string, string> }).getHeaders?.();
    if (streamHeaders && res.getHeader('Content-Type') === undefined && streamHeaders.type) {
      res.setHeader('Content-Type', streamHeaders.type);
    }

    try {
      await streamPipeline(source, res);
    } catch (error) {
      this.logger.error('Error while streaming a response', error instanceof Error ? error.stack : String(error));
      if (!res.headersSent) res.status(HttpStatus.INTERNAL_SERVER_ERROR);
      res.end();
    }
  }
}

/** The Express application, exposed for advanced configuration. */
export type ExpressApp = Application;

/** Every verb Gland can ask Express to register, native or guarded. */
export const EXPRESS_VERBS = ROUTABLE_VERBS;

/** Re-exported so an application can reach Express's own helpers. */
export { HttpReply };

/** Whether a value is a thenable. Local, to avoid a dependency for one check. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function';
}

/**
 * The verbs a Gland route can be registered on.
 *
 * `Application` and `Router` both satisfy this, and the seven core verbs plus
 * `all` are the only keys Gland ever writes to. Narrowing through one alias
 * keeps the `as never` casts in `registerRoute` from spreading.
 */
type RouteRegistrar = Record<CoreHttpVerb | 'all', (path: string, handler: RequestHandler) => unknown>;

/** Whether `path` starts with `prefix` on a segment boundary. */
function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix === '/' || prefix === '') return true;
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === normalized || path.startsWith(`${normalized}/`);
}
