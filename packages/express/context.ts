import { HttpContext, type AcceptType, type HttpEventBroker, type HttpHeaderInput, type HttpHeaderName, type HttpHeaderValue, type HttpReply } from '@glandjs/http';
import { ContentType, parseCookieHeader } from '@glandjs/http';
import type { CookieOptions, ErrorCallback, RequestCookies, SendOptions } from '@glandjs/http';
import { HttpStatus, type Dictionary, type Maybe } from '@medishn/toolkit';
import type { EventRecord } from '@glandjs/events';
import type { RequestMethod } from '@glandjs/http';
import type { Request, Response, CookieOptions as ExpressCookieOptions } from 'express';
import { Readable } from 'node:stream';

/**
 * Express's request context.
 *
 * Everything here is a read through to `req`/`res` or a thin wrapper over one
 * Express call. That restraint is the point: the previous implementation
 * normalised `req.accepts()` three separate times in one function, and a context
 * that *reinterprets* the framework's API is a context whose bugs are the
 * framework's bugs plus yours.
 *
 * The one non-obvious member is {@link ExpressContext.createContext}'s
 * idempotence requirement — see {@link HttpServerAdapter}.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * @Controller('/products')
 * class ProductController {
 *   @Get('/:id')
 *   async find(ctx: ExpressContext<MyEvents>) {
 *     const product = await ctx.call('db:product:find', ctx.params.id);
 *     if (!product) return ctx.throw(HttpStatus.NOT_FOUND);
 *     return product;
 *   }
 * }
 * ```
 */
export class ExpressContext<TEvents extends EventRecord = EventRecord> extends HttpContext<Request, Response, TEvents> {
  /**
   * Memoised on the request, so `ctx.state` written by a middleware is visible
   * to the handler. Two contexts for one request would be the single worst bug
   * this adapter could have.
   */
  constructor(events: HttpEventBroker<any>, req: Request, res: Response) {
    super(events, req, res);
    this.params = (req.params ?? {}) as Dictionary<string>;
    this.host = req.hostname;
  }

  // ── Request ────────────────────────────────────────────────────────────

  public get body(): any {
    return this.req.body;
  }

  public get path(): string {
    // `req.path` excludes the query string, which is what a route pattern and a
    // log line both want.
    return this.req.path;
  }

  public get xhr(): boolean {
    return this.req.xhr === true;
  }

  public get stale(): boolean {
    return this.req.fresh === false;
  }

  public get fresh(): boolean {
    return this.req.fresh === true;
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
    return this.req.secure === true;
  }

  public get url(): string {
    return this.req.originalUrl;
  }

  public get originalUrl(): string {
    return this.req.originalUrl;
  }

  public get query(): Dictionary<string | string[] | undefined> {
    return this.req.query as Dictionary<string | string[] | undefined>;
  }

  public get subdomains(): string[] {
    return this.req.subdomains;
  }

  public get headers(): Dictionary<string | string[] | undefined> {
    return this.req.headers as Dictionary<string | string[] | undefined>;
  }

  /**
   * `req.accepts()`, flattened.
   *
   * Express returns `string | false | string[]` depending on the overload used;
   * the array form arrives when the argument is a plain string array. Callers of
   * `ctx.accepts()` get one value or `false`, which is the only shape worth
   * branching on.
   */
  public get accepts(): (types?: AcceptType) => string | false {
    return (types?: AcceptType): string | false => {
      if (types === undefined) return firstOrFalse(this.req.accepts());
      // Express overloads `accepts` on the argument's type, so a union cannot be
      // passed without narrowing first.
      if (Array.isArray(types)) return firstOrFalse(this.req.accepts(types));
      return firstOrFalse(this.req.accepts(types as string));
    };
  }

  /** `req.is()`, with the `null` case folded to `false` so the union is usable. */
  public get is(): (type: string | readonly string[]) => string | false | null {
    return (type: string | readonly string[]): string | false | null => this.req.is(type as string | string[]) ?? null;
  }

  // ── Response ───────────────────────────────────────────────────────────

  public status(code: HttpStatus | number): this {
    this.res.status(code);
    return this;
  }

  public redirect(url: string, status: HttpStatus | number = HttpStatus.FOUND): this {
    this.res.redirect(status, url);
    return this.markWritten();
  }

  /**
   * Whether the response has begun.
   *
   * `writableEnded` rather than `headersSent`: a response can have headers sent
   * and still accept more header calls, but an ended one cannot accept a body.
   * Gland's `respond()` needs to know whether a *body* would double-write, and
   * {@link HttpContext.written} covers the case where this context wrote it.
   */
  public get responded(): boolean {
    return this.written || this.res.headersSent || this.res.writableEnded;
  }

  // ── Cookies ────────────────────────────────────────────────────────────

  public setCookie(name: string, value: string, options?: CookieOptions): this {
    this.res.cookie(name, value, toExpressCookieOptions(options));
    return this;
  }

  public clearCookie(name: string, options?: Partial<CookieOptions>): this {
    this.res.clearCookie(name, toExpressCookieOptions(options));
    return this;
  }

  public deleteCookie(name: string, options?: Partial<CookieOptions>): this {
    this.res.clearCookie(name, toExpressCookieOptions(options));
    return this;
  }

  public getCookie(name: string): Maybe<string> {
    return this.cookies[name]?.value;
  }

  /**
   * Request cookies, with or without `cookie-parser`.
   *
   * `req.cookies` is `undefined` until `cookie-parser` is mounted, and a
   * controller reading a session cookie should not have to know that. The
   * header is parsed directly in that case, which is also what makes
   * `ctx.cookies` behave identically on an Express app that has the parser and
   * one that does not.
   */
  public get cookies(): RequestCookies {
    if (this.req.cookies) return this.req.cookies as RequestCookies;
    return parseCookieHeader(this.req.headers.cookie);
  }

  public get signedCookies(): RequestCookies {
    return (this.req.signedCookies ?? {}) as RequestCookies;
  }

  // ── Body ───────────────────────────────────────────────────────────────

  /**
   * Writes a body, choosing the encoding from its type.
   *
   * `res.send(string)` defaults to `text/html`, which is wrong for Gland's
   * contract: a string reply is `text/plain` unless it sniffs as markup, and the
   * sniffing is already applied by the reply coercion before a handler ever
   * reaches here. Leaving Express's default in place makes `ctx.send('done')`
   * render as a page in the browser.
   */
  public send(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    if (typeof data === 'string' && !this.res.getHeader('Content-Type')) {
      this.res.setHeader('Content-Type', ContentType.text);
    }
    return this.finish((res) => res.send(data), statusCode, headers);
  }

  public json(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish((res) => res.json(data), statusCode, headers);
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
    if (!this.res.writableEnded) this.res.end();
    return this.markWritten();
  }

  // ── Files ──────────────────────────────────────────────────────────────

  public sendFile(filePath: string, options: SendOptions = {}, fn?: ErrorCallback): this {
    this.res.sendFile(filePath, options as never, (error) => {
      // Express hands back `undefined` on success, and an adapter that swallowed
      // that would make `fn` unusable for the success case.
      if (fn) fn(error ?? undefined);
    });
    return this;
  }

  public download(filePath: string, filename?: string, options?: SendOptions): this {
    if (filename) this.res.download(filePath, filename, options as never);
    else this.res.download(filePath, options as never);
    return this;
  }

  // ── Headers ────────────────────────────────────────────────────────────

  /** Whether a *request* header is present. */
  public hasHeader(name: HttpHeaderName): boolean {
    const value = this.req.headers[String(name).toLowerCase()];
    return value !== undefined;
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
    this.res.setHeader(name as string, value as never);
    return this;
  }

  public setHeaders(headers: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) this.res.setHeader(name, value as never);
    }
    return this;
  }

  public removeHeader<T extends string>(name: HttpHeaderName<T>): this {
    this.res.removeHeader(name as string);
    return this;
  }

  public vary(fields: string): this {
    this.res.vary(fields);
    return this;
  }

  public attachment(filename?: string): this {
    this.res.attachment(filename);
    return this;
  }

  public location(url: string): this {
    this.res.location(url);
    return this;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** Applies status and headers, then performs the write. */
  private finish(write: (res: Response) => unknown, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    if (statusCode) this.res.status(statusCode);
    if (headers) this.setHeaders(headers);
    write(this.res);
    return this.markWritten();
  }

  /**
   * Sets `Content-Type` only if the caller has not already chosen one.
   *
   * Overwriting would break `ctx.text(markup, 200, { 'content-type': 'text/csv' })`,
   * which is a legitimate call and used to be silently rewritten to `text/plain`.
   */
  private withContentType(contentType: string, write: () => this): this {
    if (!this.res.getHeader('Content-Type')) this.res.setHeader('Content-Type', contentType);
    return write();
  }
}

/** `Readable`-backed payload, for {@link HttpReply.stream}. */
export type { HttpReply, Readable };

/**
 * Maps Gland's `sameSite` onto Express's.
 *
 * Express wants `'lax' | 'strict' | 'none' | boolean`; Gland's contract allows
 * the same, so the only work is dropping the keys Express does not know. Passing
 * them through produced `cookie` warnings on every response.
 */
/**
 * Maps Gland's cookie options onto Express's.
 *
 * `name`, `secret`, `overwrite` and `secureProxy` are either derived by Gland
 * or handled by `cookie-parser` on the request side; forwarding them to Express
 * produced a warning on every response. Express also types `options` as
 * *required* on `res.cookie()`, so an absent value becomes `{}` rather than
 * `undefined`.
 */
function toExpressCookieOptions(options?: CookieOptions): ExpressCookieOptions {
  if (!options) return {};
  const { name: _name, secret: _secret, overwrite: _overwrite, secureProxy: _secureProxy, ...rest } = options;
  return rest as ExpressCookieOptions;
}

/** Express returns an array for a multi-type `accepts`; collapse it. */
function firstOrFalse(value: string | false | string[] | undefined): string | false {
  if (Array.isArray(value)) return value[0] ?? false;
  return value ?? false;
}
