import { HttpCore, type HttpApplicationOptions } from '@glandjs/http'
import { ExpressAdapter } from './express-adapter'
import type { Application, Request, Response } from 'express'
import type { Server } from 'net'
export class ExpressCore extends HttpCore<
  Server,
  Application,
  Request,
  Response
> {
  constructor(options?: HttpApplicationOptions) {
    super(new ExpressAdapter(), options)
  }
}
