# @glandjs/koa

Release notes for `@glandjs/koa`. It is released together with
[`@glandjs/http`](../http/CHANGELOG.md), which carries the shared adapter
contract this package implements, and it requires
[`@glandjs/core`](https://www.npmjs.com/package/@glandjs/core) `>= 2.0.0` for
route replay.

The combined history of every package in this repository also lives in
[docs/CHANGELOG.md](../../docs/CHANGELOG.md).

## 1.0.0

First release. `@glandjs/koa` has never been published before, so there is
nothing to upgrade from — the manifest previously read `1.1.0-beta`, which was
never on npm.

Targets **Koa 3** (`koa: ^3.0.0`, `@koa/router: ^13.1.0`).

### What it provides

- `KoaBroker` / `KoaBrokerClass` — the class `app.connectTo()` takes
- `KoaCore` — the application, with a `koa` getter for the underlying instance
- `KoaAdapter` — the adapter
- `KoaContext` — the request context
- `KoaState`, `GlandKoaContext` — types for typing `app.context`

### The router is mounted with no prefix, deliberately

`HttpServerAdapter.route()` has already applied the global prefix to every path
by the time an adapter sees it. Mounting `@koa/router` at the same prefix as well
would put every route at `/api/api/products`. So the adapter calls
`app.use(router.routes())` — no mount path — and `applyPrefix()` remains the one
source of truth.

The second reason is subtler: prepending works until a controller declares a
wildcard, and then two routes collide.

### Added

- **A Koa adapter that satisfies the shared contract**, verified against the
  same ~25 assertions every other transport runs (`test/shared/contract.ts`).
- **Route registration from the `gland:define:route` broadcast**, reading
  `fullPath` — the field the core actually emits.
- **A full request context**: `body`, `path`, `method`, `query`, `headers`,
  `cookies`, `ip`, `protocol`, `secure`, `hostname`, `contentType`,
  `contentLength`, `accepts()`/`is()`, `status()`, `send()`, `json()`, `html()`,
  `text()`, `xml()`, `end()`, `redirect()`, `sendFile()`, `download()`,
  `setCookie()`, `getCookie()`, `deleteCookie()`, `clearCookie()`, `vary()`,
  `attachment()`, `location()`, and the request/response header split
  (`getHeader()`/`hasHeader()` read the request; `getResponseHeader()`/
  `hasResponseHeader()` read the response).
- **`ctx.sse()`** — a real `SseStream`, piped as `ctx.body` so Koa owns the
  stream and does not add a `Content-Length` to it.
- **Body parsing via `koa-bodyparser`,** declared as an **optional peer**
  dependency and `require`d on first route registration. Limits default to
  **100 kB** for json, form and text rather than `koa-bodyparser`'s own 1 MB —
  the code cites this package's CVE history as the reason. **Multipart is
  deliberately excluded**: streaming a file upload through a buffering parser is
  how a 10 MB video becomes a 10 MB heap spike. Use `@koa/multer` through
  `useRaw()` instead.
- **`bodyParser: false` is honoured.** With no parser declared,
  `ctx.request.body` stays `undefined` — Koa parses nothing by itself.
- **Static assets via `koa-static`**, an optional peer, queued in call order so
  the mount happens before any route.
- **A terminal 404 mounted behind the router.** `@koa/router` leaves
  `ctx.status === 404` and `ctx.body` unset when nothing matched; Koa would then
  answer with its own body. The middleware runs after `await next()` and only
  answers when both are still unset.
- **Request-abort tracking**, via `ctx.res.once('close')` — the only adapter
  that does this.
- **`close()` calls `closeIdleConnections()`** alongside `server.close()`, which
  beats `closeAllConnections()` for a server with keep-alive clients.
- **Route params are copied late.** A Gland middleware reaches the context before
  the router has matched, so `syncParams()` runs immediately before the handler.

### Deliberate limitations

- **`poweredBy: false` is accepted and ignored.** Koa sets no `X-Powered-By`, and
  `app.context.remove()` delegates are not available during construction. (Hono,
  by contrast, acts on this option.)
- **`ctx.signedCookies` returns `{}`.** Signed cookies need a signed-cookie
  middleware mounted by you (`app.koa.keys = [...]`).
- **A throw from a Gland _middleware_ reaches Koa's own error page.** The adapter
  registers `app.on('error', …)` to _log_ such a throw, but it does not install
  `app.onerror`, so Koa's default handler renders its HTML error page. Throws
  from route handlers are fine — those are caught by the shared pipeline and
  rendered as RFC 7807 problem details. This is a real difference from Hono, which
  installs a real error handler.
- **No view-engine integration.** `views` is stored on the base adapter but the
  Koa adapter does not wire `@koa/views`.
- **`@koa/router` is a required runtime dependency, not a peer,** because Koa
  deliberately ships no router.

### Known issues

- **`useOne()` is a literal pass-through** to `koa.use(...)`, so a Gland
  middleware that expects a bridged context will not get one. `bridgeGland()`
  exists for the `app.use()` path.
- **No SSE, cookie-signing, static-file, view or multipart assertion exists in
  the shared contract suite**, so those paths are unverified by tests.
- **`@glandjs/common` is a required `peerDependency` but no source file in this
  package imports it.**
- **`@glandjs/core` is a runtime `dependency` that no source file imports
  directly** — it arrives transitively through `@glandjs/http`.
