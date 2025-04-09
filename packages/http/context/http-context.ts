import { Context } from '@glandjs/core'
import { HttpEventCore } from '../adapter/http-events'

import type { Broker } from '@glandjs/events'

/**
 * HTTP-specific context providing access to request/response objects and utility methods.
 * @example
 * ctx.send('Hello World');
 */
export class HttpContext<TRequest, TResponse> extends Context {
  constructor(
    protected readonly events: HttpEventCore,
    public readonly req: TRequest,
    public readonly res: TResponse
  ) {
    const broker = events['_channel']['broker'] as Broker
    super(broker)
  }
}
