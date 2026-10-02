# Architecture

Gland's HTTP layer is five ideas stacked on each other. Reading them in order
explains almost every decision in the codebase, and — more usefully — explains
why each adapter is as small as it is.

```
  ┌──────────────────────────────────────────────────────────────┐
  │  Your application                                            │
  │  @Controller() · @Get() · @Channel() · @On()                 │
  └───────────────┬──────────────────────────────────────────────┘
                  │ the binder broadcasts every route it finds
                  │ on "gland:define:route"
  ┌───────────────▼──────────────────────────────────────────────┐
  │  @glandjs/http — no framework, no server, no router          │
  │                                                              │
  │  contracts/   what a handler may return, what middleware is   │
  │  adapter/     the machinery every adapter shares              │
  │  middleware/  CORS, problem details, the error handler       │
  │  utils/       path normalisation, reply coercion, cookies    │
  └───────────────┬──────────────────────────────────────────────┘
                  │ HttpServerAdapter — one abstract class
  ┌───────────────▼──────────────────────────────────────────────┐
  │  @glandjs/express · fastify · koa · hono · node              │
  │  each: a framework instance, a context, a request listener    │
  └──────────────────────────────────────────────────────────────┘
```

## 1. The core owns the behaviour; the adapter owns the framework

The split is the whole design, and it is worth being precise about where the
line falls.

**In `@glandjs/http`,** because it must be identical everywhere:

- coercing a handler's return value into a body
- the middleware onion and its path scoping
- the request lifecycle events
- the `404` and the error renderer
- CORS, the cookie header, path normalisation, SSE framing

**In an adapter**, because only the framework knows how:

- building a context for a request
- putting a route on a router
- mounting one framework-native middleware
- writing a resolved reply to a response
- binding and releasing the socket

That split is why an adapter is a few hundred lines rather than a few thousand.
It is also the reason the layer can be tested once and trusted five times:
`test/integration/adapters.spec.ts` runs one suite of assertions against five
servers, and a case that passes on four and fails on one is a hole in the
abstraction rather than a framework quirk.

## 2. A handler returns a value, not a response

The alternative is a controller reaching for `res`. Gland's answer is that a
handler's **return value is the response**, and one shared function decides what
each value means.

```ts
return { id: 1 }; // application/json
return 'done'; // text/plain
return Readable.from(parts); // streamed
return HttpReply.json(body, { status }); // anything else, explicitly
return ctx.throw(404, { detail: '…' }); // RFC 7807 problem details
return ctx.redirect('/there'); // 302 with a Location
return; // the handler already answered
```

Every adapter funnels that through `toReplyPayload()` and its own `write()`.
It is why `return 42` means `42` on Express and on Hono rather than a JSON
`42` on one and a bare `42` on the other, and it is why a controller has no
`res` and therefore no reason to care which framework is underneath.

The one consequence worth stating: the write methods are fluent and return
`this`, so `return ctx.redirect(url)` is a natural thing to write. `HttpContext`
therefore tracks a `written` flag, and the pipeline skips a handler that has
already answered. Without it the pipeline tries to serialise the context
itself, hits its circular references, and answers a `500` to a handler that
actually sent a `302`.

## 3. Ordering is decided once, by buffering

The order a user writes things in is not the order they have to take effect in:

```ts
const http = app.connectTo(ExpressBroker); // ← routes arrive here
http.use(auth); // ← middleware arrives here
http.listen(3000); // ← everything mounts now
```

`connectTo()` has to come first — it is what produces the application you are
configuring — so the binder's routes are registered _before_ the middleware is
declared. Mounting either eagerly gets the other wrong: Express skips
middleware mounted after a matching route, and Koa's router does not exist until
it is mounted.

So both are buffered and mounted together, in a fixed order, at `listen()`:

| #   | Step                 | Why here                                                      |
| --- | -------------------- | ------------------------------------------------------------- |
| 1   | `onInitialize`       | framework settings, the error and 404 handlers                |
| 2   | the middleware queue | in call order, so `use()` and `useRaw()` interleave correctly |
| 3   | `afterMiddleware`    | for Fastify, whose hook chain is sealed once                  |
| 4   | deferred plugins     | must land after middleware and before routes                  |
| 5   | the routes           |                                                               |
| 6   | `afterRoutes`        | the catch-all 404, which has to be _behind_ the routes        |

The order is the same on every adapter, which is what makes the API
order-independent. A `204` from step 6 for every request is what happens if the
404 is mounted at step 2 instead.

## 4. The context is abstract, and that is load-bearing

`HttpContext` is an abstract class rather than a set of free functions. That
looks like a style choice and is not: an adapter **cannot** implement it
partially, because TypeScript will not let a `KoaContext` forget
`subdomains()`. It is the guarantee that makes changing a transport a refactor
rather than a rewrite.

Two members carry more weight than their size suggests.

**`params` is re-synced immediately before the handler.** Express fills
`req.params` inside the route handler, and Koa's router sets `ctx.params` on
Koa's own context — but a Gland middleware reached the context _first_, and that
is the one memoised for the request. Without the re-sync, `ctx.params` is `{}`
on every adapter, and a handler reading `ctx.params.id` fails with a confusing
"cannot read property of undefined" rather than an obvious "no such parameter".

**`getHeader` reads the request; `getResponseHeader` reads the response.** The
distinction exists because the first version of `getHeader` read the response,
and every consumer of it — content negotiation, CORS, the body parsers — is
asking what the _client_ sent. `ctx.getHeader('origin')` returned `undefined`
for every real request, so CORS silently never applied.

## 5. The lifecycle bus is observability, not control flow

Every request publishes `http:request:start` and `http:request:end`, and a
listener that throws cannot take the server down. `http:request:end` fires on the
failure path too — otherwise a metrics exporter leaks a counter on exactly the
requests that failed, which is the worst possible time to be wrong.

`safeEmit` checks for a listener first and returns whether one ran. A
listener-free `request:start` would otherwise walk the emitter chain on every
request for nobody.

The bus is deliberately separate from the core's channel bus. Application code
is reached with `ctx.call('db:product:find', id)`; the transport is observed
with `app.on(HttpEvent.RequestEnd, …)`. Keeping them apart is what stops a
lifecycle event from shadowing a channel name.

## Reading order

| Document                                                 | What it answers                                 |
| -------------------------------------------------------- | ----------------------------------------------- |
| [The adapter contract](adapter-contract.md)              | What an adapter implements, and what it may not |
| [The request lifecycle](request-lifecycle.md)            | What happens, in order, for one request         |
| [Writing an adapter](writing-an-adapter.md)              | How to add a sixth transport                    |
| [Differences between adapters](../api/adapter-matrix.md) | What each transport can and cannot do           |
