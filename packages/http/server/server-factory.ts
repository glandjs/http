import { Logger } from '@medishn/toolkit'
import { Server } from 'net'
import { HttpApplicationOptions } from '../interface'
import type { RequestListener } from 'http'
export class ServerFactory {
  private static readonly _logger = new Logger({ context: 'HTTP:Server' })

  public static create(
    options?: HttpApplicationOptions,
    listener?: RequestListener
  ): Server {
    const isHttpsEnabled = options?.https
    this._logger.info(
      `Initializing ${isHttpsEnabled ? 'HTTPS' : 'HTTP'} server...`
    )
    const serverModule = isHttpsEnabled ? require('https') : require('http')

    if (isHttpsEnabled) {
      return serverModule.createServer(options!.https)
    }
    return serverModule.createServer(listener)
  }
}
