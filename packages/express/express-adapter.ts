import {
  HttpContext,
  HttpServerAdapter,
  ServerFactory,
  type HttpApplicationOptions,
} from '@glandjs/http'
import type { CorsConfig } from '@glandjs/http/types'
import { isNil, isObject, isString } from '@medishn/toolkit'
import express, { type Application, type Request, type Response } from 'express'
import { normalizePath } from '@glandjs/common'
import cors from 'cors'
import { pipeline } from 'node:stream'
import { Server } from 'net'
export class ExpressAdapter extends HttpServerAdapter<
  Server,
  Application,
  Request,
  Response
> {
  constructor() {
    super(express())
    this.instance.use((req: Request, res: Response, next: Function) => {
      const ctx = new HttpContext(this.events, req, res)
      ;(req as any).ctx = ctx
      next()
    })
  }

  public initialize(): Promise<void> | void {
    this.logger.info('Initializing Express adapter')
    this.events.on('options', (options) => {
      console.log('OPTIONS:', options)
    })
  }
  public listen(
    port: number | string,
    hostname: string = 'localhost',
    message?: string
  ) {
    try {
      const parsedPort = isString(port) ? parseInt(port, 10) : port

      const options = this.events.request<HttpApplicationOptions>(
        'options',
        {},
        'first'
      )

      const defaultMessage = `Server listening on ${hostname}:${parsedPort}`
      this.logger.info(message ?? defaultMessage)
      this.server = ServerFactory.create(options, this.instance)
      this.server.listen(parsedPort, hostname)
    } catch (error) {
      this.handleError(error, 'Failed to start Express server')
    }
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }

      this.server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        this.logger.info('Express server closed')
        resolve()
      })
    })
  }

  public reply(response: any, body: any, statusCode?: number): any {
    if (statusCode) {
      response.status(statusCode)
    }

    if (isNil(body)) {
      return response.send()
    }

    if (body && body.getStream && typeof body.getStream === 'function') {
      const streamHeaders = body.getHeaders ? body.getHeaders() : {}

      if (
        response.getHeader('Content-Type') === undefined &&
        streamHeaders.type
      ) {
        response.setHeader('Content-Type', streamHeaders.type)
      }

      return pipeline(
        body.getStream().once('error', (err: Error) => {
          response.status(500).end()
          this.logger.error(err)
        }),
        response,
        (err: any) => {
          if (err) {
            this.logger.error(err)
          }
        }
      )
    }

    return isObject(body) ? response.json(body) : response.send(String(body))
  }

  public use(...args: any[]): any {
    const wrapped = args.map((arg) => {
      if (typeof arg !== 'function') return arg

      if (arg.length === 2 || arg.length === 3) {
        return function (req: Request, res: Response, next: Function) {
          const ctx = (req as any).ctx
          if (!ctx) return next(new Error('No context found in middleware'))

          try {
            arg(ctx, next)
          } catch (err) {
            next(err)
          }
        }
      }

      return arg
    })

    return this.instance.use(...wrapped)
  }
  public registerRoute(method: string, path: string, action: Function): void {
    const normalizedPath = normalizePath(path)

    this.instance[method.toLowerCase()](
      normalizedPath,
      async (req: Request, res: Response, next: Function) => {
        try {
          const ctx = (req as any).ctx

          const result = await action(ctx)

          if (result !== undefined && !res.headersSent) {
            this.reply(res, result)
          }
        } catch (error) {
          next(error)
        }
      }
    )
  }

  public enableCors(options: CorsConfig): void {
    this.use(cors(options as any))
  }

  public set(key: string, value: any): this {
    this.instance.set(key, value)
    return this
  }

  public engine(ext: string, engine: any): this {
    this.instance.engine(ext, engine)
    return this
  }

  public setViewEngine(engine: string): this {
    return this.set('view engine', engine)
  }

  public setBaseViewsDir(path: string | string[]): this {
    return this.set('views', path)
  }

  public setGlobalPrefix(prefix: string): void {
    if (!prefix.startsWith('/')) {
      prefix = `/${prefix}`
    }

    const router = express.Router()
    this.instance.use(prefix, router)

    this.logger.info(`Global prefix set to: ${prefix}`)
  }
  public useStaticAssets(path: string): void {
    this.instance.use(express.static(path))
    this.logger.info(`Static asset directory registered: ${path}`)
  }
}
