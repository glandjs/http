import { Maybe } from '@medishn/toolkit'
import type { CorsOptions, CorsOptionsDelegate } from '../interface'
import type { IncomingMessage } from 'http'
export type StaticOrigin = boolean | string | RegExp | (string | RegExp)[]

export type CustomOrigin = (
  requestOrigin: string,
  callback: (err: Maybe<Error>, origin?: StaticOrigin) => void
) => void

export type CorsConfig =
  | boolean
  | CorsOptions
  | CorsOptionsDelegate<IncomingMessage>
