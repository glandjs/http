<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="160" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/fastify" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/fastify.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/fastify" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/fastify.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/fastify" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/fastify.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/fastify</h1>

<p align="center">The Fastify 5 adapter for Gland's HTTP layer.</p>

## Description

`@glandjs/fastify` is the Fastify adapter for Gland's HTTP layer. It contributes
a Fastify instance, a `FastifyContext`, and nothing else — the onion, the request
lifecycle, the reply coercion and the error rendering all come from
`@glandjs/http`.

Fastify is the one framework here whose lifecycle is genuinely asynchronous:
`listen()` returns a promise because plugins are still registering, and `close()`
drains connections rather than dropping them.

## Install

```sh
npm install @glandjs/core @glandjs/common @glandjs/http @glandjs/fastify reflect-metadata
```

Optional, for the features that need them: `@fastify/cookie`, `@fastify/formbody`,
`@fastify/static`.

## Usage

```ts
import { GlandFactory } from '@glandjs/core';
import { FastifyBroker, type FastifyContext } from '@glandjs/fastify';
import { Get } from '@glandjs/http';
import { Controller, Module } from '@glandjs/common';

@Controller('/products')
class ProductController {
  @Get('/:id')
  async find(ctx: FastifyContext) {
    return ctx.call('db:product:find', ctx.params.id);
  }
}

@Module({ controllers: [ProductController] })
class AppModule {}

const { app, shutdown } = await GlandFactory.create(AppModule);
const http = app.connectTo(FastifyBroker, { poweredBy: false });

http.listen(3000);
await http.ready(); // Fastify loads plugins asynchronously
http.fastify.register(require('@fastify/helmet'));
```

## The middleware onion is real here

Fastify has no `use()`, and its hook chain is a hand-off — a hook continues it by
returning. Mounting one hook per Gland middleware would therefore give N
independent middlewares rather than an onion: `outer` would finish before `inner`
began.

So the adapter mounts **one** `preHandler` hook and walks the Gland chain inside
it as a promise-based onion:

```ts
app.use(async (ctx, next) => {
  const started = Date.now();
  await next(); // the downstream half has finished
  metrics.timing('route', Date.now() - started);
});
```

What is given up is the ability for a Gland middleware to short-circuit into a
_Fastify_ hook, which is rare and reachable through `app.fastify` if you need it.

## WebDAV

Fastify 5 routes only its own default method set, and `addHttpMethod()` refuses
anything outside `node:http#METHODS`. So:

|                                                 |                                               |
| ----------------------------------------------- | --------------------------------------------- |
| `PROPFIND`, `SEARCH`, `COPY`, `MOVE`, `LOCK`, … | **work** — declared with `addHttpMethod`      |
| `MKWORKSPACE`, `UPDATE`                         | **no equivalent** — the adapter warns at boot |

```
[HTTP:Fastify] WARN Fastify cannot route "MKWORKSPACE" (Provided method is invalid!).
  The method is not in node:http#METHODS, so it has no Fastify equivalent. Use
  @glandjs/express, @glandjs/koa, @glandjs/hono or @glandjs/node if the application
  needs it.
```

Reported at boot rather than at request time, because a route that cannot be
registered is a configuration problem and a `500` in production is not.

## `useRaw` has no meaning

Fastify has no `use()`. A framework-native middleware is a plugin:

```ts
app.fastify.register(require('@fastify/helmet'));
app.fastify.register(require('@fastify/rate-limit'), { max: 100 });
```

`app.useRaw(...)` is reported and ignored, because a silently-dropped
`compression()` leaves an application that believes it is compressed.

## Logging

Fastify's own logger is off by default. Gland publishes the lifecycle events, and
two loggers emitting the same line per request is worse than one. Turn Fastify's
back on through `app.fastify` if you want it.

## API

| Export                                  | Kind                                           |
| --------------------------------------- | ---------------------------------------------- |
| `FastifyBroker` / `FastifyBrokerClass`  | What `app.connectTo()` takes                   |
| `FastifyCore`                           | The application, with a typed `fastify` getter |
| `FastifyAdapter`                        | The adapter                                    |
| `FastifyContext`, `FastifyRouteOptions` | The context                                    |

The full surface is in the [API reference](../../docs/api/README.md).

## Documentation

- [Choosing an adapter](../../docs/guides/adapters.md)
- [Adapter matrix](../../docs/api/adapter-matrix.md)
- [Middleware](../../docs/guides/middleware.md)

## License

MIT
