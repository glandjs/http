import { HttpContext, ContentType, type AcceptType, type HttpEventBroker, type HttpHeaderInput, type HttpHeaderName, type HttpHeaderValue, type RequestMethod, type SseStream } from '@glandjs/http';
import type { CookieOptions, ErrorCallback, RequestCookies, SendOptions } from '@glandjs/http';
import type { EventRecord } from '@glandjs/events';
import { HttpStatus, type Dictionary, type Maybe } from '@medishn/toolkit';
import type { ParameterizedContext } from 'koa';
import type { DefaultContext, DefaultState } from 'koa';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * Koa's request context.
 *
 * Koa is the framework Gland's middleware model was taken from, so the
 * interesting part of this adapter is how little translation there is:
 * `ctx.method`, `ctx.path`, `ctx.query`, `ctx.status` and `ctx.body` already
 * mean what the Gland contract says they mean.
 *
 * The two places that do need work:
 *
 * - **Route parameters.** Koa has no router, so `ctx.params` is whatever the
 *   router that ran put there. This context reads it defensively and defaults to
 *   `{}`, because a handler must never have to check whether it is `undefined`.
 * - **Response state.** Koa decides the status from `ctx.body` at the end of the
 *   request — setting `ctx.body = undefined` yields `204`, not `200` with an
 *   empty body. {@link KoaContext.end} makes the intent explicit instead of
 *   leaving it to Koa's inference.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * @Get('/:id')
 * async find(ctx: KoaContext<MyEvents>) {
 *   return ctx.call('db:product:find', ctx.params.id);
 * }
 * ```
 */
export class KoaContext<TEvents extends EventRecord = EventRecord> extends HttpContext<ParameterizedContext, ParameterizedContext, TEvents> {
  constructor(events: HttpEventBroker<any>, ctx: ParameterizedContext) {
    // Koa has one object that is both the request and the response. It is passed
    // as both, which is what makes `ctx.req` and `ctx.res` aliases rather than
    // two objects.
    super(events, ctx, ctx);
    this.params = (ctx.params ?? {}) as Dictionary<string>;
    this.host = ctx.host;
  }

  // ── Request ────────────────────────────────────────────────────────────

  public get body(): any {
    return this.req.request.body;
  }

  public get path(): string {
    return this.req.path;
  }

  public get xhr(): boolean {
    return this.req.xhr === true;
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
   * Content negotiation, from `accepts`.
   *
   * The dependency is required rather than optional: Koa's `accepts` is the
   * package Koa exists to compose, and hand-rolling a `q`-aware `Accept` parser
   * to avoid one dependency would be a worse trade than declaring it.
   */
  public get accepts(): (types?: AcceptType) => string | false {
    return (types?: AcceptType): string | false => {
      const accept = this.req.accepts;
      if (typeof accept !== 'function') return '*/*';
      if (types === undefined) return (accept.types() as string[])[0] ?? '*/*';
      const result = (Array.isArray(types) ? accept.types(types as string[]) : accept.type(types as string)) as string | false;
      return result || false;
    };
  }

  public get is(): (type: string | readonly string[]) => string | false | null {
    return (type: string | readonly string[]): string | false | null => {
      const request = this.req.req;
      const contentType = request.headers['content-type'];
      if (!contentType) return null;
      const base = contentType.split(';')[0]?.trim().toLowerCase();
      const wanted = Array.isArray(type) ? type : [type];
      return wanted.find((candidate) => candidate === base || matchesWildcard(candidate, base as string)) ?? null;
    };
  }

  // ── Response ───────────────────────────────────────────────────────────

  public status(code: HttpStatus | number): this {
    this.res.status = code;
    return this;
  }

  public redirect(url: string, status: HttpStatus | number = HttpStatus.FOUND): this {
    this.res.redirect(url);
    this.res.status = status;
    return this.markWritten();
  }

  /**
   * Whether a body has been decided.
   *
   * Koa sets `body` to `null` for a `204` before the response is written, so
   * "is it set" is a better signal here than "has the socket been written" —
   * which Koa does not expose on the context at all.
   */
  public get responded(): boolean {
    return this.written || this.res.body !== undefined;
  }

  // ── Cookies ────────────────────────────────────────────────────────────

  public setCookie(name: string, value: string, options?: CookieOptions): this {
    this.res.cookies.set(name, value, toKoaCookieOptions(options));
    return this;
  }

  public clearCookie(name: string, options?: Partial<CookieOptions>): this {
    this.res.cookies.set(name, null, toKoaCookieOptions({ ...options, expires: new Date(0), maxAge: 0 }));
    return this;
  }

  public deleteCookie(name: string, options?: Partial<CookieOptions>): this {
    return this.clearCookie(name, options);
  }

  public getCookie(name: string): Maybe<string> {
    return this.req.cookies?.get(name);
  }

  public get cookies(): RequestCookies {
    const jar = this.req.cookies;
    if (!jar) return {};
    const bag: RequestCookies = {};
    for (const [name, value] of jar) {
      bag[name] = { value: typeof value === 'string' ? value : String((value as { value?: unknown }).value ?? ''), signed: false };
    }
    return bag;
  }

  /** Koa has no signed cookies without a middleware that adds them. */
  public get signedCookies(): RequestCookies {
    return {};
  }

  // ── Body ───────────────────────────────────────────────────────────────

  /**
   * Koa's default `ParameterizedContext` types `body` as read-only, which is a
   * reasonable default for code that only reads it. Writing a response is the
   * whole point of this class, so the two write paths narrow to the setter once
   * rather than casting at every assignment.
   */
  private get target(): { body?: unknown; status: number } {
    return this.res as unknown as { body?: unknown; status: number };
  }

  public send(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish((ctx) => (ctx.target.body = data), statusCode, headers);
  }

  public json(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish((ctx) => (ctx.target.body = data), statusCode, headers);
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

  /**
   * Finishes the response with no body.
   *
   * Koa infers `204` from a `null`/`undefined` body, so the status is set
   * explicitly here — otherwise `ctx.status(201).end()` would silently become a
   * `204`, which is a very different answer to a client's `POST`.
   */
  public end(): this {
    const target = this.target;
    target.status = target.status === 200 ? HttpStatus.NO_CONTENT : target.status;
    target.body = null;
    return this.markWritten();
  }

  // ── Files ──────────────────────────────────────────────────────────────

  public sendFile(filePath: string, options: SendOptions = {}, fn?: ErrorCallback): this {
    void stat(filePath).then(
      () => {
        this.res.body = createReadStream(filePath);
        if (options.maxAge !== undefined) this.res.set('Cache-Control', `max-age=${Math.floor(Number(options.maxAge) / 1000)}`);
        if (options.lastModified === false) this.res.remove('Last-Modified');
      },
      (error: Error) => {
        fn?.(error);
        this.res.status = HttpStatus.NOT_FOUND;
        this.res.body = { error: 'Not Found' };
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
    return this.res.response?.has(name as string) ?? false;
  }

  /** Reads a **response** header. */
  public getResponseHeader<T extends string>(name: HttpHeaderName<T>): HttpHeaderValue<T> {
    return this.res.response?.get(name as string) as HttpHeaderValue<T>;
  }

  public setHeader<T extends string>(name: HttpHeaderName<T>, value: HttpHeaderInput<T>): this {
    this.res.set(name as string, value as never);
    return this;
  }

  public setHeaders(headers: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) this.res.set(name, value as never);
    }
    return this;
  }

  public removeHeader<T extends string>(name: HttpHeaderName<T>): this {
    this.res.remove(name as string);
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
    this.res.set('Location', url);
    return this;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private finish(write: (ctx: KoaContext<TEvents>) => unknown, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    if (statusCode) this.res.status = statusCode;
    if (headers) this.setHeaders(headers);
    write(this);
    return this.markWritten();
  }
  private withContentType(contentType: string, write: () => this): this {
    if (!this.res.response.get('Content-Type')) this.res.type = contentType;
    return write();
  }

  /** Compares `If-Modified-Since` against `Last-Modified`. */
  private isStale(): boolean {
    const since = this.req.headers['if-modified-since'];
    const modified = this.res.response?.get('Last-Modified');
    if (!since || !modified) return true;
    return new Date(since as string).getTime() < new Date(modified).getTime();
  }

  /** An SSE stream, exposed so a handler can hand it to application code. */
  public override sse(options?: { retry?: number; heartbeat?: number; lastEventId?: string }): SseStream {
    return super.sse(options);
  }
}

/** The `ctx.state` a Gland application may rely on. */
export interface KoaState extends DefaultState {
  /** Present once a Gland middleware has run. */
  gland?: { startedAt: number };
}

/** The Koa context with Gland's state, for a typed `app.context`. */
export type GlandKoaContext = ParameterizedContext<DefaultState, KoaState>;

/**
 * Maps Gland's cookie options onto the `cookies` package's.
 *
 * `maxAge` is milliseconds in Gland and milliseconds in `cookies` too — unlike
 * `@fastify/cookie`, which uses seconds. `httpOnly` and `sameSite` are spelled
 * the same but `SameSite: true` means `Strict` in both.
 */
function toKoaCookieOptions(options?: CookieOptions): Record<string, unknown> | undefined {
  if (!options) return undefined;
  const { name: _name, secret: _secret, overwrite: _overwrite, secureProxy: _secureProxy, ...rest } = options;
  return rest as Record<string, unknown>;
}

/** Whether `pattern` covers `type`, e.g. `text/*` covers `text/html`. */
function matchesWildcard(pattern: string, type: string): boolean {
  if (pattern === type || pattern === '*/*') return true;
  if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
  return false;
}
