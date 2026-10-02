/**
 * The HTTP methods Gland is able to route.
 *
 * The enum is deliberately wider than any single framework. Express exposes
 * seven verbs, Fastify seven more, Hono and `node:http` accept arbitrary
 * method strings. Keeping the union in Gland means a controller can declare
 * `@Propfind()` once, and the adapter decides whether it can be registered
 * natively or has to fall back to a method-agnostic route.
 *
 * `ALL` is **not** a wire method. It is Gland's marker for "register this
 * handler for every method the adapter can", and each adapter translates it
 * into whatever its router understands. It is therefore excluded from
 * {@link ROUTABLE_METHODS}.
 *
 * @see {@link file:./verb.const.ts} for the split between the methods every
 *      adapter supports natively and the ones it may have to emulate.
 *
 * @example
 * ```ts
 * RequestMethod.GET            // 'GET'
 * RequestMethod.PROPFIND       // 'PROPFIND'
 * RequestMethod.ALL            // 'ALL' — expand to everything routable
 * ```
 */
export enum RequestMethod {
  // ── Every adapter supports these natively ───────────────────────────────
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',

  // ── Defined by HTTP/1.1, hidden behind most router APIs ────────────────
  ALL = 'ALL',
  CONNECT = 'CONNECT',
  TRACE = 'TRACE',

  // ── Caching (RFC 9111) ────────────────────────────────────────────────
  PURGE = 'PURGE',

  // ── Search (RFC 5323) ─────────────────────────────────────────────────
  SEARCH = 'SEARCH',

  // ── WebDAV (RFC 4918) ─────────────────────────────────────────────────
  COPY = 'COPY',
  LOCK = 'LOCK',
  MKCOL = 'MKCOL',
  MOVE = 'MOVE',
  PROPFIND = 'PROPFIND',
  PROPPATCH = 'PROPPATCH',
  UNLOCK = 'UNLOCK',

  // ── WebDAV access control (RFC 3744) ─────────────────────────────────
  ACL = 'ACL',

  // ── WebDAV binding (RFC 5842) ────────────────────────────────────────
  BIND = 'BIND',
  REBIND = 'REBIND',
  UNBIND = 'UNBIND',

  // ── WebDAV versioning / checkout (RFC 3253) ──────────────────────────
  CHECKOUT = 'CHECKOUT',
  MERGE = 'MERGE',
  MKACTIVITY = 'MKACTIVITY',
  MKWORKSPACE = 'MKWORKSPACE',
  REPORT = 'REPORT',
  UPDATE = 'UPDATE',

  // ── Server-sent events over plain HTTP (RFC 6665) ────────────────────
  NOTIFY = 'NOTIFY',
  SUBSCRIBE = 'SUBSCRIBE',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
}
