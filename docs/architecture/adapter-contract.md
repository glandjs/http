# The adapter contract

`HttpServerAdapter` is the whole extension seam. An adapter contributes a
framework, a context, and a request listener; it inherits the request pipeline.

## The two rules

Everything else is detail. These two are not negotiable, and both were learned
from bugs that hid rather than failed.

### 1. `createContext` must be idempotent per request

Express and Koa expose the same object to every middleware _and_ to the route
handler. A middleware that writes `ctx.state.trace` and a handler that reads it
have to be looking at the same object, so `createContext` returns the context it
built earlier rather than a second one.

Three ways to do it, all equivalent:

```ts
// A property on the request — visible, but it is someone else's object.
Object.defineProperty(req, 'glandContext', { value: ctx, configurable: true });

// A symbol — invisible, and `Symbol.for` makes it a shared registry entry.
Object.defineProperty(ctx, CONTEXT_KEY, { value: glandCtx, configurable: true });

// WeakMap, when the framework object is not yours to extend.
const CACHE = new WeakMap<object, HttpContext>();
```

`@glandjs/node` walks the middleware chain itself and therefore memoises on a
symbol too.

### 2. `write` must not double-write

The base calls `write` only when `responded` is `false`, and expects the adapter
to mark the context as written before it starts. `responded` combines two
sources, and an adapter needs both:

```ts
get responded() {
  return this.written || this.res.headersSent || this.res.writableEnded;
}
```

- `this.written` — a fluent `ctx.json()` the handler called itself. Without it,
  `return ctx.redirect(url)` is serialised as a body.
- the transport's own signal — because a raw middleware or a framework error
  handler may have written the response without touching the context.

## What an adapter implements

| Member             | Responsibility                                                            |
| ------------------ | ------------------------------------------------------------------------- |
| `onInitialize`     | Framework settings, the error handler, the 404 handler. **Never routes.** |
| `createContext`    | Build (or recall) the context. Idempotent.                                |
| `registerRoute`    | Put one route on the framework's router.                                  |
| `useOne`           | Mount one framework-native middleware, unmolested.                        |
| `bridgeGland`      | Wrap one Gland middleware in the framework's signature.                   |
| `afterMiddleware`  | Optional. Between the middleware and the routes. Fastify needs it.        |
| `afterRoutes`      | Optional. Behind the routes. Express and Koa need it for the 404.         |
| `write`            | Write a resolved `ReplyPayload`.                                          |
| `responded`        | Whether a body would double-write.                                        |
| `bodyParser`       | Record the parsers the application asked for.                             |
| `useStaticAssets`  | Record a static mount.                                                    |
| `listen` / `close` | Bind and release the socket.                                              |

`bridgeGland` is the member worth reading first, because it is where the
framework's signature meets Gland's:

```ts
// Express — three arguments, so the bridged handler IS the middleware.
public bridgeGland(entry: MiddlewareEntry): RequestHandler {
  return (req, res, done) => { … };
}

// Koa and Hono — two arguments, same thing.
public bridgeGland(entry: MiddlewareEntry): Middleware {
  return async (ctx, next) => { … };
}

// Fastify — cannot take a per-request closure, so it records instead.
protected override mount(entry: MiddlewareEntry): void {
  this.chain.push({ middleware: entry.value as never, prefixes });
}
```

And `mount` in the base, which is the line most likely to be got wrong:

```ts
protected mount(entry: MiddlewareEntry): void {
  this.useOne(this.bridgeGland(entry));
}
```

The bridged handler is passed **as is**. Wrapping it in a second closure and
handing _that_ to the framework calls the bridge and discards the result — which
builds a middleware that never calls `next()`, stops the chain, and hangs every
request with a server log full of nothing.

## What an adapter inherits

Everything in [Overview](README.md#1-the-core-owns-the-behaviour-the-adapter-owns-the-framework):

- `dispatch()` — the whole request pipeline, including the lifecycle events and
  the duration
- `respond()` — return value to body, unless the handler already answered
- `notFound()` — the 404, and `route:miss`
- `crash()` — a crash that a listener cannot escalate
- `route()` — prefix application, the route table, `route:registered`
- `use()` / `useRaw()` / `defer()` — the middleware queue
- `setGlobalPrefix()` / `setViewEngine()` / `setBaseViewsDir()`
- `finalize()` — the fixed mount order, idempotent

## Registering a route

```ts
public registerRoute(method: string, path: string, action): void {
  const entry = this.pendingRoute ?? { … };
  this.instance[toVerb(method)](path, (req, res) => this.dispatch(entry, req, res));
}
```

`pendingRoute` is set by the base for the duration of the call. Close over it
rather than reading `this.routes[length - 1]` later: the table grows, and by the
time a request arrives it holds every route the application has.

## The prefix, once

`HttpServerAdapter.route()` applies the global prefix to each path, so
`registerRoute` receives an already-prefixed path.

The rule that follows: **do not mount a router at the prefix as well.** A
`Router` mounted at `/api` with routes registered at `/api/products` serves
`/api/api/products` — and a 404 for every request the application exists to
answer. The Express adapter mounts nothing; the Koa adapter sets no router
prefix.

## Testing an adapter

The fastest useful test is the shared suite. Write a `Transport` that boots the
application, and let `verify()` run the assertions:

```ts
function myTransport(): Transport {
  let http: HttpApp | undefined;
  return {
    name: 'mine',
    // What this transport genuinely cannot do, named rather than hidden.
    skip: ['a cookie round-trips'],
    async start() {
      const { app } = await GlandFactory.create(AppModule);
      http = app.connectTo(MyBroker);
      http.listen(0, { host: '127.0.0.1' });
      await http.ready();
      return http.port!;
    },
    async stop() {
      await http?.close();
    },
  };
}
```

A case that needs a different expectation on your transport is a finding. Either
the case is wrong, or the abstraction has a hole — and the second is worth more
than the first.
