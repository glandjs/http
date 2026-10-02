import type { Maybe } from '@medishn/toolkit';
import type { RequestMethod } from '../enum/method.enum';

/**
 * Origin matching strategies for `Access-Control-Allow-Origin`.
 *
 * The array form is a whitelist, not a fallback list: an origin matches if it
 * equals any entry, or matches any entry's `RegExp`. `'*'` and a `RegExp` array
 * are rejected together by {@link file:../middleware/cors.middleware.ts}, since
 * "allow everything, but only some of it" is not a policy anyone means.
 */
export type StaticOrigin = boolean | string | RegExp | readonly (string | RegExp)[];

/**
 * Decides the allowed origin asynchronously.
 *
 * Needed for the common case of a per-tenant allow-list kept in a database,
 * which cannot be resolved at boot.
 */
export type CustomOrigin = (requestOrigin: Maybe<string>, callback: (err: Maybe<Error>, origin?: StaticOrigin) => void) => void;

/** Callback form of {@link CorsOptionsDelegate}. */
export interface CorsOptionsCallback {
  (error: Error | null, options: CorsOptions): void;
}

/**
 * Resolves CORS options per request.
 *
 * @typeParam TRequest - the framework's request object
 */
export interface CorsOptionsDelegate<TRequest = any> {
  (req: TRequest, cb: CorsOptionsCallback): void;
}

/**
 * CORS policy.
 *
 * Defaults follow the `cors` package, because that is the behaviour people
 * already have configured in an existing Express application they are porting.
 */
export interface CorsOptions {
  /**
   * Allowed origin.
   *
   * @default '*'
   */
  origin?: StaticOrigin | CustomOrigin;

  /**
   * `Access-Control-Allow-Methods`.
   *
   * @default 'GET,HEAD,PUT,PATCH,POST,DELETE'
   */
  methods?: RequestMethod | readonly RequestMethod[];

  /**
   * `Access-Control-Allow-Headers`.
   *
   * `undefined` means "echo whatever the preflight asked for", which is the
   * behaviour a request-scoped policy needs and a static policy usually does
   * not — declare the list explicitly when you can.
   */
  allowedHeaders?: string | readonly string[];

  /** `Access-Control-Expose-Headers`. */
  exposedHeaders?: string | readonly string[];

  /**
   * `Access-Control-Allow-Credentials`.
   *
   * @default false
   */
  credentials?: boolean;

  /**
   * `Access-Control-Max-Age`, in seconds.
   *
   * @default 600 — the ceiling in Chrome and Firefox. Above it, the browser
   * caps the value itself and logs a warning you will never see.
   */
  maxAge?: number;

  /**
   * Hand the `OPTIONS` request to the next handler instead of ending it with
   * `204`.
   *
   * @default false
   */
  preflightContinue?: boolean;

  /**
   * Status for a successful preflight.
   *
   * @default 204
   */
  optionsSuccessStatus?: number;

  /**
   * Add `Vary: Origin` on responses whose origin was reflected.
   *
   * Without it a shared cache will serve one tenant's reflected origin to
   * another. On by default, because the failure it prevents is a data leak and
   * the header costs one line.
   *
   * @default true
   */
  vary?: boolean;
}

/**
 * What `app.enableCors()` accepts.
 *
 * `true` is the permissive default and `false` disables the middleware, so that
 * a boolean can come straight from a config file.
 */
export type CorsConfig = boolean | CorsOptions | CorsOptionsDelegate;
