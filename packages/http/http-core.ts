import { Callback, Noop } from '@medishn/toolkit'
import { EventType } from '@glandjs/common'
import { HttpApplicationOptions } from './interface'
import {
  type ApplicationEventMap,
  type ServerListening,
} from './types/app-options.types'
import { RequestMethod } from './enum'
import type { HttpServerAdapter } from './adapter'
import type { CorsConfig, RouteAction } from './types'
import type { HttpEventType } from './http-events.const'

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
    return this._adapter.broker
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
  public get = (path: string, action: RouteAction<TRequest, TResponse>): this =>
    this._registerRoute(RequestMethod.GET, path, action)
  public post = (
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): this => this._registerRoute(RequestMethod.POST, path, action)
  public put = (path: string, action: RouteAction<TRequest, TResponse>): this =>
    this._registerRoute(RequestMethod.PUT, path, action)
  public delete = (
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): this => this._registerRoute(RequestMethod.DELETE, path, action)
  public patch = (
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): this => this._registerRoute(RequestMethod.PATCH, path, action)
  public head = (
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): this => this._registerRoute(RequestMethod.HEAD, path, action)
  public options = (
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): this => this._registerRoute(RequestMethod.OPTIONS, path, action)
  public all = (path: string, action: RouteAction<TRequest, TResponse>): this =>
    this._registerRoute(RequestMethod.ALL, path, action)

  public enableCors(options: CorsConfig) {
    this._adapter.enableCors(options)
  }
  public useStaticAssets(path: string): void {
    this._adapter.useStaticAssets(path)
  }

  // Event Management
  public on<T>(event: HttpEventType, listener: Callback<[T]>): Noop {
    const isExternal = this._adapter.events.getListeners(`external:${event}`)
    if (isExternal) {
      return this._adapter.events.on(`external:${event}`, listener)
    } else {
      return this._adapter.events.on(event, listener)
    }
  }
  public emit<T>(type: EventType, data: T) {
    this._adapter.events.emit(type, data)
  }

  public off<T>(event: HttpEventType, listener: Callback<[T]>): void {
    this._adapter.events.off(event, listener)
  }

  public system<K extends keyof ApplicationEventMap<TRequest, TResponse>>(
    event: K,
    listener: ApplicationEventMap<TRequest, TResponse>[K]
  ): void {
    switch (event) {
      case 'crashed':
        this._adapter.events.on('$server:crashed', listener)
        break
      case 'router:miss':
        this._adapter.events.on('$router:miss', listener)
        break
      case 'request:failed':
        this._adapter.events.on('$request:failed', listener)
        break
      default:
        throw Error(`Unknown system event: ${event}`)
    }
  }
}
