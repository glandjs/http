# Migrating to 1.1

The 1.1 release changed behaviour a caller can observe. This page is the list of
what to change, ordered by how likely it is to bite.

Most applications need one edit. The rest are silent — they still compile, still
run, and produce a different answer.

## `ctx.getHeader()` now reads the request

**The one that matters.** It read the _response_. Every consumer — CORS, content
negotiation, authentication, `isJson()` — was asking what the client sent.

```ts
// before — read the response, which is empty until you set it
ctx.getHeader('authorization');

// after
ctx.getHeader('authorization'); // the request header
ctx.getResponseHeader('content-type'); // the response header
ctx.hasResponseHeader('content-type'); // whether it is already set
```

If a middleware of yours used `getHeader` to check what _you_ had set on the way
out, it becomes `getResponseHeader`. That is the whole migration.

## `return ctx.redirect(url)` no longer 500s

It used to be re-serialised after the framework had already written it, which
produced a `500` with a circular-structure error. `HttpContext` now tracks
whether it has written:

```ts
ctx.written; // has anything been written yet
ctx.wrote(); // mark it, if you write through the framework yourself
ctx.responded; // has the framework already sent headers
```

If your handler writes through the raw response — `res.end()`, `reply.raw` — tell
the layer, or it will try to serialise the return value as well:

```ts
res.end('done');
ctx.wrote();
return;
```

## Declare a body parser

Nothing is parsed until you say so, on all five adapters. If `ctx.body` is
`undefined` in a handler that reads it, this is why:

```ts
app.connectTo(ExpressBroker, {
  bodyParser: { json: { limit: '2mb' }, urlencoded: { extended: true } },
});
```

**Fastify needs the opposite** if you relied on its default: it parses JSON
whether or not it is asked to, and the adapter removes the parser when nothing
is declared. If you were relying on that, declare one.

## `appOptions`, not `options()`

`HttpCore.options()` is now `appOptions`. The old name is the `OPTIONS` HTTP
verb, and a method cannot be both.

```ts
http.appOptions; // HttpApplicationOptions | undefined
```

## Deep imports moved

`packages/http` was reorganised. If you imported a path rather than the package
root, update it:

| Before                               | After                                 |
| ------------------------------------ | ------------------------------------- |
| `…/interface/app-options.interface`  | `…/interfaces/app-options.interface`  |
| `…/interface/cors-options.interface` | `…/interfaces/cors-options.interface` |
| `…/interface/http-headers.interface` | `…/interfaces/http-headers.interface` |
| `…/types/app-options.types`          | `…/interfaces/app-options.interface`  |
| `…/types/cors-options.types`         | `…/interfaces/cors-options.interface` |
| `…/types/route-action.type`          | `…/contracts/route-action`            |
| `…/http-events.const`                | `…/constants/http-events.const`       |
| `…/adapter/http.adapter`             | `…/adapter/http-adapter.abstract`     |

Note the singular `interface/` becoming plural `interfaces/`, and `types/`
splitting: options and headers are options, a route action is a contract. The
package root (`@glandjs/http`) is unchanged and is what you should be importing.
Everything a decorator or a handler needs is re-exported from there.

## Event names

`HTTP_EVENTS`, `RouterEvent`, `PipelineEvent` and `MiddlewareEvent` are
**deprecated aliases, not removals** — your code still compiles. The names were
ambiguous with application channels on a shared bus.

```ts
// before
http.on(RouterEvent.ROUTER_REGISTER, …);

// after
http.on(HttpEvent.RouteRegistered, …);
```

The unprefixed strings (`'router:register'`) are still accepted by `on()`. What
is gone is the ability to _subscribe_ to middleware execution as a separate
event — it is part of the request now, and `http:request:end` covers it.

## `useStaticAssets` on `@glandjs/node`

It was a no-op — the adapter ignored the option. It now queues a wildcard route.
If you served nothing and thought you did, you now serve it.

## Transports that need a decision, not a code change

Nothing to migrate, but worth knowing before you pick one:

|             |                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------- |
| Express     | `await next()` resolves at the hand-off, so an upstream `catch` cannot see a downstream throw |
| Fastify     | `MKWORKSPACE` and `UPDATE` cannot be routed                                                   |
| Hono        | no `raw` body; `useRaw` can add headers but cannot change the status                          |
| `node:http` | no `useRaw()`                                                                                 |
| Koa         | `poweredBy: false` is a no-op                                                                 |

[Adapter matrix](../api/adapter-matrix.md) has the full table.

## A checklist

- [ ] `ctx.getHeader` — request or response?
- [ ] `ctx.getResponseHeader` where you meant the response
- [ ] `bodyParser` declared if any handler reads `ctx.body`
- [ ] `ctx.redirect()` returns without a `500`
- [ ] `ctx.wrote()` after a manual write through the raw response
- [ ] `options()` → `appOptions`
- [ ] deep imports updated
- [ ] `RouterEvent` → `HttpEvent`
- [ ] `pnpm test` — the contract suite runs on all five transports

## See also

- [Changelog](../CHANGELOG.md) — where the per-package history lives
- [Adapter matrix](../api/adapter-matrix.md) — what each transport can and cannot do
- [Bodies and uploads](bodies.md) — the parser table
