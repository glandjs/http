# @glandjs/express

Release notes for `@glandjs/express`. It is released together with
[`@glandjs/http`](../http/CHANGELOG.md), which carries the shared adapter
contract this package implements, and it requires
[`@glandjs/core`](https://www.npmjs.com/package/@glandjs/core) `>= 2.0.0` for
route replay.

The combined history of every package in this repository also lives in
[docs/CHANGELOG.md](../../docs/CHANGELOG.md).

## 2.0.0

First stable release, and the first version of this package that can actually
serve a `@Controller()` route. `1.0.0-beta` registered **zero** controller
routes — see "Fixed" — so treat this as a fresh start rather than an upgrade.

Targets **Express 5** (`express: ^5.1.0`, `@types/express: ^5.0.1`).

### Fixed

- **The global prefix was applied twice, so every prefixed route 404'd.**
  `setGlobalPrefix(prefix)` mounted an empty `express.Router()` at the prefix
  while `HttpServerAdapter.route()` had _already_ prefixed each path. A route
  declared `@Controller('products')` under `prefix: '/api'` was registered at
  `/api/api/products`. The adapter now registers on the application and only
  records the prefix; `applyPrefix()` in `@glandjs/http` is idempotent, so
  setting both `{ prefix }` and `setGlobalPrefix()` is safe.

  ```ts
  // 1.0.0-beta produced /api/api/products
  const app = new ExpressCore({ prefix: '/api' });

  // 2.0.0 produces /api/products
  const app = new ExpressCore();
  app.setGlobalPrefix('/api');
  ```

- **Controller routes were never registered at all.** `HttpBroker` read
  `payload.meta.path` from the route broadcast, a field `@glandjs/core` stopped
  emitting when the channel registry landed. Only manual `app.get()` calls
  worked, and the symptom was a `404` on every endpoint. Fixed in
  `@glandjs/http` (`http-broker.ts` now reads `route.fullPath`) and inherited
  here — but it is the reason this release is a major rather than a minor.

  If you see `This HTTP adapter received no routes from the application binder`
  on startup, the linked `@glandjs/core` is older than `2.0.0`.

- **Body parsers were mounted at `listen()` time, which is too late.** Express
  skips middleware registered after a matching route, so parsers declared in
  `HttpApplicationOptions.bodyParser` were silently inactive. Parsers are now
  queued and mounted in call order, before the first route.

- **`ctx.getHeader()` and `ctx.hasHeader()` read the _response_ header.** Every
  caller was wrong: CORS, content negotiation and auth middleware were all
  asking what the server had set rather than what the client sent. They now
  read the **request**; `ctx.getResponseHeader()` and `ctx.hasResponseHeader()`
  were added for the response.

- **`use()` inferred its intent from function arity.** Any 2- or 3-argument
  function passed to `app.use()` was treated as Gland middleware
  `(ctx, next)`, which silently mistyped every Express handler. `app.use()` and
  `app.useRaw()` are now separate methods, and `HttpCore.use()` records into the
  queue instead of mounting immediately.

- **`return ctx.redirect(url)` produced a `500`.** The redirect was
  re-serialised after the framework had already written the response, so the
  second attempt hit a circular-structure error. The context now tracks whether
  it has written, and a reply after that is ignored.

- **`ctx.send('done')` sent `text/html`.** Express's `res.send(string)` defaults
  to `text/html`; a bare string now goes out as `text/plain`.

- **`ctx.html()`/`text()`/`xml()` overwrote a caller-supplied `Content-Type`.**
  They now set it only when absent.

- **`ctx.sendFile()` only invoked its callback on error,** so the success path
  never ran.

- **`ctx.cookies` required `cookie-parser`.** It now falls back to parsing
  `req.headers.cookie` when `req.cookies` is undefined, so cookies work with or
  without the middleware.

### Breaking

- **`ExpressAdapter`, `ExpressCore`, `ExpressApp` and `EXPRESS_VERBS` are now
  exported from the package root.** In `1.0.0-beta` the root barrel was only
  `./broker` and `./context`, so the adapter and core were reachable solely by
  deep import. This is a gain, not a break, but it means `index.d.ts` now
  declares symbols a consumer may already have declared by hand.

- **`listen()` changed signature:**
  `listen(port, hostname?, message?)` → `listen(port, options?: { host?, message?, server? })`.
  A string port (`listen('3000')`) is no longer accepted.

- **The four parser accumulators are gone:** `adapter.json()`,
  `adapter.urlencoded()`, `adapter.raw()`, `adapter.text()`. Use
  `bodyParser(options)` — or, from an application, `http.json()` and friends.

  **Read this before migrating:** a `bodyParser` option that is present but not
  `false` installs _all_ applicable parsers, because the check is
  `options.urlencoded !== false` and an absent key is `undefined`. So
  `bodyParser({ json: true })` installs json, urlencoded, text **and** raw. Pass
  explicit `false` for the ones you do not want:

  ```ts
  bodyParser({ json: true, urlencoded: false, text: false, raw: false });
  ```

- **`reply(response, body, statusCode?)` is removed.** The reply writer is
  `write(ctx, payload)`, driven by the shared `HttpReply` union in
  `@glandjs/http`.

- **`initialize()` is removed** from the adapter's public surface; the base class
  calls the protected `onInitialize(options?)` and its own `initialize()` is
  idempotent.

- **`enableCors()` is removed from the adapter.** CORS is now
  `HttpCore.enableCors(config)`, and it uses **Gland's own** middleware rather
  than the `cors` package — one implementation, so one application cannot end up
  with five different policies. Defaults match the `cors` package
  (`origin: '*'`, `maxAge: 600`, `preflightContinue: false`,
  `optionsSuccessStatus: 204`, `vary: true`). `credentials: true` combined with
  `origin: '*'` now throws at boot rather than producing a browser-rejected
  response.

- **`set()`, `engine()`, `setViewEngine()` and `setBaseViewsDir()` moved off the
  adapter.** `set()` and `express()` are on `ExpressCore`; views are on
  `HttpCore`.

- **`setGlobalPrefix()` returns `this`** and mounts nothing.

- **`useStaticAssets(path)` → `useStaticAssets(root, options?)`.** `options.prefix`
  becomes the Express mount path and everything else is forwarded verbatim to
  `express.static`.

- **`use(...args)` → `useOne(...args)`.**

- **`ExpressContext` lost `format()`, `jsonp()` and `render()`.** Views are still
  available through `useRaw()` and `app.instance`; `ctx.render()` is gone.

- **`ctx.sse()` now returns a real `SseStream`** and accepts
  `SseStreamOptions`. In `1.0.0-beta` it was a no-op that returned `this`. This
  is a capability gain, but code that used `ctx.sse()` as a chainable no-op will
  not type-check the same way.

- **`ctx.deleteCookie()` returns `this`** instead of `void`.

- **`ctx.redirect(url, status = 302)`.**

- **`ctx.download(filePath, filename?, options?)`** — `filename` is now optional.

- **`ctx.setCookie()` forwards every attribute** except `name`, `secret`,
  `overwrite` and `secureProxy`, instead of an explicit nine-attribute
  allow-list. `undefined` becomes `{}`.

- **`ctx.host` is `req.hostname`**, not `req.host`.

- **`HttpServerAdapter` grew from four type parameters to six.** Any code
  subclassing it directly needs updating.

### Added

- **`ExpressBrokerClass<TEvents>`** — the `Constructor<ExpressBroker>` type, so
  `app.connectTo()` can be typed without writing it out.
- **`ExpressCore.set(key, value)`**, **`ExpressCore.express()`** (the Express
  module itself, for advanced configuration) and **`ExpressCore.matches(prefix, path)`**.
- **`ExpressApp`** (the `Application` type), **`EXPRESS_VERBS`** (the frozen list
  of routable verbs), **`HttpReply`** and **`Readable`** are re-exported so an
  application can reach Express's own helpers and type a streamed reply without
  a deep import.
- **`ctx.getResponseHeader()` and `ctx.hasResponseHeader()`.**
- **`ctx.responded`** — `written || res.headersSent || res.writableEnded`.
- **`useStaticAssets()` honours a `prefix`**, which is how static files are
  served from a path other than the site root.
- **`ctx.sse()`** streams, with `Content-Type: text/event-stream`,
  `Cache-Control: no-cache, no-transform`, `Connection: keep-alive` and
  `X-Accel-Buffering: no`, so nginx does not buffer the stream. Defaults:
  `retry: 3000`, `heartbeat: 15000`.
- **Non-SSE streams use `node:stream/pipelines`, not `pipe`.** A bare `pipe`
  swallows the error and leaves the client with a truncated body behind a `200`
  already on the wire.
- **`close()` calls `server.closeIdleConnections()`** as well as
  `server.close()`. Without it, shutdown waits for every keep-alive connection
  to time out — five seconds by default.
- **Wildcard routes work on both Express 4 and 5 spelling.** A bare `*` is
  rewritten to `*_gland`.
- **Extended verbs (WebDAV and friends) route through a method guard** on
  `all()`, instead of throwing `TypeError: router.propfind is not a function` at
  boot.
- **`import 'reflect-metadata'` now runs when the package is imported.**

### Known issues

- **`ctx.getCookie()` is unreliable when `cookie-parser` is mounted.**
  `ctx.cookies` returns `req.cookies` unchanged if `cookie-parser` populated it,
  but `cookie-parser` fills unsigned cookies with plain strings while the Gland
  type says `{ value, signed }`. `getCookie()` then returns `undefined` for an
  unsigned cookie. Without `cookie-parser` it works, because Gland's own
  `parseCookieHeader` produces the right shape. Untested either way — the shared
  contract suite never mounts `cookie-parser` on the Express transport.
- **`@glandjs/common` is a required `peerDependency` but nothing in this package
  imports it.** The `loadPackage` import left over from `1.0.0-beta`'s
  `enableCors()` is dead. `@glandjs/core` is likewise a runtime `dependency` that
  no source file imports — it arrives transitively through `@glandjs/http`.
- **Dead fields remain in `ExpressAdapter`:** `router` and `usingRouter` are
  declared and an `express.Router()` is still allocated, but neither field is
  read or written after the prefix fix.
- **`inflate`, `verify`, `shouldParse` and `json.strictEntities` are declared in
  `BodyParserOptions` and ignored by this adapter.** The top-level `limit` is only
  a per-parser fallback, so the documented 100 kB default is not enforced here —
  Express's own default applies.
- **`multipart` throws at configuration time**, naming `multer` and
  `app.useRaw(uploader)`.
- **`await next()` resolves at the hand-off.** Express's `next()` cannot be
  awaited, so an upstream `try`/`catch` cannot see a downstream `throw`. The
  error still reaches the error handler — `next(err)` is called for you — but
  nothing can be measured or transformed after the hand-off. Use
  `app.on(HttpEvent.RequestEnd, …)` instead. This adapter is the only one of the
  five with this caveat.

## 1.0.0-beta

- Added `TEvents` type parameters to `ExpressAdapter`, `ExpressBroker` and
  `ExpressContext`.
- `ExpressContext` grew from an empty class to roughly fifty members: request,
  response, cookie, body, file and header accessors, plus `format()`, `jsonp()`,
  `sse()` and `render()`.
- `ExpressAdapter` gained `json()`, `urlencoded()`, `raw()` and `text()`
  accumulators and a `parserMiddleware` array.
- CORS moved from a hard `import cors from 'cors'` to `loadPackage('cors')`, and
  the `cors` runtime dependency was dropped.
- `req.ctx` moved from the adapter's constructor into `listen()`, and hung on
  `ExpressContext` instead of the base `HttpContext`.
- Dependencies moved to `@glandjs/{events,core,common,http}` on the `1.x` line;
  `reflect-metadata` narrowed to `^0.2.2`.

### What `1.0.0-beta` could not do

Worth stating plainly, because the version number suggests otherwise: it
registered no controller routes at all (the `payload.meta.path` bug above), and
its CORS middleware read response headers as though they were request headers,
so CORS could not have worked. It was usable only for manual
`app.get()`-style routing.

## 1.0.0-alpha

- Initial release. Five modules shipped: `ExpressAdapter`, an **empty**
  `ExpressContext`, `ExpressCore`, `ExpressBroker`, and a root barrel exporting
  only `./broker` and `./context`.
- The adapter hung a base `HttpContext` on `req.ctx` from a middleware mounted in
  its constructor, and used the real `cors` package as a runtime dependency.
- `setGlobalPrefix()` mounted an empty router — the origin of the double-prefix
  bug, already present here.
- `listen()` used `events.request('options', {}, 'first')` to fetch settings.
- `cors@^2.8.5` was a runtime dependency; `@glandjs/*` were pinned to the alpha
  line.
