import { HttpCore, type HttpApplicationOptions } from '@glandjs/http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Server } from 'net'
import { FastifyAdapter } from './adapter'

export class FastifyCore extends HttpCore<
  Server,
  FastifyInstance,
  FastifyRequest,
  FastifyReply
> {
  constructor(options?: HttpApplicationOptions) {
    super(new FastifyAdapter(), options)
  }
}
