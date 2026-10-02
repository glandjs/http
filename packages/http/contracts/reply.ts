import type { Readable } from 'node:stream';
import type { Dictionary } from '@medishn/toolkit';
import type { ContentTypeValue } from '../constants/content-type.const';

/**
 * Anything a route handler is allowed to return.
 *
 * The point of the union is that it is *narrow*. `unknown` would force every
 * adapter to guess at runtime, which is how `return res.send(...)`-style
 * handlers and `return { data }` handlers end up disagreeing about
 * `Content-Type` between frameworks. A value outside this union is still
 * accepted — {@link toReplyPayload} coerces it — but it is coerced by one
 * shared function rather than five.
 */
export type ReplyBody = string | number | boolean | Buffer | Uint8Array | Readable | Dictionary<unknown> | readonly unknown[] | null | undefined;

/**
 * How a reply should be written.
 *
 * Adapters switch on this instead of sniffing the body, which is what makes
 * `return 42` mean `42` on Express (text) and on Hono (`c.text('42')`) rather
 * than a JSON `42` on one and a string `'42'` on the other.
 *
 * | kind      | written as                                    |
 * | --------- | --------------------------------------------- |
 * | `empty`   | status only, no body                          |
 * | `json`    | `JSON.stringify`, `Content-Type: application/json` |
 * | `text`    | as-is, `Content-Type: text/plain`             |
 * | `buffer`  | raw bytes, `Content-Type: application/octet-stream` |
 * | `stream`  | piped to the socket, headers from the stream  |
 * | `file`    | the framework's static/sendFile facility       |
 * | `redirect` | `Location` + a 3xx                            |
 * | `sse`     | a live event stream                           |
 */
export type ReplyKind = 'empty' | 'json' | 'text' | 'buffer' | 'stream' | 'file' | 'redirect' | 'sse';

/**
 * A reply the adapter knows how to write, resolved but not yet written.
 *
 * Every adapter funnels a handler's return value through
 * {@link toReplyPayload} and then through its own `write()` implementation, so
 * the mapping from "what a handler returned" to "what went on the wire" is
 * defined exactly once for the whole ecosystem.
 */
export interface ReplyPayload {
  /** Which write strategy the adapter should use. */
  readonly kind: ReplyKind;
  /** The value to write. Shape depends on {@link ReplyPayload.kind}. */
  readonly body?: unknown;
  /** Status to apply before writing. Left as-is when omitted. */
  readonly status?: number;
  /** Headers to apply before writing. */
  readonly headers?: Dictionary<string | string[]>;
  /** Explicit `Content-Type`. Inferred from `kind` when omitted. */
  readonly contentType?: ContentTypeValue | string;
  /** Download filename, for `file` and `Content-Disposition: attachment`. */
  readonly filename?: string;
  /** Sendfile options, for `file`. */
  readonly fileOptions?: Dictionary<unknown>;
}

/** Options accepted by {@link HttpReply} and the `ctx.reply()` helpers. */
export interface HttpReplyOptions {
  status?: number;
  headers?: Dictionary<string | string[]>;
  contentType?: ContentTypeValue | string;
  /** `Content-Disposition` filename. */
  filename?: string;
  /** Passed through to the framework's send-file facility. */
  fileOptions?: Dictionary<unknown>;
}

/**
 * An explicit reply.
 *
 * Returning this from a handler is how a controller overrides Gland's
 * inference: status, headers, and content type without touching the context.
 * It is also the only way to return a `204` with a body-less object, or a
 * redirect that must not carry the default `text/html` body.
 *
 * Returning `undefined` remains equivalent to {@link HttpReply.empty} — a
 * handler that already wrote to `ctx` returns nothing.
 *
 * @example
 * ```ts
 * @Post('/products')
 * async create(ctx: HttpContext) {
 *   const product = await ctx.call('db:product:create', ctx.body);
 *   return HttpReply.json({ product }, { status: 201, headers: { location: `/products/${product.id}` } });
 * }
 * ```
 */
export class HttpReply implements ReplyPayload {
  /** A JSON body with an explicit status. */
  public static json(data: unknown, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('json', data, options);
  }

  /** A `text/plain` body. */
  public static text(body: string, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('text', body, options);
  }

  /** An `text/html` body. */
  public static html(body: string, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('text', body, { contentType: 'text/html; charset=utf-8', ...options });
  }

  /** An `application/xml` body. */
  public static xml(body: string, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('text', body, { contentType: 'application/xml; charset=utf-8', ...options });
  }

  /** Raw bytes. */
  public static buffer(body: Buffer | Uint8Array, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('buffer', body, options);
  }

  /** A readable stream, piped to the socket. */
  public static stream(body: Readable, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('stream', body, options);
  }

  /** A file on disk, via the framework's send-file facility. */
  public static file(path: string, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('file', path, options);
  }

  /** A `302` (or any 3xx) with a `Location` header. */
  public static redirect(url: string, status = 302, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('redirect', url, { ...options, status });
  }

  /** A status and headers with no body — `204`, `304`, or an explicit empty `200`. */
  public static empty(status = 204, options: HttpReplyOptions = {}): HttpReply {
    return new HttpReply('empty', undefined, { ...options, status });
  }

  constructor(
    public readonly kind: ReplyKind,
    public readonly body?: unknown,
    options: HttpReplyOptions = {},
  ) {
    this.status = options.status;
    this.headers = options.headers;
    this.contentType = options.contentType;
    this.filename = options.filename;
    this.fileOptions = options.fileOptions;
  }

  /** Status to apply before writing. Left as-is when omitted. */
  public readonly status?: number;
  /** Headers to apply before writing. */
  public readonly headers?: Dictionary<string | string[]>;
  /** Explicit `Content-Type`. Inferred from `kind` when omitted. */
  public readonly contentType?: ContentTypeValue | string;
  /** `Content-Disposition` filename, for `file` and attachments. */
  public readonly filename?: string;
  /** Send-file options, for `file`. */
  public readonly fileOptions?: Dictionary<unknown>;
}
