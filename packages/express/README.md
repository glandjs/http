<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="160" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/express" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/express.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/express" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/express.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/express" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/express.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/express</h1>

<p align="center">The Express 5 adapter for Gland's HTTP layer.</p>

## Description

> Express is not your application — it is just one way to deliver HTTP. Gland
> abstracts that detail.

`@glandjs/express` is the Express adapter for Gland's HTTP layer. It contributes
an Express application, an `ExpressContext`, and nothing else — the onion, the
request lifecycle, the reply coercion and the error rendering all come from
`@glandjs/http`, so the same controller runs unchanged on Fastify, Koa, Hono or
`node:http`.

A controller never imports Express. A route is declared with a decorator from
`@glandjs/http`, and the adapter works out how to write the reply to the socket.

## Install

```sh
npm install @glandjs/core @glandjs/common @glandjs/http @glandjs/express reflect-metadata
```

## Usage

```ts
import { GlandFactory } from '@glandjs/core';
import { ExpressBroker, type ExpressContext } from '@glandjs/express';
import { Get } from '@glandjs/http';
import { Controller, Module } from '@glandjs/common';

@Controller('/products')
class ProductController {
  @Get('/:id')
  async find(ctx: ExpressContext) {
    return ctx.call('db:product:find', ctx.params.id); // an object becomes JSON
  }
}

@Module({ controllers: [ProductController] })
class AppModule {}

const { app, shutdown } = await GlandFactory.create(AppModule);
const http = app.connectTo(ExpressBroker, { poweredBy: false });

http.json();
http.use(async (ctx, next) => {
  const started = Date.now();
  await next();
  console.log(`${ctx.method} ${ctx.path} ${Date.now() - started}ms`);
});
http.useRaw(compression()); // framework middleware, unmolested

http.listen(3000);
```

## What is different about Express

**`await next()` resolves early.** Express's `next()` is a hand-off, not a call.
The bridge resolves as soon as Express moves downstream, so an upstream
`try`/`catch` cannot see a downstream throw. The error still reaches the error
handler — `next(err)` is called for you — but you cannot _measure_ or _transform_
what happened after the hand-off.

```ts
app.use(async (ctx, next) => {
  const started = Date.now();
  await next(); // the hand-off, not the route
  metrics.timing('route', Date.now() - started);
});
```

The transport-agnostic alternative, which works everywhere:

```ts
app.on(HttpEvent.RequestEnd, ({ method, path, status, duration }) => {
  metrics.timing('http.request', duration, { method, path, status });
});
```

**`app.use` is split in two.** Gland's `use()` is a promise-based onion;
Express's is a synchronous hand-off. Rather than infer intent from a function's
arity — which the previous version did, and which silently mis-typed every
Express handler — the two are separate:

```ts
app.use((ctx, next) => …);              // Gland, on the onion
app.useRaw(compression());              // Express, unmolested
```

**`ctx.send('done')` is `text/plain`.** Express's `res.send(string)` defaults to
`text/html`, which would make a text reply render as a page in a browser. The
adapter sets the type, so a string means the same thing on all five adapters.

**Extended methods use a guard.** Express 5 exposes seven verbs, so `@Propfind()`
is registered with `all()` plus a method check — a real route that works, rather
than a `TypeError: router.propfind is not a function` at boot.

## Reaching Express directly

```ts
app.instance.set('trust proxy', 1); // a setting Gland does not model
app.set('etag', 'strong'); // the same thing, typed
```

That is the right answer for framework settings. It is the wrong answer for
routing, body parsing or CORS, because those are the parts the abstraction owns.

## API

| Export                                 | Kind                                               |
| -------------------------------------- | -------------------------------------------------- |
| `ExpressBroker` / `ExpressBrokerClass` | What `app.connectTo()` takes                       |
| `ExpressCore`                          | The application, with `instance` typed and `set()` |
| `ExpressAdapter`                       | The adapter                                        |
| `ExpressContext`                       | The context                                        |
| `EXPRESS_VERBS`, `ExpressApp`          | Extras                                             |

The full surface is in the
[API reference](../../docs/api/README.md).

## Documentation

- [Choosing an adapter](../../docs/guides/adapters.md)
- [Middleware](../../docs/guides/middleware.md) — and the Express caveat
- [Adapter matrix](../../docs/api/adapter-matrix.md) — what each transport can and
  cannot do
- [Gland architecture](https://github.com/glandjs/gland)

## License

MIT
