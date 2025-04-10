import { Logger } from '@medishn/toolkit'
import { HttpEventCore } from './http-events'
import { Broker } from '@glandjs/events'
import type { CorsConfig, RouteAction } from '../types'
export abstract class HttpServerAdapter<TServer, TAapp, TRequest, TResponse> {
  protected logger = new Logger({ context: 'HTTP:Adapter' })
  public broker: Broker
  public events: HttpEventCore
  protected server: TServer
  constructor(public instance: TAapp) {
    this.broker = new Broker('http')
    this.events = new HttpEventCore(this.broker.channel('http'))
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
        this.logger.info('Express server closed')
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

  public abstract setGlobalPrefix(prefix: string): void

  public abstract useStaticAssets(path: string, options?: any): void

  public handleError(error: any, message: string) {
    this.events.safeEmit('$server:crashed', {
      message,
      error,
      stack: error.stack,
    })
    throw error
  }
}
