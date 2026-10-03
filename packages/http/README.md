<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="160" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/http.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/http.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/http.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/http</h1>

<p align="center">The framework-agnostic HTTP layer for Gland: the contracts an adapter implements, and the behaviour every adapter shares.</p>

## Description

> What if HTTP was just another event?

`@glandjs/http` contains **no server, no router and no framework import**. It is
three things:

- **the contracts** — what a handler may return, what a middleware is, what a
  route is
- **the machinery** — the request pipeline, the middleware onion, the lifecycle
  bus, the error renderer, the CORS policy
- **the decorators** — so a controller can declare a route without knowing how it
  will be served

Everything that has to be identical across transports lives here. Everything that
needs framework knowledge lives in an adapter.

| Package                          | Framework   | Middleware onion | Runtime                 |
| -------------------------------- | ----------- | ---------------- | ----------------------- |
| [`@glandjs/express`](../express) | Express 5   | hand-off         | Node                    |
| [`@glandjs/fastify`](../fastify) | Fastify 5   | real             | Node                    |
| [`@glandjs/koa`](../koa)         | Koa 3       | real             | Node                    |
| [`@glandjs/hono`](../hono)       | Hono 4      | real             | Node and the edge       |
| [`@glandjs/node`](../node)       | `node:http` | real             | Node, zero dependencies |

## Install

```sh
npm install @glandjs/http
```

You also need a transport, `@glandjs/core`, `@glandjs/common` and
`reflect-metadata`.

## Usage

`@glandjs/http` is used through an adapter; there is nothing to construct here
except the decorators and the middleware.

```ts
import { Get, Post, HttpReply, HttpEvent, withErrors, bodyLimitMiddleware } from '@glandjs/http';

@Controller('/orders')
class OrderController {
  @Get('/:id')
  async find(ctx) {
    const order = await ctx.call('db:order:find', ctx.params.id);
    if (!order) return ctx.throw(404, { detail: 'No such order' });
    return order; // an object becomes JSON
  }

  @Post('/')
  async create(ctx) {
    return HttpReply.json(await ctx.call('db:order:create', ctx.body), { status: 201 });
  }
}
```

## What a handler may return

One function decides, and every adapter writes the result the same way.

| Returned                          | Written as                                          |
| --------------------------------- | --------------------------------------------------- |
| an object, array, number, boolean | `application/json`                                  |
| a string                          | `text/plain`, or `text/html` if it sniffs as markup |
| a `Buffer`                        | raw bytes                                           |
| a `Readable`                      | piped to the socket                                 |
| an `SseStream`                    | `text/event-stream`, with a heartbeat               |
| a `HttpReply`                     | exactly what it says                                |
| `undefined` / `null`              | nothing — the handler already answered              |

That is why `return 42` means `42` on Express and on Hono rather than a JSON
`42` on one and a bare `42` on the other.

## What this package owns

|                                                                       |                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `HttpCore`                                                            | the application: routes, middleware, parsers, `listen`, `close` |
| `HttpBroker`                                                          | what `app.connectTo()` takes; registers the binder's routes     |
| `HttpServerAdapter`                                                   | the contract an adapter implements                              |
| `HttpContext`                                                         | the whole request surface, abstract, and identical everywhere   |
| `HttpReply`                                                           | an explicit reply                                               |
| `createCorsMiddleware`                                                | one CORS policy for every adapter                               |
| `errorHandler`, `withErrors`, `bodyLimitMiddleware`                   | the error and body primitives                                   |
| `SseStream`                                                           | a correctly framed event stream                                 |
| `toReplyPayload`, `normalizePath`, `applyPrefix`, `parseCookieHeader` | the shared decisions                                            |
| `Get`, `Post`, `Propfind`, …                                          | the route decorators                                            |

## Errors

RFC 7807 problem details, and the default renderer **drops the message of
anything that is not an `HttpException`** — a stack trace, a SQL fragment or a
file path in a response body is a disclosure bug. Log it on
`http:request:error`; do not send it.

```ts
ctx.throw(404, { detail: 'No such product', type: 'https://errors.example.com/product' });
```

## Lifecycle

```ts
app.on(HttpEvent.RequestStart, ({ method, path }) => metrics.count(`${method} ${path}`));
app.on(HttpEvent.RequestEnd, ({ method, path, status, duration }) => metrics.timing('http.request', duration, { method, path, status }));
```

`RequestEnd` fires on the failure path too, so a counter cannot leak on exactly
the requests that failed.

## Ordering

Routes and middleware are both buffered and mounted together at `listen()`, in a
fixed order — framework configuration, the middleware queue in call order,
plugins, the routes, and finally the catch-all 404. That is what makes this work
regardless of the order you wrote things in:

```ts
const http = app.connectTo(ExpressBroker); // ← routes arrive here
http.use(auth); // ← middleware arrives here
http.listen(3000); // ← everything mounts now
```

## Documentation

- [Architecture → Overview](../../docs/architecture/README.md) - the five ideas
- [The adapter contract](../../docs/architecture/adapter-contract.md) - what an
  adapter implements
- [Writing an adapter](../../docs/architecture/writing-an-adapter.md)
- [Replies](../../docs/guides/replies.md), [Errors](../../docs/guides/errors.md),
  [CORS](../../docs/guides/cors.md)
- [Lifecycle events](../../docs/guides/lifecycle-events.md) - the bus, and what
  is worth listening to
- [API reference](../../docs/api/README.md)

## License

MIT
