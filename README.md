<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="200" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/http.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/http.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/http.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/http</h1>

<p align="center">One HTTP layer, five transports. The same controller, the same middleware and the same assertions on Express, Fastify, Koa, Hono and <code>node:http</code>.</p>

## Description

> HTTP is not your application — it is a transport. Gland treats it that way.

`@glandjs/http` is Gland's HTTP layer. It contains **no server, no router and no
framework import**: the contracts an adapter implements, the behaviour every
adapter shares, and the decorators that let a controller declare a route.

The transports are separate packages. Swapping one is a one-line import change,
and the controller does not move:

| Package                                  | Framework   | Middleware onion      | Extended methods   | Runtime                 |
| ---------------------------------------- | ----------- | --------------------- | ------------------ | ----------------------- |
| [`@glandjs/express`](./packages/express) | Express 5   | hand-off              | via a method guard | Node                    |
| [`@glandjs/fastify`](./packages/fastify) | Fastify 5   | real, inside one hook | most WebDAV        | Node                    |
| [`@glandjs/koa`](./packages/koa)         | Koa 3       | real                  | native             | Node                    |
| [`@glandjs/hono`](./packages/hono)       | Hono 4      | real                  | native             | Node and the edge       |
| [`@glandjs/node`](./packages/node)       | `node:http` | real                  | native             | Node, zero dependencies |

## Features

- 🔌 **One contract, five adapters** — and a test suite that boots one
  application on all five and asserts the same twenty-odd behaviours
- 🧅 **A promise-based middleware onion** — `await next()` waits, and a
  downstream `throw` reaches an upstream `catch`
- 🎯 **A return value is the response** — `return product`, `return ctx.throw(404)`,
  `return Readable.from(…)`; one coercion function, so `return 42` means the same
  thing everywhere
- 🧩 **An abstract context** — an adapter cannot implement it partially, which is
  what makes a transport change a refactor rather than a rewrite
- 🛡️ **RFC 7807 errors, with the message dropped** for anything that is not an
  `HttpException`, because a stack trace in a response body is a disclosure bug
- 🌐 **One CORS implementation** for every adapter, with `Vary: Origin` on by
  default and the `credentials` + `origin: '*'` contradiction rejected at boot
- 📡 **Server-sent events** that actually frame correctly — a multi-line payload
  is split across `data:` lines, and a heartbeat keeps intermediaries from idling
  the connection out
- 🔭 **A lifecycle bus** — `request:start`, `request:end`, `route:miss`,
  `server:listening`, and an `end` that fires on the failure path too
- 🪶 **A zero-dependency adapter** — `@glandjs/node` has no framework and no
  runtime dependencies, and is the reference implementation of the contract

## Install

```sh
npm install @glandjs/core @glandjs/common @glandjs/http @glandjs/express reflect-metadata
```

`reflect-metadata` is a peer dependency, not an optional one, and
`experimentalDecorators` / `emitDecoratorMetadata` are mandatory compiler
options.

## Usage

```ts
import { Controller, Channel, Module, On } from '@glandjs/common';
import { Get, Post, HttpReply } from '@glandjs/http';
import { GlandFactory } from '@glandjs/core';
import { ExpressBroker, type ExpressContext } from '@glandjs/express';

interface Events {
  'math:add': { a: number; b: number };
}

@Controller('/products')
export class ProductController {
  @Get('/:id')
  async find(ctx: ExpressContext<Events>) {
    const product = await ctx.call('db:product:find', { id: ctx.params.id });
    if (!product) return ctx.throw(404, { detail: 'No such product' });
    return product; // an object becomes JSON
  }

  @Post('/')
  async create(ctx: ExpressContext<Events>) {
    const product = await ctx.call('db:product:create', ctx.body);
    return HttpReply.json({ product }, { status: 201, headers: { location: `/products/${product.id}` } });
  }
}

@Module({ controllers: [ProductController] })
export class AppModule {}

async function main() {
  const { app, shutdown } = await GlandFactory.create(AppModule);

  const http = app.connectTo(ExpressBroker, { poweredBy: false });

  http.json();
  http.enableCors({ origin: 'https://app.example.com' });
  http.use(async (ctx, next) => {
    const started = Date.now();
    await next();
    console.log(`${ctx.method} ${ctx.path} ${Date.now() - started}ms`);
  });

  http.listen(3000);

  const stop = async (signal: string) => {
    await http.close();
    await shutdown(signal);
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`app.connectTo(FastifyBroker)`, `KoaBroker`, `HonoBroker` or `NodeBroker` instead,
and nothing else changes.

## Why the layers are split this way

Everything that has to be identical lives in `@glandjs/http`, and everything that
needs framework knowledge lives in an adapter:

| In `@glandjs/http`              | In an adapter                     |
| ------------------------------- | --------------------------------- |
| reply coercion                  | building a context                |
| the middleware onion            | putting a route on a router       |
| the request lifecycle           | mounting one framework middleware |
| CORS, cookies, problem details  | writing a reply to a response     |
| path normalisation, SSE framing | binding and releasing the socket  |

That is why an adapter is a few hundred lines, and why the layer can be tested
once and trusted five times.
[Architecture → Overview](./docs/architecture/README.md).

## Documentation

Start with [docs/README.md](./docs/README.md) — it has a reading path. The rest:

|                                                                 |                                              |
| --------------------------------------------------------------- | -------------------------------------------- |
| [Getting started](./docs/guides/getting-started.md)             | A working service, end to end                |
| [Choosing an adapter](./docs/guides/adapters.md)                | The five, and which to reach for             |
| [Controllers and routes](./docs/guides/controllers.md)          | Every method, the prefix rules               |
| [The context](./docs/guides/context.md)                         | Every member, grouped                        |
| [Middleware](./docs/guides/middleware.md)                       | The onion, scoping, the Express caveat       |
| [Replies](./docs/guides/replies.md)                             | What a handler may return                    |
| [Errors](./docs/guides/errors.md)                               | Problem details, and what is never leaked    |
| [CORS](./docs/guides/cors.md)                                   | One policy, five adapters                    |
| [Bodies and uploads](./docs/guides/bodies.md)                   | The parsers, the limit, the `maxAge` trap    |
| [Lifecycle events](./docs/guides/lifecycle-events.md)           | The bus, and the five worth wiring up        |
| [Deployment](./docs/guides/deployment.md)                       | TLS, proxies, shutdown, health checks        |
| [Testing](./docs/guides/testing.md)                             | Unit vs. integration, and the contract suite |
| [Migrating to 1.1](./docs/guides/migration.md)                  | What changed, and what to change             |
| [API reference](./docs/api/README.md)                           | Every public export                          |
| [Adapter matrix](./docs/api/adapter-matrix.md)                  | What each transport can and cannot do        |
| [Architecture](./docs/architecture/README.md)                   | The five ideas the layer is built from       |
| [Writing an adapter](./docs/architecture/writing-an-adapter.md) | Adding a sixth transport                     |

## Examples

One runnable service per adapter. The controller, the channel and the module are
identical in all five — only the import and `connectTo()` differ.

```sh
npx tsx examples/express/hello-world.ts
npx tsx examples/fastify/hello-world.ts
npx tsx examples/koa/hello-world.ts
npx tsx examples/hono/hello-world.ts
npx tsx examples/node/hello-world.ts
```

```sh
curl localhost:3000/hello/world
curl localhost:3000/sum/2/3
curl -X POST localhost:3000/echo -H 'content-type: application/json' -d '{"a":1}'
```

## Development

```sh
pnpm install
pnpm build          # all six packages
pnpm test           # unit + the five-transport contract suite
pnpm typecheck
pnpm lint
```

See [Contributing](./docs/development/CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
