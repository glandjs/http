import { HttpsOptions } from './http-options.interface'

export interface HttpApplicationOptions {
  /**
   * HTTPS configuration.
   */
  https?: HttpsOptions
}
export type ErrorCallback = (err: Error) => void
