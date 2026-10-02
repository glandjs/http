# Controllers and routes

A controller is a class with a path and some decorated methods. It never imports
a service and never touches `res`.

## Declaring routes

```ts
@Controller('/products')          // from @glandjs/common
export class ProductController {
  @Get()                          // GET  /products
  list(ctx) { … }

  @Get('/:id')                    // GET  /products/:id
  find(ctx) { … }

  @Post('/')                      // POST /products
  create(ctx) { … }
}
```

The path is the controller's prefix plus the handler's own path, and the core
composes them. `@Controller('/')` with `@Get('/health')` is `GET /health`.

Route decorators come from **`@glandjs/http`**, not from the adapter and not from
`@glandjs/common`. That is deliberate: a controller should not have to change
when the transport does, and a route declaration that lived in the adapter
package would.

## Every method

| Decorator                                                           | Method                | Native on                                  |
| ------------------------------------------------------------------- | --------------------- | ------------------------------------------ |
| `@Get` `@Post` `@Put` `@Patch` `@Delete` `@Head` `@Options`         | the usual seven       | all five                                   |
| `@All`                                                              | every method          | all five, expanded per adapter             |
| `@Trace` `@Connect` `@Purge`                                        | HTTP/1.1 and RFC 9111 | express, koa, hono, node                   |
| `@Search`                                                           | RFC 5323              | express, koa, hono, node; fastify too      |
| `@Propfind` `@Proppatch` `@Mkcol` `@Copy` `@Move` `@Lock` `@Unlock` | WebDAV                | express, koa, hono, node; fastify for most |
| `@Acl` `@Report`                                                    | WebDAV                | express, koa, hono, node                   |

A path may be an array, and each entry becomes its own route:

```ts
@Get(['/summary', '/overview'])
index(ctx) { … }
```

### How a method that a framework does not know is registered

`@Propfind()` is a real, supported route — not a fallback that 404s. Each
adapter spells it differently:

- **Express** has seven verbs, so the route is registered with `all()` plus a
  method guard. A `PROPFIND` reaches the handler and a `PUT` falls through.
- **Fastify** calls `addHttpMethod()` first, which is Fastify's own extension
  point. `PROPFIND` and `SEARCH` are in `node:http#METHODS` and work;
  `MKWORKSPACE` is not, and the adapter warns at boot that the route is not
  available rather than failing the request later.
- **Koa and Hono** take any method string. Nothing to do.
- **`node:http`** compiles the pattern itself, so a method is just a string.

## The global prefix

```ts
app.connectTo(ExpressBroker, { prefix: '/api' }); // or
app.setGlobalPrefix('/api');
```

Every route registered afterwards is prefixed. The application is responsible for
applying it — the core does not know about it — which means:

- **do not mount a router at the prefix as well.** Paths are already prefixed, so
  a `Router` mounted at `/api` serves `/api/api/products`
- the prefix is applied once, even if set twice
- `ctx.path` is the path as the client sent it, with the prefix included, because
  the router is what matched

## Route handlers

A handler is `(ctx) => unknown`. Its return value is the response — see
[Replies](replies.md) — and `ctx.params` holds what the router captured.

```ts
@Get('/:id/reviews/:reviewId')
async review(ctx) {
  return ctx.call('db:review:find', { id: ctx.params.id, reviewId: ctx.params.reviewId });
}
```

`ctx.params` is populated before the handler runs, and re-synced at that moment
rather than when the context was built. Express fills `req.params` inside the
route handler and Koa's router sets them on Koa's own context, so a context that
a middleware created first has none until the router has matched — which is why
the pipeline re-reads them.

## Routes without a controller

```ts
app.get('/health', (ctx) => ({ ok: true }));
app.post('/webhooks/:provider', handleWebhook);
```

`app.get` is `HttpCore.get` and takes the same `(path, action)` pair as
`@Get()`. Use it for endpoints that are not part of a controller's tree — health
checks, a webhook, a debug route.

The verb methods are declared explicitly rather than generated, because they are
the API surface a reader is looking for:

```
get  post  put  patch  delete  head  options
all  trace  connect  purge  search
propfind  proppatch  mkcol  copy  move  lock  unlock  acl  report
```

Anything outside that list goes through `registerRoute(method, path, action)`.

## The route table

```ts
for (const route of app.routes) {
  console.log(route.method, route.path, route.origin);
}
```

`origin` is where the route came from — `decorator`, `manual`, or `replay` — which
is how you tell a controller route from one you registered by hand. `replay` is
the interesting one: it means the core published it during bootstrap and the
adapter picked it up afterwards, which is the normal order.

`app.settings.routeCount` is the same number without the iteration.

## When no route arrives

If a controller route is missing, the broker says so:

```
[HTTP:Broker] ERROR This HTTP adapter received no routes from the application binder.
  …@glandjs/core replays its route log to an adapter that attaches later — that
  replay is what makes `app.connectTo(Broker)` work at all, and it is not present
  in @glandjs/core <= 1.0.3-beta.
```

That message means the core is older than the HTTP layer expects, or the
application module declares no controllers. It is deliberately loud: the
alternative is a healthy-looking server that `404`s every controller route, with
nothing in the log to explain it.
