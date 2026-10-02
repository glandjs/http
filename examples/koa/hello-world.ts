import { Channel, Controller, Module, On } from '@glandjs/common';
import { Get, HttpReply, Post } from '@glandjs/http';
import { GlandFactory } from '@glandjs/core';
import { HttpStatus } from '@medishn/toolkit';
import { KoaBroker, type KoaContext } from '@glandjs/koa';

/**
 * The same application as `examples/express/hello-world.ts`, on Koa.
 *
 * Koa is the adapter with the *real* middleware onion — no hand-off, no caveats.
 * `await next()` suspends until everything downstream has run, and a `throw`
 * unwinds through every frame. If you are choosing an adapter and want the
 * simplest mental model, this is the one that gives you one.
 *
 * Run it:
 *
 * ```sh
 * npx tsx examples/koa/hello-world.ts
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
    return { name: '@glandjs/koa', framework: 'koa' };
  }

  /** `GET /hello/:name` — route parameters are on `ctx.params`. */
  @Get('/hello/:name')
  hello(ctx: KoaContext<Events>) {
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
  async sum(ctx: KoaContext<Events>) {
    const total = await ctx.call('math:add', { a: Number(ctx.params.a), b: Number(ctx.params.b) });
    return { total };
  }

  /**
   * `POST /echo` — the parsed body is on `ctx.body`.
   *
   * Koa parses nothing by itself: it ships a `ctx.request.body` that is always
   * `undefined` until a parser is installed. `bodyParser` registers
   * `koa-bodyparser`, which is the only place that value comes from.
   */
  @Post('/echo')
  echo(ctx: KoaContext<Events>) {
    return ctx.body ?? { error: 'send a JSON body' };
  }

  /**
   * `GET /gone` — `throw()` ends the request with a problem document.
   *
   * Koa's own `ctx.throw()` produces a different shape, so a handler uses the
   * Gland one and gets the same RFC 7807 body on every adapter.
   */
  @Get('/gone')
  gone(ctx: KoaContext<Events>) {
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

  const http = app.connectTo(KoaBroker, {
    // `koa-bodyparser` is optional. Without it `ctx.body` is `undefined` and a
    // JSON post reaches the handler as nothing.
    bodyParser: { json: true, urlencoded: true },
  });

  // The onion, for real: `await next()` does not return until the handler has
  // run, which is what makes the timing log below measure the request rather
  // than the middleware.
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
