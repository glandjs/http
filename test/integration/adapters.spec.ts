/**
 * @remarks
 * `GlandFactory.create()` resolves to `{ app, shutdown }`. The `boot()` helper
 * unwraps it, so only this function would change if the core's factory shape
 * moves again.
 */
import 'reflect-metadata';
import { GlandFactory } from '@glandjs/core';
import { HttpCore, HttpEvent, type HttpApplicationOptions } from '@glandjs/http';
import { ExpressBroker } from '@glandjs/express';
import { FastifyBroker } from '@glandjs/fastify';
import { HonoBroker } from '@glandjs/hono';
import { KoaBroker } from '@glandjs/koa';
import { NodeBroker } from '@glandjs/node';
import type { Constructor } from '@medishn/toolkit';
import { AppModule, sharedCors, sharedMiddleware, sharedOptions } from '../shared/app';
import { verify, type Transport } from '../shared/contract';

/** Every broker hands back the same shape, whatever its framework. */
type HttpApp = HttpCore<any, any, any, any, any, any>;

/** Boots the shared module. One per transport, so each gets a clean bus. */
async function boot() {
  const { app } = await GlandFactory.create(AppModule);
  return app;
}

/** Express, with a framework-native `useRaw` probe. */
function expressTransport(): Transport {
  let http: HttpApp | undefined;

  return {
    name: 'express',
    async start() {
      const app = await boot();
      http = app.connectTo(ExpressBroker, sharedOptions) as HttpApp;
      sharedMiddleware(http);
      http.enableCors(sharedCors);
      http.useRaw((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
        res.setHeader('x-gland-raw', 'raw');
        next();
      });
      http.listen(0, { host: '127.0.0.1' });
      await http.ready();
      return http.port!;
    },
    async stop() {
      await http?.close();
    },
  };
}

/**
 * Fastify.
 *
 * `useRaw` has no meaning here — Fastify has no `use()` — so the "framework
 * middleware" case is skipped rather than faked.
 */
function fastifyTransport(): Transport {
  let http: HttpApp | undefined;

  return {
    name: 'fastify',
    skip: ['framework-native middleware still runs, in call order'],
    async start() {
      const app = await boot();
      http = app.connectTo(FastifyBroker, sharedOptions) as HttpApp;
      sharedMiddleware(http);
      http.enableCors(sharedCors);
      http.listen(0, { host: '127.0.0.1' });
      await http.ready();
      return http.port!;
    },
    async stop() {
      await http?.close();
    },
  };
}

/** Koa, with a Koa-native `useRaw` probe. */
function koaTransport(): Transport {
  let http: HttpApp | undefined;

  return {
    name: 'koa',
    async start() {
      const app = await boot();
      http = app.connectTo(KoaBroker, sharedOptions) as HttpApp;
      sharedMiddleware(http);
      http.enableCors(sharedCors);
      http.useRaw(async (ctx: any, next: () => Promise<void>) => {
        ctx.set('x-gland-raw', 'raw');
        await next();
      });
      http.listen(0, { host: '127.0.0.1' });
      await http.ready();
      return http.port!;
    },
    async stop() {
      await http?.close();
    },
  };
}

/** Hono, with a Hono-native `useRaw` probe. */
function honoTransport(): Transport {
  let http: HttpApp | undefined;

  return {
    name: 'hono',
    async start() {
      const app = await boot();
      http = app.connectTo(HonoBroker, sharedOptions) as HttpApp;
      sharedMiddleware(http);
      http.enableCors(sharedCors);
      http.useRaw(async (c: any, next: () => Promise<void>) => {
        c.header('x-gland-raw', 'raw');
        await next();
      });
      http.listen(0, { host: '127.0.0.1' });
      await http.ready();
      return http.port!;
    },
    async stop() {
      await http?.close();
    },
  };
}

/** `node:http`, which has no framework-native middleware to mount at all. */
function nodeTransport(): Transport {
  let http: HttpApp | undefined;

  return {
    name: 'node',
    skip: ['framework-native middleware still runs, in call order'],
    async start() {
      const app = await boot();
      http = app.connectTo(NodeBroker, sharedOptions) as HttpApp;
      sharedMiddleware(http);
      http.enableCors(sharedCors);
      http.listen(0, { host: '127.0.0.1' });
      await http.ready();
      return http.port!;
    },
    async stop() {
      await http?.close();
    },
  };
}

/** A transport, and the broker class it is booted from. */
interface TransportCase {
  /** Boots a fresh server on an ephemeral port. */
  transport: () => Transport;
  /** What `connectTo()` takes, for the cases that build a server themselves. */
  broker: Constructor<any>;
}

const CASES: TransportCase[] = [
  { transport: expressTransport, broker: ExpressBroker },
  { transport: fastifyTransport, broker: FastifyBroker },
  { transport: koaTransport, broker: KoaBroker },
  { transport: honoTransport, broker: HonoBroker },
  { transport: nodeTransport, broker: NodeBroker },
];

describe('the HTTP adapter contract', function () {
  this.timeout(120_000);

  it('registers every controller route through the binder', async () => {
    const app = await boot();
    const http = app.connectTo(ExpressBroker, sharedOptions as HttpApplicationOptions) as HttpApp;

    const routes = http.routes.map((route) => `${route.method} ${route.path}`);

    // The regression this exists for: the broker used to read `payload.meta.path`
    // from a route broadcast that carries `fullPath`, so every controller route
    // silently failed to register and only manual `app.get()` calls worked.
    //
    // The expected path is matched as a suffix because `fullPath` is the core's
    // to compose: `@glandjs/core@1.0.3-beta` emits the handler path alone
    // (`/echo/:n`), while a core that combines the controller prefix emits
    // `/api/echo/:n`. Both are correct for their core, and the adapter must not
    // care which.
    assertSome(routes, 'GET', '/echo/:n');
    assertSome(routes, 'GET', '/greet');
    assertSome(routes, 'POST', '/body');
    assertSome(routes, 'PROPFIND', '/webdav');

    await http.close();
  });

  it('reports a 500 without leaking the error message', async () => {
    const app = await boot();
    const http = app.connectTo(NodeBroker, sharedOptions) as HttpApp;
    http.listen(0, { host: '127.0.0.1' });
    await http.ready();

    const response = await fetch(`http://127.0.0.1:${http.port}/api/boom`);
    const body = await response.text();

    assertEqual(response.status, 500);
    assertEqual(body.includes('super-secret-token'), false, `the message leaked: ${body}`);

    await http.close();
  });

  /**
   * `bodyParser: false` means no parser is installed, on every transport.
   *
   * The default is the safe answer: a handler that expects an object should get
   * `undefined` rather than a body nobody chose to parse. This pins that on all
   * five, because `node:http` used to collect the bytes unconditionally — it has
   * exactly one way to read a body, so the collector was mounted whether it was
   * asked for or not, and `bodyParser: false` did nothing at all.
   */
  for (const { transport, broker } of CASES) {
    const name = transport().name;

    it(`${name} installs no body parser unless one is declared`, async () => {
      const app = await boot();
      // Everything except `bodyParser`, which is the subject of the test.
      const { bodyParser: _declared, ...withoutParser } = sharedOptions;
      const http = app.connectTo(broker, withoutParser as HttpApplicationOptions) as HttpApp;
      http.listen(0, { host: '127.0.0.1' });
      await http.ready();

      const response = await fetch(`http://127.0.0.1:${http.port}/api/body`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });
      const parsed = JSON.parse(await response.text()) as { received: unknown };

      assertEqual(parsed.received, undefined, `${name} parsed a body with no parser declared`);

      await http.close();
    });
  }

  for (const { transport } of CASES) {
    const { name } = transport();

    it(`${name} implements the whole contract`, async () => {
      await verify(transport());
    });
  }
});

/** Asserts a `METHOD path` entry exists, with a readable failure. */
function assertSome(routes: readonly string[], method: string, pathSuffix: string): void {
  const match = routes.some((route) => route.startsWith(`${method} `) && route.endsWith(pathSuffix));
  if (!match) {
    throw new Error(`expected a "${method}" route ending in "${pathSuffix}", received:\n  ${routes.join('\n  ')}`);
  }
}

/** Asserts equality, with a readable failure. */
function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

/** Re-exported so the suite reads without a deep import. */
export { HttpEvent };
