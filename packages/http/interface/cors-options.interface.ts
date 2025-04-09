import type { RequestMethod } from '../enum'
import type { CustomOrigin, StaticOrigin } from '../types'

export interface CorsOptionsCallback {
  (error: Error | null, options: CorsOptions): void
}
export interface CorsOptionsDelegate<T> {
  (req: T, cb: CorsOptionsCallback): void
}

export interface CorsOptions {
  /**
   * Configures the `Access-Control-Allow-Origin` CORS header.
   * @default '*'
   */
  origin?: StaticOrigin | CustomOrigin

  /**
   * Configures the `Access-Control-Allow-Methods` CORS header.
   * @default 'GET,HEAD,PUT,PATCH,POST,DELETE'
   */
  methods?: keyof typeof RequestMethod | (keyof typeof RequestMethod)[]

  /**
   * Configures the `Access-Control-Allow-Headers` CORS header.
   */
  allowedHeaders?: string | string[]

  /**
   * Configures the `Access-Control-Expose-Headers` CORS header.
   */
  exposedHeaders?: string | string[]

  /**
   * Configures the `Access-Control-Allow-Credentials` CORS header.
   * @default false
   */
  credentials?: boolean

  /**
   * Configures the `Access-Control-Max-Age` CORS header.
   */
  maxAge?: number

  /**
   * Whether to pass the CORS preflight response to the next handler.
   * @default false
   */
  preflightContinue?: boolean

  /**
   * Provides a status code to use for successful `OPTIONS` requests.
   * @default 204
   */
  optionsSuccessStatus?: number
}
