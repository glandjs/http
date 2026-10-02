# The context

`HttpContext` is the whole public surface of the HTTP layer, and it is identical
on every adapter. A controller that takes an `HttpContext` — or an
`ExpressContext`, or a `KoaContext` — compiles against any of them.

It is an abstract class rather than a set of free functions, and that is the
load-bearing decision of the package: an adapter cannot implement it partially,
because TypeScript will not let a `KoaContext` forget `subdomains()`. That is
what makes changing a transport a refactor rather than a rewrite.

Take the narrowest one that helps. `ExpressContext` is typed, so a controller
that only needs the request should not depend on Express at all.

## Request

| Member                | Type                                          | Notes                                          |
| --------------------- | --------------------------------------------- | ---------------------------------------------- |
| `method`              | `RequestMethod`                               | upper case, e.g. `'GET'`                       |
| `path`                | `string`                                      | without the query string                       |
| `url` / `originalUrl` | `string`                                      | with the query string                          |
| `query`               | `Dictionary<string \| string[] \| undefined>` | a repeated key becomes an **array**            |
| `body`                | `any`                                         | whatever the declared parser produced          |
| `params`              | `Dictionary<string>`                          | filled by the router, `{}` when there are none |
| `headers`             | `Dictionary<string \| string[] \| undefined>` | lower-cased                                    |
| `getHeader`           | `HttpHeaderValue`                             | a **request** header                           |
| `hasHeader`           | `boolean`                                     | a **request** header                           |
| `hostname`            | `string`                                      | without the port                               |
| `host`                | `string \| undefined`                         | the `Host` header, without the port            |
| `ip`                  | `string \| undefined`                         | honours `X-Forwarded-For` with `trustProxy`    |
| `protocol`            | `string`                                      | `'http'` or `'https'`                          |
| `secure`              | `boolean`                                     |                                                |
| `subdomains`          | `string[]`                                    | most significant first                         |
| `xhr`                 | `boolean`                                     |                                                |
| `fresh` / `stale`     | `boolean`                                     | from the conditional headers                   |
| `accepts(types?)`     | `string \| false`                             | `q`-aware                                      |
| `is(type)`            | `string \| false \| null`                     | the `Content-Type` check                       |

### `query` collects repeats

`?tag=a&tag=b` is `{ tag: ['a', 'b'] }` on every adapter. Some frameworks keep
only the last value; a filter on a repeated parameter that silently loses its
values is a bug that does not reproduce in development.

### `getHeader` reads the request

`ctx.getHeader('origin')`, `ctx.getHeader('accept')` and
`ctx.getHeader('content-type')` are all things the **client** sent. A response
header is a different question with a different name — `getResponseHeader` — and
keeping them separate is what makes content negotiation, CORS and the body
parsers work at all.

### `accepts`

```ts
ctx.accepts(); // 'application/json', or the first listed
ctx.accepts('application/json'); // 'application/json' | false
ctx.accepts(['text/html', 'text/plain']); // the client's first acceptable
```

Implemented per adapter, because none of the frameworks expose the same thing.
On Hono and `node:http` it is hand-written; the point is one answer everywhere.

## Response

| Member                                    | Notes                                  |
| ----------------------------------------- | -------------------------------------- |
| `status(code)`                            | fluent                                 |
| `redirect(url, status = 302)`             | fluent, and marks the context written  |
| `location(url)`                           | `Location` without changing the status |
| `send`, `json`, `html`, `text`, `xml`     | fluent, and mark the context written   |
| `end()`                                   | status and no body                     |
| `setHeader`, `setHeaders`, `removeHeader` | response headers                       |
| `getResponseHeader`, `hasResponseHeader`  | response headers                       |
| `vary(fields)`, `attachment(filename)`    | fluent                                 |
| `responded`                               | whether a body would double-write      |

`responded` combines `written` with the transport's own signal, because a raw
middleware or a framework error handler may have written the response without
touching the context.

## Files and streams

| Member                                | Notes                                  |
| ------------------------------------- | -------------------------------------- |
| `sendFile(path, options?, fn?)`       | streams from disk                      |
| `download(path, filename?, options?)` | as an attachment                       |
| `sse(options?)`                       | a live event stream, also a `Readable` |

`sse()` returns an inert stream: safe to create before the response is ready, and
either return it from the handler or write to it directly and return nothing.
See [Replies → Server-sent events](replies.md#server-sent-events).

## Cookies

| Member                             | Notes                                                    |
| ---------------------------------- | -------------------------------------------------------- |
| `getCookie(name)`                  | one value                                                |
| `cookies`                          | `{ name: { value, signed } }`, no parser needed          |
| `signedCookies`                    | `{}` unless the framework has a signed-cookie middleware |
| `setCookie(name, value, options?)` | `maxAge` in **milliseconds**                             |
| `clearCookie(name, options?)`      | sets an expiry in the past                               |
| `deleteCookie(name, options?)`     | an alias of `clearCookie`                                |

## Gland

| Member                               | Notes                                       |
| ------------------------------------ | ------------------------------------------- |
| `call(event, payload, 'all'?)`       | invoke a channel handler, return its value  |
| `emit(event, payload)`               | invoke a channel handler, ignore the result |
| `state`                              | a per-request bag; assignment **merges**    |
| `setState(data)`                     | the explicit merge                          |
| `lifecycle`                          | the transport's event bus                   |
| `next(error?)`                       | advance the middleware chain                |
| `attachRegistry(brokerId, registry)` | `@internal`, called by the binder           |

### `state`

```ts
app.use(async (ctx, next) => {
  ctx.state = { startedAt: Date.now() }; // merges, so it cannot drop `b`
  await next();
});
```

Assignment merges rather than replaces, so `ctx.state = { a: 1 }` twice does not
lose `b`. A replace-on-assign bag is a source of "the value disappeared" bugs
that only happen when two middlewares set state.

### `call` reaches code by name

```ts
const product = await ctx.call('db:product:find', { id });
const all = await ctx.call('db:product:list', {}, 'all'); // fan out
ctx.emit('analytics:viewed', { id }); // fire and forget
```

The controller does not import the channel. The name is resolved through a
frozen registry the binder published, so a call is observable without patching
the callee, and one implementation is reusable by a WebSocket, a queue consumer
or a CLI.

An unknown name throws `UnknownEventError`, which lists the names that do exist.
A miss is a hard error rather than a silent no-op.

### `requestId`

```ts
ctx.requestId; // X-Request-Id, or X-Correlation-Id, or a UUID
ctx.startedAt; // when the context was built
ctx.elapsed; // ms since then
ctx.aborted; // the client hung up mid-response
```

Generated in the constructor, not lazily, so a crash in the first middleware is
still traceable. Capped at 200 characters, because an attacker-controlled header
that flows into every log line is a log-injection vector.

## Errors

```ts
ctx.throw(status, { detail, type, title, instance });
```

Sets the status, sets `application/problem+json`, sends the document and marks
the context written — so returning it is safe. See [Errors](errors.md).

## Using the framework directly

`app.instance` is the framework's own application, typed:

```ts
app.instance.set('trust proxy', 1); // Express
app.fastify.register(myPlugin); // Fastify
app.koa.keys = ['…']; // Koa
app.hono; // Hono, and the edge export
```

`app.adapter` is the same object at the Gland level, with
`routeTable`, `prefix`, `port`, `viewConfig` and `isFinalized` on it.

This is the escape hatch, and it is the right answer for framework settings Gland
does not model. It is the wrong answer for routing, body parsing or CORS, because
those are the parts the abstraction owns.
