/**
 * One suite, six transports.
 *
 * The point of this file is not that Express works. It is that **the same
 * controller, the same middleware and the same assertions produce the same
 * results on all six** — which is the only claim `@glandjs/http` actually
 * makes. A behaviour that is correct on one adapter and quietly different on
 * another is a bug in the abstraction, and this is where it gets caught.
 *
 * Every case below is transport-agnostic on purpose. Where an adapter genuinely
 * cannot honour something, the difference is named in the case itself rather
 * than hidden in a per-adapter branch.
 */
import { strict as assert } from 'node:assert';
import { lastTrace, traces } from './app';
import type { Server } from 'node:http';

/** What every adapter's broker has to hand back. */
export interface Transport {
  name: string;
  /** Starts on an OS-assigned port. Resolves once it is accepting requests. */
  start(): Promise<number>;
  stop(): Promise<void>;
  /** Capabilities this transport cannot provide, and the cases to skip. */
  skip?: readonly string[];
}

const TIMEOUT = 20_000;

/** Issues a request and reads the whole body, without undici's decoding. */
async function request(port: number, path: string, init?: RequestInit): Promise<{ status: number; headers: Headers; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: response.status, headers: response.headers, body: await response.text() };
}

function json(data: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

/**
 * Runs the shared assertions against one transport.
 *
 * Exported so `test/integration/adapters.spec.ts` can call it per transport,
 * rather than duplicating the table six times.
 */
export async function verify(transport: Transport): Promise<void> {
  const skip = new Set(transport.skip ?? []);
  const port = await transport.start();

  const check = async (label: string, fn: () => Promise<void>): Promise<void> => {
    if (skip.has(label)) return;
    try {
      await fn();
    } catch (error) {
      throw new Error(`[${transport.name}] ${label}\n${error instanceof Error ? error.message : String(error)}`);
    }
  };

  try {
    await check('an object return is JSON', async () => {
      const response = await request(port, '/api/echo/42');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      assert.deepEqual(JSON.parse(response.body), { n: 42 });
    });

    await check('a string return is text/plain', async () => {
      const response = await request(port, '/api/text');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
      assert.equal(response.body, 'plain text');
    });

    await check('an HTML-looking string is sniffed as HTML', async () => {
      const response = await request(port, '/api/html');
      assert.match(response.headers.get('content-type') ?? '', /text\/html/);
      assert.equal(response.body, '<h1>Hello</h1>');
    });

    await check('a number return is JSON, not a bare digit', async () => {
      const response = await request(port, '/api/number');
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      assert.equal(response.body, '42');
    });

    await check('an explicit reply carries status and headers', async () => {
      const response = await request(port, '/api/created');
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('location'), '/api/echo/1');
      assert.deepEqual(JSON.parse(response.body), { id: 1 });
    });

    await check('204 carries no body', async () => {
      const response = await request(port, '/api/empty');
      assert.equal(response.status, 204);
      assert.equal(response.body, '');
    });

    await check('route parameters are captured', async () => {
      const response = await request(port, '/api/users/7');
      assert.deepEqual(JSON.parse(response.body), { id: '7' });
    });

    await check('a repeated query key becomes an array', async () => {
      const response = await request(port, '/api/query?tag=a&tag=b&one=1');
      assert.deepEqual(JSON.parse(response.body), { tag: ['a', 'b'], one: '1' });
    });

    await check('a JSON body is parsed', async () => {
      const response = await request(port, '/api/body', json({ hello: 'world' }));
      assert.deepEqual(JSON.parse(response.body), { received: { hello: 'world' } });
    });

    // A browser posts a form as `a=1&b=2`, and a handler that works on four
    // transports must not have to reach for `URLSearchParams` on the fifth. This
    // existed for Hono, which returned the raw string and nothing else.
    await check('a urlencoded body is parsed into an object', async () => {
      const response = await request(port, '/api/body', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'a=1&b=2',
      });
      assert.deepEqual(JSON.parse(response.body), { received: { a: '1', b: '2' } });
    });

    await check('a channel is reachable through ctx.call', async () => {
      const response = await request(port, '/api/greet?name=Gland');
      assert.deepEqual(JSON.parse(response.body), { greeting: 'Hi Gland' });
    });

    await check('ctx.throw produces problem details', async () => {
      const response = await request(port, '/api/conflict');
      assert.equal(response.status, 409);
      const problem = JSON.parse(response.body);
      assert.equal(problem.status, 409);
      assert.equal(problem.detail, 'Deliberate conflict');
      assert.equal(problem.type, 'https://errors.example.com/conflict');
    });

    await check('an unhandled error is a 500 with no leaked message', async () => {
      const response = await request(port, '/api/boom');
      assert.equal(response.status, 500);
      assert.ok(!response.body.includes('super-secret-token'), `the error message leaked: ${response.body}`);
    });

    await check('a stream is piped', async () => {
      const response = await request(port, '/api/stream');
      assert.equal(response.body, 'chunk-achunk-bc');
    });

    await check('a 404 is a problem document, not a framework page', async () => {
      const response = await request(port, '/api/nope');
      assert.equal(response.status, 404);
      const body = JSON.parse(response.body);
      assert.ok(body.error || body.title, `expected a structured 404, received: ${response.body.slice(0, 120)}`);
    });

    await check('the middleware onion wraps the handler', async () => {
      await request(port, '/api/echo/1');
      assert.deepEqual([...lastTrace()], ['outer:before', 'inner:before', 'inner:after', 'outer:after'], `expected a nested onion, recorded: ${lastTrace().join(' → ')}`);
    });

    await check('a path-scoped middleware only runs on its prefix', async () => {
      traces.clear();

      await request(port, '/api/scoped/yes');
      assert.ok(lastTrace().includes('scoped:on'), 'the scoped middleware did not run on its own prefix');

      traces.clear();
      await request(port, '/api/echo/1');
      assert.ok(!lastTrace().includes('scoped:on'), `the scoped middleware ran on an unrelated path: ${lastTrace().join(' → ')}`);
    });

    await check('framework-native middleware still runs, in call order', async () => {
      const response = await request(port, '/api/echo/1');
      assert.equal(response.headers.get('x-gland-raw'), 'raw');
    });

    await check('CORS is enabled with the configured origin', async () => {
      const response = await request(port, '/api/echo/1', { headers: { origin: 'https://app.example.com' } });
      assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com');
      assert.match(response.headers.get('vary') ?? '', /Origin/);
    });

    await check('a CORS preflight is answered without reaching a route', async () => {
      const response = await request(port, '/api/echo/1', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET' },
      });
      assert.equal(response.status, 204);
      assert.match(response.headers.get('access-control-allow-methods') ?? '', /GET/);
    });

    await check('a cookie round-trips', async () => {
      const set = await request(port, '/api/cookie');
      const raw = set.headers.getSetCookie?.()[0] ?? set.headers.get('set-cookie') ?? '';
      assert.match(raw, /gland_session=/);
      // Attribute names are case-insensitive in HTTP, and `koa`'s `cookies`
      // package lower-cases them. Matching case-sensitively would be asserting a
      // spelling, not a behaviour.
      assert.match(raw, /httponly/i, `expected HttpOnly in: ${raw}`);

      const read = await request(port, '/api/cookie', { headers: { cookie: 'gland_session=abc123' } });
      assert.deepEqual(JSON.parse(read.body), { session: 'abc123' });
    });

    await check('a response header set by a handler survives', async () => {
      const response = await request(port, '/api/headers');
      assert.equal(response.headers.get('x-custom'), 'set-by-handler');
    });

    await check('a 200 status is not turned into a 204', async () => {
      const response = await request(port, '/api/empty-200');
      assert.equal(response.status, 200);
    });

    await check('an extended method reaches its route', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/webdav`, { method: 'PROPFIND' });
      assert.equal(response.status, 200, `PROPFIND returned ${response.status}`);
      assert.equal(await response.text(), 'webdav');
    });

    await check('a redirect is followed by Location, not by a body', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/old`, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/api/echo/1');
    });
  } finally {
    await transport.stop();
  }
}

/** A helper the transports share: a server handle for the node-based ones. */
export type { Server, TIMEOUT };
