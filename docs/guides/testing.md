# Testing

Two levels, and the split matters. **A unit test covers your code.** An
**integration test covers the transport**, and it is the only thing that proves
the same handler means the same thing on Express, Fastify, Koa, Hono and
`node:http`.

## A controller is a plain class

Nothing about a Gland controller is magic — it is a class with decorated methods,
and a decorated method is still a method.

```ts
@Controller('/users')
class UserController {
  constructor(private readonly users: UserStore) {}

  @Get('/:id')
  async find(ctx: HttpContext<any, any, MyEvents>) {
    const user = await this.users.byId(ctx.params.id);
    if (!user) return ctx.throw(HttpStatus.NOT_FOUND);
    return user;
  }
}

// The decorator adds metadata; the method is callable.
const result = await new UserController(store).find(fakeContext);
```

That is what makes the handler layer testable without a socket. Build a
context, call the method, assert on the return value — because on all five
adapters **the return value is the response**, so the return value _is_ the
assertion.

```ts
it('returns 404 for an unknown id', async () => {
  const ctx = contextFor({ params: { id: '404' } });
  await expect(new UserController(store).find(ctx)).rejects.toMatchObject({ status: 404 });
});
```

## `contextFor` — a context in one line

`test/shared/app.ts` in this repository has one. The shape is small: the abstract
`HttpContext` needs a request, a response and a broker.

```ts
import { HttpCore, type Constructor } from '@glandjs/http';
import { ExpressBroker } from '@glandjs/express';

const http = new HttpCore(undefined, {}) as unknown as MyApp;

export function contextFor(params: Record<string, string> = {}): MyContext {
  return { params, requestId: 'test', state: {}, startedAt: Date.now() } as unknown as MyContext;
}
```

For most tests that is enough, because a handler reads `params`, `body`, `query`
and `state`, and asserts on its return value. Reach for a real server when the
thing you are testing _is_ the transport.

## When you need a real server

Anything about headers, status codes, cookies, streaming, CORS or the error
shape. Those are written by the adapter, and a fake context proves nothing about
them.

```ts
describe('the upload endpoint', () => {
  let http: ExpressCore;
  let port: number;

  before(async () => {
    const { app } = await GlandFactory.create(AppModule);
    http = app.connectTo(ExpressBroker, { bodyParser: { multipart: true } });
    http.listen(0, { host: '127.0.0.1' }); // 0 = a free port from the OS
    await http.ready();
    port = http.port!;
  });

  after(async () => {
    await http.close();
  });

  it('stores the file', async () => {
    const form = new FormData();
    form.set('file', new Blob(['hello']), 'hello.txt');

    const response = await fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', body: form });

    expect(response.status).to.equal(201);
    expect(await response.json()).to.have.property('name', 'hello.txt');
  });
});
```

Four things in that block are not stylistic:

**`listen(0)` and then `http.port`.** Asking for a free port and then reading it
back is the only way to run these in parallel without a port collision. Reading
`http.port` _before_ `ready()` returns `undefined`.

**`host: '127.0.0.1'`.** On Windows, `localhost` resolves to `::1` first, and
`fetch` on `127.0.0.1` will not reach a server that bound the IPv6 loopback. The
failure is a `ECONNREFUSED` that has nothing to do with the code under test.

**`after()` closes.** An unclosed server keeps the process alive, and Mocha
`--exit` hides the leak rather than fixing it.

**`close()` in `after`, not `beforeEach`.** Rebuilding the app per test re-runs
every decorator and re-registers every route. That is slow, and on some adapters
it is also a leak.

## Test against the transport, not the mock

A test that stubs `ctx.send()` is testing your stub. If you need to assert on
what went over the wire, read the wire:

```ts
const response = await fetch(...);
assert.equal(response.headers.get('content-type'), 'application/json');
assert.equal(response.status, 409);
```

The adapter is where headers are set, cookies are serialised, `maxAge` is
converted and errors become RFC 7807. A mocked context skips all of it, which is
exactly the layer with the interesting bugs.

## The five-transport suite

The strongest test in this repository is `test/shared/contract.ts`: one set of
assertions, run against every adapter.

```ts
await check('a JSON body is parsed', async () => {
  const response = await request(port, '/api/body', json({ hello: 'world' }));
  assert.deepEqual(JSON.parse(response.body), { received: { hello: 'world' } });
});
```

A transport joins by supplying a name, a `start()`, a `stop()`, and — when it
genuinely cannot do something — a `skip`:

```ts
{
  name: 'fastify',
  skip: ['framework-native middleware still runs, in call order'],
  async start() { … },
  async stop() { … },
}
```

Name what a transport cannot do. A skip is a finding worth writing down; a
quietly different behaviour is not.

## What belongs in each suite

|                    |                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `test/unit`        | Reply coercion, path normalisation, cookie parsing, SSE framing, the router, the event bus — anything with no socket |
| `test/integration` | Headers, status codes, cookies, CORS, streaming, errors, middleware order, routing                                   |

The rule: if the assertion would still be true if the adapter were replaced with a
fake, it is a unit test.

## Two failure modes worth avoiding

**A test that passes on four transports.** That is not a framework quirk; it is a
hole in the abstraction. Either the adapter is wrong or the contract is missing
something — and both are worth a failing test before the fix.

**Asserting on a status you did not ask for.** `assert.equal(response.status, 200)`
passes just as happily against a `200` produced by the framework default as
against the one your handler meant. Assert the status you set.

## See also

- [Contributing → Testing](../development/CONTRIBUTING.md#testing) — the project's own rules
- [Writing an adapter → The test](../architecture/writing-an-adapter.md#5-the-test)
- [Lifecycle events](lifecycle-events.md) — asserting on the bus instead of the response
