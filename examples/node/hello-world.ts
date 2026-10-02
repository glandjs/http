import { Channel, Controller, Module, On } from '@glandjs/common';
import { Get, HttpReply, Post } from '@glandjs/http';
import { GlandFactory } from '@glandjs/core';
import { HttpStatus } from '@medishn/toolkit';
import { NodeBroker, type NodeContext } from '@glandjs/node';

/**
 * The same application as `examples/express/hello-world.ts`, on `node:http`.
 *
 * No framework and no dependency — the router, the reply writer and the body
 * collector are all in `@glandjs/node`. The controller below is the same one the
 * other four examples use; only the import and `connectTo()` differ.
 *
 * Run it:
 *
 * ```sh
 * npx tsx examples/node/hello-world.ts
 * ```
 *
 * Then:
 *
 * ```sh
 * curl localhost:3000/hello/world
 * curl localhost:3000/sum/2/3
 * curl localhost:3000/gone
 * curl -X POST localhost:3000/echo -H 'content-type: application/json' -d '{"a":1}'
 * ```
 */

/** The channel event map this application exposes. */
interface Events {
  'math:add': { a: number; b: number };
  'math:sum': number;
}

@Controller('/')
class HelloController {
  /** `GET /` — a plain object becomes JSON. */
  @Get('/')
  index() {
    return { name: '@glandjs/node', framework: 'node:http' };
  }

  /** `GET /hello/:name` — route parameters are on `ctx.params`. */
  @Get('/hello/:name')
  hello(ctx: NodeContext<Events>) {
    return { message: `Hello, ${ctx.params.name}!` };
  }

  /**
   * `GET /sum/:a/:b` — reaching application code by name, not by import.
   *
   * The controller does not import the channel. It addresses it, and the binder
   * resolves the name. That indirection is what lets one channel implementation
   * be reused by a WebSocket, a queue consumer, or a CLI.
   */
  @Get('/sum/:a/:b')
  async sum(ctx: NodeContext<Events>) {
    const total = await ctx.call('math:add', { a: Number(ctx.params.a), b: Number(ctx.params.b) });
    return { total };
  }

  /**
   * `POST /echo` — the parsed body is on `ctx.body`.
   *
   * `bodyParser` is not the default anywhere in Gland: "no parser installed" is
   * the safe answer, because a handler that expects an object should get a `415`
   * rather than `undefined`. Declaring it here installs the collector, which
   * runs first in the chain and decodes by `Content-Type`.
   */
  @Post('/echo')
  echo(ctx: NodeContext<Events>) {
    return ctx.body ?? { error: 'send a JSON body' };
  }

  /**
   * `GET /gone` — `throw()` ends the request with a problem document.
   *
   * The status, the `Content-Type` and the RFC 7807 body are produced by the
   * layer, not by this method.
   */
  @Get('/gone')
  gone(ctx: NodeContext<Events>) {
    return ctx.throw(HttpStatus.GONE, { detail: 'This resource has been removed', type: 'https://errors.example.com/gone' });
  }

  /** `GET /created` — an explicit reply, for a status a bare return cannot carry. */
  @Get('/created')
  created() {
    return HttpReply.json({ id: 1 }, { status: HttpStatus.CREATED, headers: { location: '/' } });
  }
}

/** The channel `sum` reaches. */
@Channel('math')
class MathChannel {
  @On('add')
  add(payload: { a: number; b: number }) {
    return payload.a + payload.b;
  }
}

@Module({ controllers: [HelloController], channels: [MathChannel] })
class AppModule {}

async function main(): Promise<void> {
  const { app, shutdown } = await GlandFactory.create(AppModule);

  const http = app.connectTo(NodeBroker, {
    poweredBy: false,
    bodyParser: { limit: '1mb' },
  });

  // `node:http` has no middleware, so this adapter walks the chain itself — which
  // makes `await next()` mean what it looks like it means. The timing log
  // measures the request, not the middleware.
  http.use(async (ctx, next) => {
    const started = Date.now();
    await next();
    console.log(`${ctx.method} ${ctx.path} in ${Date.now() - started}ms`);
  });

  http.enableCors({ origin: 'https://example.com' });
  http.listen(3000, { host: '0.0.0.0' });
  await http.ready();

  const stop = async (signal: string): Promise<void> => {
    await http.close();
    await shutdown(signal);
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

void main().catch((error: unknown) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
