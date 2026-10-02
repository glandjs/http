import type { EventRecord } from '@glandjs/events';
import { HttpStatus, isNil, isString } from '@medishn/toolkit';
import type { HttpServerAdapter, MiddlewareEntry } from './adapter';
import { HttpEvent } from './constants';
import { HttpReply, type ErrorHandlerFunction, type MiddlewareFunction, type RegisteredRoute, type ReplyPayload, type RouteAction } from './contracts';
import type { HttpContext } from './context';
import type { HttpEventRecord } from './events/http-events';
import type { BodyParserOptions, CorsConfig, HttpApplicationOptions, ServerListening, StaticAssetOptions } from './interfaces';
import { errorHandler } from './middleware';
import { createCorsMiddleware } from './middleware/cors.middleware';
import { applyPrefix, normalizePath } from './utils/path.util';

/**
 * An HTTP application.
 *
 * The class every adapter extends, and the only thing a controller or a test
 * ever sees. It owns no framework: `get`, `use`, `listen` and `close` all
 * delegate to an {@link HttpServerAdapter}, and everything that has to behave
 * identically across transports already lives there.
 *
 * ### Ordering
 *
 * The three kinds of registration are buffered and flushed once, by
 * {@link HttpServerAdapter.initialize}, before the first route exists:
 *
 * ```
 * app.use(auth)                    // Gland onion, mounted 1st
 * app.useRaw(compression())        // framework middleware, mounted 2nd
 * app.get('/health', handler)      // route, registered 3rd by connectTo()
 * ```
 *
 * That is why `listen()` in this package used to apply parser middleware with
 * `console.log` in a loop: routes were registered at construction time, so
 * anything mounted afterwards sat behind them. Buffering fixes the ordering
 * rather than papering over it.
 *
 * ### Lifecycle
 *
 * ```
 * new HttpCore(options)   → adapter.initialize() → middleware flushed
 * app.connectTo(Broker)   → routes registered from the binder's broadcast
 * app.listen(port)        → socket bound
 * ```
 *
 * @typeParam TServer - the framework's server handle
 * @typeParam TApp - the framework's application instance
 * @typeParam TRequest - the framework's request object
 * @typeParam TResponse - the framework's response object
 * @typeParam TContext - the adapter's context
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const app = new ExpressCore<MyEvents>({ prefix: '/api' });
 *
 * app.use(async (ctx, next) => {
 *   const started = Date.now();
 *   await next();
 *   console.log(`${ctx.method} ${ctx.path} ${Date.now() - started}ms`);
 * });
 *
 * app.get('/health', (ctx) => ({ ok: true }));
 *
 * await app.listen(3000);
 * ```
 */
export class HttpCore<
  TServer = unknown,
  TApp = unknown,
  TRequest = any,
  TResponse = any,
  TContext extends HttpContext<TRequest, TResponse, any> = HttpContext<TRequest, TResponse, any>,
  TEvents extends EventRecord = HttpEventRecord,
> {
  /**
   * Options this application was constructed with.
   *
   * Named `appOptions` rather than `options` because
   * {@link HttpCore.options} is the `OPTIONS` route verb — `app.options('/cors',
   * handler)` is the spelling every framework uses, and it is worth more than a
   * symmetrical field name. Read it back through {@link HttpCore.settings}.
   */
  public readonly appOptions: HttpApplicationOptions;

  constructor(
    /** The framework adapter. Public so an application can reach framework-native settings. */
    public readonly adapter: HttpServerAdapter<TServer, TApp, TRequest, TResponse, TContext, TEvents & HttpEventRecord>,
    options: HttpApplicationOptions = {},
  ) {
    this.appOptions = options;
    // Synchronous by design. `initialize()` is async so an adapter *can* await
    // something, but making the constructor async would force every caller —
    // including the five adapter cores, which are constructed inside a broker's
    // constructor — into a promise. It does not await here, and
    // `finalize()` awaits it again, so nothing is lost.
    void this.adapter.initialize(options);
    this.applyOptions(options);
  }

  // ── Identity ───────────────────────────────────────────────────────────

  /** The adapter's lifecycle bus. */
  public get broker() {
    return this.adapter.events;
  }

  /** Id of the adapter's broker. */
  public get id(): string {
    return this.adapter.id;
  }

  /** The framework's application instance — `express()`, the `Koa` instance, the `Fastify` instance. */
  public get instance(): TApp {
    return this.adapter.instance;
  }

  /**
   * Resolved configuration.
   *
   * The previous implementation returned `undefined` — `get settings() { return }`
   * — so there was nowhere to read the effective prefix, view directory, or
   * port from. Everything here is post-application, not post-construction:
   * `setGlobalPrefix()` shows up, and the constructor options that lost to it do
   * not.
   */
  public get settings(): HttpApplicationSettings {
    return {
      prefix: this.adapter.prefix,
      port: this.adapter.port,
      views: this.adapter.viewConfig,
      routeCount: this.adapter.routeTable.length,
      middlewareCount: this.middleware.length,
      poweredBy: this.appOptions.poweredBy === false ? false : (this.appOptions.poweredBy ?? 'Gland'),
      options: this.appOptions,
    };
  }

  /** The routes registered so far, in registration order. */
  public get routes(): readonly RegisteredRoute<TRequest, TResponse, TContext>[] {
    return this.adapter.routeTable;
  }

  /** The middleware recorded so far, in the order it will be mounted. */
  public get middleware(): readonly MiddlewareEntry[] {
    return (this.adapter as unknown as { queue: MiddlewareEntry[] }).queue;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Binds a socket and starts accepting requests.
   *
   * Everything the framework needs is mounted first, and in this order:
   * framework configuration, middleware and plugins, then routes. The user's
   * call order therefore does not matter — `http.use()` after `connectTo()` and
   * before it would both end up ahead of every route.
   *
   * Fluent, and deliberately not awaitable: `app.listen(3000)` reads better than
   * `await app.listen(3000)` in a bootstrap file, and the promise is available
   * through {@link HttpCore.ready} for the code that has to wait.
   *
   * A start-up failure is reported on `HttpEvent.ServerCrashed` and logged. It
   * does not throw, because throwing from a synchronous-looking call makes
   * `EADDRINUSE` depend on whether a `.catch()` was attached — and the outcome
   * should be the same either way.
   *
   * @param port - TCP port. `0` asks the OS for a free one.
   * @param options - host, log message, socket options
   * @returns `this`
   */
  public listen(port: number, options: ServerListening = {}): this {
    const host = options.host ?? 'localhost';

    this.listenRequested = true;
    this.listening ??= this.waitForListening();

    // `finalize()` is what mounts middleware and registers routes, so it has to
    // complete before the socket accepts anything. It is idempotent, and
    // `HttpCore.ready()` calls it too — whichever runs first wins.
    void this.adapter
      .finalize()
      .then(() => {
        const result = this.adapter.listen(port, { ...options, host });
        // Adapters whose `listen` is async (Fastify, Hono) return a promise. It
        // is observed here so a late failure reaches the event bus instead of
        // becoming an unhandled rejection.
        if (isThenable(result)) {
          result.catch((error: unknown) => this.adapter.crash(`Failed to start listening on ${host}:${port}`, error));
        }
      })
      .catch((error: unknown) => this.adapter.crash(`Failed to start listening on ${host}:${port}`, error));

    return this;
  }

  /**
   * Resolves once the server is bound and accepting requests.
   *
   * Meaningful for every adapter, not just the async ones: Express, Koa and
   * `node:http` set `port` from a socket `listening` event, so a
   * `listen(0); await ready()` sequence would otherwise return a still-`undefined`
   * port — which is exactly what a test binding an OS-assigned port needs.
   *
   * A start-up failure rejects, and so does a 30 s timeout, so a caller that
   * awaits this cannot hang on a `listen()` that never happened.
   */
  public async ready(): Promise<this> {
    await this.adapter.finalize();

    const prepare = (this.adapter as unknown as { ready?: () => Promise<unknown> }).ready;
    if (typeof prepare === 'function') await prepare.call(this.adapter);

    if (this.listenRequested && this.adapter.port === undefined) {
      await this.listening;
    }

    return this;
  }

  /**
   * Resolves on the first `ServerListening`, rejects on a crash or a timeout.
   *
   * Private because `ready()` is the public spelling; exposed as a field so
   * `listen()` and `ready()` share one promise rather than each creating a
   * subscription.
   */
  private waitForListening(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const events = this.adapter.events;

      const settle = (fn: () => void): void => {
        clearTimeout(timer);
        events.off(HttpEvent.ServerListening, onListening);
        events.off(HttpEvent.ServerCrashed, onCrashed);
        fn();
      };

      const onListening = (): void => settle(resolve);
      const onCrashed = (event: unknown): void => settle(() => reject(new Error(String((event as { message?: string } | undefined)?.message ?? 'The server failed to start listening.'))));

      const timer = setTimeout(() => settle(() => reject(new Error('Timed out after 30s waiting for the server to start listening.'))), 30_000);
      timer.unref?.();

      events.on(HttpEvent.ServerListening, onListening);
      events.on(HttpEvent.ServerCrashed, onCrashed);
    });
  }

  private listenRequested = false;
  private listening?: Promise<void>;

  /** The bound port, or `undefined` before `listen()`. */
  public get port(): number | undefined {
    return this.adapter.port;
  }

  /**
   * Stops accepting requests and releases the socket.
   *
   * Safe to call when the server was never started, in which case it resolves
   * without doing anything. `GlandFactory`'s shutdown hook calls this, so an
   * application that wired its lifecycle properly drains in-flight requests
   * before the process exits.
   */
  public async close(): Promise<void> {
    await this.adapter.close();
  }

  // ── Middleware ─────────────────────────────────────────────────────────

  /**
   * Registers Gland middleware.
   *
   * The onion is promise-based: `await next()` waits for everything downstream.
   * On Express the hand-off cannot be awaited — that is a property of
   * `express`'s `next()`, not of Gland — so an upstream `catch` will not see a
   * downstream throw. Everything else, including path scoping and ordering
   * against `useRaw`, behaves identically on all five adapters.
   *
   * @example
   * ```ts
   * app.use(async (ctx, next) => {
   *   ctx.state.requestId = ctx.requestId;
   *   await next();
   *   logger.info({ id: ctx.requestId, status: ctx.status });
   * });
   * ```
   */
  public use(middleware: MiddlewareFunction<TContext>): this;

  /**
   * Registers Gland middleware under one or more paths.
   *
   * @param path - URL prefix, or an array of prefixes
   * @param middleware - `(ctx, next) => …`
   */
  public use(path: string | readonly string[], middleware: MiddlewareFunction<TContext>): this;
  public use(first: MiddlewareFunction<TContext> | string | readonly string[], second?: MiddlewareFunction<TContext>): this {
    if (isString(first) || Array.isArray(first)) {
      if (isNil(second)) {
        throw new TypeError('app.use(path, middleware) requires a middleware function as its second argument.');
      }
      this.adapter.use(first as string | readonly string[], second);
    } else {
      this.adapter.use(first as MiddlewareFunction<TContext>);
    }
    return this;
  }

  /**
   * Registers framework-native middleware, unmolested.
   *
   * For anything Gland does not wrap — `express.static()`, `compression()`,
   * `@fastify/helmet()`. Mounted in call order, interleaved with `use()`.
   *
   * @example
   * ```ts
   * import compression from 'compression';
   * app.useRaw(compression());
   * ```
   */
  public useRaw(...args: unknown[]): this {
    this.adapter.useRaw(...args);
    return this;
  }

  /**
   * Replaces the terminal error renderer.
   *
   * @param handler - receives the error and the context
   *
   * @example
   * ```ts
   * app.setErrorHandler((error, ctx) => {
   *   ctx.json({ error: ctx.requestId }, 500);
   * });
   * ```
   */
  public setErrorHandler(handler: ErrorHandlerFunction<TContext>): this {
    this.errorRenderer = handler;
    (this.adapter as unknown as { errorHandler: ErrorHandlerFunction<TContext> }).errorHandler = handler;
    return this;
  }

  private errorRenderer: ErrorHandlerFunction<TContext> = errorHandler as ErrorHandlerFunction<TContext>;

  // ── Routing ────────────────────────────────────────────────────────────

  /**
   * Registers a route.
   *
   * Called by `GlandBroker` for every route the core binder discovers, and
   * available directly for a route that is not tied to a controller.
   *
   * @param method - the wire method, e.g. `'GET'`
   * @param path - the route path; the global prefix is applied here
   * @param action - the handler
   * @returns `this`
   */
  public registerRoute(method: string, path: string, action: RouteAction<TRequest, TResponse, TContext>, origin: RegisteredRoute<TRequest, TResponse, TContext>['origin'] = 'manual'): this {
    this.adapter.route(method, path, action, origin);
    return this;
  }

  /** `GET path`. Fluent. */
  public get(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('GET', path, action);
  }

  /** `POST path`. Fluent. */
  public post(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('POST', path, action);
  }

  /** `PUT path`. Fluent. */
  public put(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('PUT', path, action);
  }

  /** `PATCH path`. Fluent. */
  public patch(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('PATCH', path, action);
  }

  /** `DELETE path`. Fluent. */
  public delete(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('DELETE', path, action);
  }

  /** `HEAD path`. Fluent. */
  public head(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('HEAD', path, action);
  }

  /** `OPTIONS path`. Fluent. */
  public options(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('OPTIONS', path, action);
  }

  /** Every method. Expands to the full routable set in each adapter. */
  public all(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('ALL', path, action);
  }

  /** `TRACE path`. */
  public trace(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('TRACE', path, action);
  }

  /** `CONNECT path`. */
  public connect(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('CONNECT', path, action);
  }

  /** `PURGE path` — RFC 9111, for a CDN. */
  public purge(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('PURGE', path, action);
  }

  /** `SEARCH path` — RFC 5323. */
  public search(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('SEARCH', path, action);
  }

  /** `PROPFIND path` — WebDAV. */
  public propfind(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('PROPFIND', path, action);
  }

  /** `PROPPATCH path` — WebDAV. */
  public proppatch(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('PROPPATCH', path, action);
  }

  /** `MKCOL path` — WebDAV. */
  public mkcol(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('MKCOL', path, action);
  }

  /** `COPY path` — WebDAV. */
  public copy(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('COPY', path, action);
  }

  /** `MOVE path` — WebDAV. */
  public move(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('MOVE', path, action);
  }

  /** `LOCK path` — WebDAV. */
  public lock(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('LOCK', path, action);
  }

  /** `UNLOCK path` — WebDAV. */
  public unlock(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('UNLOCK', path, action);
  }

  /** `ACL path` — WebDAV access control, RFC 3744. */
  public acl(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('ACL', path, action);
  }

  /** `REPORT path` — WebDAV, RFC 3253. */
  public report(path: string, action: RouteAction<TRequest, TResponse, TContext>): this {
    return this.registerRoute('REPORT', path, action);
  }

  // ── Configuration ──────────────────────────────────────────────────────

  /** Prefixes every route registered from now on. Idempotent. */
  public setGlobalPrefix(prefix: string): this {
    this.adapter.setGlobalPrefix(prefix);
    return this;
  }

  /**
   * Enables CORS.
   *
   * Uses Gland's own implementation rather than a per-framework package, so one
   * policy produces the same headers on every adapter.
   *
   * @param config - `true` for the defaults, or a policy object
   */
  public enableCors(config: CorsConfig = true): this {
    this.use(createCorsMiddleware<TContext>(config));
    return this;
  }

  /**
   * Installs a view engine.
   *
   * @param engine - the resolved module, e.g. `require('ejs')`
   */
  public setViewEngine(engine: unknown): this {
    this.adapter.setViewEngine(engine);
    return this;
  }

  /** Sets the directory views are resolved from. */
  public setBaseViewsDir(directory: string | readonly string[]): this {
    this.adapter.setBaseViewsDir(directory);
    return this;
  }

  /**
   * Serves a directory as static assets.
   *
   * @param path - directory on disk
   * @param options - framework-native static options
   */
  public useStaticAssets(path: string, options?: Record<string, unknown>): this {
    this.adapter.useStaticAssets(path, options);
    return this;
  }

  /**
   * Declares request body parsing.
   *
   * @param options - per-parser configuration, or `false` for none
   *
   * @example
   * ```ts
   * app.json({ limit: '2mb' });
   * app.urlencoded({ extended: true });
   * ```
   */
  public bodyParser(options: BodyParserOptions | false): this {
    this.adapter.bodyParser(options);
    return this;
  }

  /** `application/json`. Fluent. */
  public json(options?: BodyParserOptions | boolean): this {
    return this.bodyParser(typeof options === 'boolean' ? { json: options } : { json: options ?? true });
  }

  /** `application/x-www-form-urlencoded`. Fluent. */
  public urlencoded(options?: { extended?: boolean; limit?: number | string } | boolean): this {
    return this.bodyParser(typeof options === 'boolean' ? { urlencoded: options } : { urlencoded: options ?? true });
  }

  /** `text/<any>`. Fluent. */
  public text(options?: { limit?: number | string } | boolean): this {
    return this.bodyParser(typeof options === 'boolean' ? { text: options } : { text: options ?? true });
  }

  /** `multipart/form-data`. Fluent. Needs a streaming parser on the adapter. */
  public multipart(options?: { limit?: number | string; uploadDir?: string } | boolean): this {
    return this.bodyParser(typeof options === 'boolean' ? { multipart: options } : { multipart: options ?? true });
  }

  /** `<any>/*` into a `Buffer`. Fluent. */
  public raw(options?: { limit?: number | string } | boolean): this {
    return this.bodyParser(typeof options === 'boolean' ? { raw: options } : { raw: options ?? true });
  }

  // ── Observability ──────────────────────────────────────────────────────

  /**
   * Subscribes to a lifecycle event.
   *
   * For framework-level observation — logging, metrics, tracing. To reach
   * application code, use `ctx.call()` / `ctx.emit()` from a handler.
   *
   * @example
   * ```ts
   * app.on(HttpEvent.RequestEnd, ({ method, path, status, duration }) => {
   *   metrics.timing('http.request', duration, { method, path, status });
   * });
   * ```
   */
  public on<K extends keyof (TEvents & HttpEventRecord) & string>(event: K, listener: (payload: (TEvents & HttpEventRecord)[K]) => void): this {
    this.adapter.events.on(event, listener as never);
    return this;
  }

  /** Removes a lifecycle listener. */
  public off<K extends keyof (TEvents & HttpEventRecord) & string>(event: K, listener: (payload: (TEvents & HttpEventRecord)[K]) => void): this {
    this.adapter.events.off(event, listener as never);
    return this;
  }

  /**
   * Reports a transport-level failure.
   *
   * @param error - the thrown value
   * @param message - what was being attempted
   */
  public handleError(error: unknown, message: string): void {
    this.adapter.crash(message, error);
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Applies construction options.
   *
   * Ordering matters: the body parsers and static assets go into the middleware
   * queue, and the queue is flushed by the adapter's `initialize()`. Since this
   * runs immediately after that call, the entries land in the right order
   * relative to the user's own `use()` calls but are still mounted before any
   * route.
   */
  private applyOptions(options: HttpApplicationOptions): void {
    if (options.prefix) this.adapter.setGlobalPrefix(options.prefix);
    if (options.bodyParser !== undefined) this.adapter.bodyParser(options.bodyParser);
    if (options.static) {
      for (const asset of options.static) this.adapter.useStaticAssets(asset.root, { prefix: asset.prefix, ...asset.options });
    }
    if (options.views) {
      this.adapter.setViewEngine(options.views.engine);
      this.adapter.setBaseViewsDir(options.views.directory);
    }
  }
}

/** The effective configuration reported by {@link HttpCore.settings}. */
export interface HttpApplicationSettings {
  /** Prefix applied to every registered route. */
  readonly prefix: string;
  /** Bound port, or `undefined` before `listen()`. */
  readonly port?: number;
  /** Resolved view engine and directory, or `undefined`. */
  readonly views?: { engine: unknown; directory: string | readonly string[]; extension?: string };
  /** How many routes are registered. */
  readonly routeCount: number;
  /** How many middleware entries are queued. */
  readonly middlewareCount: number;
  /** Value of the `X-Powered-By` header, or `false`. */
  readonly poweredBy: string | false;
  /** The options the application was constructed with. */
  readonly options: HttpApplicationOptions;
}

/** Narrows a value to a thenable without pulling in a type guard library. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function';
}
