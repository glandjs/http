# @glandjs/hono

Release notes for `@glandjs/hono`. It is released together with
[`@glandjs/http`](../http/CHANGELOG.md), which carries the shared adapter
contract this package implements, and it requires
[`@glandjs/core`](https://www.npmjs.com/package/@glandjs/core) `>= 2.0.0` for
route replay.

The combined history of every package in this repository also lives in
[docs/CHANGELOG.md](../../docs/CHANGELOG.md).

## 1.0.0

First release. `@glandjs/hono` has never been published before, so there is
nothing to upgrade from — the manifest previously read `1.1.0-beta`, which was
never on npm.

Targets **Hono 4** (`hono: ^4.6.14`), on Node and on the edge runtimes Hono
itself targets.

### What it provides

- `HonoBroker` / `HonoBrokerClass` — the class `app.connectTo()` takes
- `HonoCore` — the application, with a `hono` getter exposing the edge export
- `HonoAdapter` — the adapter
- `HonoRequestContext` — the request context
- `parseFetchBody(text, contentType)` — exported so an application can reuse the
  same content-type-to-body mapping
- `FetchBodyInit`, `SseStream` — types

### The trade a fetch `Response` forces

A fetch `Response`'s `status`, `headers` and `body` are read-only. Every reply
this adapter writes is therefore built as a **new** `Response` rather than
mutated. That single constraint produces three consequences you should know
before choosing this adapter.

**1. `useRaw()` can add headers but cannot amend a reply.** A raw middleware may
observe the response and add headers, and may short-circuit by returning its own
`Response` — but it cannot change the status or body the handler already
composed. The adapter merges only header names that are not already present.

> Note: the changeset for this release claimed `useRaw()` "reports that it was
> ignored" on Hono. **It does not** — that warning exists only on
> `@glandjs/node` and `@glandjs/fastify`, which have no `use()` to forward to.
> On Hono `useRaw()` genuinely runs.

**2. There is no `Buffer` body.** A fetch body is read as text. Declaring
`bodyParser({ raw: true })` logs a warning at boot and is otherwise ignored;
`ctx.rawText` holds the raw string.

**3. `listen()` is Node-only.** Off Node the adapter logs that you should export
`app.fetch` and returns. `@hono/node-server` is an optional peer.

### Added

- **A Hono adapter that satisfies the shared contract**, verified against the
  same ~25 assertions every other transport runs.
- **`ctx.body` for `application/x-www-form-urlencoded` is an object** parsed with
  `URLSearchParams`, with repeated keys collected into arrays — matching the other
  four adapters. Previously it was the raw body string, so a handler written
  against the other four had to reach for `URLSearchParams` itself, which is
  exactly the kind of per-adapter difference this layer exists to remove. This is
  pinned by the shared contract assertion `a urlencoded body is parsed into an
object`. Any content type that is neither JSON nor form-urlencoded (e.g.
  `text/csv`) stays a string.
- **The body is read exactly once, and only when asked for.** The pre-hook skips
  `GET`/`HEAD`/`OPTIONS`, and reads only if a parser was declared — so
  `bodyParser: false` means no parser, and `ctx.body` stays `undefined`. This
  matters because a fetch body can only be read once: a second attempt would hang
  rather than return nothing.
- **Route registration from the `gland:define:route` broadcast**, reading
  `fullPath`. Wildcards are rewritten to the _named_ form (`/files/*` →
  `/files/{splat}`), which Hono requires.
- **A full request context**: `body`, `path`, `method`, `query`, `headers`,
  `cookies`, `ip`, `protocol`, `secure`, `hostname`, `accepts()`/`is()`,
  `status()`, `send()`, `json()`, `html()`, `text()`, `xml()`, `end()`,
  `redirect()`, `sendFile()`, `download()`, the cookie methods, `vary()`,
  `attachment()`, `location()`, and the request/response header split.
- **`ctx.sse()`**, with the same headers as the other four adapters
  (`text/event-stream`, `no-cache, no-transform`, `keep-alive`,
  `X-Accel-Buffering: no`).
- **Static assets via `hono/serve-static`.**
- **`poweredBy: false` is honoured** — an `app.use('*')` deletes `X-Powered-By`
  after `next()`. Koa ignores the same option; this adapter acts on it.
- **Errors render as RFC 7807 problem details** through both `notFound` and
  `onError`, replacing Hono's own `{ error, status }` shape.
- **A middleware short-circuit that short-circuits.** Without copying the
  context's response back, Hono's dispatcher throws `Context is not finalized`
  and the short circuit becomes a `500` — the opposite of its purpose. A CORS
  preflight, which never calls `next()`, is the case this fixes.
- **`ctx.query` collects repeated keys into arrays,** because Hono's own
  `c.req.query()` keeps only the last value.
- **`ctx.path` parses the pathname** out of the absolute URL, because Hono's
  `c.req.url` is absolute on some runtimes — and an absolute URL in a `Vary`
  header, a log line or a problem document is both wrong and a mild information
  leak.
- **Object-mode `Readable` results are adapted** via `objectModeToWeb`, because
  `Readable.toWeb` refuses them.
- **`listen()` reports the bound port**, resolved from `server.address()`. With
  `listen(0)` this matters: reporting `0` makes every subsequent request fail
  with `fetch failed`.

### Deliberate limitations

- **No body-size limit is enforced.** Hono has no parser registry — the pre-hook
  decides by content type — so `bodyParser({ limit })` is accepted and ignored.
  Koa, by contrast, caps at 100 kB per type. A shared `bodyLimitMiddleware` is
  exported by `@glandjs/http` but is not wired into this adapter.
- **Every other `bodyParser` option is accepted and ignored** — `json`,
  `urlencoded`, `text`, `enableTypes`, `limit`. Only `raw` and `multipart`
  produce a warning.
- **`ctx.signedCookies` returns `{}`.** There is no signed-cookie support at all.
- **`sendFile()` needs a filesystem,** so it is Node-only in practice; on a
  worker the `stat` fails with a clear error rather than a silent empty body.
- **`ctx.ip` is header-derived** — first entry of `x-forwarded-for`, else
  `x-real-ip`, else `undefined`. Honest, but not a socket address.
- **`hono/serve-static` is required at runtime but is not declared** as an
  optional peer, unlike `koa-static` for Koa. A missing install surfaces as a
  generic load failure.

### Known issues

- **`unquote()` is dead code** in `context.ts` — defined, never called, not
  exported.
- **No SSE, cookie-signing, static-file, view or multipart assertion exists in
  the shared contract suite**, so those paths are unverified by tests.
- **`@glandjs/common` is a required `peerDependency` but no source file in this
  package imports it.**
- **`@glandjs/core` is a runtime `dependency` that no source file imports
  directly** — it arrives transitively through `@glandjs/http`.
