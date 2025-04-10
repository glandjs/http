import { HttpBroker, type HttpApplicationOptions } from '@glandjs/http'
import { FastifyCore } from './core'

export class FastifyBroker extends HttpBroker<
  FastifyCore,
  HttpApplicationOptions
> {
  constructor(options: HttpApplicationOptions) {
    super(new FastifyCore(options), options)
  }
}
