import { Logger } from '@medishn/toolkit'
import { HttpEventCore } from './http-events'
import type { CorsConfig, RouteAction } from '../types'
import type { HttpApplicationOptions } from '../interface'
export interface HttpGlandEvents {
  options?: HttpApplicationOptions
  'server:crashed': {
    message: string
    error: any
    stack: any
  }
}
export abstract class HttpServerAdapter<TServer, TAapp, TRequest, TResponse> {
  protected logger = new Logger({ context: 'HTTP:Adapter' })
  public events: HttpEventCore<HttpGlandEvents>
  protected server: TServer
  constructor(public instance: TAapp) {
    this.events = new HttpEventCore('http')
    this.events.on('options', this.initialize.bind(this))
  }
  public abstract initialize(): Promise<void> | void
  public abstract listen(
    port: string | number,
    hostname?: string,
    message?: string
  ): void
  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }

      ;(this.server as any).close((err) => {
        if (err) {
          reject(err)
          return
        }
        this.logger.info('server closed')
        resolve()
      })
    })
  }
  public abstract use(...args: any): any
  public abstract registerRoute(
    method: string,
    path: string,
    action: RouteAction<TRequest, TResponse>
  ): void

  public abstract enableCors(options: CorsConfig): void

  public abstract setViewEngine(engine: string): this
  public abstract setBaseViewsDir(path: string | string[]): this
  public abstract setGlobalPrefix(prefix: string): void
  public abstract useStaticAssets(path: string, options?: any): void
  public abstract json(options?: any): this
  public abstract urlencoded(options?: { extended?: boolean }): this
  public abstract raw(options?: any): this
  public abstract text(options?: any): this
  public handleError(error: any, message: string) {
    this.events.safeEmit('server:crashed', {
      message,
      error,
      stack: error.stack,
    })
    throw error
  }
}
