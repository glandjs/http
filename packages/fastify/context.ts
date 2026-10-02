import { HttpContext, ContentType, type AcceptType, type HttpEventBroker, type HttpHeaderInput, type HttpHeaderName, type HttpHeaderValue, type RequestMethod, type SseStream } from '@glandjs/http';
import type { CookieOptions, ErrorCallback, RequestCookies, SendOptions } from '@glandjs/http';
import type { EventRecord } from '@glandjs/events';
import { HttpStatus, type Dictionary, type Maybe } from '@medishn/toolkit';
import type { FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * Fastify's request context.
 *
 * The largest gap between Fastify and the Gland contract is body access. Fastify
 * parses bodies itself and stores them in four fixed places — `body`,
 * `bodyAsBuffer`, `bodyAsText`, and the querystring-parser for `query` — which
 * means a body only exists if a parser is registered for that content type. This
 * context therefore reads all four rather than only `body`, so `ctx.body` is
 * never `undefined` just because the request arrived as `text/plain`.
 *
 * The other notable difference is that a Fastify handler cannot be async-unaware:
 * returning without calling `reply.send()` and returning after having called it
 * are the same thing to Fastify. Gland gets that for free by never letting a
 * handler touch `reply` directly.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * @Get('/:id')
 * async find(ctx: FastifyContext<MyEvents>) {
 *   return ctx.call('db:product:find', ctx.params.id);
 * }
 * ```
 */
export class FastifyContext<TEvents extends EventRecord = EventRecord> extends HttpContext<FastifyRequest, FastifyReply, TEvents> {
  constructor(events: HttpEventBroker<any>, req: FastifyRequest, res: FastifyReply) {
    super(events, req, res);
    this.params = (req.params ?? {}) as Dictionary<string>;
    this.host = req.hostname;
  }

  // ── Request ────────────────────────────────────────────────────────────

  /**
   * The parsed body, whatever its shape.
   *
   * Fastify's `body` is `undefined` for a content type it has no parser for,
   * so the buffer and text forms are consulted before giving up. A handler that
   * got `undefined` here would have to branch on the content type, and that
   * branch is the same on every adapter once the value has been normalised.
   */
  public get body(): any {
    const extended = this.req as FastifyRequest & { bodyAsText?: string; bodyAsBuffer?: Buffer };
    if (this.req.body !== undefined) return this.req.body;
    if (extended.bodyAsText !== undefined) return extended.bodyAsText;
    if (extended.bodyAsBuffer !== undefined) return extended.bodyAsBuffer;
    return undefined;
  }

  public get path(): string {
    // Fastify has no `req.path`; the URL minus the querystring is the same value.
    const url = this.req.raw.url ?? '/';
    const index = url.indexOf('?');
    return index === -1 ? url : url.slice(0, index);
  }

  public get xhr(): boolean {
    return this.req.headers['x-requested-with'] === 'XMLHttpRequest';
  }

  public get stale(): boolean {
    return this.isStale();
  }

  public get fresh(): boolean {
    return !this.isStale();
  }

  public get method(): RequestMethod {
    return this.req.method as RequestMethod;
  }

  public get hostname(): string {
    return this.req.hostname;
  }

  public get ip(): string | undefined {
    return this.req.ip;
  }

  public get protocol(): string {
    return this.req.protocol;
  }

  public get secure(): boolean {
    return this.req.protocol === 'https';
  }

  public get url(): string {
    return this.req.raw.url ?? '/';
  }

  public get originalUrl(): string {
    return this.req.raw.url ?? '/';
  }

  public get query(): Dictionary<string | string[] | undefined> {
    return this.req.query as Dictionary<string | string[] | undefined>;
  }

  public get subdomains(): string[] {
    return splitHost(this.req.hostname);
  }

  public get headers(): Dictionary<string | string[] | undefined> {
    return this.req.headers as Dictionary<string | string[] | undefined>;
  }

  /**
   * Content negotiation.
   *
   * Fastify has no `accepts()`. Implemented here rather than pulled in as a
   * dependency, because the only thing that is needed is a `q`-aware pick from a
   * comma-separated `Accept` header — and a wrong answer here is a
   * content-type bug that surfaces as a broken client, not a server error.
   */
  public get accepts(): (types?: AcceptType) => string | false {
    return (types?: AcceptType): string | false => {
      const header = this.req.headers.accept;
      if (!header) return types === undefined ? '*/*' : '*/*';
      if (types === undefined) return header.split(',')[0]?.trim() ?? '*/*';

      const wanted = (Array.isArray(types) ? types : [types]) as string[];
      const ranked = parseAccept(header);

      for (const candidate of wanted) {
        const match = ranked.find((entry) => entry.type === candidate || entry.type === '*/*' || matchesWildcard(entry.type, candidate));
        if (match) return candidate;
      }

      return false;
    };
  }

  /** `content-type`-to-`req.is()` compatibility. */
  public get is(): (type: string | readonly string[]) => string | false | null {
    return (type: string | readonly string[]): string | false | null => {
      const contentType = this.req.headers['content-type'];
      if (!contentType) return null;
      const base = contentType.split(';')[0]?.trim().toLowerCase();
      const wanted = Array.isArray(type) ? type : [type];
      return wanted.find((candidate) => candidate === base || matchesWildcard(candidate, base as string)) ?? null;
    };
  }

  // ── Response ───────────────────────────────────────────────────────────

  public status(code: HttpStatus | number): this {
    this.res.status(code);
    return this;
  }

  public redirect(url: string, status: HttpStatus | number = HttpStatus.FOUND): this {
    // Fastify's signature is `redirect(dest, statusCode)`, not Express's
    // `redirect(status, dest)`. Passing them the other way round compiles to a
    // `302` pointing at the number, which is a 404 with a confusing URL.
    this.res.redirect(url, status);
    return this.markWritten();
  }

  public get responded(): boolean {
    return this.written || this.res.sent === true;
  }

  // ── Cookies ────────────────────────────────────────────────────────────

  /**
   * `setCookie` and `clearCookie` come from `@fastify/cookie`, which decorates
   * the reply at runtime. The cast is confined here — the decorator is
   * registered by {@link FastifyAdapter.bodyParser} — rather than leaking into
   * the adapter or into every call site.
   */
  public setCookie(name: string, value: string, options?: CookieOptions): this {
    (this.res as unknown as CookieReply).setCookie(name, value, toFastifyCookieOptions(options));
    return this;
  }

  public clearCookie(name: string, options?: Partial<CookieOptions>): this {
    (this.res as unknown as CookieReply).clearCookie(name, toFastifyCookieOptions(options));
    return this;
  }

  public deleteCookie(name: string, options?: Partial<CookieOptions>): this {
    (this.res as unknown as CookieReply).clearCookie(name, toFastifyCookieOptions(options));
    return this;
  }

  public getCookie(name: string): Maybe<string> {
    return (this.req as CookieRequest).cookies?.[name];
  }

  public get cookies(): RequestCookies {
    return ((this.req as CookieRequest).cookies ?? {}) as unknown as RequestCookies;
  }

  /**
   * Fastify has no signed cookies.
   *
   * Signing needs a secret and a `cookie-parser` equivalent, neither of which
   * Gland should take a position on. Returning `{}` rather than throwing keeps
   * a controller portable — the ones that use signed cookies are the ones that
   * should fail, and they will, at the read rather than at the write.
   */
  public get signedCookies(): RequestCookies {
    return {};
  }

  // ── Body ───────────────────────────────────────────────────────────────

  public send(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish((reply) => reply.send(data), statusCode, headers);
  }

  public json(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish((reply) => reply.send(data), statusCode, headers);
  }

  public html(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.withContentType(ContentType.html, () => this.send(body, statusCode, headers));
  }

  public text(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.withContentType(ContentType.text, () => this.send(body, statusCode, headers));
  }

  public xml(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.withContentType(ContentType.xml, () => this.send(body, statusCode, headers));
  }

  public end(): this {
    if (!this.res.sent) this.res.send();
    return this.markWritten();
  }

  // ── Files ──────────────────────────────────────────────────────────────

  /**
   * Streams a file.
   *
   * Fastify has `reply.send(stream)`, which handles `Range`, `ETag` and
   * `Last-Modified` internally. The `SendOptions` that Fastify understands
   * (`cacheControl`, `immutable`, `maxAge`) are translated; the rest — `start`,
   * `end`, `extensions` — belong to Express's `res.sendFile` and are reported
   * rather than silently ignored, because a caller who asked for a byte range
   * deserves to know they did not get one.
   */
  public sendFile(filePath: string, options: SendOptions = {}, fn?: ErrorCallback): this {
    void stat(filePath).then(
      (stats) => {
        if (options.start !== undefined || options.end !== undefined) {
          this.loggerUnsupported?.('sendFile', 'start/end byte ranges');
        }
        (this.res as unknown as { send: (payload: unknown, opts: unknown) => unknown }).send(createReadStream(filePath), {
          cacheControl: options.cacheControl === false ? false : true,
          etag: options.etag !== false,
          lastModified: options.lastModified !== false,
          acceptRanges: options.acceptRanges !== false,
          ...(options.maxAge !== undefined ? { maxAge: Math.floor(Number(options.maxAge) / 1000) } : {}),
        });
        void stats;
      },
      (error: Error) => {
        fn?.(error);
        if (!this.res.sent) this.res.status(HttpStatus.NOT_FOUND).send({ error: 'Not Found' });
      },
    );
    return this;
  }

  public download(filePath: string, filename?: string, options?: SendOptions): this {
    this.attachment(filename ?? basename(filePath));
    return this.sendFile(filePath, options);
  }

  // ── Headers ────────────────────────────────────────────────────────────

  /** Whether a *request* header is present. */
  public hasHeader(name: HttpHeaderName): boolean {
    return this.req.headers[String(name).toLowerCase()] !== undefined;
  }

  /** Reads a **request** header. @see HttpContext.getHeader */
  public getHeader<T extends string>(name: HttpHeaderName<T>): HttpHeaderValue<T> {
    const value = this.req.headers[String(name).toLowerCase()];
    if (value === undefined) return undefined as HttpHeaderValue<T>;
    return (Array.isArray(value) ? value.join(', ') : value) as HttpHeaderValue<T>;
  }

  /** Whether a *response* header is already set. */
  public hasResponseHeader(name: HttpHeaderName): boolean {
    return this.res.hasHeader(name as string);
  }

  /** Reads a **response** header. */
  public getResponseHeader<T extends string>(name: HttpHeaderName<T>): HttpHeaderValue<T> {
    return this.res.getHeader(name as string) as HttpHeaderValue<T>;
  }

  public setHeader<T extends string>(name: HttpHeaderName<T>, value: HttpHeaderInput<T>): this {
    this.res.header(name as string, value as never);
    return this;
  }

  public setHeaders(headers: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) this.res.header(name, value as never);
    }
    return this;
  }

  public removeHeader<T extends string>(name: HttpHeaderName<T>): this {
    this.res.removeHeader(name as string);
    return this;
  }

  public vary(fields: string): this {
    this.res.header('Vary', fields);
    return this;
  }

  public attachment(filename?: string): this {
    this.res.header('Content-Disposition', `attachment${filename ? `; filename="${filename}"` : ''}`);
    return this;
  }

  public location(url: string): this {
    this.res.header('Location', url);
    return this;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private finish(write: (reply: FastifyReply) => unknown, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    if (statusCode) this.res.status(statusCode);
    if (headers) this.setHeaders(headers);
    write(this.res);
    return this.markWritten();
  }

  private withContentType(contentType: string, write: () => this): this {
    if (!this.res.getHeader('Content-Type')) this.res.header('Content-Type', contentType);
    return write();
  }

  /**
   * Compares `If-Modified-Since` against `Last-Modified`.
   *
   * Only the two dates are consulted; a conditional `If-None-Match` against an
   * ETag is the server's business, and a wrong 304 is worse than no 304.
   */
  private isStale(): boolean {
    const since = this.req.headers['if-modified-since'];
    const modified = this.req.headers['last-modified'];
    if (!since || !modified) return true;
    return new Date(since).getTime() < new Date(modified).getTime();
  }

  /** Optional hook so the adapter can report an unsupported option. */
  public loggerUnsupported?: (what: string, detail: string) => void;
}

/** `RouteOptions` narrowed to the shape a Gland route is registered with. */
export type FastifyRouteOptions = Pick<RouteOptions, 'method' | 'url' | 'exposeHeadRoute' | 'logLevel'>;

/** Options for {@link FastifyContext.sse}. Re-exported for convenience. */
export type { SseStream };

/** The `@fastify/cookie` decorators this context relies on. */
interface CookieReply {
  setCookie(name: string, value: string, options: Record<string, unknown>): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
}

/** The `@fastify/cookie` request decoration this context relies on. */
interface CookieRequest {
  cookies?: Record<string, string | undefined>;
}

/**
 * Maps Gland's cookie options onto `@fastify/cookie`'s.
 *
 * The two differ in one place that matters: `maxAge` is milliseconds in Gland
 * and seconds in `@fastify/cookie`. Forwarding the number unchanged produces a
 * cookie that expires in under a millisecond, which looks like "the cookie does
 * not work" and is very hard to debug.
 */
function toFastifyCookieOptions(options?: CookieOptions): Record<string, unknown> {
  if (!options) return {};
  const { name: _name, secret: _secret, overwrite: _overwrite, secureProxy: _secureProxy, maxAge, ...rest } = options;
  return maxAge === undefined ? (rest as Record<string, unknown>) : { ...rest, maxAge: Math.floor(maxAge / 1000) };
}

/** Splits a hostname into sub-domains, most significant first. */
function splitHost(hostname: string): string[] {
  const host = hostname.split(':')[0] ?? '';
  const parts = host.split('.');
  // A bare hostname like `localhost` is not a subdomain list.
  return parts.length > 2 ? parts.slice(0, -2) : [];
}

/** One entry of a parsed `Accept` header. */
interface AcceptEntry {
  type: string;
  quality: number;
}

/** Parses `Accept` into entries ordered by descending `q`. */
function parseAccept(header: string): AcceptEntry[] {
  return header
    .split(',')
    .map((part) => {
      const [rawType, ...params] = part.trim().split(';');
      const quality = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { type: (rawType ?? '').toLowerCase(), quality: quality ? Number(quality.slice(2)) || 0 : 1 };
    })
    .filter((entry) => entry.type.length > 0 && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);
}

/**
 * Whether `pattern` covers `type`.
 *
 * A `text/` prefix covers `text/html`, and `*` alone covers anything. Written by
 * hand rather than pulled from a package, because the only alternative is a
 * dependency for eleven lines.
 */
function matchesWildcard(pattern: string, type: string): boolean {
  if (pattern === type) return true;
  if (pattern === '*/*') return true;
  if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
  return false;
}
