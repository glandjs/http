import { isNil, isPlainObject, isString } from '@medishn/toolkit';
import type { Readable } from 'node:stream';
import { ContentType, isEventStreamContentType } from '../constants/content-type.const';
import { HttpReply, type ReplyPayload } from '../contracts/reply';
import type { SseStream } from './sse-stream';

/**
 * Whether a value is a Node readable stream.
 *
 * Duck-typed on `pipe` rather than checked with `instanceof`, because a stream
 * that crossed a worker boundary or came from a different copy of `stream` in
 * the dependency tree is still perfectly pipeable — and `instanceof` would
 * reject it.
 */
export function isReadableStream(value: unknown): value is Readable {
  return typeof value === 'object' && value !== null && typeof (value as Readable).pipe === 'function';
}

/**
 * Whether a value is a Gland {@link SseStream}.
 */
export function isSseStream(value: unknown): value is SseStream {
  return typeof value === 'object' && value !== null && (value as SseStream).kind === 'sse';
}

/** Whether a value should be written as raw bytes. */
export function isBinary(value: unknown): value is Buffer | Uint8Array {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

/**
 * Turns whatever a route handler returned into a {@link ReplyPayload}.
 *
 * This is the single decision point for the whole ecosystem. Five adapters
 * calling one function is why `return { ok: true }` produces
 * `application/json` on all of them, and why `return 42` produces the text
 * `42` on all of them instead of JSON on one and a string on another.
 *
 * The rules, in order:
 *
 * 1. an {@link HttpReply} is taken as-is
 * 2. an {@link SseStream} becomes `sse`
 * 3. `null`/`undefined` become `empty` — "the handler wrote the response itself"
 * 4. a readable becomes `stream`
 * 5. a `Buffer`/`Uint8Array` becomes `buffer`
 * 6. a string becomes `text`
 * 7. anything else — object, array, number, boolean — becomes `json`
 *
 * Step 7 is the one worth arguing about. JSON is the default because an object
 * return is the shape a controller naturally produces and the one a client
 * expects; a number or a boolean becoming `application/json` is correct, since
 * the alternative is a bare digit with no type information at all.
 *
 * @param value - the handler's return value
 * @returns the payload an adapter should write
 *
 * @example
 * ```ts
 * toReplyPayload({ id: 1 })            // { kind: 'json', body: { id: 1 } }
 * toReplyPayload('ok')                 // { kind: 'text', body: 'ok' }
 * toReplyPayload(undefined)            // { kind: 'empty' }
 * toReplyPayload(Buffer.from('hi'))    // { kind: 'buffer', body: <Buffer> }
 * toReplyPayload(HttpReply.empty(204)) // { kind: 'empty', status: 204 }
 * ```
 */
export function toReplyPayload(value: unknown): ReplyPayload {
  if (value instanceof HttpReply) {
    return value;
  }

  if (isSseStream(value)) {
    return { kind: 'sse', body: value };
  }

  if (isNil(value)) {
    return { kind: 'empty' };
  }

  if (isReadableStream(value)) {
    return { kind: 'stream', body: value };
  }

  if (isBinary(value)) {
    return { kind: 'buffer', body: value };
  }

  if (isString(value)) {
    return { kind: 'text', body: value };
  }

  if (typeof value === 'number' || typeof value === 'boolean' || isPlainObject(value) || Array.isArray(value)) {
    return { kind: 'json', body: value };
  }

  // A function, a symbol, a class instance. JSON.stringify handles all three
  // (dropping the value entirely for the first and last), so serialising is
  // more useful than rejecting the request — and a handler that returns one of
  // these has almost certainly made a mistake that should surface as a `null`
  // body rather than as a 500 on a code path that otherwise works.
  return { kind: 'json', body: value };
}

/**
 * The `Content-Type` to write for a payload.
 *
 * An explicit `payload.contentType` always wins. Otherwise the kind decides —
 * except for `text`, which sniffs HTML, because `return '<h1>Hi</h1>'` almost
 * always means HTML and labelling it `text/plain` makes browsers show the tags.
 *
 * @param payload - the resolved reply
 * @returns the header value, or `undefined` to leave the framework's default
 */
export function contentTypeFor(payload: ReplyPayload): string | undefined {
  if (payload.contentType) return payload.contentType;

  switch (payload.kind) {
    case 'json':
      return ContentType.json;
    case 'buffer':
    case 'file':
      return ContentType.octetStream;
    case 'sse':
      return ContentType.eventStream;
    case 'text': {
      const body = payload.body;
      // Only a string body can be sniffed. A stream typed as `text` is opaque,
      // and guessing at it would be worse than letting the framework default.
      return isString(body) && looksLikeHtml(body) ? ContentType.html : ContentType.text;
    }
    default:
      return undefined;
  }
}

/**
 * Whether a string looks like HTML.
 *
 * Deliberately narrow: a leading `<!doctype`, `<html`, or any of the handful of
 * block-level tags. A loose test such as "contains a `<`" would mislabel
 * `a < b` as markup, and a sniff that guessed `text/html` for an API error
 * message would turn a JSON client into a browser download prompt.
 */
export function looksLikeHtml(value: string): boolean {
  const head = value.trimStart().slice(0, 512).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return true;
  return /^<(?:head|body|title|div|span|p|section|article|header|footer|main|nav|aside|table|ul|ol|form|script|style|meta|link|h[1-6])\b/.test(head);
}

/**
 * Whether the response already carries an event-stream content type.
 *
 * Adapters call this to decide whether an `SseStream` body needs its headers
 * set, or whether a `text/event-stream` is already in flight.
 */
export function hasEventStreamType(contentType: string | undefined): boolean {
  return isEventStreamContentType(contentType);
}
