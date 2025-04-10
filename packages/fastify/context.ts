import { HttpContext } from '@glandjs/http'
import type { FastifyReply, FastifyRequest } from 'fastify'

export class FastifyContext extends HttpContext<FastifyRequest, FastifyReply> {}
