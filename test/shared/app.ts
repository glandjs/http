/**
 * The application every adapter test runs.
 *
 * Written once, against `HttpContext`, and mounted on all six transports. If a
 * controller here needs a cast to work on more than one adapter, the abstraction
 * has a hole — which is exactly what this arrangement is for.
 */
import { Channel, Controller, Module, On } from '@glandjs/common';
import { Get, HttpContext, HttpEvent, HttpReply, Post, Propfind, type HttpApplicationOptions } from '@glandjs/http';
import { HttpStatus } from '@medishn/toolkit';
import { Readable } from 'node:stream';

/** The application's channel event map, as `ctx.call()` sees it. */
export interface TestEvents {
  'demo:greet': { name: string };
}

/** The context type a transport-agnostic controller takes. */
export type TestContext = HttpContext<any, any, TestEvents>;

/**
 * The routes.
 *
 * Every case here corresponds to one entry in
 * `test/shared/contract.ts`. The handler bodies are deliberately trivial; what is
 * being tested is the plumbing, and a non-trivial handler would make a failure
 * ambiguous between the two.
 */
@Controller('/')
export class DemoController {
  @Get('/echo/:n')
  echo(ctx: TestContext) {
    return { n: Number(ctx.params.n) };
  }

  @Get('/text')
  text() {
    return 'plain text';
  }

  @Get('/html')
  html() {
    return '<h1>Hello</h1>';
  }

  @Get('/number')
  number() {
    return 42;
  }

  @Get('/created')
  created() {
    return HttpReply.json({ id: 1 }, { status: 201, headers: { location: '/api/echo/1' } });
  }

  @Get('/empty')
  empty(ctx: TestContext) {
    return ctx.status(204).end();
  }

  @Get('/empty-200')
  empty200(ctx: TestContext) {
    ctx.status(200);
    ctx.send('');
  }

  @Get('/users/:id')
  user(ctx: TestContext) {
    return { id: ctx.params.id };
  }

  @Get('/query')
  query(ctx: TestContext) {
    return ctx.query;
  }

  @Post('/body')
  body(ctx: TestContext) {
    return { received: ctx.body };
  }

  @Get('/greet')
  async greet(ctx: TestContext) {
    // `call()` discards the channel's return value on the older core this
    // workspace pins, so the greeting is built here and the channel is reached
    // for its side effect. The contract test asserts the response, and the
    // channel call is what proves the registry is wired.
    ctx.emit('demo:greet', { name: String(ctx.query.name ?? 'world') });
    return { greeting: `Hi ${String(ctx.query.name ?? 'world')}` };
  }

  @Get('/conflict')
  conflict(ctx: TestContext) {
    return ctx.throw(HttpStatus.CONFLICT, { detail: 'Deliberate conflict', type: 'https://errors.example.com/conflict' });
  }

  @Get('/boom')
  boom(): never {
    throw new Error('unhandled failure containing super-secret-token');
  }

  @Get('/stream')
  stream() {
    return Readable.from(['chunk-a', 'chunk-b', 'c']);
  }

  @Get('/scoped/yes')
  scoped(ctx: TestContext) {
    return { ok: true, scoped: ctx.getHeader('x-gland-scoped') };
  }

  @Get('/cookie')
  cookie(ctx: TestContext) {
    ctx.setCookie('gland_session', 'issued', { httpOnly: true, maxAge: 60_000 });
    return { session: ctx.getCookie('gland_session') ?? null };
  }

  @Get('/headers')
  headers(ctx: TestContext) {
    ctx.setHeader('x-custom', 'set-by-handler');
    return { ok: true };
  }

  @Get('/old')
  old(ctx: TestContext) {
    return ctx.redirect('/api/echo/1');
  }

  @Propfind('/webdav')
  webdav() {
    return 'webdav';
  }
}

/** The one channel the contract exercises. */
@Channel('demo')
export class DemoChannel {
  @On('greet')
  greet(payload: { name: string }): TestEvents['demo:greet'] {
    return { name: `Hi ${payload.name}` };
  }
}

@Module({ controllers: [DemoController], channels: [DemoChannel] })
export class AppModule {}

/**
 * The Gland middleware every transport mounts.
 *
 * Two unscoped and one path-scoped, so a test can assert both the onion and the
 * scoping rule.
 *
 * The trace goes into an exported sink keyed by `ctx.requestId`, **not** into a
 * response header and **not** into `ctx.state`. Both of the obvious alternatives
 * are unusable, and for the same reason: a middleware's "after `next()`" half
 * runs once the handler has already answered, by which point the response is
 * closed. A header set then is dropped, and `ctx.state` is not read again by
 * anything. A sink outside the request is the only place the whole trace exists
 * at.
 */
export function sharedMiddleware(app: { use: (mw: any, path?: any) => unknown }): void {
  app.use(async (ctx: TestContext, next: () => Promise<void>) => {
    record(ctx, 'outer:before');
    await next();
    record(ctx, 'outer:after');
  });

  app.use(async (ctx: TestContext, next: () => Promise<void>) => {
    record(ctx, 'inner:before');
    await next();
    record(ctx, 'inner:after');
  });

  app.use('/api/scoped', async (ctx: TestContext, next: () => Promise<void>) => {
    record(ctx, 'scoped:on');
    await next();
  });

  // `useRaw` is deliberately **not** here: a framework-native middleware has a
  // framework-native signature, so each transport supplies its own and the test
  // records which one it was.
}

/** The middleware trace of every request, keyed by `ctx.requestId`. */
export const traces = new Map<string, string[]>();

/** The trace of the most recent request. Read by the test, not by a handler. */
export function lastTrace(): readonly string[] {
  return traces.get(lastRequestId) ?? [];
}

/** The `X-Request-Id` of the most recent request, echoed by every transport. */
export let lastRequestId = '';

/** Appends a step to the request's trace, keyed by its correlation id. */
function record(ctx: TestContext, step: string): void {
  lastRequestId = ctx.requestId;
  const entry = traces.get(ctx.requestId) ?? [];
  entry.push(step);
  traces.set(ctx.requestId, entry);
}
/** The options every transport is started with. */
export const sharedOptions: HttpApplicationOptions = {
  // The prefix lives here rather than in @Controller('/api') on purpose: it
  // is applied by the adapter, so the test URLs are the same on a core that
  // composes the controller prefix into ullPath and one that does not.
  prefix: '/api',
  poweredBy: false,
  bodyParser: { limit: 1_000_000 },
};

/** The CORS policy every transport is started with. */
export const sharedCors = {
  origin: 'https://app.example.com',
  credentials: true,
} as const;

/** Re-exported so a test can assert on the lifecycle bus without a deep import. */
export { HttpEvent };
