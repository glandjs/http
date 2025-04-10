import { HttpContext } from '@glandjs/http'
import type { Request, Response } from 'express'

export class ExpressContext extends HttpContext<Request, Response> {}
