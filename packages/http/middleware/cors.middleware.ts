import { isNil, type Maybe } from '@medishn/toolkit';
import { HttpStatus } from '@medishn/toolkit';
import type { MiddlewareFunction } from '../contracts/middleware';
import type { HttpContext } from '../context/http-context';
import type { RequestMethod } from '../enum';
import type { CorsConfig, CorsOptions, CustomOrigin, StaticOrigin } from '../interfaces/cors-options.interface';

/** Defaults, chosen to match the `cors` package so existing config ports over. */
const DEFAULTS = {
  origin: '*' as StaticOrigin,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'] as RequestMethod[],
  credentials: false,
  maxAge: 600,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  vary: true,
} as const satisfies CorsOptions;

/**
 * Cross-Origin Resource Sharing, implemented in Gland rather than delegated.
 *
 * Every adapter's `enableCors()` calls this. The alternative — `loadPackage('cors')`
 * for Express, `@fastify/cors`, `@koa/cors` for the others — would give five
 * different policies for one application, and CORS is exactly the kind of
 * policy that has to be identical on every edge.
 *
 * Two details that are easy to get wrong and are handled here:
 *
 * - **`Vary: Origin` is added whenever the origin is reflected.** A shared cache
 *   that stored one tenant's reflected origin would hand it to the next tenant.
 * - **A wildcard `*` combined with `credentials: true` is rejected.** Browsers
 *   refuse that combination, so a config that says it is a bug in the config,
 *   and failing at boot beats failing in the browser console.
 *
 * @param config - `true` for the defaults, or a policy
 * @returns Gland middleware
 *
 * @example
 * ```ts
 * app.enableCors({ origin: ['https://app.example.com'], credentials: true });
 * ```
 * @example
 * ```ts
 * app.enableCors({
 *   origin: async (requestOrigin, cb) => {
 *     const tenant = await tenants.findByDomain(requestOrigin);
 *     cb(null, tenant ? requestOrigin : false);
 *   },
 * });
 * ```
 */
export function createCorsMiddleware<TContext extends HttpContext<any, any, any>>(config: CorsConfig = true): MiddlewareFunction<TContext> {
  const options = resolveOptions(config);
  assertCoherent(options);

  return async function glandCors(ctx: TContext, next) {
    const requestOrigin = ctx.getHeader('origin') as Maybe<string>;

    // No `Origin` header: not a cross-origin request. Nothing to negotiate, and
    // adding CORS headers to it is noise.
    if (isNil(requestOrigin)) {
      await next();
      return;
    }

    const allowed = await resolveOrigin(options.origin, requestOrigin);
    const isPreflight = ctx.method === 'OPTIONS' && Boolean(ctx.getHeader('access-control-request-method'));

    if (allowed === false) {
      // Deliberately no `Access-Control-Allow-Origin`. The browser blocks the
      // response, which is the correct outcome; writing `null` would be a
      // subtler version of the same refusal.
      await next();
      return;
    }

    if (options.vary) ctx.vary('Origin');
    ctx.setHeader('access-control-allow-origin', allowed);

    if (options.credentials) {
      ctx.setHeader('access-control-allow-credentials', 'true');
    }

    if (isPreflight) {
      ctx.setHeader('access-control-allow-methods', joinHeader(options.methods));
      ctx.setHeader('access-control-allow-headers', resolveAllowedHeaders(options.allowedHeaders, ctx.getHeader('access-control-request-headers') as Maybe<string>));
      ctx.setHeader('access-control-max-age', String(clampMaxAge(options.maxAge)));

      if (options.exposedHeaders) {
        ctx.setHeader('access-control-expose-headers', joinHeader(options.exposedHeaders));
      }

      if (!options.preflightContinue) {
        ctx.status(options.optionsSuccessStatus as HttpStatus);
        ctx.end();
        return;
      }
    } else if (options.exposedHeaders) {
      ctx.setHeader('access-control-expose-headers', joinHeader(options.exposedHeaders));
    }

    await next();
  };
}

/**
 * Normalises the accepted forms into one {@link CorsOptions}.
 *
 * A delegate is probed with a no-op request so that its answer is cached for the
 * first real request; a delegate that is asynchronous cannot be resolved here,
 * so it is passed through and evaluated per request.
 */
function resolveOptions(config: CorsConfig): CorsOptions {
  if (config === true) return { ...DEFAULTS };
  if (config === false) return { ...DEFAULTS, origin: false };
  if (typeof config === 'function') return { ...DEFAULTS, origin: (_origin, callback) => (config as (req: any, cb: any) => void)(undefined, callback) };
  return { ...DEFAULTS, ...config };
}

/**
 * Rejects a configuration the browser would refuse anyway.
 *
 * Failing at boot means a deploy catches it. Failing at runtime means a
 * production console that says `The value of the 'Access-Control-Allow-Origin'
 * header ... must be '*' ...` while the app looks healthy.
 */
function assertCoherent(options: CorsOptions): void {
  if (!options.credentials) return;
  if (options.origin === '*' || options.origin === true) {
    throw new Error(
      'CORS configuration is contradictory: `credentials: true` cannot be combined with `origin: "*"`. ' + 'The browser rejects it. List the allowed origins explicitly, or set `credentials: false`.',
    );
  }
}

/** Resolves the `Access-Control-Allow-Origin` value for a request. */
function resolveOrigin(origin: CorsOptions['origin'], requestOrigin: string): Promise<string | false> {
  if (isNil(origin) || origin === '*' || origin === true) return Promise.resolve('*');
  if (origin === false) return Promise.resolve(false);

  if (typeof origin === 'function') {
    return new Promise<string | false>((resolve, reject) => {
      try {
        (origin as CustomOrigin)(requestOrigin, (error, resolved) => {
          if (error) return reject(error);
          resolve(evaluate(resolved, requestOrigin));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  return Promise.resolve(evaluate(origin, requestOrigin));
}

/** Applies the static-origin rules to a candidate value. */
function evaluate(origin: StaticOrigin | undefined, requestOrigin: string): string | false {
  if (isNil(origin) || origin === false) return false;
  if (origin === true) return requestOrigin;

  if (typeof origin === 'string') return origin === '*' || origin === requestOrigin ? origin : false;

  if (origin instanceof RegExp) return origin.test(requestOrigin) ? requestOrigin : false;

  // An array is a whitelist. A `RegExp` entry echoes the request's own origin
  // rather than the pattern, which is not a value a browser will accept.
  for (const candidate of origin) {
    if (typeof candidate === 'string' && candidate === requestOrigin) return requestOrigin;
    if (candidate instanceof RegExp && candidate.test(requestOrigin)) return requestOrigin;
  }

  return false;
}

/**
 * Decides `Access-Control-Allow-Headers`.
 *
 * `undefined` means "echo the preflight's `Access-Control-Request-Headers`",
 * which is what a request-scoped policy needs. An explicit list is respected
 * even when the client asked for something else, so a static policy can
 * actually be static.
 */
function resolveAllowedHeaders(configured: string | readonly string[] | undefined, requested: Maybe<string>): string {
  if (configured) return joinHeader(configured);
  if (!requested) return '';
  return requested
    .split(',')
    .map((header) => header.trim())
    .filter(Boolean)
    .join(',');
}

/** Chrome and Firefox both cap the preflight cache at 10 minutes. */
function clampMaxAge(maxAge: number | undefined): number {
  if (isNil(maxAge) || maxAge < 0) return DEFAULTS.maxAge;
  return Math.min(Math.floor(maxAge), DEFAULTS.maxAge);
}
/** Joins a header value that may be a string or an array. */
function joinHeader(value: string | readonly string[] | undefined): string {
  if (isNil(value)) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}
