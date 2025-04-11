import { Channel, On } from '@glandjs/common'
import type { ExpressContext } from '@glandjs/express'
import type { FastifyContext } from '@glandjs/fastify'

@Channel('response')
export class Response {
  @On('send')
  index(ctx: ExpressContext | FastifyContext) {
    ctx.res.send('Hello World')
  }
}
