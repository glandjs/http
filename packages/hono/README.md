<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="160" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/hono" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/hono.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/hono" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/hono.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/hono" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/hono.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/hono</h1>

<p align="center">The Hono adapter for Gland's HTTP layer — on Node, Cloudflare Workers, Deno and Bun.</p>

## Description

`@glandjs/hono` is the Hono adapter for Gland's HTTP layer. Because Hono is built
on the Fetch API, this is the only adapter that also runs on Cloudflare Workers,
Deno Deploy, Bun and Lambda — where there is no socket to bind and the
application exports `fetch` instead.

The same controller, the same middleware and the same reply semantics run on
all of them.

## Install

```sh
npm install @glandjs/core @glandjs/common @glandjs/http @glandjs/hono reflect-metadata
```

Optional, for `listen()` on Node: `@hono/node-server`.

## Usage

On Node:

```ts
import { GlandFactory } from '@glandjs/core';
import { HonoBroker, type HonoRequestContext } from '@glandjs/hono';
import { Get } from '@glandjs/http';
import { Controller, Module } from '@glandjs/common';

@Controller('/products')
class ProductController {
  @Get('/:id')
  async find(ctx: HonoRequestContext) {
    return ctx.call('db:product:find', ctx.params.id);
  }
}

@Module({ controllers: [ProductController] })
class AppModule {}

const { app, shutdown } = await GlandFactory.create(AppModule);
const http = app.connectTo(HonoBroker);

http.listen(3000);
await http.ready();
```

On an edge runtime, export the Hono instance:

```ts
export default http.hono; // Cloudflare Workers, Deno, Bun
```

## A fetch `Response` is immutable

This is the trade for running everywhere, and it has three consequences.

**`c.res` is replaced, not mutated.** A `useRaw` middleware that sets a header is
_merged_ into the adapter's reply rather than overwriting it, so
`c.header('x-request-id', …)` still reaches the client. What it cannot do is
change the status or the body: a fetch `Response` is immutable, and the adapter's
is the one the handler's return value describes. A raw middleware can observe,
add headers, and short-circuit by returning its own `Response`.

**No `raw` body.** A fetch body is read as text, and re-buffering it would mean
holding the whole body twice. The adapter warns at boot and `ctx.rawText` carries
what was read. For a file upload, use `await ctx.req.parseBody()` in the handler.

**`listen()` is Node-only.** On an edge runtime there is nothing to bind, and the
adapter says so rather than failing.

## The body is read once

A fetch `Request` body is a one-shot stream, so the adapter reads it in a
middleware and hands the parsed value to `ctx.body`. Without that, `ctx.body`
would be `undefined` everywhere — and a second read would hang rather than return
nothing.

```ts
app.useRaw(async (c, next) => {
  c.header('x-request-id', crypto.randomUUID());
  await next();
});
```

## API

| Export                                                  | Kind                                        |
| ------------------------------------------------------- | ------------------------------------------- |
| `HonoBroker` / `HonoBrokerClass`                        | What `app.connectTo()` takes                |
| `HonoCore`                                              | The application, with a typed `hono` getter |
| `HonoAdapter`                                           | The adapter                                 |
| `HonoRequestContext`, `FetchBodyInit`, `parseFetchBody` | The context                                 |

The full surface is in the [API reference](../../docs/api/README.md).

## Documentation

- [Choosing an adapter](../../docs/guides/adapters.md)
- [Adapter matrix](../../docs/api/adapter-matrix.md)
- [Bodies and uploads](../../docs/guides/bodies.md)

## License

MIT
