/**
 * The `Content-Type` values Gland writes.
 *
 * They are constants rather than inline strings because the same value has to
 * be produced in three places — `ctx.json()`, the CORS preflight, and the
 * problem-details error renderer — and a typo in one of them is invisible until
 * a client rejects the response.
 *
 * The charset is part of the value on purpose. Modern HTTP treats the header
 * as `application/json` regardless of parameters, but browsers and older
 * clients still sniff an unlabelled `text/plain` as Latin-1, which mangles
 * non-ASCII response bodies.
 */
export const ContentType = {
  /** `ctx.json()` — RFC 8259, UTF-8 by definition. */
  json: 'application/json; charset=utf-8',
  /** JSON Patch, for `ctx.json()` with a patch body. */
  jsonPatch: 'application/json-patch+json',
  /** RFC 7807 problem details — the shape `ctx.throw()` emits. */
  problem: 'application/problem+json; charset=utf-8',

  html: 'text/html; charset=utf-8',
  text: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',

  /** `application/x-www-form-urlencoded`, for the urlencoded body parser. */
  form: 'application/x-www-form-urlencoded',
  /** `multipart/form-data`. Never set by hand — the boundary is generated. */
  multipart: 'multipart/form-data',

  octetStream: 'application/octet-stream',
  pdf: 'application/pdf',
  zip: 'application/zip',

  /** `ctx.sse()` — RFC text/event-stream. */
  eventStream: 'text/event-stream; charset=utf-8',

  /** `text/<any>`, for the text body parser. */
  anyText: 'text/*',
  /** `<any>/*`, for the raw body parser. */
  any: '*/*',
} as const;

/** Any of the {@link ContentType} values, as a literal union. */
export type ContentTypeValue = (typeof ContentType)[keyof typeof ContentType];

/** Strips parameters — `"text/plain; charset=utf-8"` becomes `"text/plain"`. */
export function baseContentType(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const index = value.indexOf(';');
  return (index === -1 ? value : value.slice(0, index)).trim().toLowerCase();
}

/**
 * Whether a `Content-Type` denotes JSON.
 *
 * Matches the `+json` structured-suffix form as well as the bare type, so
 * `application/vnd.api+json` and `application/problem+json` both count.
 */
export function isJsonContentType(value: string | undefined | null): boolean {
  const base = baseContentType(value);
  return base === 'application/json' || base === 'text/json' || (base?.endsWith('+json') ?? false);
}

/** Whether a `Content-Type` denotes `text/<any>`. */
export function isTextContentType(value: string | undefined | null): boolean {
  return (baseContentType(value)?.startsWith('text/') ?? false) && !isJsonContentType(value);
}

/** Whether a `Content-Type` denotes HTML. */
export function isHtmlContentType(value: string | undefined | null): boolean {
  return baseContentType(value) === 'text/html';
}

/** Whether a `Content-Type` denotes an event stream. */
export function isEventStreamContentType(value: string | undefined | null): boolean {
  return baseContentType(value) === 'text/event-stream';
}
