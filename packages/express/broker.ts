import { HttpBroker, type HttpApplicationOptions } from '@glandjs/http'
import { ExpressCore } from './core'
import { EventRecord } from '@glandjs/events'

export class ExpressBroker<TEvents extends EventRecord> extends HttpBroker<
  TEvents,
  ExpressCore<TEvents>,
  HttpApplicationOptions
> {
  constructor(options?: HttpApplicationOptions) {
    super(new ExpressCore<TEvents>(options), options)
  }
}
