<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="160" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/node" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/node.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/node" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/node.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/node" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/node.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/node</h1>

<p align="center">Gland's HTTP layer on <code>node:http</code> — no framework, zero runtime dependencies. Also the reference implementation of the adapter contract.</p>

## Description

`@glandjs/node` serves a Gland application over Node's built-in HTTP module. There
is no Express, no Fastify, no Koa, no Hono — and no dependency that exists only to
route a request. The router, the reply writer, the body collector and the cookie
serialiser are all in this package, in two files.

It is here for three reasons, in order of importance:

1. **It proves the contract.** If `@glandjs/http` can serve HTTP with no
   framework at all, then the four framework adapters are genuinely thin — and a
   sixth adapter is a mechanical job rather than a research project.
2. **It is the smallest install.** For a service that is one endpoint and a
   health check, a framework is a large cost for a small problem.
3. **It is the reference.** Every awkward decision in the other adapters — path
   normalisation, reply coercion, cookie serialisation, when to end a socket —
   is implemented here against primitives, so there is exactly one place to look
   up what the intended behaviour actually is.

## Install

```sh
npm install @glandjs/core @glandjs/common @glandjs/http @glandjs/node reflect-metadata
```

## Usage

```ts
import { GlandFactory } from '@glandjs/core';
import { Controller, Module, On, Channel } from '@glandjs/common';
import { Get, Post, HttpReply } from '@glandjs/http';
import { NodeBroker, type NodeContext } from '@glandjs/node';
import { HttpStatus } from '@medishn/toolkit';

@Controller('/')
class HelloController {
  @Get('/')
  index() {
    return { framework: 'node:http' };
  }

  @Get('/hello/:name')
  hello(ctx: NodeContext) {
    return { message: `Hello, ${ctx.params.name}!` };
  }

  @Post('/echo')
  echo(ctx: NodeContext) {
    return ctx.body;
  }

  @Get('/gone')
  gone(ctx: NodeContext) {
    return ctx.throw(HttpStatus.GONE, { detail: 'removed' });
  }
}

@Module({ controllers: [HelloController] })
class AppModule {}

const { app } = await GlandFactory.create(AppModule);
const http = app.connectTo(NodeBroker, { prefix: '/api' });

http.listen(3000, { host: '0.0.0.0' });
await http.ready();
```

```sh
curl localhost:3000/api/hello/world
```

## The pipeline

`node:http` has no middleware concept, so this adapter walks the recorded queue
itself. That makes it the one adapter where the onion is unambiguously real:

```
X-Powered-By ──▶ body collector ──▶ your middleware ──▶ route handler ──▶ 404
```

- **The chain runs for every request**, including one that matched nothing. A
  `401` middleware protects a 404 as much as it protects a handler, which is the
  behaviour you want and the one a framework adapter has to work to preserve.
- **`await next()` awaits the rest of the chain.** A `throw` unwinds through
  every frame, with the error rendered at the outermost one.
- **The body collector is first**, ahead of anything you add. `ctx.body` is
  parsed from the bytes it accumulates, so a middleware mounted before it would
  see `undefined` on every request.
- **Registration order is the tiebreak.** A specific route registered before a
  wildcard wins — the same rule the other four adapters inherit from their
  frameworks, and the one an application migrating from Express expects.

## The router

A compiled segment matcher, not a regular expression. Two reasons:

- `:id` must not match across a `/`, so `/a/b` is not `/a/:x/y`;
- interpolating an unescaped user value into a `RegExp` is not a risk worth
  taking when the alternative is thirty lines.

Paths are normalised first — one leading slash, no trailing slash, no empty
segments — and matched **case-sensitively**, per RFC 3986. A case-insensitive
match is how `/Users` and `/users` quietly become one route.

```ts
import { compile, matchSegments } from '@glandjs/node';

matchSegments(compile('/users/:id'), ['users', '42']); // { id: '42' }
matchSegments(compile('/users/:id'), ['users', '42', 'x']); // undefined
```

## What this adapter does not do

| Missing                                   | Why, and what to use instead                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `useRaw()`                                | There is no framework-native middleware to hand a raw request to. It warns and is ignored.                                           |
| Per-format parsers                        | There is one way to read a body, and the decoding follows `Content-Type`. `ctx.rawBody` holds the raw `Buffer` for anything unusual. |
| `x-powered-by`, `trust proxy`, templating | Set `X-Powered-By` with `poweredBy`; nothing here reads `X-Forwarded-*` or renders a view.                                           |

The body collector is only installed when a parser was declared, matching the
documented default:

```ts
app.connectTo(NodeBroker, { bodyParser: { limit: '2mb' } }); // collects and parses
app.connectTo(NodeBroker); // `ctx.body` stays undefined
```

`useStaticAssets()` does work: it queues a wildcard route, which is all
`serveStatic` needs.

## API

| Export                           | Kind                                   |
| -------------------------------- | -------------------------------------- |
| `NodeBroker` / `NodeBrokerClass` | What `app.connectTo()` takes           |
| `NodeCore`                       | The application                        |
| `NodeAdapter`                    | The adapter                            |
| `NodeContext`                    | The context                            |
| `collectBody`                    | The body parser, mounted for you       |
| `compile`, `matchSegments`       | The router, for inspection and testing |

## Documentation

- [Choosing an adapter](../../docs/guides/adapters.md)
- [Adapter matrix](../../docs/api/adapter-matrix.md)
- [Writing an adapter](../../docs/architecture/writing-an-adapter.md)
- [Example](../../examples/node/hello-world.ts)

## License

MIT
