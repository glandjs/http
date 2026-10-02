# Bodies and uploads

`@glandjs/http` does not parse bodies. Parsing is a security decision — limits,
encodings, content types — and every framework makes it differently. What the
layer provides is one declaration, in a framework-neutral shape, that each
adapter translates.

## Declaring parsers

```ts
app.json({ limit: '2mb' });
app.urlencoded({ extended: true });
app.text();
app.raw();
```

or in one place:

```ts
app.connectTo(ExpressBroker, {
  bodyParser: { json: { limit: '2mb' }, urlencoded: { extended: true } },
});
```

or nothing, which is the default:

```ts
app.bodyParser(false);
```

**Nothing is parsed until you declare it, on all five transports.** An API that
never declares a parser wants a JSON post rejected with a `415`, not an unparsed
body handed to a handler that expects an object.

| Option       | Express  | Fastify                  | Koa              | Hono                | `node:http`        |
| ------------ | -------- | ------------------------ | ---------------- | ------------------- | ------------------ |
| `json`       | built in | built in, **already on** | `koa-bodyparser` | read in middleware  | `JSON.parse`       |
| `urlencoded` | built in | `@fastify/formbody`      | `koa-bodyparser` | read in middleware  | `URLSearchParams`  |
| `text`       | built in | —                        | `koa-bodyparser` | read in middleware  | `toString('utf8')` |
| `raw`        | built in | —                        | —                | **not possible**    | `Buffer`           |
| `multipart`  | `multer` | `@fastify/multipart`     | `@koa/multer`    | `c.req.parseBody()` | `@fastify/busboy`  |

"Built in" means _no package to install_ — not _mounted for you_. Express ships
`express.json` and `express.urlencoded` but only runs them once `app.json()` says
so, and neither does Gland. Every adapter needs a declaration; they differ only
in which package implements it.

`limit` defaults to 100 kB, not to the framework's own default. `koa-bodyparser`
defaults to 1 MB, which is generous for JSON and is part of why the CVE history
of that package is what it is.

### One framework needs an extra step

Fastify is the only adapter where the parser is on before you ask. To make the
default consistent the adapter calls `removeContentTypeParser('application/json')`
when nothing was declared; declaring a parser keeps Fastify's and adds the plugins
above.

It has to be _removed_ rather than skipped, and it has to happen before
`ready()` — which is why the answer is computed in `onInitialize` and applied
through `defer()`, not in `bodyParser()`, which `HttpCore` calls from its
constructor.

## Reading `ctx.body`

```ts
@Post('/products')
async create(ctx) {
  const body = ctx.body;             // already parsed, by content type
  return HttpReply.json(await ctx.call('db:product:create', body), { status: 201 });
}
```

`ctx.body` is whatever the declared parser produced for _this_ request's
`Content-Type`:

| `Content-Type`                           | `ctx.body`                                              |
| ---------------------------------------- | ------------------------------------------------------- |
| `application/json`, `application/*+json` | the parsed value                                        |
| `application/x-www-form-urlencoded`      | an object, with nesting on the adapters that support it |
| `text/*`                                 | a string                                                |
| anything else with `raw`                 | a `Buffer`                                              |
| anything else, or no parser              | `undefined`                                             |

Fastify and Hono have no `raw` body, so the adapter says so at boot rather than
handing you a string that looks like a buffer.

For a content type no parser above claims, two adapters expose the bytes
directly rather than parsing them:

|           | Express                      | Fastify | Koa | Hono                     | `node:http`                |
| --------- | ---------------------------- | ------- | --- | ------------------------ | -------------------------- |
| raw bytes | `ctx.body`, with `raw: true` | —       | —   | `ctx.rawText` (a string) | `ctx.rawBody` (a `Buffer`) |

`node:http` accumulates the bytes once and decodes on read, so `ctx.rawBody` is
always there and `ctx.body` is derived from it. A fetch body is read as text, so
Hono's is a `Buffer`-free string — re-buffering it would mean holding the whole
body twice.

## Ordering

Parsers are mounted in the middleware queue, which is flushed before the routes.
Declared in `HttpApplicationOptions.bodyParser`, they are queued first — by the
constructor — so a middleware that reads `ctx.body` sees a parsed body.

```ts
app.connectTo(ExpressBroker, { bodyParser: { json: true } }); // queued first
app.use(logRequestBody); // reads ctx.body
```

If you declare a parser _after_ a middleware that reads the body, that
middleware sees `undefined`. Call order is mount order.

## `maxAge`: the trap

Gland's cookie `maxAge` is **milliseconds**. `@fastify/cookie` uses **seconds**,
and `cookies` (Koa, Express) uses milliseconds. The adapter converts.

Forwarding the number unchanged produces a cookie that expires in under a
millisecond, which presents as "the cookie does not work" and is very hard to
debug from the symptom.

```ts
ctx.setCookie('session', token, { maxAge: 60_000 }); // one minute, everywhere
```

## Reading cookies

```ts
const session = ctx.getCookie('gland_session');
const all = ctx.cookies; // { name: { value, signed } }
```

`ctx.cookies` works on every adapter **without** a cookie-parser package. On
Express, `req.cookies` is `undefined` until `cookie-parser` is mounted, and a
controller reading a session cookie should not have to know that — so the header
is parsed directly when the framework has not.

Values are percent-decoded and unquoted, because that is what `setCookie` writes.

`signedCookies` is `{}` on Express, Fastify, Hono and `node:http` — signing needs
a secret and a parser that Gland should not take a position on. Koa returns the
real thing if a signed-cookie middleware is mounted.

## Uploads

No adapter parses `multipart/form-data` by default, and the Express adapter
**throws** if you ask it to:

```
Express cannot parse multipart/form-data on its own. Install `multer` and mount
it with `app.useRaw(uploader)`, then read `req.file` in your controller.
```

The reason is not effort. A streaming upload through a buffering parser is how a
10 MB video becomes a 10 MB heap spike, and every framework's default is to
buffer.

```ts
// Express
import multer from 'multer';
app.useRaw(multer({ dest: './uploads', limits: { fileSize: 10 * 1024 * 1024 } }).single('file'));

@Post('/documents')
upload(ctx) {
  return { received: (ctx.req as any).file.filename };
}
```

| Adapter | Do                                                                                |
| ------- | --------------------------------------------------------------------------------- |
| express | `app.useRaw(multer({…}).single('file'))`                                          |
| fastify | `app.fastify.register(require('@fastify/multipart'))`                             |
| koa     | `app.useRaw(require('@koa/multer')({ … }))`                                       |
| hono    | `await ctx.req.parseBody()` in the handler                                        |
| node    | stream the request yourself; `collectBody` buffers, so raise the limit or skip it |

## Enforcing a limit early

```ts
app.use(bodyLimit(1_000_000));
app.json();
```

`bodyLimit` must be registered before the parsers, because a parser that has
already buffered the upload has already lost. On `node:http` the limit is
enforced _while reading_ rather than from `Content-Length`, which is the only
place a lying client is caught.

## `raw`

```ts
app.raw(); // */* into a Buffer
```

Not available on Hono: a fetch body is read as text, and re-buffering it would
mean holding the whole thing in memory twice. The adapter warns at boot and
`ctx.rawText` carries what was read.
