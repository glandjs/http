# Middleware

Gland's middleware is a promise-based onion. It is the Koa model rather than the
Express one, and the choice is deliberate — see
[The Express caveat](#the-express-caveat) for what that costs on one adapter.

## The shape

```ts
app.use(async (ctx, next) => {
  const started = Date.now();
  await next(); // everything downstream
  ctx.setHeader('x-duration', String(Date.now() - started));
});
```

`await next()` waits for the rest of the chain. A downstream `throw` reaches this
`try`/`catch`:

```ts
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    // Recover, and answer instead of propagating.
    ctx.status(503).json({ error: 'upstream unavailable' });
  }
});
```

To hand an error to the chain — which is what `next(err)` is for:

```ts
if (!ctx.getHeader('authorization')) {
  await ctx.next(new HttpException(401, { detail: 'Missing bearer token' }));
}
```

## Path scoping

```ts
app.use('/api', rateLimit);
app.use(['/admin', '/internal'], audit);
```

The prefix is matched on a **segment boundary**: `/api` matches `/api` and
`/api/x`, and not `/apixyz`. The check runs per request rather than by mounting
once per path, so an array mounts a single entry.

## The two kinds

```ts
app.use(async (ctx, next) => { … });          // Gland, on the onion
app.useRaw(compression());                     // framework, unmolested
app.useStaticAssets('./public');               // a static mount
```

`useRaw` is for anything Gland does not wrap: `express.static()`,
`@fastify/helmet()`, a rate limiter with its own store. It is mounted in call
order alongside `use`, so interleaving behaves the way it reads.

What each adapter accepts:

|         | `use` | `useRaw`                                     |
| ------- | ----- | -------------------------------------------- |
| express | yes   | yes, `(req, res, next)`                      |
| fastify | yes   | **no** — register a plugin                   |
| koa     | yes   | yes, `(ctx, next)`                           |
| hono    | yes   | yes, `(c, next)`; headers it adds are merged |
| node    | yes   | **no** — there is no `use()`                 |

`useRaw` on Fastify and `node:http` is reported rather than ignored, because a
silently-dropped `compression()` leaves an application that believes it is
compressed.

## When a middleware does not call `next`

The chain stops. Everything after it — including the route handler — does not
run, and what the client receives is what the middleware wrote.

```ts
app.use(async (ctx, next) => {
  if (ctx.method === 'OPTIONS') {
    ctx.status(204).end(); // the preflight is answered here
    return; // and `next()` is deliberately not called
  }
  await next();
});
```

This is how CORS works, and how a cache hit or a rate-limit rejection avoids
reaching a handler that would do work whose result is not needed.

## Order

The three kinds of registration are buffered and mounted together, in this
order, when the server starts:

1. the framework's own configuration
2. the middleware queue, **in call order**
3. the routes
4. the catch-all 404, behind everything

So this reads top to bottom and behaves top to bottom:

```ts
app.useStaticAssets('./public'); // 1st
app.useRaw(compression()); // 2nd
app.use(requireAuth); // 3rd
app.use('/api', rateLimit); // 4th
app.enableCors(); // 5th
app.get('/health', handler); // after all of them
```

Note that `app.get()` may appear before `app.use()` in your source and the
middleware still runs first. `connectTo()` has to come before `use()` — it is
what produces the application — so the routes are registered before the
middleware is declared; buffering is what makes the call order irrelevant.

The one that catches people is the 404. It is mounted **after** the routes,
because a catch-all mounted before them answers first and returns "not found"
for everything.

## The Express caveat

Express's `next()` is a hand-off, not a call. The bridge resolves as soon as
Express moves downstream:

```ts
// Koa, Hono, node:http — and Fastify, via its composed hook.
app.use(async (ctx, next) => {
  const started = Date.now();
  await next(); // the downstream half has finished
  metrics.timing('route', Date.now() - started);
});

// Express — `metrics.timing` records the hand-off, not the route.
```

What still works on Express:

- `next(err)` reaches the error handler
- the error handler runs
- path scoping
- ordering against `useRaw`

What does not: measuring or transforming anything _after_ the hand-off, from
upstream middleware.

The workarounds, in the order worth trying:

1. **Move it downstream.** Timing belongs in a middleware registered _after_ the
   one you want to measure, or in the handler.
2. **Use the lifecycle events**, which are transport-agnostic and carry a
   duration computed by the pipeline after the response:

   ```ts
   app.on(HttpEvent.RequestEnd, ({ method, path, status, duration }) => {
     metrics.timing('http.request', duration, { method, path, status });
   });
   ```

3. **Use another adapter** if the onion is the point.

## Built in

```ts
app.enableCors({ origin: 'https://example.com', credentials: true });
```

One implementation for all five adapters, because a CORS policy that differs
per framework is a data leak waiting to happen. See [CORS](cors.md).

## Errors

```ts
app.setErrorHandler((error, ctx) => {
  if (error instanceof HttpException) return errorHandler(error, ctx);
  ctx.json({ error: ctx.requestId }, 500);
});
```

The default renders RFC 7807 problem details and drops the message of anything
that is not an `HttpException`. See [Errors](errors.md).

## Writing your own

`withErrors` makes the return path and the throw path symmetric, so a handler can
`return ctx.throw(404)` or `throw new NotFoundException()` with the same result:

```ts
import { withErrors } from '@glandjs/http';

app.get(
  '/orders/:id',
  withErrors(async (ctx) => {
    const order = await ctx.call('db:order:find', ctx.params.id);
    if (!order) return ctx.throw(HttpStatus.NOT_FOUND);
    return order;
  }),
);
```

`bodyLimit` rejects an oversized body before the parsers run, because a parser
that has already buffered a 2 GB upload has already lost:

```ts
app.use(bodyLimit(1_000_000));
```
