# Replies

A handler's **return value is the response**. One shared function decides what
each value means, and every adapter writes it the same way — which is why
`return 42` is `42` on Express and on Hono rather than a JSON `42` on one and a
bare `42` on the other.

## What a handler may return

| Returned                          | Written as                             | `Content-Type`                                      |
| --------------------------------- | -------------------------------------- | --------------------------------------------------- |
| an object, array, number, boolean | JSON                                   | `application/json; charset=utf-8`                   |
| a string                          | text                                   | `text/plain`, or `text/html` if it sniffs as markup |
| a `Buffer` / `Uint8Array`         | raw bytes                              | `application/octet-stream`                          |
| a `Readable`                      | piped to the socket                    | from the stream, if it has one                      |
| an `SseStream`                    | a live event stream                    | `text/event-stream`                                 |
| a `HttpReply`                     | exactly what it says                   | whatever it says                                    |
| `undefined` / `null`              | nothing — the handler already answered |                                                     |
| a `ctx.…` result                  | nothing — the context wrote it         |                                                     |

```ts
@Get('/product/:id')  find(ctx) { return ctx.call('db:product:find', ctx.params.id); }
@Post('/products')    create(ctx) { return HttpReply.json(ctx.body, { status: 201 }); }
@Get('/report')       report(ctx) { return Readable.from(rows); }
@Get('/ping')         ping() { return 'ok'; }
@Get('/count')        count() { return 42; }
```

### Why a number is JSON

`return 42` produces `42` with `application/json`, not a bare `42` and not
`"42"`. The alternative is a response with no type information at all, and a
client that has to guess. A string is how you ask for text.

### Why a string is sniffed for HTML

`return '<h1>Hello</h1>'` is `text/html`. A handler that returns markup almost
always means markup, and `text/plain` makes a browser show the tags.

The sniff is narrow on purpose — a leading `<!doctype html`, `<html`, or one of
about twenty block-level tags. A loose test such as "contains a `<`" would
mislabel `a < b` as markup, and turn an API error message into a download
prompt.

### How to override it

```ts
return HttpReply.text(csv, { contentType: 'text/csv; charset=utf-8' });
return HttpReply.html('<h1>Hi</h1>');
return ctx.text(markdown);
```

## `HttpReply`

The explicit form, for a status or a header the return value cannot carry.

```ts
HttpReply.json(data, { status, headers, contentType })
HttpReply.text(body, { … })
HttpReply.html(body, { … })
HttpReply.xml(body, { … })
HttpReply.buffer(bytes, { … })
HttpReply.stream(readable, { … })
HttpReply.file(path, { filename, fileOptions })
HttpReply.redirect(url, status = 302, { … })
HttpReply.empty(status = 204, { … })
```

```ts
@Post('/products')
async create(ctx) {
  const product = await ctx.call('db:product:create', ctx.body);
  return HttpReply.json(
    { product },
    {
      status: 201,
      headers: { location: `/products/${product.id}`, 'x-request-id': ctx.requestId },
    },
  );
}
```

## Writing through the context

Every method below is fluent and marks the context as written, so returning it
is safe and returning something _else_ afterwards is ignored.

```ts
ctx.status(201);
ctx.setHeader('location', '/products/1');
return ctx.json({ id: 1 });
```

| Group   | Members                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| status  | `status(code)`, `redirect(url, status)`, `location(url)`                                                                            |
| body    | `send`, `json`, `html`, `text`, `xml`, `end`                                                                                        |
| headers | `setHeader`, `setHeaders`, `getHeader`, `getResponseHeader`, `hasHeader`, `hasResponseHeader`, `removeHeader`, `vary`, `attachment` |
| files   | `sendFile`, `download`                                                                                                              |
| cookies | `setCookie`, `clearCookie`, `deleteCookie`                                                                                          |
| streams | `sse()`                                                                                                                             |

`getHeader` reads the **request**; `getResponseHeader` reads the response. The
distinction matters because everything in this layer that inspects a header —
`accepts`, CORS, the body parsers — is asking what the client sent.

## `return ctx.redirect(url)`

`redirect()` returns `this`, so `return ctx.redirect(url)` is the natural
spelling. The pipeline skips a context that has already answered.

Without that, the pipeline sees a returned value, assumes the handler did not
answer, and tries to serialise the context — which hits its circular references,
throws, and produces a `500` from a handler that actually sent a `302`. It is
worth knowing this is what `written` is for.

## `204`

A `204` carries no body. Koa, `node:http` and Hono all need to be told: Koa
infers `204` from a `null` body, and undici throws when a `204` is constructed
with one.

```ts
ctx.status(204).end(); // 204
ctx.status(200).send(''); // 200 with an empty text body
return HttpReply.empty(204); // the explicit form
```

## Streaming

```ts
@Get('/export')
async export(ctx) {
  const file = createReadStream('/tmp/report.csv');
  return file;                       // piped
}
```

`pipeline` rather than `pipe`, so a mid-stream error destroys the response
instead of leaving a truncated body behind a `200` that has already been sent. A
`pipe` failure is silent, and the client sees a valid-looking empty download.

## Server-sent events

```ts
@Get('/events')
async events(ctx) {
  const sse = ctx.sse();                       // heartbeat every 15s by default

  sse.send({ ready: true });
  const timer = setInterval(() => sse.send({ tick: Date.now() }), 1000);

  ctx.events.once(HttpEvent.RequestEnd, () => {
    clearInterval(timer);
    sse.close();
  });

  return sse;
}
```

The class is a `Readable` underneath, so any adapter treats it as a stream, and
it buffers rather than writes directly — a controller can build the stream and
hand it to application code, and the adapter decides when the bytes leave.

Two details that are easy to get wrong and are handled:

- **a multi-line payload is split across `data:` lines.** A bare newline would
  be parsed as a field name and dropped by the client.
- **`X-Accel-Buffering: no` is set.** Nginx buffers proxied responses by
  default, which defeats the entire mechanism; the header is a no-op everywhere
  else.

Backpressure is honoured — `push()` returning `false` pauses the writes — so a
fast producer will not buffer an entire event history in memory on a slow
client.

## Status codes at a glance

| Code             | How                                                       |
| ---------------- | --------------------------------------------------------- |
| 200              | `return value`                                            |
| 201              | `HttpReply.json(body, { status: 201 })`                   |
| 204              | `ctx.status(204).end()` or `HttpReply.empty()`            |
| 302              | `ctx.redirect(url)` or `HttpReply.redirect(url, 302)`     |
| 400, 404, 409, … | `ctx.throw(status, { detail })` — see [Errors](errors.md) |
| 500              | a `throw`, rendered without the message                   |
