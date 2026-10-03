# Changelog

Release notes for Gland's HTTP layer. Each package also has its own
`CHANGELOG.md`, which is excluded from the published tarball — this file and
npm are the two places a consumer will find them.

| Package                                                   | Version | This release      | Per-package changelog                          |
| --------------------------------------------------------- | ------- | ----------------- | ---------------------------------------------- |
| [`@glandjs/http`](../../packages/http/CHANGELOG.md)       | `2.0.0` | rewritten         | [http](../../packages/http/CHANGELOG.md)       |
| [`@glandjs/express`](../../packages/express/CHANGELOG.md) | `2.0.0` | breaking fix      | [express](../../packages/express/CHANGELOG.md) |
| [`@glandjs/fastify`](../../packages/fastify/CHANGELOG.md) | `1.0.0` | **first release** | [fastify](../../packages/fastify/CHANGELOG.md) |
| [`@glandjs/koa`](../../packages/koa/CHANGELOG.md)         | `1.0.0` | **first release** | [koa](../../packages/koa/CHANGELOG.md)         |
| [`@glandjs/hono`](../../packages/hono/CHANGELOG.md)       | `1.0.0` | **first release** | [hono](../../packages/hono/CHANGELOG.md)       |
| [`@glandjs/node`](../../packages/node/CHANGELOG.md)       | `1.0.0` | **first release** | [node](../../packages/node/CHANGELOG.md)       |

## Published history at a glance

Versions come from the npm registry, not from the repository. Several versions
below exist only as tags or as a local manifest value.

| Package            | Last published before this release | Publishing now |
| ------------------ | ---------------------------------- | -------------- |
| `@glandjs/http`    | `1.0.0-beta` (2025-05-17)          | `2.0.0`        |
| `@glandjs/express` | `1.0.0-beta` (2025-05-17)          | `2.0.0`        |
| `@glandjs/fastify` | `1.0.0-alpha` (2025-04-11)         | `1.0.0`        |
| `@glandjs/koa`     | **never published**                | `1.0.0`        |
| `@glandjs/hono`    | **never published**                | `1.0.0`        |
| `@glandjs/node`    | **never published**                | `1.0.0`        |

Earlier versions still on npm: `@glandjs/http` and `@glandjs/express` also have
`1.0.0-alpha.0`, `1.0.0-alpha.1` and `1.0.0-alpha`.

### Why these versions differ

Each package is versioned on **its own** history, not on a shared counter.

- **`http` and `express` → `2.0.0`.** Both had a published `1.0.0-beta` line and
  both have breaking changes against it, so they take a major.
- **`fastify → `1.0.0`, not `2.0.0`.** Its only published version is
  `1.0.0-alpha`, which belonged to an implementation that was deleted from the
  repository. The current adapter shares no source line with it, so on the
  evidence of what actually shipped this is a first release. Upgrading from the
  alpha is a reinstall, not a version bump.
- **`koa`, `hono` and `node` → `1.0.0`.** Never published. Their manifests
  previously read `1.1.0-beta`, a version that never existed on npm.

The `-beta` suffix is dropped across the board: `http` and `express` have shipped
three betas, and the four newer packages never needed one.

## Requires `@glandjs/core` 2.0.0

Every package here depends on `@glandjs/core` `^2.0.0` and peer-depends on
`@glandjs/common` `^2.0.0`. This is not optional.

`HttpBroker` reads `route.fullPath` from the `gland:define:route` broadcast.
`@glandjs/core <= 1.0.3-beta` did not emit that field, so against those versions
**no controller route registers at all** and every endpoint answers `404`. The
adapter reports this itself:

```
This HTTP adapter received no routes from the application binder …
route replay … is not present in @glandjs/core <= 1.0.3-beta.
```

`@glandjs/common` is a required **peer** dependency of all six packages, but no
source file in any of them imports it. It is declared because an application
built on these adapters needs it, not because the adapters call it.

## 2.0.0 — `@glandjs/http`, `@glandjs/express`

**`1.0.0-beta` could not serve a single controller route.** `HttpBroker` read
`payload.meta.path`, a field `@glandjs/core` had stopped emitting when the channel
registry landed. Only manual `app.get()` calls worked, and the symptom was a
`404` on every endpoint. Both packages take a major because of it.

**Migration**

1. Upgrade `@glandjs/core` and `@glandjs/common` to `2.0.0` first. Without that,
   nothing works.

   ```bash
   npm i @glandjs/core@^2 @glandjs/common@^2
   ```

2. `ctx.getHeader()` now reads the **request**. It read the response, so CORS,
   content negotiation and any auth middleware were asking what the server had
   set. `ctx.getResponseHeader()` and `ctx.hasResponseHeader()` were added.

3. The global prefix now works. It did nothing in `1.0.0-beta` — routes went on
   the application while `setGlobalPrefix()` mounted an empty router — so every
   prefixed request 404'd. It is applied once, by an idempotent `applyPrefix()`.

4. `app.on('router:register', …)` no longer compiles. The unprefixed event names
   are still exported as deprecated aliases, but `HttpCore.on()` is typed against
   `HttpEvent.*`:

   ```ts
   // before
   app.on('router:register', handler);
   // after
   app.on(HttpEvent.RouteRegistered, handler);
   ```

   `docs/guides/migration.md` claims the old strings still work. They do not.

5. **Express:** `listen(port, hostname?, message?)` →
   `listen(port, { host?, message?, server? })`.

6. **Express:** the four parser accumulators are gone. Use `bodyParser()`.

   **Read this before you migrate:** a `bodyParser` key that is present but not
   `false` installs _all_ applicable parsers, because the check is
   `options.urlencoded !== false` and an absent key is `undefined`. So
   `bodyParser({ json: true })` installs json, urlencoded, text **and** raw.

   ```ts
   bodyParser({ json: true, urlencoded: false, text: false, raw: false });
   ```

7. **Express:** `ctx.format()`, `ctx.jsonp()` and `ctx.render()` are gone. Views
   are reachable through `useRaw()` and `app.instance`.

8. **Deep imports moved.** `interface/` → `interfaces/`, `types/` split across
   `interfaces/` and `contracts/`, `http-events.const` →
   `constants/http-events.const`, `adapter/http.adapter` →
   `adapter/http-adapter.abstract`, `adapter/http-events` →
   `adapter/http-event-broker`. The full table is in
   [`@glandjs/http`'s changelog](../../packages/http/CHANGELOG.md).

9. **Express** no longer mounts the `cors` package. `enableCors()` on the adapter
   is gone; use `HttpCore.enableCors()`, which is Gland's own middleware.
   `credentials: true` with `origin: '*'` now throws at boot.

## 1.0.0 — `@glandjs/fastify`, `@glandjs/koa`, `@glandjs/hono`, `@glandjs/node`

First releases. Nothing to migrate from, but two behaviours will surprise you if
you assume a framework's defaults.

- **Fastify parses JSON whether or not you ask it to — unless the adapter stops
  it.** With no parser declared, Fastify's built-in `application/json` parser is
  removed and such a request is answered with `415 Unsupported Media Type` before
  any handler runs. Declare `bodyParser({ json: true })` if you relied on the
  default. A form-urlencoded body is also parsed as a nested object
  (`a[b]=1` → `{ a: { b: '1' } }`) rather than Fastify's flat default.

- **`@glandjs/node` serves no static files.** `useStaticAssets()` records the
  option and then warns, because a raw `node:http` adapter has nothing to mount it
  on. Serve them yourself or pick another adapter.

- **Hono's `useRaw()` can add headers but cannot change the status or body**, and
  it does **not** warn. A fetch `Response` is immutable, so a raw middleware may
  observe a reply and add headers, or short-circuit with its own `Response`, but
  cannot amend one the handler already composed. The warning that `useRaw()` was
  ignored exists only on `@glandjs/node` and `@glandjs/fastify`.

## 1.0.0-beta — `@glandjs/http`, `@glandjs/express`

The first public betas, published 2025-05-17. `@glandjs/express` here had an empty
`ExpressContext` sibling in `1.0.0-alpha` that had grown to roughly fifty members,
and an adapter that inferred Gland middleware from function arity. Neither could
serve a controller route — see above.

## 1.0.0-alpha — `@glandjs/http`, `@glandjs/express`, `@glandjs/fastify`

Published 2025-04-11 from a single release commit. `@glandjs/http` and
`@glandjs/express` also have `1.0.0-alpha.0` and `1.0.0-alpha.1` from
2025-03-27.

The `@glandjs/fastify` alpha is **withdrawn**: its implementation was deleted from
the repository, and the Fastify adapter shipping as `1.0.0` was written from
scratch afterwards. The two share no source line.

## Corrections to the changeset notes for this release

Two changeset files in `.changeset/` described this work. Both have been folded
into the per-package changelogs above, and three of their claims did not survive
verification against the published artifacts. Recording the corrections here
because the changesets are the record other people will read:

- **"Express and Koa applied the global prefix twice, producing `/api/api/...`"** —
  in `1.0.0-beta` the prefix was applied **zero** times. `setGlobalPrefix()`
  mounted an empty `express.Router()` at the prefix while `registerRoute()`
  registered on the application. The double-prefix describes a draft of the
  rewrite, not a released state. `@glandjs/koa` was never published at all.
- **"`return ctx.redirect(url)` produced a `500` with a circular-structure
  error"** — not reproducible against `1.0.0-beta`. The Express route handler
  already guarded the write with `if (result !== undefined && !res.headersSent)`.
  The _machinery_ that makes a double reply safe (`written`, `markWritten()`,
  `responded`) is new and worth having, but it is not a fix to an observed
  `1.0.0-beta` failure.
- **"`bodyParser: false` is now honoured everywhere"** — `HttpApplicationOptions`
  in `1.0.0-beta` was `{ https?: HttpsOptions }`. There was no `bodyParser` key
  to ignore. No parser was installed unless you called `app.json()` and friends.
- **"`mount()` in the base adapter discarded the bridged handler"** — no `mount()`
  existed on `HttpServerAdapter` before this rewrite; `use()` was abstract and each
  adapter implemented it.

See also: the [architecture notes](architecture/README.md), the
[adapter matrix](api/adapter-matrix.md), and the
[migration guide](guides/migration.md).
