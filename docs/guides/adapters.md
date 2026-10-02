# Choosing an adapter

All five speak the same protocol: the same controller, the same middleware, the
same return values, the same errors. What differs is the framework underneath,
and — more usefully — the things a framework genuinely cannot do.

## The five

| Package            | Framework   | Install                  | Runtime                             |
| ------------------ | ----------- | ------------------------ | ----------------------------------- |
| `@glandjs/express` | Express 5   | `npm i @glandjs/express` | Node                                |
| `@glandjs/fastify` | Fastify 5   | `npm i @glandjs/fastify` | Node                                |
| `@glandjs/koa`     | Koa 3       | `npm i @glandjs/koa`     | Node                                |
| `@glandjs/hono`    | Hono 4      | `npm i @glandjs/hono`    | Node, Cloudflare Workers, Deno, Bun |
| `@glandjs/node`    | `node:http` | `npm i @glandjs/node`    | Node, **zero dependencies**         |

## Which one

**Already on Express.** Stay on it. The migration risk is low, the ecosystem is
the largest, and the one thing you give up — a middleware that cannot await what
comes after it — is documented and has a workaround
([below](#the-express-caveat)).

**Starting fresh, and throughput is the concern.** Fastify. Its router is
`find-my-way`, it serialises with `JSON.stringify` rather than `JSON.parse`, and
it has a real plugin ecosystem for the things Express has a hundred small
packages for.

**You want the middleware model to just be right.** Koa. Its onion is the model
this layer was written against, so the adapter is the thinnest here and
`await next()` means what it says.

**You deploy to the edge.** Hono. It is the only adapter that runs on a Fetch
`Request`, so the same code runs on Cloudflare Workers, Deno and Bun with no
Node shim. [What that costs](../api/adapter-matrix.md#hono).

**You want no dependencies at all.** `@glandjs/node`. The router, the reply
writer, the body collector and the cookie serialiser are all in the package. It
is also the reference implementation of
[the adapter contract](../architecture/adapter-contract.md): if a behaviour is
ambiguous, this is where it is defined.

## What each one cannot do

The full table is in the [adapter matrix](../api/adapter-matrix.md). The three
that shape a decision:

### Express: `await next()` resolves early

Express's `next()` is a hand-off, not a call. `await next()` resolves as soon as
Express moves downstream, so an upstream `try`/`catch` cannot see a downstream
throw. The error still reaches the error handler — `next(err)` is called for you
— but you cannot _measure_ or _transform_ what happened after the hand-off.

```ts
// Koa, Hono and node:http — the downstream half has finished.
app.use(async (ctx, next) => {
  const started = Date.now();
  await next();
  metrics.timing('route', Date.now() - started);
});

// Express — `metrics.timing` records the hand-off, not the route.
```

Everything else is identical, and the error path works. Koa, Fastify (via one
composed hook), Hono and `node:http` all give you the real onion.

### Fastify: no WebDAV

Fastify 5 routes only the methods in its own default set, and `addHttpMethod()`
refuses anything outside `node:http#METHODS` — so `PROPFIND` and `SEARCH` work,
and `MKWORKSPACE` and `UPDATE` have no equivalent. The adapter says so at boot
rather than failing the request:

```
[HTTP:Fastify] WARN Fastify cannot route "MKWORKSPACE" (Provided method is invalid!)
```

### `node:http`: no framework middleware

There is no `use()` to call, so `useRaw()` reports that it was ignored. Static
files and body parsing are native to the adapter. Express, Koa and Hono take
`useRaw()`; Fastify takes plugins.

## Sizes

Approximate install cost, for the case where it is the deciding factor:

| Adapter   | Runtime dependencies beyond `@glandjs/http`                                             |
| --------- | --------------------------------------------------------------------------------------- |
| `node`    | none                                                                                    |
| `hono`    | `hono` (+ `@hono/node-server` on Node)                                                  |
| `koa`     | `koa`, `@koa/router` (+ `koa-bodyparser`, `koa-static` if you use them)                 |
| `fastify` | `fastify` (+ `@fastify/cookie`, `@fastify/formbody`, `@fastify/static` if you use them) |
| `express` | `express` (+ `cors`, `cookie-parser`, `compression` if you use them)                    |

The optional packages are optional in the literal sense: they are peer
dependencies marked `optional`, and a feature that needs one throws a message
naming the package rather than failing with `undefined is not a function`.

## They all pass the same tests

`test/integration/adapters.spec.ts` boots one application on five transports and
runs the same twenty-odd assertions against each: reply coercion, HTML sniffing,
a `204`, parameters, a repeated query key, body parsing, a channel call, problem
details, a `500` that leaks nothing, streaming, a `404`, the onion, path scoping,
CORS, a preflight, a cookie, a handler-set header, `PROPFIND`, a redirect.

A case that passes on four adapters and fails on one is a hole in the
abstraction rather than a framework quirk, and the suite is the reason that
distinction stays visible.
