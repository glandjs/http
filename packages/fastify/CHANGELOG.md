# @glandjs/fastify

Release notes for `@glandjs/fastify`. It is released together with
[`@glandjs/http`](../http/CHANGELOG.md), which carries the shared adapter
contract this package implements, and it requires
[`@glandjs/core`](https://www.npmjs.com/package/@glandjs/core) `>= 2.0.0` for
route replay.

The combined history of every package in this repository also lives in
[docs/CHANGELOG.md](../../docs/CHANGELOG.md).

## 1.0.0

First release — and **not** a prerelease of the `1.0.0-alpha` on npm.

> `@glandjs/fastify@1.0.0-alpha` (2025-04-11) was built against an earlier,
> since-removed implementation and an earlier shape of `@glandjs/http`. That
> implementation was deleted from the repository before this one was written, and
> the shared package was reorganised twice in between, so **the two share no
> source line.** Treat the alpha as withdrawn, not as a prerelease of `1.0.0`.
> Upgrading from it is a reinstall, not an upgrade.

Targets **Fastify 5** (`fastify: ^5.2.1`).

### What it provides

- `FastifyBroker` / `FastifyBrokerClass` — the class `app.connectTo()` takes
- `FastifyCore` — the application, with a `fastify` getter for the underlying
  instance
- `FastifyAdapter` — the adapter
- `FastifyContext` — the request context
- `FastifyRouteOptions`, `SseStream` — types

### The middleware chain is one hook, and that is the point

Fastify's hook chain is a **hand-off**: a hook continues it by _returning_. So
mounting one `preHandler` per middleware gives you N independent middlewares
rather than an onion — the outer one finishes before the inner one begins, and a
downstream `throw` never reaches an upstream `catch`.

This adapter overrides `mount()` to record the raw middleware instead of wrapping
it, and `afterMiddleware()` to install **exactly one** `preHandler` that walks the
chain as a promise-based onion:

```ts
// inside afterMiddleware()
this.instance.addHook('preHandler', async (request, reply) => {
  const run = async (index: number): Promise<void> => {
    const entry = chain[index];
    if (!entry) return;
    ctx.next = async (error?: unknown) => {
      if (error) throw error;
      await run(index + 1);
    };
    await entry.middleware(ctx, ctx.next);
  };
  await run(0);
});
```

The observable consequence: **`await next()` really awaits the downstream half,
and an upstream `try`/`catch` really does see a downstream `throw`.** Express is
the only one of the five transports where it does not.

Path scoping is checked per request inside the hook rather than by mounting per
path, so `app.use(['/admin', '/internal'], mw)` mounts one entry.

The design gives up one thing: a Gland middleware cannot short-circuit into a
_Fastify_ hook. That is reachable through `app.fastify` if it is ever needed.

> The class-level JSDoc in `adapter.ts` still says "one hook per middleware …
> the same caveat as Express". That comment is **stale** and contradicts the
> implementation, the README and `docs/api/adapter-matrix.md`. The code is
> authoritative.

### Breaking behaviour

- **Fastify's built-in JSON parser is removed when no parser is declared.** This
  is the most user-visible change in the package. Fastify parses
  `application/json` whether or not it is asked to; the adapter removes the
  content-type parser so that behaviour matches the other four. With it gone, a
  JSON request is answered with **`415 Unsupported Media Type`** before any
  handler runs — which is what `bodyParser: false` is documented to mean.

  If you relied on Fastify's default, declare a parser:

  ```ts
  bodyParser({ json: true });
  ```

  The removal happens inside a `defer()` block because `HttpCore` calls
  `bodyParser()` from its constructor and Fastify refuses to change its parsers
  once `ready()` has run.

- **A form-urlencoded body is parsed as a nested object.** Fastify's default body
  querystring parser is the flat `querystring` one, so `a[b]=1&c=2` produced
  `{ 'a[b]': '1', c: '2' }`. The adapter supplies its own `parseNestedQuery()`,
  giving `{ a: { b: '1' }, c: '2' }` with repeated keys collected into arrays —
  matching every other Gland adapter rather than Express's "last value wins".

### Added

- **The whole adapter contract**, verified against the same ~25 assertions every
  other transport runs.
- **Route registration from the `gland:define:route` broadcast**, reading
  `fullPath`. Wildcards are rewritten to the **named** form (`/files/*` →
  `/files/{splat}`), which Fastify 5 requires.
- **WebDAV and other extended verbs route**, via `addHttpMethod`. A verb that
  `node:http#METHODS` does not list (`MKWORKSPACE`, `UPDATE`) is reported with a
  warning **at boot**, naming the alternative adapters — because a route that
  cannot be registered is a configuration problem, and finding out in production
  is too late.
- **`ctx.sse()`** — a real `SseStream`. The reply path calls `ctx.res.hijack()`
  before piping to `ctx.res.raw`; writing through `reply` instead would run the
  stream back through Fastify's serializer, which cannot handle an
  already-piped body.
- **`ctx.body` reads four places, not one:** `req.body`, then `bodyAsText`, then
  `bodyAsBuffer`. So `ctx.body` is never `undefined` just because the request
  arrived as `text/plain`.
- **Static assets via `@fastify/static`,** an optional peer, registered lazily so
  a hook can still read the request for logging.
- **Cookies via `@fastify/cookie`,** an optional peer. `maxAge` is converted from
  **milliseconds to seconds** — forwarding the number unchanged produces a cookie
  that expires in under a millisecond.
- **A full request context**: `body`, `path`, `method`, `query`, `headers`,
  `cookies`, `ip`, `protocol`, `secure`, `hostname`, `accepts()`/`is()`,
  `status()`, `send()`, `json()`, `html()`, `text()`, `xml()`, `end()`,
  `redirect()`, `sendFile()`, `download()`, the cookie methods, `vary()`,
  `attachment()`, `location()`, and the request/response header split.
- **Errors render as RFC 7807 problem details** through one `setErrorHandler`,
  covering both a handler throw and a `throw` inside the Gland chain, since
  Fastify routes both through its own handler. An error carrying a 400–599
  `status`/`statusCode` renders with that status.
- **`listen()` awaits `instance.ready()` first.** Without it, a `listen()` racing
  plugin registration throws `FST_ERR_INSTANCE_ALREADY_LISTENING`, and the failure
  surfaces as an unhandled rejection rather than as a boot error.
- **`close()` awaits `instance.close()`,** which refuses new requests and drains
  in-flight ones — the correct shutdown order, and the reason it is not a plain
  `server.close()`.
- **`poweredBy: false` disables `x-powered-by`,** guarded on
  `typeof disable === 'function'` — not every 5.x build has it, and a missing
  method is no reason to fail the boot.
- **`trustProxy` and `https` are passed as constructor options,** because Fastify
  has no `instance.set()`.
- **Logging is off by default** (`logger: false`). Gland publishes
  `request:start` and `request:end`, and two loggers emitting the same line per
  request is worse than one.

### Deliberate limitations

- **`useRaw()` has no meaning** and warns. Fastify has no `use()`; use
  `app.fastify.register(...)`.
- **No signed cookies** — `signedCookies` returns `{}`.
- **Multipart, views and cookie signing need `@fastify/multipart`,
  `@fastify/view` and `@fastify/cookie`.**
- **An unmatched request never enters the Gland onion.** `setNotFoundHandler`
  answers it, so a `preHandler` hook does not run for a 404. (Node is the
  opposite — its chain runs for every request.)
- **`ctx.sendFile()` reports byte-range options as unsupported** through
  `loggerUnsupported`, because Fastify's `sendFile` does not take `start`/`end`.

### Known issues

- **`peerDependenciesMeta` marks `@fastify/cookie`, `@fastify/formbody` and
  `@fastify/static` optional, but none of them appears in `peerDependencies`** —
  they are `devDependencies`. The metadata is inert. At runtime the adapter does
  `require()` them lazily and throws a named error if one is missing, so the
  _behaviour_ is optional-peer-like; the _manifest_ does not say so.
  `docs/guides/adapters.md` describes them as "peer dependencies marked
  optional", which is not what the file says.
- **`this.publishConfig` is absent from this manifest**, unlike every other
  package in the repository, and `.changeset/config.json` says
  `"access": "restricted"`. Worth aligning before release.
- **`declareMethod`'s comment says `hasBody: false`; the code passes
  `hasBody: true`.** The comment is stale.
- **`HttpCore.system()` and `ApplicationEventMap` are gone** with no replacement
  escape hatch.
- **No SSE, cookie-signing, static-file or multipart assertion** exists in the
  shared contract suite.
- **`@glandjs/common` is a required `peerDependency` but no source file in this
  package imports it.**
- **`@glandjs/core` is a runtime `dependency` that no source file imports
  directly** — it arrives transitively through `@glandjs/http`.
