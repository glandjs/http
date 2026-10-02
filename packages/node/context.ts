import {
  HttpContext,
  ContentType,
  baseContentType,
  isJsonContentType,
  parseCookieHeader,
  serializeCookie,
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
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * The `node:http` request context.
 *
 * No framework, so everything here is written against the Node API directly.
 * That is the point of this adapter: it is the proof that Gland's contract does
 * not secretly depend on a framework, because there is no framework to depend on.
 *
 * The Node request object has none of the conveniences the other adapters get
 * for free, and the ones implemented here are the ones a controller actually
 * reaches for:
 *
 * - `query` — parsed with `URLSearchParams`, so a repeated key becomes an array
 *   rather than Node's "last value wins"
 * - `cookies` — parsed from the `Cookie` header, with percent-decoding and
 *   quoted-value handling, because `res.cookie` on the other adapters emits
 *   exactly that format
 * - `body` — accumulated by {@link collectBody} and parsed according to the
 *   content type
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * @Get('/:id')
 * async find(ctx: NodeContext<MyEvents>) {
 *   return ctx.call('db:product:find', ctx.params.id);
 * }
 * ```
 */
export class NodeContext<TEvents extends EventRecord = EventRecord> extends HttpContext<IncomingMessage, ServerResponse, TEvents> {
  /** Raw request bytes, when a body collector was installed. */
  public rawBody?: Buffer;

  constructor(events: HttpEventBroker<any>, req: IncomingMessage, res: ServerResponse) {
    super(events, req, res);
    this.params = (req as { params?: Dictionary<string> }).params ?? {};
  }

  // ── Request ────────────────────────────────────────────────────────────

  public get body(): any {
    const withBody = this.req as IncomingMessage & { body?: unknown };
    if (withBody.body !== undefined) return withBody.body;
    if (this.rawBody === undefined || this.rawBody.length === 0) return undefined;
    return parseBody(this.rawBody, this.contentType);
  }

  public get path(): string {
    const url = this.req.url ?? '/';
    const index = url.indexOf('?');
    return index === -1 ? url : url.slice(0, index);
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
    return (this.req.method ?? 'GET') as RequestMethod;
  }

  public get hostname(): string {
    // The `Host` header is the authority as sent, which is the only place the
    // port appears — `req.headers.host`, not `req.url`.
    const host = this.header('host') ?? 'localhost';
    return host.startsWith('[') ? (host.split(']')[0] ?? host) + ']' : (host.split(':')[0] ?? host);
  }

  public get ip(): string | undefined {
    return this.req.socket.remoteAddress ?? undefined;
  }

  public get protocol(): string {
    return isEncrypted(this.req.socket) ? 'https' : 'http';
  }

  public get secure(): boolean {
    return isEncrypted(this.req.socket);
  }

  public get url(): string {
    return this.req.url ?? '/';
  }

  public get originalUrl(): string {
    return this.req.url ?? '/';
  }

  /**
   * The query string, with repeated keys collected into an array.
   *
   * `URLSearchParams` is used rather than `node:querystring`, which keeps only
   * the last value for a repeated key. `?tag=a&tag=b` becoming `'b'` is a bug
   * that is invisible until someone writes a filter on a repeated parameter.
   */
  public get query(): Dictionary<string | string[] | undefined> {
    const url = this.req.url ?? '/';
    const index = url.indexOf('?');
    if (index === -1) return {};

    const result: Dictionary<string | string[] | undefined> = {};
    for (const [key, value] of new URLSearchParams(url.slice(index + 1))) {
      const existing = result[key];
      if (existing === undefined) result[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else result[key] = [existing, value];
    }
    return result;
  }

  public get subdomains(): string[] {
    const host = this.hostname;
    const parts = host.split('.');
    return parts.length > 2 ? parts.slice(0, -2) : [];
  }

  public get headers(): Dictionary<string | string[] | undefined> {
    return this.req.headers as Dictionary<string | string[] | undefined>;
  }

  public get contentType(): string | undefined {
    return this.header('content-type');
  }

  /** `Content-Type` with its parameters stripped, lower-cased. */
  public get mimeType(): string | undefined {
    return baseContentType(this.contentType);
  }

  /** The declared body length, or `undefined` when the client sent none. */
  public get contentLength(): number | undefined {
    const declared = this.header('content-length');
    if (declared === undefined) return undefined;
    const value = Number(declared);
    return Number.isFinite(value) ? value : undefined;
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
    this.res.statusCode = code;
    return this;
  }

  /** The status code currently set on the response. */
  public get statusCode(): number {
    return this.res.statusCode;
  }

  /**
   * Sends a `3xx` and **ends the response**.
   *
   * Ending it is the part that is easy to get wrong with `node:http`. Express's
   * `res.redirect()`, Koa's `ctx.redirect()` and Hono's `new Response(…)` all
   * finish the response themselves; here, setting `Location` and
   * `statusCode` leaves the socket open, and the client waits for a body that
   * never arrives. The symptom is a hang on the *next* request, because the
   * first one looks like it succeeded.
   */
  public redirect(url: string, status: HttpStatus | number = HttpStatus.FOUND): this {
    this.setHeader('location', url);
    this.res.statusCode = status;
    // No body on a redirect. Writing one is legal but pointless, and a
    // `Content-Type` with no content is a confusing thing to hand a client.
    this.res.end();
    return this.markWritten();
  }

  public get responded(): boolean {
    return this.written || this.res.headersSent || this.res.writableEnded;
  }

  // ── Cookies ────────────────────────────────────────────────────────────

  public setCookie(name: string, value: string, options: CookieOptions = {}): this {
    this.appendHeader('set-cookie', serializeCookie(name, value, options));
    return this;
  }

  public clearCookie(name: string, options: Partial<CookieOptions> = {}): this {
    this.appendHeader('set-cookie', serializeCookie(name, '', { ...options, expires: new Date(0), maxAge: 0 }));
    return this;
  }
  public deleteCookie(name: string, options: Partial<CookieOptions> = {}): this {
    return this.clearCookie(name, options);
  }

  public getCookie(name: string): Maybe<string> {
    return this.cookies[name]?.value;
  }

  public get cookies(): RequestCookies {
    return parseCookieHeader(this.header('cookie'));
  }

  public get signedCookies(): RequestCookies {
    return {};
  }

  // ── Body ───────────────────────────────────────────────────────────────

  /**
   * Writes a body.
   *
   * Not routed through {@link NodeContext.finish}, because that helper's
   * callback takes no argument and `send` has to hand its own payload to
   * {@link NodeContext.writeBody}. Getting that wrong writes an empty body for
   * every response, which shows up as `Unexpected end of JSON input` on the
   * client rather than as anything in the server log.
   */
  public send(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    if (statusCode) this.res.statusCode = statusCode;
    if (headers) this.setHeaders(headers);
    this.writeBody(data);
    return this.markWritten();
  }

  public json(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.withContentType(ContentType.json, () => this.send(data, statusCode, headers));
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
    void stat(filePath).then(
      (stats) => {
        const start = options.start ?? 0;
        const end = options.end ?? stats.size - 1;
        // A `Range` request is honoured explicitly. Node's `createReadStream`
        // will happily send the whole file for a partial request, and a client
        // that asked for bytes 100–200 does not concatenate.
        const ranged = this.header('range');
        if (ranged !== undefined) this.res.statusCode = HttpStatus.PARTIAL_CONTENT;
        this.res.writeHead(this.res.statusCode, { 'Content-Type': this.mimeType ?? ContentType.octetStream });
        createReadStream(filePath, { start, end }).pipe(this.res);
      },
      (error: Error) => {
        fn?.(error);
        this.res.statusCode = HttpStatus.NOT_FOUND;
        this.res.end('Not Found');
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
    return this.req.headers[String(name).toLowerCase()] !== undefined;
  }

  /**
   * Reads a **request** header.
   *
   * @see HttpContext.getHeader — the distinction matters, because every consumer
   *      of this method is asking what the *client* sent.
   */
  public getHeader<T extends string>(name: HttpHeaderName<T>): HttpHeaderValue<T> {
    return this.header(String(name).toLowerCase()) as HttpHeaderValue<T>;
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
    this.res.setHeader('Vary', fields);
    return this;
  }

  public attachment(filename?: string): this {
    this.res.setHeader('Content-Disposition', `attachment${filename ? `; filename="${filename}"` : ''}`);
    return this;
  }

  public location(url: string): this {
    this.res.setHeader('Location', url);
    return this;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * A single request header, as a string. Repeated headers join with `, `.
   *
   * Public because {@link collectBody} needs it from outside the class.
   */
  public header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value.join(', ') : value;
  }

  private withContentType(contentType: string, write: () => this): this {
    if (!this.res.hasHeader('Content-Type')) this.res.setHeader('Content-Type', contentType);
    return write();
  }

  /**
   * Writes a value as a response body.
   *
   * The same coercion as every other adapter, applied here because Node has no
   * `res.send` to delegate to.
   */
  private writeBody(data: unknown): void {
    if (data === undefined || data === null) {
      this.res.end();
      return;
    }

    if (Buffer.isBuffer(data)) {
      this.res.end(data);
      return;
    }

    if (data instanceof Uint8Array) {
      this.res.end(Buffer.from(data));
      return;
    }

    if (typeof data === 'string') {
      this.res.end(data);
      return;
    }

    if (typeof (data as { pipe?: unknown }).pipe === 'function') {
      this.res.end();
      return;
    }

    if (!this.res.hasHeader('Content-Type')) this.res.setHeader('Content-Type', ContentType.json);
    this.res.end(JSON.stringify(data));
  }

  /** Appends to a repeated header, creating it when absent. */
  private appendHeader(name: string, value: string): void {
    const existing = this.res.getHeader(name);
    if (existing === undefined) {
      this.res.setHeader(name, value);
      return;
    }
    const list = Array.isArray(existing) ? existing.map(String) : [String(existing)];
    this.res.setHeader(name, [...list, value]);
  }

  /** Compares `If-Modified-Since` against `Last-Modified`. */
  private isStale(): boolean {
    const since = this.header('if-modified-since');
    const modified = this.res.getHeader('last-modified') as string | undefined;
    if (!since || !modified) return true;
    return new Date(since).getTime() < new Date(modified).getTime();
  }
}

/** An SSE stream, re-exported so a handler can type it without a deep import. */
export type { SseStream };

/**
 * Accumulates a request body into a `Buffer`.
 *
 * Installed as Gland middleware, which is the only place in the `node:http`
 * adapter that hooks the request stream at all. The limit is enforced while
 * reading rather than from `Content-Length`, because a client that lies about —
 * or omits — the declared length is exactly the case a limit exists for.
 *
 * @param limit - maximum body size in bytes
 */
export function collectBody(limit = 100 * 1024): (ctx: NodeContext, next: () => Promise<void>) => Promise<void> {
  return async function glandCollectBody(ctx: NodeContext, next: () => Promise<void>) {
    // Skip anything that cannot carry a body, and anything already consumed.
    // The `end` event for a request with no body may already have fired by the
    // time a middleware runs, and awaiting it then hangs the request forever —
    // which is exactly what a `PROPFIND` with no body does.
    if (!canHaveBody(ctx.method) || ctx.req.readableEnded) {
      await next();
      return;
    }

    // A request that declares neither `Content-Length` nor
    // `Transfer-Encoding` has no body to wait for. Trusting that is safer than
    // the alternative: waiting on an `end` that will not come.
    if (ctx.contentLength === undefined && ctx.header('transfer-encoding') === undefined) {
      await next();
      return;
    }

    const declared = ctx.contentLength;
    if (declared !== undefined && declared > limit) {
      throw new HttpExceptionLike(413, `Request body exceeds the ${limit} byte limit`);
    }

    const chunks: Buffer[] = [];
    let size = 0;

    await new Promise<void>((resolve, reject) => {
      ctx.req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          ctx.req.destroy();
          reject(new HttpExceptionLike(413, `Request body exceeds the ${limit} byte limit`));
          return;
        }
        chunks.push(chunk);
      });
      ctx.req.once('end', resolve);
      ctx.req.once('error', reject);
    });

    ctx.rawBody = Buffer.concat(chunks);
    await next();
  };
}

/** Whether an HTTP method is allowed to carry a body. */
function canHaveBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

/**
 * Parses a collected body according to its content type.
 *
 * Exported because a caller with its own buffering strategy needs the same
 * mapping, and two copies of "what does `text/csv` become" is how a form and an
 * API start disagree.
 */
export function parseBody(raw: Buffer, contentType: string | undefined): unknown {
  if (raw.length === 0) return undefined;

  if (isJsonContentType(contentType)) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch (error) {
      throw new HttpExceptionLike(400, `Malformed JSON body: ${error instanceof Error ? error.message : 'parse error'}`);
    }
  }

  if (baseContentType(contentType) === 'application/x-www-form-urlencoded') {
    const result: Dictionary<string> = {};
    for (const [key, value] of new URLSearchParams(raw.toString('utf8'))) {
      const existing = result[key];
      result[key] = existing === undefined ? value : `${existing},${value}`;
    }
    return result;
  }

  const base = baseContentType(contentType);
  if (!base || base.startsWith('text/') || base === 'application/xml' || base === 'application/javascript') {
    return raw.toString('utf8');
  }

  return raw;
}

/** A minimal `HttpException`-shaped error, so this file needs no toolkit import. */
class HttpExceptionLike extends Error {
  constructor(
    public readonly status: number,
    detail: string,
  ) {
    super(detail);
    this.name = 'HttpExceptionLike';
  }
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

/** Whether the socket is a TLS socket. `node:net`'s `Socket` has no `encrypted`. */
function isEncrypted(socket: unknown): boolean {
  return (socket as { encrypted?: boolean } | undefined)?.encrypted === true;
}
