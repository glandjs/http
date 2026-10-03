# @glandjs/http

Release notes for `@glandjs/http` — the framework-agnostic HTTP layer that every
adapter in this repository implements. It carries the adapter contract, the reply
union, the middleware onion and the built-in CORS and error handling.

It is released together with the adapters, and it requires
[`@glandjs/core`](https://www.npmjs.com/package/@glandjs/core) `>= 2.0.0` for
route replay.

The combined history of every package in this repository also lives in
[docs/CHANGELOG.md](../../docs/CHANGELOG.md).

## 2.0.0

First stable release. This is a large rewrite: the package is reorganised, the
adapter contract is explicit rather than emergent, and four defects that made the
`1.0.0-beta` adapters unusable are fixed.

### Fixed

- **`HttpBroker` read a route field the core does not emit, so no controller
  route ever registered.** The published `1.0.0-beta` did
  `this.instance[payload.method.toLowerCase()](payload.meta.path, payload.action)`.
  `meta` was removed from the route payload when the channel registry landed in
  `@glandjs/core`. Only manual `app.get()`-style calls worked, and the symptom
  was a `404` on every endpoint. `HttpBroker` now reads `route.fullPath`, passes
  `route.method` through **upper-case**, validates the payload with
  `isGlandRoute()`, and warns-and-skips a malformed one instead of throwing
  mid-bootstrap.

  ```ts
  // 1.0.0-beta
  const path = payload.meta.path;

  // 2.0.0
  const path = route.fullPath ?? route.path;
  ```

- **`HttpCore.settings` returned `undefined`.** The beta's getter was literally
  `get settings() { return; }`. It now returns `HttpApplicationSettings`
  (`prefix`, `port`, `views`, `routeCount`, `middlewareCount`, `poweredBy`,
  `options`).

- **`ServerFactory.create` dropped the HTTPS listener.** For `options.https` it
  called `createServer(options.https)` with no listener attached, so an HTTPS
  server accepted connections and never answered. It now passes the listener
  through, and adds `ServerFactory.isSecure()`.

  `extractHttpOptions()` also strips Gland's own `noErrorListener` before handing
  options to `node:http`, which would otherwise have thrown on an unknown
  option.

- **`ctx.getHeader()` and `ctx.hasHeader()` read the _response_ header.** Every
  caller was wrong — CORS, content negotiation and auth middleware were all
  asking what the server had set rather than what the client sent. They now read
  the **request**; `ctx.getResponseHeader()` and `ctx.hasResponseHeader()` were
  added for the response.

  This also fixed `ctx.throw()` and `errorHandler`, which were testing
  `getHeader('content-type')` — the request's type — to decide what to write. They
  now test the response and emit `application/problem+json; charset=utf-8`
  instead of `application/json`.

- **The global prefix did nothing at all.** In `1.0.0-beta`, `HttpCore` passed
  the path straight through (`_registerRoute` → `adapter.registerRoute(path)`),
  and the adapters' `setGlobalPrefix()` mounted an **empty** `express.Router()`
  at the prefix while registering routes on the application. So a route declared
  under `prefix: '/api'` was served at `/products` and every prefixed request
  404'd. The prefix is now applied exactly once, by
  `applyPrefix(path, this.globalPrefix)` in `HttpServerAdapter.route()`, and
  `applyPrefix()` is idempotent — so setting both `{ prefix }` and
  `setGlobalPrefix()` does not double it.

### Breaking — the adapter contract is now explicit

Everything below is a change an adapter author has to react to.

- **`initialize()` → `onInitialize(options?)`.** The former is now concrete and
  idempotent; the latter is the abstract hook.

- **Four abstract body-parser methods → one `bodyParser(options | false)`.**
  `json()`, `urlencoded()`, `raw()` and `text()` are gone, replaced by a single
  `BodyParserOptions` object. Note this option **did not exist** in
  `1.0.0-beta` — `HttpApplicationOptions` was `{ https?: HttpsOptions }` — so
  "honouring `bodyParser: false`" is new behaviour, not a fix to a broken one.

- **`enableCors(options)` is removed from the adapter.** CORS is
  `HttpCore.enableCors(config)` backed by `createCorsMiddleware()` — Gland's own
  implementation, not the `cors` package, so one application cannot accumulate
  five different policies. Defaults match the `cors` package (`origin: '*'`,
  `maxAge: 600`, `preflightContinue: false`, `optionsSuccessStatus: 204`,
  `vary: true`). `credentials: true` with `origin: '*'` throws at construction
  rather than producing a browser-rejected response.

- **`handleError(error, message)` → `crash(message, error)`** — arguments
  **swapped**, and it no longer rethrows. Beta's `handleError` did `throw error`,
  so a non-fatal adapter fault became a fatal one.

- **New abstract members every adapter must implement:** `createContext()`,
  `useOne()`, `bridgeGland()`, `write()`, `responded()`, and `close()`. Plus
  `mount()`, which did not exist before this rewrite.

- **`listen(port, hostname?, message?)` → `listen(port, options: ServerListening)`.**

- **`use(...args: any): any` → `use(mw)` / `use(path, mw): this`**, and a separate
  `useRaw(...)`. Beta inferred intent from function arity in the Express adapter,
  which silently mistyped ordinary Express handlers.

- **`HttpContext.body` changed kind.** It was a plain optional field
  (`public body?: any`) an adapter could assign to; it is now
  `public abstract get body(): any`.

- **`HttpContext` type parameters changed:**
  `HttpContext<TRequest, TResponse>` → `HttpContext<TRequest = any, TResponse = any, TEvents extends EventRecord = EventRecord>`.

- **`RouteAction` gained a `TContext` and a `TEvents` parameter** and now takes
  route params: it is `(ctx, ...args)` rather than `(ctx)`.

- **`HttpCore._registerRoute` (private) → `HttpCore.registerRoute(method, path, action, origin?)` (public).**

- **`ctx.cookies` / `ctx.signedCookies` are now `RequestCookies`**
  (`Record<string, { value, signed, tampered? }>`) instead of
  `Dictionary<string>`. `ctx.getCookie(name)` returns `cookies[name]?.value`,
  not the raw value.

- **`ctx.deleteCookie()` returns `this`** instead of `void`.

- **`ctx.redirect(url)` → `ctx.redirect(url, status?)`**; **`ctx.status(HttpStatus)`
  → `ctx.status(HttpStatus | number)`**.

- **`ctx.throw()` now passes `requestId`** to `getProblemDetails()`, and emits
  `application/problem+json`.

- **`NextFunction` is `(error?: unknown) => Promise<void>`**, not
  `() => Promise<void>`.

- **`reflect-metadata` moved out of `dependencies`** and is now peer-only.

- **`SSEStream` → `SseStream`**, and the stub class became a real
  `Readable`-backed stream with `send()`, `event()`, `comment()`, `retry()`,
  `startHeartbeat()`, `close()` and an `isClosed` getter.

- **`HttpEventCore` → `HttpEventBroker`**, **`HttpGlandEvents` → `HttpEventRecord`**,
  **`ContentType` (type) → `ContentTypeValue`**.

### Breaking — the package was reorganised

`packages/http` now reads as a set of named areas instead of a flat pile. Every
deep import that moved is **gone**:

| Old path                                      | New path                                              |
| --------------------------------------------- | ----------------------------------------------------- |
| `interface/app-options.interface`             | `interfaces/app-options.interface`                    |
| `interface/context-options.inteface` _(typo)_ | `interfaces/context-options.interface` _(typo fixed)_ |
| `interface/cors-options.interface`            | `interfaces/cors-options.interface`                   |
| `interface/http-headers.interface`            | `interfaces/http-headers.interface`                   |
| `interface/http-options.interface`            | `interfaces/http-options.interface`                   |
| `interface/next-function.interface`           | `contracts/middleware`                                |
| `types/app-options.types`                     | `interfaces/app-options.interface`                    |
| `types/cors-options.types`                    | `interfaces/cors-options.interface`                   |
| `types/route-action.type`                     | `contracts/route-action`                              |
| `http-events.const`                           | `constants/http-events.const`                         |
| `adapter/http.adapter`                        | `adapter/http-adapter.abstract`                       |
| `adapter/http-events`                         | `adapter/http-event-broker`                           |

The `interface/` and `types/` directories are gone; `types/` was split across
`interfaces/` and the new `contracts/`. Unchanged barrels: `http-core`,
`http-broker`, `decorators`, `enum`, `server`, `context`, `adapter`, `utils`.

### Breaking — removed and renamed symbols

**Removed:** `HttpEventType<T>`, `ApplicationEventMap` (`crashed`, `'router:miss'`,
`'request:failed'`), and — from `HttpContext` — the abstract `format()`,
`jsonp()` and `render()`.

**Renamed:** `SSEStream` → `SseStream`; `HttpEventCore` → `HttpEventBroker`;
`initialize()` → `onInitialize()`; `handleError(error, message)` →
`crash(message, error)`; `HttpGlandEvents` → `HttpEventRecord`; `ContentType`
(type) → `ContentTypeValue`; `HttpCore._registerRoute` →
`HttpCore.registerRoute()`. `HttpCore`'s setters (`setGlobalPrefix`,
`useStaticAssets`, `enableCors`, `setViewEngine`, `use`) now return `this` —
fluent rather than `void`.

**Note on `HttpCore.options()`:** this is **not** a rename. `options` was, and
remains, the `OPTIONS` **verb route** (`public options = (path, action) => this`).
`appOptions` is a brand-new public readonly field holding the application options.
Several docs describe it as a rename; it is not.

### Added

- **`contracts/`** — the types that cross a boundary, separated from the
  interfaces that describe configuration:
  - `middleware.ts` — `NextFunction`, `MiddlewareFunction`,
    `PathMiddlewareFunction`, `ErrorHandlerFunction`
  - `reply.ts` — `ReplyBody`, `ReplyKind`, `ReplyPayload`, `HttpReplyOptions`,
    and the `HttpReply` class with `json()`, `text()`, `html()`, `xml()`,
    `buffer()`, `stream()`, `file()`, `redirect()`, `empty()`
  - `route-action.ts` — `RouteAction` and `RegisteredRoute`
- **`constants/`** — `ContentType` (value object) and `ContentTypeValue`,
  `baseContentType()`, `isJsonContentType()`, `isTextContentType()`,
  `isHtmlContentType()`, `isEventStreamContentType()`; the `HttpEvent` value
  object; and `core-contract.const.ts`, which declares the wire contract with
  `@glandjs/core` (`GLAND_ROUTE_EVENT`, `GlandRoute`, `isGlandRoute()`).
  `GLAND_ROUTE_EVENT` is duplicated as a string literal on purpose, so this
  package is not pinned to one core version.
- **`middleware/`** — `createCorsMiddleware()`, `errorHandler`,
  `withErrors()`, `bodyLimitMiddleware()`, `toHttpException()` and
  `notFoundReply()`. `errorHandler` renders RFC 7807 problem details and drops
  the message of anything that is not an `HttpException` (or an `Error` with a
  4xx/5xx `status`).
- **`utils/path.util.ts`** — `normalizePath()`, `joinPath()`, `applyPrefix()`,
  `paramNames()`, `splitUrl()`, `toNamedWildcard()`.
- **`utils/reply.util.ts`** — `toReplyPayload()`, `contentTypeFor()`,
  `isReadableStream()`, `isSseStream()`, `isBinary()`, `looksLikeHtml()`.
- **`utils/cookie.util.ts`** — `parseCookieHeader()` and `serializeCookie()`
  (`maxAge` is milliseconds here and in `cookies`, and is emitted as seconds).
- **`interfaces/body-parser.interface.ts`** — `BodyParserOptions` with per-format
  sub-options, a shared `limit`, and `inflate` / `verify` / `shouldParse` hooks.
- **Route decorators went from 10 to 21.** Added: `Trace`, `Connect`, `Purge`,
  `Propfind`, `Proppatch`, `Mkcol`, `Copy`, `Move`, `Lock`, `Unlock`, `Acl`,
  `Report`. Several of these existed as verb methods and `RequestMethod` members
  but had **no decorator**, which is the drift the new `routeDecorator()` factory
  removes. `@Get()` and `@Get(undefined)` now register the same path.
- **`RequestMethod` grew from 16 to 30 members** — `CONNECT`, `TRACE`, `PURGE`,
  `BIND`, `REBIND`, `UNBIND`, `CHECKOUT`, `MERGE`, `MKACTIVITY`, `MKWORKSPACE`,
  `UPDATE`, `NOTIFY`, `SUBSCRIBE`, `UNSUBSCRIBE` among them. `ALL` is now
  explicitly documented as **not a wire method**.
- **`HttpServerAdapter` exposes its whole pipeline:** `initialize()`,
  `finalize()`, `flush()`, `beforeFlush()`, `afterMiddleware()`,
  `afterRoutes()`, `defer()`, `route()`, `dispatch()`, `respond()`,
  `notFound()`, `safelyRenderError()`, `crash()`, `setGlobalPrefix()`,
  `setViewEngine()`, `mount()`, `syncParams()`, plus the read-only `queue`,
  `routes`, `routeTable`, `id`, `app`, `port`, `prefix` and the
  `isInitialized` / `isFinalized` / `isClosed` flags. The mount order is fixed
  and documented: `onInitialize → flush → afterMiddleware → flushDeferred →
flushRoutes → afterRoutes`.
- **`HttpContext` gained** `next`, `elapsed`, `lifecycle`, `requestId`,
  `startedAt`, `aborted`, `written` and an abstract `responded`.
- **`HttpCore` gained** `appOptions`, a public `adapter`, `instance`, a working
  `settings`, `routes`, `middleware`, `ready()`, `port()`, `close()`, `useRaw()`,
  `setErrorHandler()`, `bodyParser()`, `multipart()`, `trace()`, `connect()`,
  `purge()`, `acl()`, `report()`, `on()` and `off()`.
- **`HttpBroker.assertRoutesArrived()`** — when an adapter receives zero routes it
  logs a diagnostic naming the likely cause (a `@glandjs/core` without route
  replay) instead of starting a server that 404s everything.
- **`HttpEventBroker.safeEmit()` is a real "has listeners" check**, and
  `observe(event, listener)` returns an unsubscribe function.
- **SSE headers** are set on every adapter: `Content-Type: text/event-stream`,
  `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
  `X-Accel-Buffering: no` (the last so nginx does not buffer the stream).
  Defaults: `retry: 3000`, `heartbeat: 15000`.
- **`CookieOptions` gained `priority` and `partitioned`**; the header table gained
  `content-security-policy`, `keep-alive`, `te`, `x-forwarded-for`,
  `x-forwarded-host`, `x-forwarded-proto`, `x-request-id` and `x-correlation-id`,
  and lost `tk`.

### Deprecated

`HTTP_EVENTS`, `RouterEvent`, `PipelineEvent` and `MiddlewareEvent` are still
exported, and still carry the same string values as `1.0.0-beta`. They are
**deprecated aliases, not removals**. `MiddlewareEvent` has no equivalent —
middleware execution is no longer a separately observable event, it is part of
the request.

> **Caveat worth knowing before you rely on them:** `app.on('router:register', …)` > **will not compile.** `HttpCore.on()` is constrained to
> `keyof (TEvents & HttpEventRecord) & string`, and the deprecated unprefixed
> strings are not in it. `docs/guides/migration.md` claims they are still
> accepted; that is incorrect. Migrate to `HttpEvent.*`.

### Known issues

These are defects found while verifying this release. They are listed rather than
fixed so they are not lost.

- **`bodyLimitMiddleware` is exported but no adapter wires it up.** It is
  referenced in `packages/http/README.md` under the name **`bodyLimit`**, which
  does not exist. The Hono adapter in particular enforces **no body-size limit**.
- **`HttpEvent.Options` is never emitted.** `HttpServerAdapter.replayOptions()`
  exists and is called by nobody, and its doc comment claims the event fires
  during `HttpCore`'s constructor. It does not.
- **`GLAND_CHANNEL_EVENT`, `GlandContextState`, `GlandEvents` and
  `isAttachedContext`** are exported from the package root and used nowhere in
  this repository. They are public surface that is entirely untested.
- **`toNamedWildcard('/files/*', 'splat')` produces `/files/*splat`, not
  `/files/{splat}`.** The doc comment says the latter; the unit test asserts the
  former. The implementation is correct for Express; the comment is wrong.
- **`core-contract.const.ts` cites `test/unit/core-contract.spec.ts`, which does
  not exist.** `test/unit/` holds `router.spec.ts`, `http-core.spec.ts` and
  `events.spec.ts`.
- **`utils/sse-stream.ts` shows `ctx.events.once(...)` in an example**, but
  `events` is `protected` on `HttpContext`. The public accessor is
  `ctx.lifecycle`.
- **`HttpCore.system()` is gone** with `ApplicationEventMap`, and nothing replaced
  the escape hatch it provided.

## 1.0.0-beta

- The first published `@glandjs/http`. It carried the adapter contract, an
  `HttpCore` with per-format parser accumulators (`json()`, `urlencoded()`,
  `raw()`, `text()`), CORS via the `cors` package loaded through
  `loadPackage()`, and a `SseStream` that was an empty stub class.
- `HttpApplicationOptions` was `{ https?: HttpsOptions }` — there was no
  `bodyParser`, `prefix`, `trustProxy` or `poweredBy` option.
- It shipped the four defects listed under "Fixed" above, most consequentially the
  route-registration one: **`1.0.0-beta` could not serve a single controller
  route.**

## 1.0.0-alpha

- Initial release. Published 2025-04-11 alongside `@glandjs/express@1.0.0-alpha`
  and `@glandjs/fastify@1.0.0-alpha` from a single release commit.
