# Documentation

Gland's HTTP layer in six packages: one framework-agnostic core and a pluggable
adapter per server. The claim this documentation has to support is narrow and
testable — **the same controller, the same middleware and the same assertions
produce the same results on all five transports** — and every page here is
organised around that.

## If you are new here

Read these five, in this order. About twenty minutes, and afterwards nothing in
the rest of this folder will surprise you.

1. **[Getting started](guides/getting-started.md)** — a working service, from `pnpm` to a request
2. **[Controllers and routes](guides/controllers.md)** — how a method becomes a route
3. **[The context](guides/context.md)** — what a handler is handed
4. **[Replies](guides/replies.md)** — what it may return, and what goes on the wire
5. **[Choosing an adapter](guides/adapters.md)** — and then you are done

## Guides

| Guide                                           | Covers                                                   |
| ----------------------------------------------- | -------------------------------------------------------- |
| [Getting started](guides/getting-started.md)    | A working service, from install to a request             |
| [Choosing an adapter](guides/adapters.md)       | The five, and which to reach for                         |
| [Controllers and routes](guides/controllers.md) | Declaring routes, every method, the prefix rules         |
| [The context](guides/context.md)                | `HttpContext`, member by member                          |
| [Middleware](guides/middleware.md)              | The onion, path scoping, `useRaw`, the Express caveat    |
| [Replies](guides/replies.md)                    | What a handler may return, and what goes on the wire     |
| [Errors](guides/errors.md)                      | Problem details, the error handler, what is never leaked |
| [CORS](guides/cors.md)                          | One policy, one implementation, five adapters            |
| [Bodies and uploads](guides/bodies.md)          | The parsers, the limit, the `maxAge` trap                |
| [Lifecycle events](guides/lifecycle-events.md)  | The bus, and the five events worth wiring up             |
| [Deployment](guides/deployment.md)              | TLS, proxies, graceful shutdown, health checks           |
| [Testing](guides/testing.md)                    | Unit vs. integration, and the five-transport contract    |
| [Migrating to 1.1](guides/migration.md)         | What changed, and what to change                         |

## Architecture

What the layer is built from, and why. Read this before changing a shared
behaviour — most of it is load-bearing for a reason that is not obvious from the
code.

| Document                                                   | Covers                                           |
| ---------------------------------------------------------- | ------------------------------------------------ |
| [Overview](architecture/README.md)                         | The five ideas the layer is built from           |
| [The adapter contract](architecture/adapter-contract.md)   | What an adapter implements, and what it does not |
| [The request lifecycle](architecture/request-lifecycle.md) | What happens, in order, for one request          |
| [Writing an adapter](architecture/writing-an-adapter.md)   | Building a sixth transport from the contract     |

## Reference

| Document                                              | Covers                                  |
| ----------------------------------------------------- | --------------------------------------- |
| [API](api/README.md)                                  | Every public export, grouped by package |
| [Differences between adapters](api/adapter-matrix.md) | What each transport can and cannot do   |

## Project

| Document                                    | Covers                                           |
| ------------------------------------------- | ------------------------------------------------ |
| [Contributing](development/CONTRIBUTING.md) | Setup, conventions, branching, releases          |
| [Changelog](CHANGELOG.md)                   | Where the history actually lives                 |
| [Security](SECURITY.md)                     | Reporting a vulnerability, and where the risk is |
| [Code of conduct](CODE_OF_CONDUCT.md)       |                                                  |

## The five adapters

| Package                                                          | Framework   | Middleware onion      | Extended methods   | Runtime                 |
| ---------------------------------------------------------------- | ----------- | --------------------- | ------------------ | ----------------------- |
| [`@glandjs/express`](https://npmjs.com/package/@glandjs/express) | Express 5   | hand-off              | via a method guard | Node                    |
| [`@glandjs/fastify`](https://npmjs.com/package/@glandjs/fastify) | Fastify 5   | real, inside one hook | most WebDAV        | Node                    |
| [`@glandjs/koa`](https://npmjs.com/package/@glandjs/koa)         | Koa 3       | real                  | native             | Node                    |
| [`@glandjs/hono`](https://npmjs.com/package/@glandjs/hono)       | Hono 4      | real                  | native             | Node and the edge       |
| [`@glandjs/node`](https://npmjs.com/package/@glandjs/node)       | `node:http` | real                  | native             | Node, zero dependencies |

Koa is the baseline: it is the one with nothing worth writing down. The other
four each have one row that is not a tick, and it is always a property of the
framework rather than of this layer.

- **Express** — [Middleware → The Express caveat](guides/middleware.md#the-express-caveat)
- **Fastify** — [Adapter matrix → Fastify](api/adapter-matrix.md#fastify-two-methods-have-no-equivalent)
- **Hono** — [Adapter matrix → Hono](api/adapter-matrix.md#hono-a-fetch-response-is-immutable)
- **`node:http`** — [Adapter matrix → `node:http`](api/adapter-matrix.md#nodehttp-no-framework-to-reach-into)

## Conventions used in these pages

- `app` is the Gland application, `http` the connected HTTP layer. `ctx` is
  always the framework-agnostic context, never `req` or `res`.
- A table cell in **bold** is a limit, not a feature.
- "Built in" in a table means _no package to install_ — not _mounted for you_.
  Every adapter needs a declared body parser; see
  [Bodies and uploads](guides/bodies.md).
