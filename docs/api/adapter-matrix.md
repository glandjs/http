# Differences between adapters

Everything in the contract behaves identically on all five transports, and
`test/integration/adapters.spec.ts` enforces it. This page is the honest
remainder: what each transport cannot do, and what to use instead.

## The matrix

|                                          | express           | fastify                | koa                  | hono                | node         |
| ---------------------------------------- | ----------------- | ---------------------- | -------------------- | ------------------- | ------------ |
| Framework                                | Express 5         | Fastify 5              | Koa 3                | Hono 4              | `node:http`  |
| Runtime                                  | Node              | Node                   | Node                 | Node, edge          | Node         |
| Extra runtime deps                       | `express`         | `fastify`              | `koa`, `@koa/router` | `hono`              | **none**     |
| `await next()` waits                     | **no**            | yes                    | yes                  | yes                 | yes          |
| Upstream `catch` sees a downstream throw | **no**            | yes                    | yes                  | yes                 | yes          |
| `useRaw`                                 | yes               | **no**                 | yes                  | yes, headers only   | **no**       |
| A real catch-all route                   | yes               | yes                    | yes                  | yes                 | yes          |
| WebDAV verbs                             | via a guard       | most                   | native               | native              | native       |
| `PROPFIND`, `SEARCH`                     | yes               | yes                    | yes                  | yes                 | yes          |
| `MKWORKSPACE`, `UPDATE`                  | yes               | **no**                 | yes                  | yes                 | yes          |
| Signed cookies                           | with a middleware | **no**                 | with a middleware    | **no**              | **no**       |
| Parses without declaring                 | **no**            | removed by the adapter | **no**               | **no**              | **no**       |
| `raw` body (`Buffer`)                    | yes               | yes                    | yes                  | **no**              | yes          |
| Multipart                                | `multer`          | `@fastify/multipart`   | `@koa/multer`        | `c.req.parseBody()` | your own     |
| Static files                             | built in          | `@fastify/static`      | `koa-static`         | `hono/serve-static` | your own     |
| Views                                    | built in          | `@fastify/view`        | `@koa/views`         | your own            | your own     |
| `close()` drains                         | yes               | yes, native            | yes                  | yes                 | yes          |
| Trusts `X-Forwarded-*`                   | `trustProxy`      | `trustProxy`           | `app.proxy`          | runtime-dependent   | `trustProxy` |

## The four that differ

Everything below is a consequence of the framework, not of Gland. Koa is the
baseline: it has no row here because nothing about it needs one.

### Express: `await next()` resolves early

Express's `next()` is a hand-off. The bridge resolves as soon as Express moves
downstream, so an upstream `try`/`catch` cannot see a downstream throw.

Still works: `next(err)`, the error handler, path scoping, ordering.
Does not: measuring or transforming anything after the hand-off, from upstream.

The Gland onion is real on Fastify (one composed `preHandler` hook), Koa, Hono
and `node:http`. See
[Middleware → The Express caveat](../guides/middleware.md#the-express-caveat) for
the workarounds.

### Fastify: two methods have no equivalent

Fastify 5 routes only its own default set, and `addHttpMethod()` refuses
anything outside `node:http#METHODS`. `PROPFIND` and `SEARCH` are in that list
and work. `MKWORKSPACE` and `UPDATE` are not, and the adapter says so at boot:

```
[HTTP:Fastify] WARN Fastify cannot route "MKWORKSPACE" (Provided method is invalid!).
  The method is not in node:http#METHODS, so it has no Fastify equivalent. Use
  @glandjs/express, @glandjs/koa, @glandjs/hono or @glandjs/node if the application
  needs it.
```

And `useRaw()` has no meaning: Fastify has no `use()`. The adapter warns and
points at `app.fastify.register(...)`.

### Fastify: the one parser that starts on

Every adapter installs nothing until a parser is declared. Fastify is the
exception — JSON parsing is built in and enabled by default — so the adapter
calls `removeContentTypeParser('application/json')` when nothing was declared.

The consequence is that Fastify is the only transport whose boot order has to
care about it: the removal is applied in `onInitialize` through `defer()`,
because `HttpCore` calls `bodyParser()` from its constructor and Fastify refuses
to change its content type parsers once `ready()` has run.

See [Bodies and uploads](../guides/bodies.md#one-framework-needs-an-extra-step).

### Hono: a fetch `Response` is immutable

Hono targets edge runtimes, so its `Request` and `Response` are the Fetch API's.
That is a strength — the same code runs on Cloudflare Workers, Deno and Bun — and
it has two consequences.

**`c.res` is replaced, not mutated.** A `useRaw` middleware that sets a header
is merged into the adapter's reply rather than overwriting it, so
`c.header('x-request-id', …)` still reaches the client. What it cannot do is
change the status or the body: a fetch `Response` is immutable and the adapter's
is the one the handler's return value describes.

**No `raw` body.** A fetch body is read as text, and re-buffering it would mean
holding the whole body twice. The adapter warns at boot and `ctx.rawText` carries
what was read.

**`listen()` is Node-only.** On an edge runtime there is nothing to bind, and the
application exports `fetch` instead:

```ts
export default http.hono; // Cloudflare Workers, Deno, Bun
```

### `node:http`: no framework to reach into

`useRaw()` reports that it was ignored — there is no `use()` to call. Static
files and body parsing are native to the adapter; multipart is your own
business.

In exchange there are no runtime dependencies at all, and the package is the
reference implementation of [the contract](../architecture/adapter-contract.md).

## Per-adapter notes

### Express

```ts
app.set('trust proxy', 1); // a setting Gland does not model
app.useRaw(compression()); // fine
app.setViewEngine(require('ejs')); // built in
```

`ctx.send('done')` is `text/plain`, not Express's default `text/html` — the
adapter sets it, so a string reply means the same thing on all five.

### Fastify

```ts
await app.ready(); // plugins load asynchronously
app.fastify.register(require('@fastify/helmet'));
app.json(); // native
```

`app.listen(3000); await app.ready();` before anything that depends on a plugin
being present. `logger` is off by default, because Gland publishes the lifecycle
events and two loggers emitting the same line per request is worse than one.

### Koa

```ts
app.koa.keys = ['a secret']; // for signed cookies
app.useRaw(require('koa-static')('./public'));
```

`poweredBy: false` is a no-op: Koa sets no `X-Powered-By`, and a reverse proxy
that adds one is the proxy's configuration.

### Hono

```ts
export default app.hono; // the edge export
app.useRaw(async (c, next) => {
  c.header('x-a', '1');
  await next();
});
```

`useRaw` is for observing and adding headers, and for short-circuiting by
returning your own `Response`.

### `node:http`

```ts
app.listen(3000, { https: { key, cert } }); // TLS, via ServerFactory
app.useStaticAssets('./public'); // served from the built-in router
```

`ServerFactory.create()` picks `node:https` when `https` is present — and passes
the request listener through, which is the bug it exists to have fixed: creating a
TLS server without a listener produces a server that never answers a request.

## What is identical

The list is worth reading precisely, because it is what the layer promises.

Reply coercion: object → JSON, string → text (sniffed for HTML), number →
JSON, `Buffer` → bytes, readable → piped, `SseStream` → `text/event-stream`,
`HttpReply` → exactly as stated, `undefined` → nothing.

Errors: RFC 7807 problem details, with the message dropped for a non-`HttpException`.

CORS: one implementation, one set of headers, `Vary: Origin` by default, and a
`credentials` + `origin: '*'` contradiction rejected at boot.

Routing: a prefix applied exactly once; `params` populated before the handler
runs; a repeated query key becoming an array; a path that is case-sensitive.

Lifecycle: the same events, on the same lifecycle bus, with the duration computed
after the response.

Shutdown: `close()` drains in-flight requests, is safe when the server was never
started, and reports the resolved port through `http:server:listening`.
