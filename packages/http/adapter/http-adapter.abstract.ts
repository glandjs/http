import { Logger, HttpException, HttpStatus, type Constructor } from '@medishn/toolkit';
import { HttpEvent } from '../constants/http-events.const';
import { HttpReply, type MiddlewareFunction, type NextFunction, type ReplyPayload, type RegisteredRoute, type RouteAction } from '../contracts';
import type { HttpContext } from '../context/http-context';
import type { HttpEventRecord } from '../events/http-events';
import type { BodyParserOptions, HttpApplicationOptions, RequestLifecycleEvent, ServerListening } from '../interfaces';
import { errorHandler } from '../middleware/error-handler.middleware';
import { applyPrefix, normalizePath } from '../utils/path.util';
import { toReplyPayload } from '../utils/reply.util';
import { HttpEventBroker } from './http-event-broker';

/**
 * One entry in the middleware queue, recorded rather than mounted.
 *
 * Recording exists so that ordering is decided in one place. `app.use(auth)`,
 * `app.useStaticAssets('./public')` and `app.useRaw(compression())` are
 * interleaved by the order the user called them, and every one of them has to
 * reach the framework before the first route is registered. Mounting eagerly
 * cannot express that, because routes are registered later still.
 */
export type MiddlewareEntry = {
  /** URL prefix, when the middleware was path-scoped. */
  path?: string | readonly string[];
  /** Gland middleware, or a framework-native middleware for `raw`. */
  value: MiddlewareFunction<any> | unknown;
  /** Whether {@link MiddlewareEntry.value} is a Gland middleware to bridge. */
  kind: 'gland' | 'raw';
};

/**
 * The contract a protocol adapter implements to serve HTTP for Gland.
 *
 * An adapter's job is small and precise. It owns a framework, it can build a
 * {@link HttpContext} for a request, it can put a route on a router, and it can
 * write a {@link ReplyPayload} to a response. Everything else — the middleware
 * onion, the request lifecycle events, the coercion of a handler's return value
 * into a body, the rendering of an error — is implemented **here**, once.
 *
 * That is the whole reason five adapters fit in a small package each. The
 * behaviour that would otherwise be re-derived per framework is the part that
 * has to be identical, so it does not live in the adapters.
 *
 * ### The two rules
 *
 * 1. **`createContext` must be idempotent per request.** Express and Koa expose
 *    the context to middleware and to the handler through different objects;
 *    returning a second context would mean `ctx.state` set in a middleware was
 *    invisible to the handler. Adapters memoise on the request.
 *
 * 2. **`write` must not double-write.** The base calls it only when
 *    {@link HttpServerAdapter.responded} is `false`, and expects the adapter to
 *    set its own "sent" flag before it starts.
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
 * class MyAdapter extends HttpServerAdapter<Server, App, MyRequest, MyResponse> {
 *   public onInitialize(): void {}
 *   public createContext(req, res) { return new MyContext(this.events, req, res); }
 *   public registerRoute(method, path, action) { this.instance.on(method.toLowerCase(), path, …); }
 *   public useOne(...args) { return this.instance.use(...args); }
 *   public bridgeGland(entry, next) { … }
 *   public write(ctx, payload) { … }
 *   public responded(ctx) { return ctx.res.writableEnded; }
 * }
 * ```
 */
export abstract class HttpServerAdapter<
  TServer = unknown,
  TApp = unknown,
  TRequest = unknown,
  TResponse = unknown,
  TContext extends HttpContext<TRequest, TResponse, any> = HttpContext<TRequest, TResponse, any>,
  TEvents extends HttpEventRecord = HttpEventRecord,
> {
  /** The adapter's lifecycle bus. */
  public readonly events: HttpEventBroker<TEvents>;

  /** The framework's application instance. */
  public readonly instance: TApp;

  /** Options this adapter was constructed with. */
  public readonly options?: HttpApplicationOptions;

  /** The framework's server handle, once `listen()` has run. */
  protected server?: TServer;

  /** Structured logger, childed with the adapter's name. */
  protected readonly logger: Logger;

  /** Middleware recorded but not yet mounted. @see MiddlewareEntry */
  protected readonly queue: MiddlewareEntry[] = [];

  /** Routes registered through this adapter, in registration order. */
  protected readonly routes: RegisteredRoute<TRequest, TResponse, TContext>[] = [];

  /** Whether {@link HttpServerAdapter.onInitialize} has run. */
  private initialized = false;

  /** Whether {@link HttpServerAdapter.close} has completed. */
  private closed = false;

  /** Port `listen()` bound, `undefined` before it runs. */
  protected boundPort?: number;

  /** Global route prefix, from options or `setGlobalPrefix()`. */
  protected globalPrefix = '/';

  /** Resolved view engine and directory, or `undefined`. */
  protected views?: { engine: unknown; directory: string | readonly string[]; extension?: string };

  constructor(instance: TApp, options?: HttpApplicationOptions, loggerContext = 'HTTP:Adapter') {
    this.instance = instance;
    this.options = options;
    this.logger = new Logger({ context: loggerContext, logLevels: options?.logLevel ? [options.logLevel] : undefined });
    this.events = new HttpEventBroker<TEvents>('http');

    if (options?.prefix) this.globalPrefix = normalizePath(options.prefix);
    if (options?.views) this.views = { ...options.views };
  }

  // ── Identity ───────────────────────────────────────────────────────────

  /** Id of the adapter's broker. */
  public get id(): string {
    return this.events.id;
  }

  /** The framework's application instance, typed. */
  public get app(): TApp {
    return this.instance;
  }

  /** The routes registered so far. Handy in tests and on a `/routes` endpoint. */
  public get routeTable(): readonly RegisteredRoute<TRequest, TResponse, TContext>[] {
    return this.routes;
  }

  /** The port `listen()` bound, or `undefined`. */
  public get port(): number | undefined {
    return this.boundPort;
  }

  /** The global route prefix. */
  public get prefix(): string {
    return this.globalPrefix;
  }

  /** Whether {@link HttpServerAdapter.onInitialize} has run. */
  public get isInitialized(): boolean {
    return this.initialized;
  }

  // ── Framework contract ─────────────────────────────────────────────────

  /**
   * Mounts the framework and records options.
   *
   * Called once by `HttpCore`'s constructor. It only does the work that has to
   * happen before anything else — installing parsers, applying `trustProxy`,
   * registering plugins. **It does not mount middleware and does not register
   * routes**; that is {@link HttpServerAdapter.finalize}, which runs at
   * `listen()`.
   *
   * The previous implementation subscribed `initialize` to the `options` event,
   * so it re-ran on every later emit and could not know whether it had run.
   */
  public async initialize(options?: HttpApplicationOptions): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.onInitialize(options ?? this.options);
    this.logger.debug('Adapter configured', this.id);
  }

  /**
   * Mounts the middleware and registers the routes. Idempotent.
   *
   * This is the step that makes ordering work, and it is the reason
   * {@link HttpServerAdapter.route} buffers rather than registering eagerly.
   *
   * The sequence a user actually writes is:
   *
   * ```ts
   * const http = app.connectTo(ExpressBroker);   // ← routes arrive here
   * http.use(auth);                              // ← middleware arrives here
   * http.listen(3000);                           // ← everything is mounted now
   * ```
   *
   * `connectTo()` has to come first — it is what produces the application you
   * are configuring — so the binder's routes are registered before the
   * middleware is declared. Mounting either one eagerly would put the other in
   * the wrong order: Express skips middleware mounted after a matching route,
   * and Koa's router would miss routes registered before it was mounted.
   *
   * Buffering both and mounting them together at `listen()` is what makes the
   * API order-independent. `HttpCore.listen()` and `HttpCore.ready()` both call
   * this, so an application never has to.
   *
   * The order is fixed and load-bearing:
   *
   * 1. `onInitialize` — framework settings, error and 404 handlers
   * 2. the middleware queue, in call order
   * 3. `afterMiddleware` — for a framework that resolves its chain once
   * 4. deferred plugins
   * 5. the routes
   * 6. `afterRoutes` — for a catch-all, which has to be behind the routes
   */
  public async finalize(): Promise<void> {
    // The promise is cached, not just the flag. `listen()` and `ready()` both
    // call this, and an application commonly does both — without the shared
    // promise the second call would re-enter `flush()` and mount every middleware
    // twice, and two body parsers on one request is a `SyntaxError`.
    this.finalizePromise ??= this.runFinalize();
    await this.finalizePromise;
  }

  private async runFinalize(): Promise<void> {
    // `initialize` first: a plugin the framework needs before a route can be
    // registered has to be in place, and the `await` here is the first point
    // where that is guaranteed.
    await this.initialize(this.options);

    this.flush();

    // Between the middleware and the routes. Fastify needs this: it resolves its
    // hook chain when the instance is sealed, so a Gland middleware recorded
    // during the flush has to be turned into a `preHandler` hook *now*, and
    // registering it from `onInitialize` would find the queue empty.
    await this.afterMiddleware();

    await this.flushDeferred();
    this.flushRoutes();

    // After the routes. Express and Koa need this for the terminal 404: a
    // middleware mounted before a route runs first and answers everything,
    // which is a 404 on every request rather than only on the unmatched ones.
    await this.afterRoutes();

    this.finalized = true;
    this.logger.info(`Adapter ready: ${this.routes.length} route(s), ${this.queue.length} middleware entr(ies)`, this.id);
  }

  /**
   * Runs after the middleware queue is flushed, before any route is registered.
   *
   * For a framework that cannot take a middleware per request — Fastify resolves
   * its hook chain once — this is where the recorded Gland middleware becomes a
   * native hook.
   */
  protected afterMiddleware(): void | Promise<void> {
    /* Overridden by frameworks that need it. */
  }

  /**
   * Runs after every route is registered.
   *
   * For the terminal 404 handler, which has to be behind the routes to be
   * reachable at all.
   */
  protected afterRoutes(): void | Promise<void> {
    /* Overridden by adapters that need a catch-all. */
  }

  private finalizePromise?: Promise<void>;

  /** Whether {@link HttpServerAdapter.finalize} has run. */
  public get isFinalized(): boolean {
    return this.finalized;
  }

  private finalized = false;

  /**
   * Framework-specific set-up, run before the middleware queue is flushed.
   *
   * Use it to install parsers, apply `trustProxy`, and set a framework default.
   * Do **not** register routes here — `GlandBroker.connectTo()` does that
   * afterwards, and a route registered now would sit in front of the ones the
   * binder publishes.
   */
  protected abstract onInitialize(options?: HttpApplicationOptions): void | Promise<void>;

  /**
   * Builds the context for a request, or returns the one already built for it.
   *
   * Must be idempotent for a given request. @see the class documentation.
   */
  public abstract createContext(req: TRequest, res: TResponse, events?: HttpEventBroker<TEvents>): TContext;

  /** Puts one route on the framework's router. */
  public abstract registerRoute(method: string, path: string, action: RouteAction<TRequest, TResponse, TContext>, origin?: RegisteredRoute<TRequest, TResponse, TContext>['origin']): void;

  /**
   * Mounts a single framework-native middleware.
   *
   * The only method an adapter needs for middleware: Gland wraps each of its own
   * into the framework's signature via {@link HttpServerAdapter.bridgeGland},
   * then hands the result here.
   */
  public abstract useOne(...args: unknown[]): unknown;

  /**
   * Wraps one Gland middleware in the framework's native middleware signature.
   *
   * The request, response and continuation parameters are **not used**. They are
   * accepted only so an adapter can declare the same four-argument shape as the
   * abstract member, and they are all optional because {@link mount} calls this
   * once to obtain the handler rather than once per request.
   *
   * @param entry - the recorded Gland middleware
   * @returns a function {@link useOne} can mount
   */
  public abstract bridgeGland(entry: MiddlewareEntry, request?: TRequest, response?: TResponse, next?: (...args: any[]) => unknown): (...args: any[]) => unknown;

  /** Writes a resolved payload to the response. */
  public abstract write(ctx: TContext, payload: ReplyPayload): void | Promise<void>;

  /** Whether the response has already begun. */
  public abstract responded(ctx: TContext): boolean;

  /** Renders a caught error through {@link HttpServerAdapter.errorHandler}. */
  public renderError(error: unknown, ctx?: TContext): void | Promise<void> {
    return this.errorHandler(error, ctx);
  }

  /**
   * Installs request body parsing.
   *
   * Recorded rather than applied, so parsers always sit ahead of the routes the
   * binder is about to register. An adapter that cannot support a requested
   * parser logs it rather than dropping it — see
   * {@link file:../interfaces/body-parser.interface.ts}.
   */
  public abstract bodyParser(options: BodyParserOptions | false): void;

  /**
   * Serves a directory as static assets.
   *
   * Also recorded, for the same ordering reason as
   * {@link HttpServerAdapter.bodyParser}: a static mount added after a route
   * would never be reached for that route.
   */
  public abstract useStaticAssets(path: string, options?: Record<string, unknown>): void;

  /** Binds a socket and starts accepting requests. */
  public abstract listen(port: number, options?: ServerListening): void | Promise<void>;

  /** Stops accepting requests and releases the socket. */
  public abstract close(): Promise<void>;

  // ── Shared behaviour ───────────────────────────────────────────────────

  /**
   * Records a Gland middleware.
   *
   * @param middleware - `(ctx, next) => …`
   * @returns `this`
   */
  public use(middleware: MiddlewareFunction<TContext>): this;
  /**
   * Records a Gland middleware under one or more paths.
   *
   * @param path - URL prefix, or an array of prefixes
   * @param middleware - `(ctx, next) => …`
   * @returns `this`
   */
  public use(path: string | readonly string[], middleware: MiddlewareFunction<TContext>): this;
  public use(first: MiddlewareFunction<TContext> | string | readonly string[], second?: MiddlewareFunction<TContext>): this {
    if (typeof second === 'function') {
      this.queue.push({ path: first as string | readonly string[], value: second, kind: 'gland' });
    } else {
      this.queue.push({ value: first, kind: 'gland' });
    }
    return this;
  }

  /**
   * Records framework-native middleware, unmolested.
   *
   * The escape hatch for anything Gland does not wrap — `express.static()`,
   * `compression()`, `@fastify/helmet()`. Same ordering rules as
   * {@link HttpServerAdapter.use}: interleaved by call order, mounted before
   * the first route.
   *
   * @example
   * ```ts
   * app.use(async (ctx, next) => { await next(); });   // Gland onion
   * app.useRaw(compression());                          // framework middleware
   * app.use('/api', rateLimit);                         // Gland onion, scoped
   * ```
   */
  public useRaw(...args: unknown[]): this {
    this.queue.push({ value: args, kind: 'raw' });
    return this;
  }

  /**
   * Registers work to run *after* the middleware queue has been flushed.
   *
   * Some frameworks cannot take a plugin at the same moment they take
   * middleware — Fastify's `register()` must precede `ready()`, and Koa's
   * router must exist before the first route. Recording such work here and
   * running it at the end of {@link HttpServerAdapter.initialize} is what lets
   * one flush satisfy both orderings.
   *
   * @param work - receives the framework's application instance
   *
   * @example
   * ```ts
   * this.defer(async (app) => { await app.register(require('@fastify/cookie')); });
   * ```
   */
  public defer(work: (app: TApp) => void | Promise<void>): this {
    this.deferred.push(work);
    return this;
  }

  /**
   * Runs everything registered with {@link HttpServerAdapter.defer}.
   *
   * Called once, after `flush()`, and awaited so a rejected plugin registration
   * surfaces at boot rather than on the first request.
   */
  private async flushDeferred(): Promise<void> {
    for (const work of this.deferred) {
      try {
        await work(this.instance);
      } catch (error) {
        this.crash('Deferred adapter registration failed', error);
      }
    }
  }

  private readonly deferred: Array<(app: TApp) => void | Promise<void>> = [];

  /**
   * Registers a route and remembers it.
   *
   * Wraps {@link HttpServerAdapter.registerRoute} so that the route table, the
   * `route:registered` event, and the prefix are handled once instead of in
   * every adapter.
   */
  public route(
    method: string,
    path: string,
    action: RouteAction<TRequest, TResponse, TContext>,
    origin: RegisteredRoute<TRequest, TResponse, TContext>['origin'] = 'manual',
  ): RegisteredRoute<TRequest, TResponse, TContext> {
    const fullPath = applyPrefix(path, this.globalPrefix);
    const entry: RegisteredRoute<TRequest, TResponse, TContext> = {
      method: method.toUpperCase(),
      verb: method.toLowerCase(),
      path: fullPath,
      action: action as RouteAction<TRequest, TResponse, TContext>,
      origin,
    };

    this.routes.push(entry);
    this.routeQueue.push(entry);
    this.events.safeEmit(HttpEvent.RouteRegistered, entry as never);

    // After `finalize()`, a late `app.get()` has to reach the framework
    // immediately — there is no second flush coming.
    if (this.finalized) this.drainRoutes(1);

    return entry;
  }

  /**
   * Hands queued routes to the framework.
   *
   * @param count - how many entries to drain. `1` is used for a late
   *        registration, so the queue does not get re-drained from the start.
   */
  private drainRoutes(count: number): void {
    const batch = this.routeQueue.splice(0, count);
    for (const entry of batch) {
      this.currentRoute = entry;
      try {
        this.registerRoute(entry.method, entry.path, entry.action, entry.origin);
      } finally {
        this.currentRoute = undefined;
      }
    }
  }

  /** Registers every queued route on the framework. */
  private flushRoutes(): void {
    this.drainRoutes(this.routeQueue.length);
  }

  /** Routes accepted but not yet handed to the framework. */
  private readonly routeQueue: RegisteredRoute<TRequest, TResponse, TContext>[] = [];

  /**
   * The route currently being registered, or `undefined`.
   *
   * Valid only for the duration of the {@link HttpServerAdapter.registerRoute}
   * call that is on the stack. An adapter reads it to close over the full
   * entry — method, path, action — when it builds a framework handler that
   * later calls {@link HttpServerAdapter.dispatch}.
   */
  protected get pendingRoute(): RegisteredRoute<TRequest, TResponse, TContext> | undefined {
    return this.currentRoute;
  }

  private currentRoute?: RegisteredRoute<TRequest, TResponse, TContext>;

  /**
   * Runs one matched route.
   *
   * The request pipeline, in the order every adapter uses it:
   *
   * 1. build (or reuse) the context
   * 2. publish `request:start`
   * 3. invoke the handler with the route params
   * 4. coerce the return value and write it, unless the handler already did
   * 5. publish `request:end` with the duration — on the failure path too
   *
   * A handler that throws never reaches step 4; the error is published and
   * rendered, and `request:end` still fires so a metrics exporter cannot leak a
   * counter on exactly the requests that failed.
   */
  public async dispatch(route: RegisteredRoute<TRequest, TResponse, TContext>, req: TRequest, res: TResponse): Promise<TContext> {
    const ctx = this.createContext(req, res, this.events);

    // A middleware usually reaches the context first, and at that point the
    // router has not matched yet. Express in particular fills `req.params` inside
    // the route handler, so a context built during middleware has an empty
    // `params`. Re-syncing here is what makes `ctx.params` mean the same thing
    // whichever framework built the context.
    this.syncParams(ctx, req);

    const lifecycle = this.startLifecycle(ctx, route);

    try {
      const result = await route.action(ctx, ...Object.values(ctx.params ?? {}));
      await this.respond(result, ctx);
    } catch (error) {
      ctx.error = error;
      this.events.safeEmit(HttpEvent.RequestError, { event: lifecycle, error, ctx: ctx as never });
      this.logger.error(`Request failed: ${route.method} ${route.path}`, error instanceof Error ? error.stack : String(error));
      await this.safelyRenderError(error, ctx, lifecycle);
    } finally {
      this.endLifecycle(lifecycle, ctx);
    }

    return ctx;
  }

  /**
   * Turns a handler's return value into a response, if it has not written one.
   *
   * @param result - whatever the handler returned
   * @param ctx - the request context
   */
  public async respond(result: unknown, ctx: TContext): Promise<void> {
    // The handler calling `ctx.json(...)` and returning nothing is the common
    // shape, and returning something as well is legal but must not double-write.
    if (this.responded(ctx)) return;

    await this.write(ctx, toReplyPayload(result));
  }

  /**
   * The terminal error renderer.
   *
   * Replaced by `HttpCore.setErrorHandler()`. Kept as a field rather than an
   * abstract method so an adapter does not have to implement a policy it has no
   * opinion about — every adapter would otherwise copy the same six lines.
   */
  public errorHandler: (error: unknown, ctx?: TContext) => void | Promise<void> = async (error, ctx) => {
    if (!ctx) {
      this.crash('Unhandled error with no request context', error);
      return;
    }
    await errorHandler(error, ctx);
  };

  /**
   * Renders the 404 for an unmatched request.
   *
   * Each framework has its own idea of "nothing matched" — Express falls
   * through to its own handler, Koa throws, Fastify sets `404` itself — so each
   * adapter calls this from the right place and the response is identical.
   */
  public async notFound(ctx: TContext): Promise<void> {
    this.events.safeEmit(HttpEvent.RouteMiss, ctx as never);
    await this.renderError(new HttpException(HttpStatus.NOT_FOUND, { detail: `Cannot ${ctx.method} ${ctx.path}` }), ctx);
  }

  /**
   * Publishes a crash without letting a listener take the server down.
   *
   * A lifecycle bus is observability, not control flow. A listener that throws
   * is a bug in the listener, and it must not become an unhandled rejection in
   * the middle of a request.
   */
  public crash(message: string, error: unknown): void {
    this.logger.error(message, error instanceof Error ? error.stack : undefined);
    this.events.safeEmit(HttpEvent.ServerCrashed, {
      message,
      error,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Configuration ──────────────────────────────────────────────────────

  /** Prefixes every route registered from now on. Idempotent. */
  public setGlobalPrefix(prefix: string): this {
    this.globalPrefix = normalizePath(prefix);
    return this;
  }

  /** Selects a view engine. Takes a module, not a name — see `HttpApplicationOptions.views`. */
  public setViewEngine(engine: unknown): this {
    this.views = { ...(this.views ?? { directory: '' }), engine };
    return this;
  }

  /** Sets the directory views are resolved from. */
  public setBaseViewsDir(directory: string | readonly string[]): this {
    this.views = { ...(this.views ?? { engine: undefined, directory }), directory };
    return this;
  }

  /** The resolved view configuration, or `undefined`. */
  public get viewConfig(): { engine: unknown; directory: string | readonly string[]; extension?: string } | undefined {
    return this.views;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Mounts everything recorded in the queue, in call order.
   *
   * Runs once, during {@link HttpServerAdapter.finalize}, and always before any
   * route is registered. {@link beforeFlush} runs first, so an adapter can put
   * something at the head of the queue without mutating it mid-iteration.
   */
  protected flush(): void {
    this.beforeFlush();

    // Snapshot first: a middleware factory is allowed to register another
    // entry, and iterating the live array would mount the newcomer twice or
    // skip it, depending on where it landed.
    for (const entry of [...this.queue]) {
      if (entry.kind === 'raw') {
        this.useOne(...toArgs(entry.value));
        continue;
      }

      // The framework owns the iteration; Gland only supplies the per-request
      // bridge. Handing it one function per middleware is what makes
      // `app.use(a); app.use(b); app.use(c)` behave like `a → b → c` in
      // Express, Koa and Hono alike, and it is why interleaving with `useRaw`
      // is order-preserving.
      this.mount(entry);
    }

    this.logger.debug(`Flushed ${this.queue.length} middleware entries`);
  }

  /**
   * Runs immediately before {@link HttpServerAdapter.flush}.
   *
   * For the adapter to queue something that must be first. The `node:http`
   * adapter uses it to put the body collector ahead of user middleware, since
   * `ctx.body` has to be parsed before anything reads it.
   */
  protected beforeFlush(): void {
    /* Overridden by adapters that need a leading entry. */
  }

  /**
   * Mounts one queued Gland middleware.
   *
   * The bridged handler is passed to {@link HttpServerAdapter.useOne} **as is**.
   * That is the whole contract: `bridgeGland` returns a function in the
   * framework's own middleware signature, so wrapping it in another closure and
   * handing *that* to the framework calls the bridge and throws the result away.
   *
   * The failure is silent in the worst way. Express and Koa simply never receive
   * a `next()`, the chain stops, and every request hangs until the client gives
   * up — with a server log full of nothing. An adapter whose framework cannot
   * take a per-request closure overrides this; Fastify does, because it resolves
   * its hook chain once.
   */
  protected mount(entry: MiddlewareEntry): void {
    this.useOne(this.bridgeGland(entry));
  }

  /**
   * Refreshes `ctx.params` from the request, immediately before the handler.
   *
   * Overridden by adapters whose router fills params after the context exists.
   * @see HttpServerAdapter.dispatch
   */
  protected syncParams(ctx: TContext, _req: TRequest): void {
    /* Overridden where the router populates params late. */
  }

  /** Builds a promise-based `next` on top of a framework's own continuation. */
  protected bridgeNext(next: (...args: any[]) => unknown): NextFunction {
    return async (error?: unknown) => {
      await next(error);
    };
  }

  /** Publishes `request:start` and returns the event to complete later. */
  protected startLifecycle(ctx: TContext, route: RegisteredRoute<TRequest, TResponse, TContext>): RequestLifecycleEvent {
    const lifecycle: RequestLifecycleEvent = {
      id: ctx.requestId,
      method: route.method,
      path: ctx.path,
      url: ctx.url,
      ip: ctx.ip,
      startedAt: ctx.startedAt,
      timestamp: new Date().toISOString(),
    };

    this.events.safeEmit(HttpEvent.RequestStart, lifecycle as never);
    return lifecycle;
  }

  /** Publishes `request:end`. Never throws. */
  protected endLifecycle(lifecycle: RequestLifecycleEvent, ctx: TContext): void {
    try {
      this.events.safeEmit(HttpEvent.RequestEnd, {
        ...lifecycle,
        status: this.statusOf(ctx),
        duration: Date.now() - lifecycle.startedAt,
        timestamp: new Date().toISOString(),
      } as never);
    } catch (error) {
      this.crash('A request:end listener threw', error);
    }
  }

  /** Best-effort status read, for the lifecycle event. */
  protected statusOf(ctx: TContext): number | undefined {
    const status = (ctx.res as { statusCode?: number; status?: number } | undefined)?.statusCode ?? (ctx.res as { status?: number } | undefined)?.status;
    return typeof status === 'number' ? status : undefined;
  }

  /** Renders an error, containing any failure the renderer itself causes. */
  protected async safelyRenderError(error: unknown, ctx: TContext, lifecycle?: RequestLifecycleEvent): Promise<void> {
    try {
      await this.renderError(error, ctx);
    } catch (renderFailure) {
      // The renderer is the last line of defence. If it throws, the only honest
      // thing left is a bare 500 on the socket.
      this.crash(`Error while rendering "${lifecycle?.method} ${lifecycle?.path}"`, renderFailure);
      if (!this.responded(ctx)) {
        this.write(ctx, toReplyPayload(HttpReply.json({ error: 'Internal Server Error' }, { status: 500 })));
      }
    }
  }

  /**
   * Publishes `server:closed`.
   *
   * Adapters call this from their own `close()` so the payload — including
   * whether the server was even open — is decided once.
   *
   * @param startedAt - when `close()` was called, for the duration
   * @param alreadyClosed - `true` when there was no server to close
   */
  protected publishClosed(startedAt: number, alreadyClosed: boolean): void {
    this.closed = true;
    this.events.safeEmit(HttpEvent.ServerClosed, {
      alreadyClosed,
      duration: alreadyClosed ? undefined : Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  }

  /** Whether {@link HttpServerAdapter.close} has completed. */
  public get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Delivers the construction options to a listener.
   *
   * `HttpEvent.Options` fires during `HttpCore`'s constructor, which is before
   * an application has had any chance to call `app.on()` — so an event that is
   * only emitted is an event nobody receives. This is the replay.
   *
   * @param listener - called immediately with the stored options
   */
  public replayOptions(listener: (options: HttpApplicationOptions | undefined) => void): void {
    listener(this.options);
  }
}

/** Constructor type of an {@link HttpServerAdapter}, for factory functions. */
export type HttpServerAdapterClass<TApp> = Constructor<HttpServerAdapter<any, TApp, any, any, any, any>>;

/**
 * Normalises a raw entry's payload into the argument list `useOne` expects.
 *
 * A `raw` entry is *usually* an array — `useRaw(a, b)` — but an adapter
 * queueing a single middleware of its own has no reason to wrap it. Spreading a
 * bare function is the exact failure this guards against, and it produced a
 * "Spread syntax requires ...iterable" on Express for every request-parsing
 * configuration.
 */
function toArgs(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}
