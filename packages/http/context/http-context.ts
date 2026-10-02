import { Context } from '@glandjs/core';
import type { EventRecord } from '@glandjs/events';
import { HttpException, HttpStatus, type Dictionary, type Maybe } from '@medishn/toolkit';
import { randomUUID } from 'node:crypto';
import { ContentType, type ContentTypeValue } from '../constants/content-type.const';
import type { HttpEventBroker } from '../adapter/http-event-broker';
import type { CookieOptions, ErrorCallback, RequestCookies, SendOptions } from '../interfaces/context-options.interface';
import type { HttpHeaderInput, HttpHeaderName, HttpHeaderValue } from '../interfaces/http-headers.interface';
import type { RequestMethod } from '../enum/method.enum';
import { SseStream, type SseStreamOptions } from '../utils/sse-stream';
import type { NextFunction } from '../contracts/middleware';

/** Content types {@link HttpContext.accepts} understands. */
export type AcceptType = ContentTypeValue | string | readonly string[];

/**
 * A request context.
 *
 * This is the whole public surface of the HTTP layer, and it is identical on
 * every adapter. A controller that takes an `HttpContext` — or an
 * `ExpressContext`, or a `KoaContext` — compiles against any of them and keeps
 * compiling when the transport changes.
 *
 * The class is abstract rather than a set of free functions, and that is the
 * load-bearing decision of the whole package. An adapter cannot implement it
 * partially: TypeScript will not let a `KoaContext` forget `subdomains()`, which
 * is exactly the guarantee that makes a transport swap a refactor rather than a
 * rewrite.
 *
 * Three groups of members, in the order you tend to need them:
 *
 * - **request** — `method`, `path`, `query`, `body`, `params`, `headers`
 * - **response** — `status`, `json`, `send`, `redirect`, `setHeader`
 * - **Gland** — `call`, `emit`, `state`, inherited from `Context`
 *
 * @typeParam TRequest - the framework's request object
 * @typeParam TResponse - the framework's response object
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * @Get('/products/:id')
 * async find(ctx: HttpContext<MyEvents>) {
 *   const product = await ctx.call('db:product:find', { id: ctx.params.id });
 *   if (!product) return ctx.throw(HttpStatus.NOT_FOUND, { detail: 'No such product' });
 *   return product;                       // serialised as JSON
 * }
 * ```
 */
export abstract class HttpContext<TRequest = any, TResponse = any, TEvents extends EventRecord = EventRecord> extends Context<TEvents> {
  /**
   * Route parameters captured by the router.
   *
   * Populated by the adapter before the handler runs, so it is always present —
   * an empty object for a parameterless route, never `undefined`.
   */
  public params: Dictionary<string> = {};

  /** The `Host` header, without the port. */
  public host?: Maybe<string>;

  /**
   * Correlation id for this request.
   *
   * Taken from `X-Request-Id` when the client sent one, otherwise generated.
   * Set it as early as possible — the constructor does — so a crash in the first
   * middleware is still traceable.
   */
  public readonly requestId: string;

  /** Wall-clock time the context was constructed, for duration maths. */
  public readonly startedAt: number = Date.now();

  /** Set by {@link HttpContext.aborted} when the client hangs up mid-response. */
  public aborted = false;

  /**
   * Whether an explicit write has happened.
   *
   * Set by every method on this class that writes a response — `json`, `send`,
   * `redirect`, `end` and their siblings. It exists because those methods are
   * fluent and therefore return `this`, which makes `return ctx.redirect(url)`
   * a natural thing to write; without the flag, the request pipeline sees a
   * returned value, assumes the handler did not answer, and tries to serialise
   * the context itself.
   *
   * That failure is nasty: serialising a context hits its circular references,
   * the serialiser throws, and the client gets a `500` from a handler that
   * actually sent a `302`.
   *
   * @see HttpContext.responded
   */
  public written = false;

  constructor(
    /** The adapter's lifecycle bus. Also the broker `Context` dispatches on. */
    protected readonly events: HttpEventBroker,
    public readonly req: TRequest,
    /**
     * The response object.
     *
     * Not `readonly`: the Fetch-based adapter (Hono) has to build a new
     * `Response` for each write, because a Fetch `Response` is immutable. Every
     * other adapter mutates a socket-backed object in place, so nothing else
     * needs the assignment.
     */
    public res: TResponse,
  ) {
    // The lifecycle bus is typed with the *transport's* event map, while
    // `Context` is typed with the *application's* channel map. The two are
    // deliberately different buses — see {@link file:../events/http-events.ts} —
    // and the base only needs something with `on`/`emit`/`call` to dispatch on.
    // `never` rather than `Broker<TEvents>` because `@glandjs/core` resolves its
    // own copy of `@glandjs/events`, and the two `Broker` interfaces are
    // structurally incompatible because of private fields in `EventBroker`.
    super(events as never);
    this.requestId = this.resolveRequestId();
  }

  // ── Request ────────────────────────────────────────────────────────────

  /** The parsed request body, or `undefined` when no parser matched. */
  public abstract get body(): any;

  /** Path without the query string, e.g. `'/products/1'`. */
  public abstract get path(): string;

  /** Whether the request came from `XMLHttpRequest`/`fetch`. */
  public abstract get xhr(): boolean;

  /** Whether the client's cache entry is stale. */
  public abstract get stale(): boolean;

  /** Whether the client's cache entry is fresh. */
  public abstract get fresh(): boolean;

  /** The upper-case wire method. */
  public abstract get method(): RequestMethod;

  /** Hostname without the port. */
  public abstract get hostname(): string;

  /** Client address, honouring `X-Forwarded-For` when `trustProxy` is on. */
  public abstract get ip(): string | undefined;

  /** `'http'` or `'https'`. */
  public abstract get protocol(): string;

  /** Whether the connection is TLS. */
  public abstract get secure(): boolean;

  /** The request URL, including the query string. */
  public abstract get url(): string;

  /** The URL as received, before any prefix stripping. */
  public abstract get originalUrl(): string;

  /** Parsed query string. A repeated key becomes an array. */
  public abstract get query(): Dictionary<string | string[] | undefined>;

  /** Sub-domains of {@link HttpContext.hostname}, most significant first. */
  public abstract get subdomains(): string[];

  /** Request headers, lower-cased. */
  public abstract get headers(): Dictionary<string | string[] | undefined>;

  /** The body parser that produced {@link HttpContext.body}, if any. */
  public abstract get is(): (type: string | readonly string[]) => string | false | null;

  /**
   * Negotiates a response type against the `Accept` header.
   *
   * @param types - acceptable types, most preferred first
   * @returns the client's choice, or `false` when none is acceptable
   */
  public abstract get accepts(): (types?: AcceptType) => string | false;

  // ── Response ───────────────────────────────────────────────────────────

  /** Sets the response status. Fluent. */
  public abstract status(code: HttpStatus | number): this;

  /** Sends a `3xx` with a `Location` header. Fluent. */
  public abstract redirect(url: string, status?: HttpStatus | number): this;

  /**
   * Whether the response has already begun — no further body may be written.
   *
   * An adapter combines {@link HttpContext.written} with whatever its transport
   * knows: `headersSent` on Express, `writableEnded` on `node:http`, `sent` on
   * Fastify, a non-`undefined` `body` on Koa, a produced `Response` on Hono.
   */
  public abstract get responded(): boolean;

  /**
   * Records that this context wrote the response.
   *
   * Called by every write method below and by the adapters' own
   * {@link HttpServerAdapter.write}. Returns `this` so a terminal write can be
   * written as a single expression.
   */
  protected markWritten(): this {
    this.written = true;
    return this;
  }

  /**
   * Records that this context wrote the response.
   *
   * Public because an adapter's own {@link HttpServerAdapter.write} has to call
   * it from outside the class, when a framework write happens without going
   * through a method here — a Koa `ctx.body = …`, a Hono `new Response(…)`.
   */
  public wrote(): this {
    return this.markWritten();
  }

  // ── Cookies ────────────────────────────────────────────────────────────

  /** Sets a cookie. Fluent. */
  public abstract setCookie(name: string, value: string, options?: CookieOptions): this;

  /** Clears a cookie. Fluent. */
  public abstract clearCookie(name: string, options?: Partial<CookieOptions>): this;

  /** Reads a request cookie. */
  public abstract getCookie(name: string): Maybe<string>;

  /** Alias of {@link HttpContext.clearCookie}, matching Express's spelling. */
  public abstract deleteCookie(name: string, options?: Partial<CookieOptions>): this;

  /** All request cookies, `{}` when no cookie parser is installed. */
  public abstract get cookies(): RequestCookies;

  /** Cookies whose `Signature` segment verified. */
  public abstract get signedCookies(): RequestCookies;

  // ── Body ───────────────────────────────────────────────────────────────

  /** Writes a body, choosing the encoding from its type. Fluent. */
  public abstract send(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this;

  /** Writes `application/json`. Fluent. */
  public abstract json(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this;

  /** Writes `text/html`. Fluent. */
  public abstract html(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this;

  /** Writes `text/plain`. Fluent. */
  public abstract text(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this;

  /** Writes `application/xml`. Fluent. */
  public abstract xml(body: string, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this;

  /** Ends the response with no body. Fluent. */
  public abstract end(): this;

  // ── Files ──────────────────────────────────────────────────────────────

  /** Streams a file from disk. Fluent. */
  public abstract sendFile(filePath: string, options?: SendOptions, fn?: ErrorCallback): this;

  /** Sends a file as an attachment. Fluent. */
  public abstract download(filePath: string, filename?: string, options?: SendOptions): this;

  /**
   * Opens a server-sent-events stream.
   *
   * The returned stream is inert until it is written or read, so it is safe to
   * create before the response is ready. Return it from the handler, or write
   * to it directly and return nothing.
   *
   * @example
   * ```ts
   * const sse = ctx.sse({ heartbeat: 20_000 });
   * sse.send({ ready: true });
   * return sse;
   * ```
   */
  public sse(options?: SseStreamOptions): SseStream {
    return new SseStream(options);
  }

  // ── Headers ────────────────────────────────────────────────────────────

  /** Whether a *request* header is present. */
  public abstract hasHeader(name: HttpHeaderName): boolean;

  /**
   * Reads a **request** header.
   *
   * The request, not the response. `getHeader('origin')`, `getHeader('accept')`
   * and `getHeader('content-type')` are all things a *client* sent, and every
   * piece of Gland that inspects them — content negotiation, CORS, the body
   * parser — needs the request's value. A response header is a separate
   * question with a separate name: {@link HttpContext.getResponseHeader}.
   */
  public abstract getHeader<T extends string>(name: HttpHeaderName<T>): HttpHeaderValue<T>;

  /** Whether a *response* header is already set. */
  public abstract hasResponseHeader(name: HttpHeaderName): boolean;

  /**
   * Reads a **response** header.
   *
   * Useful for the "did someone already decide this?" checks — whether a
   * `Content-Type` is present before setting one, or whether a cookie has been
   * attached. Before this distinction existed, `getHeader` silently answered
   * from the response, which made `ctx.getHeader('origin')` return `undefined`
   * for every real request.
   */
  public abstract getResponseHeader<T extends string>(name: HttpHeaderName<T>): HttpHeaderValue<T>;

  /** Writes a response header. Fluent. */
  public abstract setHeader<T extends string>(name: HttpHeaderName<T>, value: HttpHeaderInput<T>): this;

  /** Writes several response headers. Fluent. */
  public abstract setHeaders(headers: Dictionary<HttpHeaderInput<string> | readonly string[]>): this;

  /** Removes a response header. Fluent. */
  public abstract removeHeader<T extends string>(name: HttpHeaderName<T>): this;

  /** Replaces the `Vary` header. Fluent. */
  public abstract vary(fields: string): this;

  /** Sets `Content-Disposition: attachment`. Fluent. */
  public abstract attachment(filename?: string): this;

  /** Sets `Location` without changing the status. Fluent. */
  public abstract location(url: string): this;

  // ── Errors ─────────────────────────────────────────────────────────────

  /**
   * Ends the request with an RFC 7807 problem document.
   *
   * The default renderer maps an `HttpException` to its own status, and
   * anything else to `500` with the message left out of the body — an internal
   * error's text is not the client's business. Override it with
   * `app.setErrorHandler()` if you need a different policy.
   *
   * @param status - the status to send
   * @param options - problem-details fields: `detail`, `type`, `title`, `instance`
   * @returns `this`, so `return ctx.throw(...)` type-checks as a reply
   *
   * @example
   * ```ts
   * if (!user) return ctx.throw(HttpStatus.UNAUTHORIZED, {
   *   detail: 'Token expired',
   *   type: 'https://errors.example.com/token-expired',
   * });
   * ```
   */
  public throw(status: HttpStatus, options?: ConstructorParameters<typeof HttpException>[1]): this {
    const exception = new HttpException(status, options);

    this.status(exception.status);

    if (!this.getResponseHeader('content-type')) {
      this.setHeader('content-type', ContentType.problem);
    }

    return this.send(exception.getProblemDetails(this.requestId));
  }

  // ── Gland ──────────────────────────────────────────────────────────────

  /** The adapter's lifecycle bus.
   *
   * Named to avoid colliding with {@link Context.broker}, which is the base
   * class's dispatch handle and is typed with the application's channel map.
   * This one carries transport events.
   */
  public get lifecycle(): HttpEventBroker {
    return this.events;
  }

  /**
   * Advances the Gland middleware chain.
   *
   * Present on the context so a controller can short-circuit — skip the rest of
   * the chain, or hand it an error — without importing the middleware contract.
   * Outside a chain it resolves immediately rather than throwing, because a
   * handler is allowed to call it defensively.
   */
  public next: NextFunction = async () => {
    /* Replaced by the adapter while a chain is running. */
  };

  /** Milliseconds since the context was constructed. */
  public get elapsed(): number {
    return Date.now() - this.startedAt;
  }

  /**
   * Reads the correlation id, or generates one.
   *
   * `X-Request-Id` first, then `X-Correlation-Id` — the two headers that mean
   * this in practice — then a UUID. Generated here rather than lazily so a crash
   * in the first middleware is still traceable, and so the id is stable across
   * every log line for the request.
   */
  private resolveRequestId(): string {
    const headers = (this.req as { headers?: Dictionary<string | string[] | undefined> } | undefined)?.headers;
    if (headers) {
      const provided = headers['x-request-id'] ?? headers['x-correlation-id'];
      const value = Array.isArray(provided) ? provided[0] : provided;
      // Capped: an attacker-controlled header flows into every log line, and an
      // unbounded one is a log-injection vector.
      if (value && typeof value === 'string' && value.length <= 200) return value;
    }
    return randomUUID();
  }
}
