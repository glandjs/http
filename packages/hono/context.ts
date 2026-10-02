import {
  HttpContext,
  ContentType,
  baseContentType,
  isJsonContentType,
  parseCookieHeader,
  type AcceptType,
  type HttpEventBroker,
  type HttpHeaderInput,
  type HttpHeaderName,
  type HttpHeaderValue,
  type RequestMethod,
  type SseStream,
} from '@glandjs/http';
import type { CookieOptions, ErrorCallback, RequestCookies, SendOptions } from '@glandjs/http';
import type { EventRecord } from '@glandjs/events';
import { HttpStatus, type Dictionary, type Maybe } from '@medishn/toolkit';
import type { Context as HonoContext, Env } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * The body constructor `fetch` accepts, derived rather than declared.
 *
 * Naming `BodyInit` directly would require adding the `DOM` lib to this
 * package, which puts `document` and `window` in scope for a server library
 * that has no business using either. Reading the type off `Response` gets the
 * same answer from the same source of truth.
 */
export type FetchBodyInit = ConstructorParameters<typeof Response>[0];

/**
 * Hono's request context.
 *
 * Hono is the odd one out in this set, and that is worth being explicit about.
 * It is built for edge runtimes, so its `Request` and `Response` are the Fetch
 * API's, not Node's. There is no socket, no `headersSent`, no `writableEnded`.
 *
 * That turns out to be an advantage for the Gland contract rather than a
 * problem: a Fetch `Response` is *immutable*, which means a reply is built once
 * and returned, and "has this already been written?" becomes "does a response
 * exist?" — a question with an exact answer rather than a heuristic.
 *
 * The consequence for handlers is that they never mutate a response; every
 * `ctx.*` method returns a new one. {@link HonoRequestContext.responded} is true
 * from the moment a handler has produced one.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * @Get('/:id')
 * async find(ctx: HonoRequestContext<MyEvents>) {
 *   return ctx.call('db:product:find', ctx.params.id);
 * }
 * ```
 */
export class HonoRequestContext<TEvents extends EventRecord = EventRecord> extends HttpContext<HonoContext<Env, any>, Response, TEvents> {
  /**
   * The response a handler produced.
   *
   * Set by the adapter after the handler returns. Hono's `Context` is not itself
   * a response — it carries the one the handler returns — so this is the only
   * way the reply contract can answer "already written?".
   */
  public response?: Response;

  /** The body the adapter parsed for this request. @internal */
  public parsedBody: unknown;

  /** The raw request text, kept for a handler that wants it. @internal */
  public rawText?: string;

  constructor(events: HttpEventBroker<any>, ctx: HonoContext<Env, any>) {
    // Hono's context is read-only in both directions, so it is the "request" and
    // a `Response` is the "response". The type contract is satisfied by
    // construction rather than by lying to the compiler about either.
    super(events, ctx, undefined as unknown as Response);
    this.params = (ctx.req.param() ?? {}) as Dictionary<string>;
    this.host = ctx.req.header('host');
  }

  // ── Request ────────────────────────────────────────────────────────────

  /**
   * The parsed body.
   *
   * Hono does not parse bodies — it hands out the raw `Request`, whose body is a
   * one-shot stream. The adapter reads it once in a middleware and stores the
   * result here, so `ctx.body` works and a second read does not hang.
   */
  public get body(): any {
    return this.parsedBody;
  }

  public get path(): string {
    // Parsed rather than sliced, because Hono's `c.req.url` is the **absolute**
    // URL on some runtimes — and an absolute URL in a `Vary`/log/problem document
    // is both wrong and a mild information leak. A path is a path.
    try {
      return new URL(this.req.req.url).pathname || '/';
    } catch {
      const url = this.req.req.url ?? '/';
      const index = url.indexOf('?');
      return index === -1 ? url : url.slice(0, index);
    }
  }

  public get xhr(): boolean {
    return this.header('x-requested-with') === 'XMLHttpRequest';
  }

  public get stale(): boolean {
    return this.isStale();
  }

  public get fresh(): boolean {
    return !this.isStale();
  }

  public get method(): RequestMethod {
    return this.req.req.method as RequestMethod;
  }

  public get hostname(): string {
    return new URL(this.req.req.url).hostname;
  }

  /**
   * The client address.
   *
   * The Fetch `Request` has no socket, so this is only available on a runtime
   * that populates a forwarded header — a Cloudflare Worker, Deno Deploy, or
   * `@hono/node-server` behind a proxy. `undefined` locally, which is honest.
   */
  public get ip(): string | undefined {
    return this.header('x-forwarded-for')?.split(',')[0]?.trim() ?? this.header('x-real-ip');
  }

  public get protocol(): string {
    return new URL(this.req.req.url).protocol.replace(':', '');
  }

  public get secure(): boolean {
    return this.protocol === 'https';
  }

  public get url(): string {
    return this.req.req.url;
  }

  public get originalUrl(): string {
    return this.req.req.url;
  }

  /**
   * The query string, with repeated keys collected into an array.
   *
   * Hono's `c.req.query()` returns a single value per key, keeping the last
   * one. `?tag=a&tag=b` becoming `'b'` loses data, so `URLSearchParams` is used
   * instead — the same result the other four adapters produce.
   */
  public get query(): Dictionary<string | string[] | undefined> {
    const result: Dictionary<string | string[] | undefined> = {};
    for (const [key, value] of new URL(this.req.req.url).searchParams) {
      const existing = result[key];
      if (existing === undefined) result[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else result[key] = [existing, value];
    }
    return result;
  }

  public get subdomains(): string[] {
    const parts = this.hostname.split('.');
    return parts.length > 2 ? parts.slice(0, -2) : [];
  }

  public get headers(): Dictionary<string | string[] | undefined> {
    const bag: Dictionary<string | string[]> = {};
    this.req.req.raw.headers.forEach((value, name) => {
      bag[name] = value;
    });
    return bag;
  }

  public get contentType(): string | undefined {
    return this.header('content-type');
  }

  public get mimeType(): string | undefined {
    return baseContentType(this.contentType);
  }

  public get accepts(): (types?: AcceptType) => string | false {
    return (types?: AcceptType): string | false => {
      const header = this.header('accept');
      if (types === undefined) return header?.split(',')[0]?.trim() ?? '*/*';
      if (!header) return '*/*';

      const wanted = (Array.isArray(types) ? types : [types]) as string[];
      const ranked = parseAccept(header);
      for (const candidate of wanted) {
        if (ranked.some((entry) => matchesWildcard(entry.type, candidate))) return candidate;
      }
      return false;
    };
  }

  public get is(): (type: string | readonly string[]) => string | false | null {
    return (type: string | readonly string[]): string | false | null => {
      const mime = this.mimeType;
      if (!mime) return null;
      const wanted = Array.isArray(type) ? type : [type];
      return wanted.find((candidate) => candidate === mime || matchesWildcard(candidate, mime)) ?? null;
    };
  }

  // ── Response ───────────────────────────────────────────────────────────

  public status(code: HttpStatus | number): this {
    this.res = new Response(this.res?.body ?? null, { status: code, headers: this.res?.headers });
    return this;
  }

  public redirect(url: string, status: HttpStatus | number = HttpStatus.FOUND): this {
    this.res = new Response(null, { status, headers: { Location: url } });
    return this.markWritten();
  }

  /** Whether a response has been produced. Exact, unlike the other adapters. */
  public get responded(): boolean {
    return this.written || this.response !== undefined;
  }

  // ── Cookies ────────────────────────────────────────────────────────────

  public setCookie(name: string, value: string, options?: CookieOptions): this {
    setCookie(this.req, name, value, options as never);
    return this;
  }

  public clearCookie(name: string, options?: Partial<CookieOptions>): this {
    deleteCookie(this.req, name, options as never);
    return this;
  }

  public deleteCookie(name: string, options?: Partial<CookieOptions>): this {
    return this.clearCookie(name, options);
  }

  public getCookie(name: string): Maybe<string> {
    return getCookie(this.req, name);
  }

  public get cookies(): RequestCookies {
    return parseCookieHeader(this.header('cookie'));
  }

  public get signedCookies(): RequestCookies {
    return {};
  }

  // ── Body ───────────────────────────────────────────────────────────────

  public send(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish(data, statusCode, headers, undefined);
  }

  public json(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish(data, statusCode, headers, ContentType.json);
  }

  public html(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish(body, statusCode, headers, ContentType.html);
  }

  public text(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish(body, statusCode, headers, ContentType.text);
  }

  public xml(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.finish(body, statusCode, headers, ContentType.xml);
  }

  public end(): this {
    this.res = new Response(null, { status: this.res?.status ?? HttpStatus.NO_CONTENT, headers: this.res?.headers });
    return this.markWritten();
  }

  // ── Files ──────────────────────────────────────────────────────────────

  public sendFile(filePath: string, _options: SendOptions = {}, fn?: ErrorCallback): this {
    void stat(filePath).then(
      () => {
        // Hono targets edge runtimes, which have no filesystem. A read stream
        // is still the right shape on Node — `@hono/node-server` pipes it — and
        // on a worker the `stat` above is what fails, with a clear error rather
        // than a silent empty body.
        this.response = new Response(createReadStream(filePath) as unknown as FetchBodyInit);
      },
      (error: Error) => {
        fn?.(error);
        this.response = Response.json({ error: 'Not Found' }, { status: HttpStatus.NOT_FOUND });
      },
    );
    return this;
  }

  public download(filePath: string, filename?: string, options: SendOptions = {}): this {
    this.attachment(filename ?? basename(filePath));
    return this.sendFile(filePath, options);
  }

  // ── Headers ────────────────────────────────────────────────────────────

  /** Whether a *request* header is present. */
  public hasHeader(name: HttpHeaderName): boolean {
    return this.header(String(name).toLowerCase()) !== undefined;
  }

  /** Reads a **request** header. @see HttpContext.getHeader */
  public getHeader<T extends string>(name: HttpHeaderName<T>): HttpHeaderValue<T> {
    return this.header(String(name).toLowerCase()) as HttpHeaderValue<T>;
  }

  /** Whether a *response* header is already set. */
  public hasResponseHeader(name: HttpHeaderName): boolean {
    return this.res?.headers.has(name as string) ?? false;
  }

  /** Reads a **response** header. */
  public getResponseHeader<T extends string>(name: HttpHeaderName<T>): HttpHeaderValue<T> {
    return (this.res?.headers.get(name as string) ?? undefined) as HttpHeaderValue<T>;
  }

  public setHeader<T extends string>(name: HttpHeaderName<T>, value: HttpHeaderInput<T>): this {
    const headers = new Headers(this.res?.headers);
    headers.set(name as string, String(value));
    this.res = new Response(this.res?.body, { status: this.res?.status, headers });
    return this;
  }

  public setHeaders(headers: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    const merged = new Headers(this.res?.headers);
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) merged.set(name, Array.isArray(value) ? value.join(', ') : String(value));
    }
    this.res = new Response(this.res?.body, { status: this.res?.status, headers: merged });
    return this;
  }

  public removeHeader<T extends string>(name: HttpHeaderName<T>): this {
    const headers = new Headers(this.res?.headers);
    headers.delete(name as string);
    this.res = new Response(this.res?.body, { status: this.res?.status, headers });
    return this;
  }

  public vary(fields: string): this {
    return this.setHeader('vary', fields);
  }

  public attachment(filename?: string): this {
    return this.setHeader('content-disposition', `attachment${filename ? `; filename="${filename}"` : ''}`);
  }

  public location(url: string): this {
    return this.setHeader('location', url);
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Builds a new `Response`, carrying over whatever was set earlier.
   *
   * That carry-over is what makes `ctx.status(201).json({…})` read the way it
   * does: each call returns a fresh response with the previous one's status and
   * headers folded in.
   */
  private finish(data: unknown, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>, contentType?: string): this {
    const merged = new Headers(this.res?.headers);
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (value !== undefined) merged.set(name, Array.isArray(value) ? value.join(', ') : String(value));
    }
    if (contentType && !merged.has('Content-Type')) merged.set('Content-Type', contentType);

    // `204` and `304` may not carry a body, and constructing such a `Response`
    // throws in undici. Dropping it explicitly is cheaper than catching it.
    const status = (statusCode ?? this.res?.status ?? 200) as number;
    const bodyless = status === HttpStatus.NO_CONTENT || status === HttpStatus.NOT_MODIFIED;
    if (bodyless) merged.delete('Content-Length');

    this.res = new Response(bodyless ? null : toBodyInit(data), { status, headers: merged });
    return this.markWritten();
  }

  /** A single request header, lower-cased. */
  private header(name: string): string | undefined {
    return this.req.req.raw.headers.get(name) ?? undefined;
  }

  private isStale(): boolean {
    const since = this.header('if-modified-since');
    const modified = this.res?.headers.get('Last-Modified');
    if (!since || !modified) return true;
    return new Date(since).getTime() < new Date(modified).getTime();
  }
}

/** An SSE stream, re-exported so a handler can type it without a deep import. */
export type { SseStream };

/**
 * Coerces a value into a fetch body.
 *
 * The same rules as `toReplyPayload`, expressed against the `fetch`
 * constructors instead of a socket.
 */
function toBodyInit(data: unknown): FetchBodyInit {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array || Buffer.isBuffer(data)) return data as FetchBodyInit;
  if (isJsonSafe(data)) return JSON.stringify(data);
  // A stream, a `FormData`, a `URLSearchParams` — already valid bodies.
  return data as FetchBodyInit;
}

/** Whether a value should be serialised as JSON. */
function isJsonSafe(data: unknown): boolean {
  return typeof data === 'object' && data !== null && !(data instanceof ArrayBuffer) && !('pipe' in (data as object));
}

/**
 * Parses a body according to its content type.
 *
 * Exported because a caller with its own body strategy needs the same mapping,
 * and two copies of "what does `text/csv` become" is how a form and an API
 * start to disagree.
 */
export function parseFetchBody(text: string, contentType: string | undefined): unknown {
  if (!text) return undefined;

  if (isJsonContentType(contentType)) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Malformed JSON body: ${error instanceof Error ? error.message : 'parse error'}`);
    }
  }

  // A browser posts a form as `a=1&b=2`. Leaving that as a string means the same
  // handler works on four adapters and has to reach for `URLSearchParams` on the
  // fifth, which is exactly the kind of difference this layer exists to remove.
  if (baseContentType(contentType) === 'application/x-www-form-urlencoded') {
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of new URLSearchParams(text)) {
      const existing = result[key];
      result[key] = existing === undefined ? value : ([] as string[]).concat(existing, value);
    }
    return result;
  }

  return text;
}

/** Strips the quotes `hono/cookie` adds. */
function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
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

/** Whether `pattern` covers `type`, e.g. `text/` covers `text/html`. */
function matchesWildcard(pattern: string, type: string): boolean {
  if (pattern === type || pattern === '*') return true;
  if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
  return false;
}
