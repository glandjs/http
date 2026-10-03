# @glandjs/node

Release notes for `@glandjs/node`. It is released together with
[`@glandjs/http`](../http/CHANGELOG.md), which carries the shared adapter
contract this package implements, and it requires
[`@glandjs/core`](https://www.npmjs.com/package/@glandjs/core) `>= 2.0.0` for
route replay.

The combined history of every package in this repository also lives in
[docs/CHANGELOG.md](../../docs/CHANGELOG.md).

## 1.0.0

First release. `@glandjs/node` has never been published before, so there is
nothing to upgrade from — the manifest previously read `1.1.0-beta`, which was
never on npm.

It is the reference implementation of the adapter contract: the smallest thing
that satisfies [`@glandjs/http`](../http/CHANGELOG.md), written directly against
`node:http`.

### What it provides

- `NodeBroker` / `NodeBrokerClass` — the class `app.connectTo()` takes
- `NodeCore` — the application
- `NodeAdapter` — the adapter
- `NodeContext` — the request context
- `collectBody(limit)` — the body collector middleware
- `parseBody(raw, contentType)` — content-type-to-body decoding
- `compile()` / `matchSegments()` — the router, exported for the unit tests
- `SseStream`, `HttpEvent` — re-exported types

### What "no framework" means

The other four adapters each name a web framework in their `dependencies` —
`express`, `fastify`, `koa`, `hono`. This one names none, and
`docs/api/adapter-matrix.md` puts it as **"Extra runtime deps: none."**

To be precise about the claim, because it is easy to overstate: the
`dependencies` block is **not** empty. It lists `@glandjs/core`,
`@glandjs/events`, `@glandjs/http`, `@medishn/toolkit` and `tslib` — the same
Gland-internal dependencies every adapter has. What this package adds is **no
third-party framework**.

### What that costs you

`node:http` provides none of the conveniences the other adapters get for free, so
this adapter implements the ones a controller actually reaches for:

- **`query`** — parsed with `URLSearchParams` rather than `node:querystring`, so
  `?tag=a&tag=b` yields `['a','b']` instead of `'b'`, matching every other
  adapter.
- **`cookies`** — `parseCookieHeader()` from `@glandjs/http`, with
  percent-decoding and quoted-value handling. Writes go through
  `serializeCookie()`.
- **`body`** — accumulated by `collectBody()` and decoded by `parseBody()`.
- **The router** — `compile()` and `matchSegments()`, a compiled segment matcher
  written deliberately **not** as a `RegExp`, so `:id` cannot cross a `/` and no
  user value is ever interpolated into a pattern. Literal segments match
  case-sensitively, per RFC 3986 — a case-insensitive match is how `/Users` and
  `/users` become one route.
- **Accept negotiation** — `parseAccept()` / `matchesWildcard()` with q-value
  ranking, because Node has no `accepts()`.
- **Ending a response** — `redirect()` ends the socket itself. Setting `Location`
  and `statusCode` alone leaves it open, and the symptom is a hang on the _next_
  request.
- **Reply coercion** — `toReplyPayload()` from `@glandjs/http`.

### Added

- **The whole adapter contract**, verified against the same ~25 assertions every
  other transport runs (`test/shared/contract.ts`).
- **Route registration from the `gland:define:route` broadcast**, reading
  `fullPath`.
- **`bodyParser: false` is honoured, and nothing is read unless a parser is
  declared.** `node:http` used to collect the request bytes unconditionally, so a
  body arrived whether or not anyone wanted it. `bodyParsing` now defaults to
  `false`, and `beforeFlush()` only queues the collector when a parser was
  declared — collecting bytes nobody parses is a `413` risk with no benefit. This
  is pinned by the shared assertion _"installs no body parser unless one is
  declared"_, which runs for all five transports.
- **The body limit is enforced while reading, not from `Content-Length`.** A
  request declaring an oversized `Content-Length` is rejected before any byte is
  read; one that lies is rejected mid-stream, and the socket is destroyed. Limit
  defaults to 100 kB and accepts `'2mb'`-style strings.
- **`ctx.rawBody` holds the raw `Buffer`**, for content types `parseBody()` does
  not decode.
- **`parseBody()`** — JSON, `application/x-www-form-urlencoded` (repeated keys
  joined), `text/*`, XML and JavaScript as utf-8 strings, anything else as the
  raw `Buffer`. Malformed JSON raises a `400`.
- **`ctx.sse()`** — a real `SseStream`, written with `node:stream/promises`
  `pipeline` rather than `pipe`. A bare `pipe` swallows the error and leaves the
  client with a truncated body behind a `200` already on the wire — a
  valid-looking empty download.
- **`use()` runs the middleware chain for _every_ request, including an
  unmatched one,** because the 404 is the terminal branch inside the onion. A
  `401` middleware can therefore protect a 404 as well as a handler.
- **`X-Powered-By: Gland`** by default, suppressible with `poweredBy: false`.
- **HTTPS via `node:https`**, selected by `ServerFactory` when `options.https` is
  present.
- **`close()` calls `closeIdleConnections()`** so shutdown does not wait out the
  keep-alive timeout.
- **`ctx.getHeader()` / `hasHeader()` read the request; `getResponseHeader()` /
  `hasResponseHeader()` read the response.**

### Deliberate limitations

- **`useRaw()` is not supported** and warns: there is no framework-native
  `use()` to forward a middleware to.
- **`useStaticAssets()` does not serve files.** This is worth being explicit
  about, because the changeset for this release says it "now queues a wildcard
  route, which is all `serveStatic` needs". It does not: the argument is pushed
  onto the middleware queue as a `raw` entry, `flush()` hands it to `useOne()`,
  and `useOne()` warns and returns `undefined`. There is no `serveStatic` in this
  repository. What changed is only that the option is no longer discarded
  _silently_. Serve static files yourself, or use an adapter that has a static
  implementation.
- **No signed cookies** — `signedCookies` returns `{}`.
- **No multipart.**
- **`trustProxy` is not implemented.** Nothing reads `X-Forwarded-*`, so `ctx.ip`
  is `socket.remoteAddress` and `ctx.secure` tests `socket.encrypted`.
  (`docs/api/adapter-matrix.md` claims node trusts `X-Forwarded-*`; that row is
  wrong.)
- **No view engine.**

### Known issues

- **`ctx.sendFile()` uses a bare `createReadStream(...).pipe(this.res)`** — the
  exact thing this adapter's own `pipeStream()` was written to avoid. A failure
  there is silent and leaves a truncated body behind a `200`. It does honour a
  `Range` header manually and answers `206`.
- **`ctx.sendFile()` uses `ctx.mimeType` — the _request's_ content type — as the
  response `Content-Type`.** That looks like a bug.
- **`compile()` and `matchSegments()` are exported** with an `@internal` tag
  "Exported for the unit tests". They are public API by accident of necessity.
- **`HttpContext.body`, `NextFunction`, `Segment`, `CONTEXT_KEY`, `normalize`,
  `splitSegments`, `matchesPrefix` and `parseByteSize`** carry `@internal` JSDoc
  but are not all actually module-private.
- **No SSE, cookie, static-file or multipart assertion** exists in the shared
  contract suite.
- **`@glandjs/common` is a required `peerDependency` but no source file in this
  package imports it.**
- **`@glandjs/core` is a runtime `dependency` that no source file imports
  directly** — it arrives transitively through `@glandjs/http`.
