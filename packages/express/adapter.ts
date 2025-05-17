import { HttpServerAdapter, ServerFactory } from '@glandjs/http'
import type { CorsConfig, RouteAction } from '@glandjs/http/types'
import { isNil, isObject, isString } from '@medishn/toolkit'
import express, { type Application, type Request, type Response } from 'express'
import { normalizePath, loadPackage } from '@glandjs/common'

import { pipeline } from 'node:stream'
import { Server } from 'net'
import { ExpressContext } from './context'
import { EventRecord } from '@glandjs/events'
export class ExpressAdapter<
  TEvents extends EventRecord,
> extends HttpServerAdapter<Server, Application, Request, Response> {
  private parserMiddleware: Function[] = []
  constructor() {
    super(express())
    express.json()
    express.urlencoded()
    express.raw()
    express.text()
  }
  public json(options?: any): this {
    this.parserMiddleware.push(express.json(options))
    return this
  }

  public urlencoded(options?: { extended?: boolean }): this {
    this.parserMiddleware.push(express.urlencoded(options))
    return this
  }

  public raw(options?: any): this {
    this.parserMiddleware.push(express.raw(options))
    return this
  }

  public text(options?: any): this {
    this.parserMiddleware.push(express.text(options))
    return this
  }
  public initialize(): Promise<void> | void {
    this.logger.info('Initializing Express adapter')
    this.events.on('options', (options) => {})
  }
  public listen(
    port: number | string,
    hostname: string = 'localhost',
    message?: string
  ) {
    console.log(
      `Applying ${this.parserMiddleware.length} parser middleware during listen`
    )
    this.parserMiddleware.forEach((middleware, index) => {
      console.log(`Applying parser middleware #${index + 1}`)
      this.instance.use(middleware)
    })

    this.instance.use((req: Request, res: Response, next: Function) => {
      const ctx = new ExpressContext(this.events, req, res)
      // @ts-ignore
      req.ctx = ctx
      next()
    })
    try {
      const parsedPort = isString(port) ? parseInt(port, 10) : port

      const options = this.events.call('options', {})

      const defaultMessage = `Server listening on ${hostname}:${parsedPort}`
      this.logger.info(message ?? defaultMessage)
      this.server = ServerFactory.create(options, this.instance)
      this.server.listen(parsedPort, hostname)
    } catch (error) {
      this.handleError(error, 'Failed to start Express server')
    }
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
  public registerRoute(
    method: string,
    path: string,
    action: RouteAction<Request, Response>
  ): void {
    const normalizedPath = normalizePath(path)

    this.instance[method.toLowerCase()](
      normalizedPath,
      async (req: Request, res: Response, next: Function) => {
        try {
          // @ts-ignore
          const ctx = req.ctx
          ctx.params = req.params
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
    const cors = loadPackage('cors', 'cors is not install')
    this.use(cors(options))
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
