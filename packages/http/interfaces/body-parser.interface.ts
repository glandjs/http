/**
 * Body-parser options.
 *
 * Gland does not ship a body parser. Parsing a body is a security decision —
 * limits, encodings, content types — and every framework makes it differently.
 * Instead the options are declared once, in a framework-neutral shape, and each
 * adapter translates them:
 *
 * | adapter   | translation                                          |
 * | --------- | ---------------------------------------------------- |
 * | Express   | `express.json()` / `urlencoded()` / `raw()` / `text()` |
 * | Fastify   | native — Fastify has no equivalent middleware         |
 * | Koa       | `koa-bodyparser`                                      |
 * | Hono      | nothing; Hono parses via `c.req.json()`               |
 * | Node      | `collect()` in {@link file:../utils/body.ts}          |
 *
 * An adapter that cannot honour an option logs it as unsupported rather than
 * dropping it silently, which is the only way to keep the declaration honest
 * across five transports.
 */
export interface BodyParserOptions {
  /**
   * Parse `application/json` (and any `+json` structured suffix).
   *
   * @default true when a body parser is configured at all
   */
  json?: JsonBodyParserOptions | boolean;

  /** Parse `application/x-www-form-urlencoded`. */
  urlencoded?: UrlencodedBodyParserOptions | boolean;

  /** Parse `multipart/form-data`. Needs a streaming parser; adapters vary. */
  multipart?: MultipartBodyParserOptions | boolean;

  /** Parse `text/<any>` into a string. */
  text?: TextBodyParserOptions | boolean;

  /** Parse everything else into a `Buffer`. */
  raw?: RawBodyParserOptions | boolean;

  /**
   * Reject a body larger than this, in bytes.
   *
   * Applied to every parser. The default is 100 kB — large enough for a normal
   * JSON payload, small enough that an unauthenticated upload cannot exhaust
   * memory.
   *
   * @default 102400
   */
  limit?: number | string;

  /** `Content-Encoding` values to inflate. Requires a codec on the adapter. */
  inflate?: boolean;

  /** Verify the parsed body's type with a guard, and reject on mismatch. */
  verify?: (body: unknown, raw: Buffer) => void | Promise<void>;

  /**
   * Run before parsing. Return `true` to skip the remaining parsers for this
   * request — the escape hatch for a custom `Content-Type`.
   */
  shouldParse?: (contentType: string | undefined, method: string) => boolean;
}

/** Options for the JSON parser. */
export interface JsonBodyParserOptions {
  /** Body size limit, in bytes. Overrides {@link BodyParserOptions.limit}. */
  limit?: number | string;
  /** Accept a bare `application/json` prefix match, e.g. `application/json; charset=utf-8`. */
  strict?: boolean;
  /** Parse the first array of a batched JSON body into `body`. */
  strictEntities?: boolean;
  /** Also parse bodies whose type ends in `+json`. @default true */
  jsonSuffix?: boolean;
}

/** Options for the urlencoded parser. */
export interface UrlencodedBodyParserOptions {
  limit?: number | string;
  /**
   * Use `qs` instead of Node's `querystring` for nested keys.
   *
   * `true` parses `a[b]=1` into `{ a: { b: '1' } }`. It is also the setting
   * behind prototype-pollution advisories in old `qs` releases, so it is opt-in.
   */
  extended?: boolean;
  /** Maximum parameter depth, when `extended` is on. @default 5 */
  depth?: number;
  /** Maximum parameter count, when `extended` is on. @default 1000 */
  parameterLimit?: number;
}

/** Options for the multipart parser. */
export interface MultipartBodyParserOptions {
  limit?: number | string;
  /** Preserve the file's original name rather than a random one. */
  preservePath?: boolean;
  /** Write uploads to this directory instead of buffering them. */
  uploadDir?: string;
}

/** Options for the text parser. */
export interface TextBodyParserOptions {
  limit?: number | string;
  /** Default charset when the request omits one. @default 'utf-8' */
  defaultCharset?: string;
}

/** Options for the raw parser. */
export interface RawBodyParserOptions {
  limit?: number | string;
}
