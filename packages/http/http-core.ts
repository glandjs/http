import { HttpApplicationOptions } from './interface'
import { type ServerListening } from './types/app-options.types'
import { RequestMethod } from './enum'
import type { HttpServerAdapter } from './adapter'
import type { CorsConfig, RouteAction } from './types'

/**
 * The core HTTP server class for the Gland framework.
 *
 * `HttpCore` provides a fully event-driven HTTP/HTTPS server implementation
 * @example
 * ```typescript
 * // Simple route handler
 * app.get('/', (ctx) => {
 *   ctx.send('Hello, Gland!');
 * });
 * // Middleware example
 * app.use((ctx, next) => {
 *   console.log('Request received:', ctx.path);
 *   next();
 * });
 * ```
 */
export class HttpCore<TServer, TApp, TRequest, TResponse> {
  constructor(
    private readonly _adapter: HttpServerAdapter<
      TServer,
      TApp,
      TRequest,
      TResponse
    >,
    options?: HttpApplicationOptions
  ) {
    this.initializeEvents(options)
  }
  private initializeEvents(options?: HttpApplicationOptions) {
    this._adapter.events.emit('options', options)
  }
  get broker() {
    return this._adapter.events
  }

  get id() {
    return this.broker.id
  }

  get settings() {
    return
  }

  public listen(port: number, args?: ServerListening) {
    this._adapter.listen(port, args?.host, args?.message)
  }

  /**
   * @example
   * ```typescript
   * // Gland-style middleware
   * app.use((ctx, next) => {
   *   console.log('Request:', ctx.method, ctx.path);
   *   next();
   * });
   *
   * // Express-style middleware
   * app.use((req, res, next) => {
   *   res.setHeader('X-Powered-By', 'Gland');
   *   next();
   * });
   *
   * // Path-specific middleware
   * app.use('/api', (ctx, next) => {
   *   ctx.state.apiRequest = true;
   *   next();
   * });
   * ```
   */
  public use(...args: any[]): void {
    this._adapter.use(...args)
  }

  private _registerRoute(
    method: string,
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): this {
    this._adapter.registerRoute(method, path, action)
    return this
  }

  // HTTP Methods
  public get(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.GET, path, action)
  }
  public post(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.POST, path, action)
  }
  public put(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.PUT, path, action)
  }
  public delete(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.DELETE, path, action)
  }
  public patch(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.PATCH, path, action)
  }
  public head(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.HEAD, path, action)
  }
  public options(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.OPTIONS, path, action)
  }
  public all(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.ALL, path, action)
  }
  public search(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.SEARCH, path, action)
  }

  public propfind(
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): this {
    return this._registerRoute(RequestMethod.PROPFIND, path, action)
  }

  public proppatch(
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): this {
    return this._registerRoute(RequestMethod.PROPPATCH, path, action)
  }

  public mkcol(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.MKCOL, path, action)
  }

  public copy(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.COPY, path, action)
  }

  public move(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.MOVE, path, action)
  }

  public lock(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.LOCK, path, action)
  }

  public unlock(path: string, action: RouteAction<TRequest, TResponse>): this {
    return this._registerRoute(RequestMethod.UNLOCK, path, action)
  }

  public enableCors(options: CorsConfig) {
    this._adapter.enableCors(options)
  }
  public setViewEngine(engine: string): this {
    this._adapter.setViewEngine(engine)
    return this
  }
  public setBaseViewsDir(path: string | string[]): this {
    this._adapter.setBaseViewsDir(path)
    return this
  }
  public useStaticAssets(path: string): void {
    this._adapter.useStaticAssets(path)
  }
  public setGlobalPrefix(prefix: string): void {
    this._adapter.setGlobalPrefix(prefix)
  }
  public handleError(error: any, message: string): void {
    this._adapter.handleError(error, message)
  }

  public json(options?: any): this {
    this._adapter.json(options)
    return this
  }
  public urlencoded(options?: { extended?: boolean }): this {
    this._adapter.urlencoded(options)
    return this
  }
  public raw(options?: any): this {
    this._adapter.raw(options)
    return this
  }
  public text(options?: any): this {
    this._adapter.text(options)
    return this
  }

  // Event Management
  // public on<T>(event: HttpEventType, listener: Callback<[T]>): Noop {
  //   const isExternal = this._adapter.events.getListener(`external:${event}`)
  //   if (isExternal) {
  //     return this._adapter.events.on(`external:${event}`, listener)
  //   } else {
  //     return this._adapter.events.on(event, listener)
  //   }
  // }
  // public emit<T>(type: EventType, data: T) {
  //   this._adapter.events.emit(type, data)
  // }

  // public off<T>(event: HttpEventType, listener: Callback<[T]>): void {
  //   this._adapter.events.off(event, listener)
  // }

  // public system<K extends keyof ApplicationEventMap<TRequest, TResponse>>(
  //   event: K,
  //   listener: ApplicationEventMap<TRequest, TResponse>[K]
  // ): void {
  //   switch (event) {
  //     case 'crashed':
  //       this._adapter.events.on(
  //         '$server:crashed',
  //         listener as Callback<[ServerCrashedEvent]>
  //       )
  //       break
  //     case 'router:miss':
  //       this._adapter.events.on(
  //         '$router:miss',
  //         listener as Callback<[HttpContext<TRequest, TResponse>]>
  //       )
  //       break
  //     case 'request:failed':
  //       this._adapter.events.on('$request:failed', ((errorAndCtx) => {
  //         listener(...errorAndCtx)
  //       }) as Callback<[[any, HttpContext<TRequest, TResponse>]]>)
  //       break
  //     default:
  //       throw Error(`Unknown system event: ${event}`)
  //   }
  // }
}
