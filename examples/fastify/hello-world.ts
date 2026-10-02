import { Channel, Controller, Module, On } from '@glandjs/common';
import { Get, HttpReply, Post } from '@glandjs/http';
import { GlandFactory } from '@glandjs/core';
import { HttpStatus } from '@medishn/toolkit';
import { FastifyBroker, type FastifyContext } from '@glandjs/fastify';

/**
 * The same application as `examples/express/hello-world.ts`, on Fastify.
 *
 * Diff the two files. The controller, the channel, the module and the middleware
 * are byte-for-byte the same; only the import and `connectTo()` change. That is
 * the whole argument for the adapter layer.
 *
 * Run it:
 *
 * ```sh
 * npx tsx examples/fastify/hello-world.ts
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
    return { name: '@glandjs/fastify', framework: 'fastify' };
  }

  /** `GET /hello/:name` — route parameters are on `ctx.params`. */
  @Get('/hello/:name')
  hello(ctx: FastifyContext<Events>) {
    return { message: `Hello, ${ctx.params.name}!` };
  }

  /**
   * `GET /sum/:a/:b` — reaching application code by name, not by import.
   *
   * The controller does not import the channel. It addresses it, and the binder
   * resolves the name. That indirection is what lets one channel implementation
   * be reused by a WebSocket, a queue consumer, or a CLI — on any of the five
   * adapters.
   */
  @Get('/sum/:a/:b')
  async sum(ctx: FastifyContext<Events>) {
    const total = await ctx.call('math:add', { a: Number(ctx.params.a), b: Number(ctx.params.b) });
    return { total };
  }

  /**
   * `POST /echo` — the parsed body is on `ctx.body`.
   */
  @Post('/echo')
  echo(ctx: FastifyContext<Events>) {
    return ctx.body ?? { error: 'send a JSON body' };
  }

  /**
   * `GET /gone` — `throw()` ends the request with a problem document.
   *
   * Fastify has its own error handler, but a Gland `throw()` is already an RFC
   * 7807 problem by the time it reaches one, so both agree.
   */
  @Get('/gone')
  gone(ctx: FastifyContext<Events>) {
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

  const http = app.connectTo(FastifyBroker, {
    // Fastify is the one framework that parses JSON whether or not it is asked
    // to, so the adapter removes its built-in parser when nothing is declared.
    // Declaring one keeps it, and turns on `@fastify/formbody` and
    // `@fastify/cookie` for a form post and for `ctx.cookies`.
    bodyParser: { json: true, urlencoded: true },
  });

  // Gland middleware becomes one composed `preHandler` hook. `await next()`
  // really does wait for the rest of the chain — see the adapter's notes for why
  // that is not the same thing Express does with its `next()`.
  http.use(async (ctx, next) => {
    const started = Date.now();
    await next();
    console.log(`${ctx.method} ${ctx.path} in ${Date.now() - started}ms`);
  });

  http.enableCors({ origin: 'https://example.com' });
  http.listen(3000, { host: '0.0.0.0' });

  // Fastify finishes loading its plugins during `ready()`, and `listen()` only
  // awaits that much. `http.ready()` waits for the whole set.
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
