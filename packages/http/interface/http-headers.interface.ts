type HttpHeaders<THeaders extends string = string> = {
  accept?: string
  'accept-language'?: string
  'accept-patch'?: string
  'accept-ranges'?: string
  'access-control-allow-credentials'?: string
  'access-control-allow-headers'?: string
  'access-control-allow-methods'?: string
  'access-control-allow-origin'?: string
  'access-control-expose-headers'?: string
  'access-control-max-age'?: string
  'access-control-request-headers'?: string
  'access-control-request-method'?: string
  age?: string
  allow?: string
  'alt-svc'?: string
  authorization?: string
  'cache-control'?: string
  connection?: string
  'content-disposition'?: string
  'content-encoding'?: string
  'content-language'?: string
  'content-length'?: string
  'content-location'?: string
  'content-range'?: string
  'content-type'?:
    | 'text/html'
    | 'application/json'
    | 'application/octet-stream'
    | `${THeaders}`
    | THeaders
  cookie?: string
  date?: string
  etag?: string
  expect?: string
  expires?: string
  forwarded?: string
  from?: string
  host?: string
  'if-match'?: string
  'if-modified-since'?: string
  'if-none-match'?: string
  'if-unmodified-since'?: string
  'last-modified'?: string
  location?: string
  origin?: string
  pragma?: string
  'proxy-authenticate'?: string
  'proxy-authorization'?: string
  'public-key-pins'?: string
  range?: string
  referer?: string
  'retry-after'?: string
  'sec-websocket-accept'?: string
  'sec-websocket-extensions'?: string
  'sec-websocket-key'?: string
  'sec-websocket-protocol'?: string
  'sec-websocket-version'?: string
  'set-cookie'?: string[]
  'strict-transport-security'?: string
  tk?: string
  trailer?: string
  'transfer-encoding'?: string
  upgrade?: string
  'user-agent'?: string
  vary?: string
  via?: string
  warning?: string
  'www-authenticate'?: string
  'x-powered-by'?: string
}

type ContentTypeValues = NonNullable<HttpHeaders['content-type']>

export type ContentType<T extends string = string> =
  | ContentTypeValues
  | `${T}`
  | T

export type HttpHeaderName<
  T extends string = string,
  THeaders extends string = string,
> = `${keyof HttpHeaders<THeaders>}` | `${T}` | T

export type HttpHeaderValue<
  T,
  THeaders extends string,
> = T extends keyof HttpHeaders
  ? HttpHeaders<THeaders>[T]
  : `${THeaders}` | THeaders | string
