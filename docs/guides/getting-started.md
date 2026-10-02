# Getting started

A working Gland HTTP service, from `pnpm` to a request. Express, because it is
the most familiar; swap one import for any of the other four and nothing else
changes.

## Install

```sh
npm install @glandjs/core @glandjs/common @glandjs/http @glandjs/express reflect-metadata
```

`reflect-metadata` is a peer dependency, not an optional one. `@glandjs/core`
discovers a provider's constructor parameters from compiler-emitted metadata, and
that metadata is only produced for decorated classes — so a plain service with
no `@Injectable()` receives `undefined` for every dependency.

Two compiler options are also not optional:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
  },
}
```

## A controller

A controller is a class with a path and some decorated methods. It never imports
a service and never touches `res`.

```ts
import { Controller, Channel, Module, On } from '@glandjs/common';
import { Get, Post, HttpReply } from '@glandjs/http';
import { HttpStatus } from '@medishn/toolkit';
import type { ExpressContext } from '@glandjs/express';

interface Events {
  'math:add': { a: number; b: number };
  'math:sum': number;
}

@Controller('/products')
export class ProductController {
  @Get('/:id')
  async find(ctx: ExpressContext<Events>) {
    const product = await ctx.call('db:product:find', { id: ctx.params.id });
    if (!product) return ctx.throw(HttpStatus.NOT_FOUND, { detail: 'No such product' });
    return product; // an object becomes JSON
  }

  @Post('/')
  async create(ctx: ExpressContext<Events>) {
    const product = await ctx.call('db:product:create', ctx.body);
    return HttpReply.json({ product }, { status: 201, headers: { location: `/products/${product.id}` } });
  }
}

@Channel('math')
export class MathChannel {
  @On('add')
  add({ a, b }: { a: number; b: number }) {
    return a + b;
  }
}

@Module({ controllers: [ProductController], channels: [MathChannel] })
export class AppModule {}
```

Two things to notice.

**`ctx.call('db:product:find', …)` reaches code by name.** The controller does
not import the channel that holds the data. That indirection is what lets one
implementation be reused by a WebSocket, a queue consumer, or a CLI — and it is
what makes a call observable without patching the callee.

**The return value is the response.** `return product` is JSON. `ctx.throw` ends
the request with a problem document. There is no `res`, and no `return res.json`.

## Bootstrap

```ts
import { GlandFactory } from '@glandjs/core';
import { ExpressBroker } from '@glandjs/express';

async function main() {
  const { app, shutdown } = await GlandFactory.create(AppModule);

  const http = app.connectTo(ExpressBroker, { poweredBy: false });

  http.json(); // parse JSON bodies
  http.enableCors({ origin: 'https://example.com' });

  http.use(async (ctx, next) => {
    const started = Date.now();
    await next();
    console.log(`${ctx.method} ${ctx.path} ${Date.now() - started}ms`);
  });

  http.listen(3000, { host: '0.0.0.0' });

  const stop = async (signal: string) => {
    await http.close();
    await shutdown(signal);
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
```

```sh
curl localhost:3000/products/1
```

## The shape of the API

Three rules cover almost everything.

**Configure after `connectTo`, listen last.** `connectTo()` produces the
application, so it has to come first — and the routes it registers are buffered
until `listen()`, which is what makes `http.use()` afterwards still land in front
of them. [Ordering](../architecture/README.md#3-ordering-is-decided-once-by-buffering).

**`use` is the Gland onion; `useRaw` is the framework's.** They interleave in
call order.

```ts
app.use(async (ctx, next) => { … });            // (ctx, next) => …
app.use('/api', rateLimit);                      // path-scoped
app.useRaw(compression());                       // framework middleware
```

**Return a value, or call `ctx.…`.** Both answer the request; doing both is
harmless, because the pipeline skips a context that has already answered.

## Changing the transport

```diff
-import { ExpressBroker } from '@glandjs/express';
+import { FastifyBroker } from '@glandjs/fastify';

-const http = app.connectTo(ExpressBroker, { poweredBy: false });
+const http = app.connectTo(FastifyBroker, { poweredBy: false });
```

That is the whole change, and the controller does not move. Fastify loads its
plugins asynchronously, so add one line:

```ts
http.listen(3000);
await http.ready();
```

## Next

| Guide                                    | Covers                                               |
| ---------------------------------------- | ---------------------------------------------------- |
| [Choosing an adapter](adapters.md)       | The five, and which one to reach for                 |
| [Controllers and routes](controllers.md) | Every method, the prefix rules, WebDAV               |
| [The context](context.md)                | Every member, grouped by what you are doing          |
| [Middleware](middleware.md)              | The onion, and the one adapter that fakes it         |
| [Replies](replies.md)                    | What a handler may return, and what goes on the wire |
| [Errors](errors.md)                      | Problem details, and what is never leaked            |
| [Bodies and uploads](bodies.md)          | Nothing is parsed until you declare it               |
| [Lifecycle events](lifecycle-events.md)  | Metrics and logs that stay out of the request path   |
| [Deployment](deployment.md)              | Proxies, graceful shutdown, health checks            |
| [Testing](testing.md)                    | Unit vs. integration, and the contract suite         |

If you are upgrading rather than starting fresh, read
[Migrating to 1.1](migration.md) first — `ctx.getHeader()` changed which side of
the exchange it reads, and that is the one silent behaviour change.
