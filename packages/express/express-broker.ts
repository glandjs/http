import { HttpBroker, type HttpApplicationOptions } from '@glandjs/http'
import { ExpressCore } from './express-core'

export class ExpressBroker extends HttpBroker<
  ExpressCore,
  HttpApplicationOptions
> {
  constructor(options?: HttpApplicationOptions) {
    super(new ExpressCore(options), options)
  }
}
