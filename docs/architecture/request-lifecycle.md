# The request lifecycle

What happens, in order, for one request. Every step below is implemented once, in
`HttpServerAdapter`, and is identical on all five adapters unless the
[difference matrix](../api/adapter-matrix.md) says otherwise.

## Boot

```
  GlandFactory.create(AppModule)
    │  container → explorer → binder
    │  the binder binds channels, then broadcasts every route it found
    ▼
  app.connectTo(ExpressBroker, options)
    │  1. new ExpressAdapter()            → onInitialize runs: settings,
    │                                      the error handler, the 404 handler
    │  2. new ExpressCore(options)         → bodyParser, prefix, views, static
    │  3. broker.initialize()             → subscribes to gland:define:route
    │  4. binder replay                    → 19 routes arrive, buffered
    ▼
  app.use(auth) · app.useRaw(compression) · app.enableCors(…)
    │  buffered, interleaved in call order
    ▼
  app.listen(3000)
    │  finalize(): flush middleware → deferred plugins → register routes → 404
    ▼
  ready → the port is bound
```

Two things are worth noticing.

**Routes are buffered, not registered.** They arrive at step 3 and are
registered at step 5, after the middleware the user declared at step 4. See
[Ordering](README.md#3-ordering-is-decided-once-by-buffering).

**`listen()` is not `await`ed, and `ready()` is.** `app.listen(3000)` reads
better than `await app.listen(3000)` in a bootstrap file, and an
`await app.listen(3000)` that nobody awaits is a lint error either way. When the
port has to be open before the next line, use `ready()`:

```ts
app.listen(0, { host: '127.0.0.1' });
await app.ready();
console.log(app.port); // the *bound* port, not the requested one
```

`listen(0)` asks the OS for a free port, which is the only way to bind in a
test without a race.

## One request

```
  GET /api/products/1?expand=reviews
  │
  ▼  1. the framework matches a route and hands over (req, res)
  │
  ▼  2. createContext(req, res)          — memoised, so middleware and the
  │                                        handler see the same object
  │
  ▼  3. syncParams(ctx, req)             — Express fills req.params *here*
  │
  ▼  4. http:request:start               — { id, method, path, url, ip }
  │
  ▼  5. the Gland middleware chain, in registration order
  │        collectBody → cors → auth → …
  │        each one may read, may write, may hand the next an error
  │
  ▼  6. route.action(ctx, …)             — the controller, reached by name
  │        │
  │        └─ ctx.call('db:product:find') → the core bus → a channel
  │
  ▼  7. respond(result, ctx)             — skipped when ctx.responded
  │        toReplyPayload() → write()
  │
  ▼  8. http:request:error               — only when the handler threw
  ▼     errorHandler(error, ctx)         — RFC 7807, message dropped for a 500
  │
  ▼  9. http:request:end                 — { status, duration }, always
  ▼
  the socket
```

### Step 2 — the context is memoised

Middleware runs before the router matches, so it is the first thing to reach the
context. Whatever it puts in `ctx.state` has to be what the handler sees, which
is why `createContext` is idempotent.

### Step 3 — parameters are re-synced

Express fills `req.params` inside the route handler; Koa's router sets
`ctx.params` on Koa's own context. Both happen _after_ the middleware that
already built the context. `syncParams` re-reads them so `ctx.params` means the
same thing everywhere.

### Step 5 — the onion

```ts
app.use(async (ctx, next) => {
  const started = Date.now();
  await next(); // everything downstream
  logger.info(`${ctx.method} ${ctx.path} ${Date.now() - started}ms`);
});
```

`next` is a real call on Koa, Hono and `node:http`, so a downstream `throw`
reaches this `try`/`catch`. It is a hand-off on Express and Fastify — see
[The Express caveat](../guides/middleware.md#the-express-caveat) for what that
costs and what to do instead.

A middleware that answers instead of calling `next()` — a CORS preflight, a
rate-limit rejection, a cache hit — stops the chain. Steps 6 to 8 never run.
The response is whatever the middleware wrote, and the pipeline does not
interfere.

### Step 7 — the reply

The handler's return value goes through one function, and the adapter writes it:

| Returned             | Written as                                          |
| -------------------- | --------------------------------------------------- |
| `undefined` / `null` | nothing — the handler already answered              |
| `HttpReply`          | exactly what it says                                |
| a readable           | piped to the socket                                 |
| an `SseStream`       | `text/event-stream`, with the heartbeat             |
| a `Buffer`           | raw bytes                                           |
| a string             | `text/plain`, or `text/html` if it sniffs as markup |
| a `SseStream`        | as above                                            |
| anything else        | `application/json`                                  |

### Step 8 — the error

An `HttpException` sends its own status, title and `type`. Anything else is a
`500` with the message **dropped** — a stack trace, a SQL fragment or a file path
in an error body is a disclosure bug, and it is the most common way a production
API leaks its internals. Log it on `http:request:error`; do not send it.

### Step 9 — the completion

Always, including on the failure path. A metrics exporter that misses
`request:end` for a failed request leaks a counter on exactly the requests that
failed, which is the worst possible time to be wrong.

## Shutdown

```ts
const stop = async (signal: string) => {
  await http.close(); // drain in-flight requests, release the socket
  await shutdown(signal); // run the Gland lifecycle hooks
  process.exit(0);
};
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
```

`close()` is safe when the server was never started, and it calls
`closeIdleConnections()` so a 5-second keep-alive does not become a 5-second
shutdown. Fastify's `close()` refuses new requests and waits for in-flight ones;
the other four use `server.close()` with the idle sockets closed out from under
it.

## Events

| Event                   | Fires                                           |
| ----------------------- | ----------------------------------------------- |
| `http:route:registered` | a route reaches the adapter                     |
| `http:route:miss`       | nothing matched, before the 404                 |
| `http:request:start`    | a request is accepted, before any middleware    |
| `http:request:end`      | a request finishes, always                      |
| `http:request:error`    | a request threw, with the context attached      |
| `http:server:listening` | the socket is bound, with the resolved port     |
| `http:server:closed`    | the socket is released                          |
| `http:server:crashed`   | a listener threw, or the server failed to start |

`http:server:crashed` is the one to watch. A lifecycle bus is observability, not
control flow: a listener that throws is a bug in the listener, and it is
reported rather than allowed to become an unhandled rejection in the middle of a
request.
