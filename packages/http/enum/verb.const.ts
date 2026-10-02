import { RequestMethod } from './method.enum';

/**
 * Lower-case method names, which is the shape every router API speaks.
 *
 * `app.get()`, `router.get()`, `app.on('get')` — frameworks never want
 * `'GET'`. {@link toVerb} is the only sanctioned conversion, so that the
 * framework-specific call sites stay a single readable line.
 */
export const HTTP_VERBS = [
  // ── Native everywhere ─────────────────────────────────────────────────
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',

  // ── Hidden behind most router APIs ────────────────────────────────────
  'connect',
  'trace',
  'purge',
  'search',

  // ── WebDAV (RFC 4918) ─────────────────────────────────────────────────
  'copy',
  'lock',
  'mkcol',
  'move',
  'propfind',
  'proppatch',
  'unlock',

  // ── WebDAV access control (RFC 3744) ─────────────────────────────────
  'acl',

  // ── WebDAV binding (RFC 5842) ────────────────────────────────────────
  'bind',
  'rebind',
  'unbind',

  // ── WebDAV versioning / checkout (RFC 3253) ──────────────────────────
  'checkout',
  'merge',
  'mkactivity',
  'mkworkspace',
  'report',
  'update',

  // ── Server-sent events (RFC 6665) ────────────────────────────────────
  'notify',
  'subscribe',
  'unsubscribe',
] as const;

/** A lower-case HTTP method name. */
export type HttpVerb = (typeof HTTP_VERBS)[number];

/**
 * The subset of {@link HTTP_VERBS} that every supported adapter registers
 * through a dedicated router method.
 *
 * An adapter that meets a verb outside this list has to register it
 * method-agnostically — `app.all(path, guard)` on Express, a method array on
 * Fastify, a manual `req.method` check on `node:http`.
 */
export const CORE_HTTP_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/** A verb every adapter registers natively. */
export type CoreHttpVerb = (typeof CORE_HTTP_VERBS)[number];

/** Gland's marker verb for "every routable method". */
export const ALL_VERB = 'all';

/**
 * Every method {@link ALL_VERB} expands to, in declaration order.
 *
 * The order is stable so that a route table printed by an adapter is
 * reproducible, and so `registerAll()` implementations register the same
 * methods in the same sequence regardless of the framework underneath.
 */
export const ROUTABLE_METHODS: readonly RequestMethod[] = Object.freeze((Object.values(RequestMethod) as RequestMethod[]).filter((method) => method !== RequestMethod.ALL));

/** Lower-case verb for every routable method, in {@link ROUTABLE_METHODS} order. */
export const ROUTABLE_VERBS: readonly HttpVerb[] = Object.freeze(ROUTABLE_METHODS.map((method) => method.toLowerCase() as HttpVerb));

/**
 * Converts a wire method to the lower-case verb a router expects.
 *
 * Unknown strings pass through lower-cased rather than throwing: an adapter
 * should be able to carry a method Gland has not been taught yet, and a
 * WebDAV extension method is a legitimate thing to hit.
 *
 * @param method - a {@link RequestMethod} or any raw method string
 * @returns the lower-case verb, or `'all'` for {@link RequestMethod.ALL}
 *
 * @example
 * ```ts
 * toVerb('GET')       // 'get'
 * toVerb('PROPFIND')  // 'propfind'
 * toVerb('ALL')       // 'all'
 * toVerb('BREW')      // 'brew'
 * ```
 */
export function toVerb(method: RequestMethod | string): HttpVerb | typeof ALL_VERB {
  return method.toLowerCase() as HttpVerb | typeof ALL_VERB;
}

/** Narrows an arbitrary value to a known {@link HttpVerb}. */
export function isHttpVerb(value: unknown): value is HttpVerb {
  return typeof value === 'string' && (HTTP_VERBS as readonly string[]).includes(value);
}

/** Narrows an arbitrary value to a {@link CoreHttpVerb}. */
export function isCoreVerb(value: unknown): value is CoreHttpVerb {
  return typeof value === 'string' && (CORE_HTTP_VERBS as readonly string[]).includes(value);
}

/** Narrows an arbitrary value to a concrete {@link RequestMethod} (never `ALL`). */
export function isRequestMethod(value: unknown): value is RequestMethod {
  return typeof value === 'string' && ROUTABLE_METHODS.includes(value as RequestMethod);
}
