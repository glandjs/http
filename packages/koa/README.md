<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="160" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/koa" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/koa.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/koa" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/koa.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/koa" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/koa.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/koa</h1>

<p align="center">The Koa 3 adapter for Gland's HTTP layer.</p>

## Description

`@glandjs/koa` is the Koa adapter for Gland's HTTP layer.

Koa has the closest middleware model to Gland's — so close that the adapter is
the thinnest here, and `await next()` genuinely waits for the rest of the chain.
A downstream `throw` reaches an upstream `catch`.

## Install

```sh
npm install @glandjs/core @glandjs/common @glandjs/http @glandjs/koa reflect-metadata
```

Optional, for the features that need them: `koa-bodyparser` (body parsing) and
`koa-static` (static assets).

## Usage

```ts
import { GlandFactory } from '@glandjs/core';
import { KoaBroker, type KoaContext } from '@glandjs/koa';
import { Get } from '@glandjs/http';
import { Controller, Module } from '@glandjs/common';

@Controller('/products')
class ProductController {
  @Get('/:id')
  async find(ctx: KoaContext) {
    return ctx.call('db:product:find', ctx.params.id);
  }
}

@Module({ controllers: [ProductController] })
class AppModule {}

const { app, shutdown } = await GlandFactory.create(AppModule);
const http = app.connectTo(KoaBroker, { poweredBy: false });

http.bodyParser({ limit: 1_000_000 });
http.use(async (ctx, next) => {
  const started = Date.now();
  await next(); // really waits
  console.log(`${ctx.method} ${ctx.path} ${Date.now() - started}ms`);
});
http.useRaw(require('koa-static')('./public'));

http.listen(3000);
```

## The middleware onion

Koa _is_ the model this layer was written against, so the bridge is a one-liner:

```ts
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    ctx.status(503).json({ error: 'upstream unavailable' });
  }
});
```

A downstream `throw` propagates through `next()` and reaches the `catch` — the
full onion, with no caveats.

## The prefix is applied once

Paths arrive at the router already prefixed, because
`HttpServerAdapter.route()` applies it. The adapter therefore mounts
`app.use(router.routes())` with **no** router prefix.

A `Router` mounted at `/api` with routes registered at `/api/products` serves
`/api/api/products`, and 404s everything the application exists to answer. That
is the single most common way a prefix goes wrong.

## Body parsing

`koa-bodyparser` is loaded on request rather than bundled. Parsing is a security
decision — limits, encodings, content types — and Koa's answer to it is a
well-known package rather than a rewrite.

```ts
app.bodyParser({ limit: 1_000_000 }); // 100 kB by default
```

Multipart is not handled here: streaming a file upload through a buffering parser
is how a 10 MB video becomes a 10 MB heap spike. Use `@koa/multer` through
`useRaw`.

## Notes

- **`poweredBy: false` is a no-op.** Koa sets no `X-Powered-By`; that is Express.
  A reverse proxy that adds one is the proxy's configuration.
- **Signed cookies** work if a signed-cookie middleware is mounted, and
  `ctx.signedCookies` is `{}` without one.
- **The 404** is mounted after the router, and renders the same problem document
  as every other adapter rather than Koa's own body.

## API

| Export                                      | Kind                                       |
| ------------------------------------------- | ------------------------------------------ |
| `KoaBroker` / `KoaBrokerClass`              | What `app.connectTo()` takes               |
| `KoaCore`                                   | The application, with a typed `koa` getter |
| `KoaAdapter`                                | The adapter                                |
| `KoaContext`, `KoaState`, `GlandKoaContext` | The context                                |

The full surface is in the [API reference](../../docs/api/README.md).

## Documentation

- [Choosing an adapter](../../docs/guides/adapters.md)
- [Middleware](../../docs/guides/middleware.md)
- [Adapter matrix](../../docs/api/adapter-matrix.md)

## License

MIT
