import {
  HttpContext,
  HttpServerAdapter,
  ServerFactory,
  type HttpApplicationOptions,
} from '@glandjs/http'
import type { CorsConfig, RouteAction } from '@glandjs/http/types'
import { isNil, isObject, isString } from '@medishn/toolkit'
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Server } from 'net'
import { loadPackage, normalizePath } from '@glandjs/common'
import fastifyCors from '@fastify/cors'
import { pipeline } from 'stream'
/**
 * "fastify/view" interfaces
 * @see https://github.com/fastify/point-of-view/blob/master/types/index.d.ts
 * @publicApi
 */
export interface FastifyViewOptions {
  engine: {
    ejs?: any
    eta?: any
    nunjucks?: any
    pug?: any
    handlebars?: any
    mustache?: any
    'art-template'?: any
    twig?: any
    liquid?: any
    dot?: any
  }
  templates?: string | string[]
  includeViewExtension?: boolean
  options?: object
  charset?: string
  maxCache?: number
  production?: boolean
  defaultContext?: object
  layout?: string
  root?: string
  viewExt?: string
  propertyName?: string
  asyncProperyName?: string
}
export class FastifyAdapter extends HttpServerAdapter<
  Server,
  FastifyInstance,
  FastifyRequest,
  FastifyReply
> {
  constructor() {
    super(Fastify())
    this.instance.addHook(
      'onRequest',
      (req: FastifyRequest, reply: FastifyReply, done) => {
        const ctx = new HttpContext(this.events, req, reply)
        ;(req as any).ctx = ctx
        done()
      }
    )
  }
  public initialize(): Promise<void> | void {
    this.logger.info('Initializing Fastify adapter')
    this.events.on('options', (options) => {})
  }
  public async listen(
    port: string | number,
    hostname: string = 'localhost',
    message?: string
  ): Promise<void> {
    try {
      const parsedPort = isString(port) ? parseInt(port, 10) : port
      const options = this.events.request<HttpApplicationOptions>(
        'options',
        {},
        'first'
      )
      const defaultMessage = `Server listening on ${hostname}:${parsedPort}`
      this.logger.info(message ?? defaultMessage)
      this.server = ServerFactory.create(options, (req, res) => {
        this.instance.server.emit('request', req, res)
      })
      await this.instance.listen({ port: parsedPort, host: hostname })
    } catch (error) {
      this.handleError(error, 'Failed to start Fastify server')
    }
  }

  public reply(response: FastifyReply, body: any, statusCode?: number): any {
    if (statusCode) {
      response.status(statusCode)
    }

    if (isNil(body)) {
      return response.send()
    }

    if (body && body.getStream && typeof body.getStream === 'function') {
      const streamHeaders = body.getHeaders ? body.getHeaders() : {}

      if (!response.getHeader('Content-Type') && streamHeaders.type) {
        response.header('Content-Type', streamHeaders.type)
      }

      return pipeline(
        body.getStream().once('error', (err: Error) => {
          response.status(500).send()
          this.logger.error(err)
        }),
        response.raw,
        (err: any) => {
          if (err) {
            this.logger.error(err)
          }
        }
      )
    }

    return isObject(body) ? response.send(body) : response.send(String(body))
  }
  public registerRoute(
    method: string,
    path: string,
    action: RouteAction<FastifyRequest, FastifyReply>
  ): void {
    const normalizedPath = normalizePath(path)

    this.instance.route({
      method: method.toUpperCase() as
        | 'GET'
        | 'POST'
        | 'PUT'
        | 'DELETE'
        | 'PATCH',
      url: normalizedPath,
      handler: async (req: FastifyRequest, res: FastifyReply) => {
        try {
          const ctx = (req as any).ctx
          const result = await action(ctx)

          if (result !== undefined && !res.sent) {
            this.reply(res, result)
          }
        } catch (error) {
          res.send(error)
        }
      },
    })
  }
  public async enableCors(options: CorsConfig): Promise<void> {
    await this.instance.register(fastifyCors, options as any)
  }
  public use(...args: any[]): any {
    // Fastify uses plugins instead of middleware
    // For simple middleware functions, we can convert them to Fastify hooks
    const [arg] = args

    if (typeof arg === 'function') {
      if (arg.length === 2 || arg.length === 3) {
        return this.instance.addHook(
          'onRequest',
          async (req: FastifyRequest, reply: FastifyReply) => {
            const ctx = (req as any).ctx
            if (!ctx) throw new Error('No context found in middleware')

            return new Promise((resolve, reject) => {
              arg(ctx, (err?: Error) => {
                if (err) return reject(err)
                resolve()
              })
            })
          }
        )
      }

      return this.instance.register(arg)
    }

    return this.instance
  }

  public useStaticAssets(options: string) {
    return this.instance.register(
      loadPackage('@fastify/static', 'FastifyAdapter.useStaticAssets()', () =>
        require('@fastify/static')
      ),
      {
        root: options,
      }
    )
  }

  public set(key: string, value: any): this {
    this.instance.decorate(key, value)
    return this
  }
  public engine(ext: string, engine: any): this {
    return this
  }
  public setViewEngine(options: FastifyViewOptions) {
    return this.instance.register(
      loadPackage('@fastify/view', 'FastifyAdapter.setViewEngine()', () =>
        require('@fastify/view')
      ),
      options
    )
  }

  public setBaseViewsDir(viewsDir: string | string[]): this {
    return this
  }

  public setGlobalPrefix(prefix: string): void {
    this.logger.info(`Global prefix set to: ${prefix}`)
  }
}
