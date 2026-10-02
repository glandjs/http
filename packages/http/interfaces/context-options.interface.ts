import type { Maybe } from '@medishn/toolkit';

/**
 * `Set-Cookie` options.
 *
 * A structural copy of the common subset rather than a dependency on
 * `cookie`/`express` types, so the context contract does not leak a framework.
 */
export interface CookieOptions {
  /** Lifetime in ms. Serialised as `Max-Age` and, when `expires` is absent, as `Expires`. */
  maxAge?: number;
  /** Cookie name. Set by `setCookie()`, not here. */
  name?: string;
  /** Secret used to sign the value. */
  secret?: string | string[];
  /** Path. @default '/' */
  path?: string;
  /** `Domain` attribute. */
  domain?: string;
  /**
   * `SameSite` attribute.
   *
   * `true` maps to `'Strict'`, `false` omits the attribute. Modern browsers
   * default an unset `SameSite` to `Lax`, so omitting it is not the same as
   * permitting cross-site use.
   */
  sameSite?: 'strict' | 'lax' | 'none' | boolean;
  /** `Secure` attribute. */
  secure?: boolean;
  /** Trust `X-Forwarded-Proto` when deciding whether the cookie is secure. */
  secureProxy?: boolean;
  /** `HttpOnly` attribute. */
  httpOnly?: boolean;
  /** Sign the value with `secret`. */
  signed?: boolean;
  /** Overwrite an existing cookie of the same name. */
  overwrite?: boolean;
  /** Absolute expiry. */
  expires?: Date;
  /** `Priority` attribute. */
  priority?: 'low' | 'medium' | 'high';
  /** `Partitioned` attribute (CHIPS). */
  partitioned?: boolean;
}

/** A cookie as it arrives on the request. */
export interface RequestCookie {
  value: string;
  /** Present only when the value carried a `Signature` segment. */
  signed: boolean;
  /** Set when the signature did not verify. */
  tampered?: boolean;
}

/** A parsed `Cookie` header. */
export type RequestCookies = Record<string, RequestCookie>;

/** Called after `sendFile()` completes. */
export type ErrorCallback = (err?: Maybe<Error>) => void;

/**
 * Options for `ctx.sendFile()` and `ctx.download()`.
 *
 * Kept compatible with the Express option names so that existing code reads the
 * same here, but every adapter maps it onto its own facility — Koa has no
 * equivalent, so the `@glandjs/koa` adapter streams the file itself rather than
 * silently ignoring half of these.
 */
export interface SendOptions {
  /**
   * Honour `Range` requests and send `Accept-Ranges`.
   * @default true
   */
  acceptRanges?: boolean;

  /**
   * Send a `Cache-Control` header derived from `maxAge`.
   * @default true
   */
  cacheControl?: boolean;

  /**
   * How to treat dotfiles.
   * @default 'ignore'
   */
  dotfiles?: 'allow' | 'deny' | 'ignore';

  /** First byte to send, inclusive. */
  start?: number;

  /** Last byte to send, inclusive. */
  end?: number;

  /** Send `ETag`. @default true */
  etag?: boolean;

  /** Send `Last-Modified`. @default true */
  lastModified?: boolean;

  /**
   * `Cache-Control: max-age=<n>`.
   *
   * Ignored when {@link SendOptions.cacheControl} is `false`.
   */
  maxAge?: number | string;

  /**
   * Extensionless-file fallbacks, e.g. `['html', 'htm']`.
   *
   * @default false
   */
  extensions?: string | readonly string[] | false;

  /**
   * Directory index.
   * @default 'index.html'
   */
  index?: string | readonly string[] | false;

  /** Resolve relative paths against this directory. */
  root?: string;

  /**
   * Add `immutable` to `Cache-Control`.
   *
   * Only meaningful together with `maxAge`; without a lifetime the directive
   * is ignored by browsers anyway.
   * @default false
   */
  immutable?: boolean;
}

/** Payload of `HttpEvent.RequestStart` and `HttpEvent.RequestEnd`. */
export interface RequestLifecycleEvent {
  /** Correlation id: the `X-Request-Id` header, or a generated one. */
  id: string;
  /** Upper-case wire method. */
  method: string;
  /** Request path, without the query string. */
  path: string;
  /** Full URL as received. */
  url: string;
  /** Client address, honouring `X-Forwarded-For` when `trustProxy` is on. */
  ip?: string;
  /** Milliseconds since `Date.now()` at the start of the request. */
  startedAt: number;
  /** Populated on `RequestEnd`. */
  status?: number;
  /** Populated on `RequestEnd`. */
  duration?: number;
  /** ISO timestamp. */
  timestamp: string;
}
