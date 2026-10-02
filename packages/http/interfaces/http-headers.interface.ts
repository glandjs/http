/**
 * The header names Gland knows, keyed by their lower-case wire spelling.
 *
 * This exists so that a typo in a header name is a compile error rather than a
 * silently-ignored `undefined` at runtime. Express, Fastify, Koa and `node:http`
 * all normalise header names to lower case internally, so the table does too.
 */
type HttpHeaders<THeaders extends string = string> = {
  accept?: string;
  'accept-language'?: string;
  'accept-patch'?: string;
  'accept-ranges'?: string;
  'access-control-allow-credentials'?: string;
  'access-control-allow-headers'?: string;
  'access-control-allow-methods'?: string;
  'access-control-allow-origin'?: string;
  'access-control-expose-headers'?: string;
  'access-control-max-age'?: string;
  'access-control-request-headers'?: string;
  'access-control-request-method'?: string;
  age?: string;
  allow?: string;
  'alt-svc'?: string;
  authorization?: string;
  'cache-control'?: string;
  connection?: string;
  'content-disposition'?: string;
  'content-encoding'?: string;
  'content-language'?: string;
  'content-length'?: string;
  'content-location'?: string;
  'content-range'?: string;
  'content-security-policy'?: string;
  'content-type'?: 'text/html' | 'application/json' | 'application/problem+json' | 'text/plain' | 'application/xml' | 'application/octet-stream' | 'text/event-stream' | `${THeaders}` | THeaders;
  cookie?: string;
  date?: string;
  etag?: string;
  expect?: string;
  expires?: string;
  forwarded?: string;
  from?: string;
  host?: string;
  'if-match'?: string;
  'if-modified-since'?: string;
  'if-none-match'?: string;
  'if-unmodified-since'?: string;
  'keep-alive'?: string;
  'last-modified'?: string;
  location?: string;
  origin?: string;
  pragma?: string;
  'proxy-authenticate'?: string;
  'proxy-authorization'?: string;
  'public-key-pins'?: string;
  range?: string;
  referer?: string;
  'retry-after'?: string;
  'sec-websocket-accept'?: string;
  'sec-websocket-extensions'?: string;
  'sec-websocket-key'?: string;
  'sec-websocket-protocol'?: string;
  'sec-websocket-version'?: string;
  'set-cookie'?: string[];
  'strict-transport-security'?: string;
  te?: string;
  trailer?: string;
  'transfer-encoding'?: string;
  upgrade?: string;
  'user-agent'?: string;
  vary?: string;
  via?: string;
  warning?: string;
  'www-authenticate'?: string;
  'x-forwarded-for'?: string;
  'x-forwarded-host'?: string;
  'x-forwarded-proto'?: string;
  'x-powered-by'?: string;
  'x-request-id'?: string;
  'x-correlation-id'?: string;
};

/**
 * A header name.
 *
 * Known names are suggested by the editor; anything else is still accepted as
 * a template literal, so `ctx.setHeader('x-tenant-id', id)` compiles without
 * the table having to know about your custom headers.
 */
export type HttpHeaderName<T extends string = string, THeaders extends string = string> = `${keyof HttpHeaders<THeaders>}` | `${T}` | T;

/**
 * The value a header may hold.
 *
 * `undefined` is part of the union because `getHeader()` has to be able to say
 * "not set" without a separate overload.
 */
export type HttpHeaderValue<T extends string, THeaders extends string = string> = T extends keyof HttpHeaders<THeaders> ? HttpHeaders<THeaders>[T] | undefined : string | string[] | number | undefined;

/**
 * The value a header may be *set* to.
 *
 * The non-nullable counterpart of {@link HttpHeaderValue}, so `setHeader` cannot
 * be handed `undefined` by accident.
 */
export type HttpHeaderInput<T extends string, THeaders extends string = string> = NonNullable<HttpHeaderValue<T, THeaders>>;

/** Case-insensitive header bag, as returned by `ctx.headers`. */
export type HeaderBag = Readonly<Record<string, string | string[] | undefined>>;
