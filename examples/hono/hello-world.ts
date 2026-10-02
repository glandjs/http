import { Channel, Controller, Module, On } from '@glandjs/common';
import { Get, HttpReply, Post } from '@glandjs/http';
import { GlandFactory } from '@glandjs/core';
import { HttpStatus } from '@medishn/toolkit';
import { HonoBroker, type HonoRequestContext } from '@glandjs/hono';

/**
 * The same application as `examples/express/hello-world.ts`, on Hono.
 *
 * Hono is built on the Fetch API, so this file is the one that also runs on
 * Cloudflare Workers, Deno Deploy, Bun and Lambda — where there is no socket to
 * bind and the application exports `fetch` instead of calling `listen()`. See
 * the note at the bottom.
 *
 * Run it:
 *
 * ```sh
 * npx tsx examples/hono/hello-world.ts
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
    return { name: '@glandjs/hono', framework: 'hono' };
  }

  /** `GET /hello/:name` — route parameters are on `ctx.params`. */
  @Get('/hello/:name')
  hello(ctx: HonoRequestContext<Events>) {
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
  async sum(ctx: HonoRequestContext<Events>) {
    const total = await ctx.call('math:add', { a: Number(ctx.params.a), b: Number(ctx.params.b) });
    return { total };
  }

  /**
   * `POST /echo` — the parsed body is on `ctx.body`.
   *
   * A fetch `Request` body is a one-shot stream, so the adapter reads it once in
   * a middleware and hands the parsed value here. Without a declared parser it
   * does not read it at all, and `ctx.body` is `undefined`.
   */
  @Post('/echo')
  echo(ctx: HonoRequestContext<Events>) {
    return ctx.body ?? { error: 'send a JSON body' };
  }

  /**
   * `GET /gone` — `throw()` ends the request with a problem document.
   *
   * The problem becomes a fetch `Response`, so it is immutable: `throw()` works,
   * but nothing can amend the status afterwards.
   */
  @Get('/gone')
  gone(ctx: HonoRequestContext<Events>) {
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

  const http = app.connectTo(HonoBroker, {
    // A fetch body is read once, by the adapter's own middleware, and only when a
    // parser has been declared. Without this, `ctx.body` is `undefined` and a
    // JSON post reaches the handler as nothing.
    bodyParser: { json: true, urlencoded: true },
  });

  // The onion is real here — Hono's `next()` is awaited, not handed off — so the
  // timing below measures the request rather than the middleware.
  http.use(async (ctx, next) => {
    const started = Date.now();
    await next();
    console.log(`${ctx.method} ${ctx.path} in ${Date.now() - started}ms`);
  });

  http.enableCors({ origin: 'https://example.com' });
  http.listen(3000, { host: '0.0.0.0' });
  await http.ready();

  // On an edge runtime there is no socket to bind. `listen()` says so instead of
  // failing, and the instance is exported so the platform can serve it:
  //
  //   export default http.hono;   // Cloudflare Workers, Deno, Bun

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
