import { HttpCore, type HttpApplicationOptions } from '@glandjs/http'
import { ExpressAdapter } from './adapter'
import type { Application, Request, Response } from 'express'
import { EventRecord } from '@glandjs/events'
import type { Server } from 'net'
export class ExpressCore<TEvents extends EventRecord> extends HttpCore<
  Server,
  Application,
  Request,
  Response
> {
  constructor(options?: HttpApplicationOptions) {
    super(new ExpressAdapter<TEvents>(), options)
  }
}
