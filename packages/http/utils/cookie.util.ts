import type { RequestCookies } from '../interfaces/context-options.interface';

/**
 * Parses a `Cookie` request header.
 *
 * Present because three of the five adapters cannot rely on the framework having
 * installed a cookie parser. `req.cookies` on Express is `undefined` until
 * `cookie-parser` is mounted, and a controller that reads a session cookie
 * should not have to know that. Twelve lines, no dependency, one behaviour.
 *
 * Two details that a naive `split(';')` gets wrong:
 *
 * - the value may be percent-encoded, because that is what `setCookie` writes
 * - the value may be quoted, which is what Express's `res.cookie` writes
 *
 * A malformed escape is returned raw rather than thrown. A cookie is the
 * client's business, and a getter that throws takes down the request over
 * something the handler can decide about.
 *
 * @param header - the raw `Cookie` header
 * @returns a bag of cookies, `{}` when the header is absent
 *
 * @example
 * ```ts
 * parseCookieHeader('a=1; b=hello%20world');
 * // { a: { value: '1', signed: false }, b: { value: 'hello world', signed: false } }
 * ```
 */
export function parseCookieHeader(header: string | undefined | null): RequestCookies {
  if (!header) return {};

  const bag: RequestCookies = {};
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;

    const name = pair.slice(0, index).trim();
    if (!name) continue;

    bag[name] = { value: decodeCookieValue(pair.slice(index + 1).trim()), signed: false };
  }

  return bag;
}

/**
 * Serialises a `Set-Cookie` header value.
 *
 * Written out rather than pulled from a package: the format is six attributes
 * long, and the `node:http` adapter exists precisely to have no dependencies.
 *
 * @param name - cookie name
 * @param value - cookie value
 * @param options - attributes; `maxAge` is milliseconds, per the Gland contract
 */
export function serializeCookie(name: string, value: string, options: CookieAttributes = {}): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.partitioned) parts.push('Partitioned');
  if (options.priority) parts.push(`Priority=${options.priority[0]?.toUpperCase()}${options.priority.slice(1)}`);
  if (options.sameSite !== undefined && options.sameSite !== false) {
    const mode = options.sameSite === true ? 'Strict' : `${options.sameSite[0]?.toUpperCase()}${options.sameSite.slice(1)}`;
    parts.push(`SameSite=${mode}`);
  }

  return parts.join('; ');
}

/** The attributes {@link serializeCookie} understands. */
export interface CookieAttributes {
  maxAge?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  partitioned?: boolean;
  priority?: 'low' | 'medium' | 'high';
  sameSite?: 'strict' | 'lax' | 'none' | boolean;
}

/** Undoes percent-encoding and the quoting `res.cookie` adds. */
function decodeCookieValue(value: string): string {
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}
