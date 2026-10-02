# Errors

Errors become RFC 7807 problem documents, and the default renderer **drops the
message of anything that is not an `HttpException`**. That rule is the reason
this page exists.

## The shape

```json
{
  "type": "https://errors.example.com/gone",
  "title": "Gone",
  "status": 410,
  "detail": "This resource has been removed",
  "traceId": "0f9c…"
}
```

`traceId` is `ctx.requestId` — the `X-Request-Id` the client sent, or a
generated one. It is the join between a user's screenshot and your logs, and it
is capped at 200 characters because an attacker-controlled header flows into
every log line.

## Ending a request with an error

```ts
@Get('/products/:id')
async find(ctx) {
  const product = await ctx.call('db:product:find', ctx.params.id);
  if (!product) {
    return ctx.throw(HttpStatus.NOT_FOUND, {
      detail: 'No such product',
      type: 'https://errors.example.com/product-not-found',
    });
  }
  return product;
}
```

`throw()` sets the status, sets `Content-Type: application/problem+json`, sends
the document, and marks the context as written — so returning it is safe.

The exception classes are also available, and produce the same document:

```ts
import { NotFoundException, ConflictException } from '@medishn/toolkit';

throw new NotFoundException({ detail: 'No such product' });
throw new ConflictException({ detail: 'The slug is already taken' });
```

## What the default renderer does

| Thrown                                                      | Sent                                       |
| ----------------------------------------------------------- | ------------------------------------------ |
| `HttpException`                                             | its own status, title, `type` and `detail` |
| an error with a numeric `status` or `statusCode` in 400–599 | that status, with the message as `detail`  |
| anything else                                               | `500`, with **no message**                 |

The middle row is what lets a channel reject a call without importing an HTTP
class:

```ts
@Channel('orders')
class Orders {
  @On('cancel')
  cancel() {
    const error = new Error('the order has already shipped') as Error & { status: number };
    error.status = 409;
    throw error; // reaches the client as a 409
  }
}
```

The last row is the important one. A stack trace, a SQL fragment or a file path
in an error body is a disclosure bug, and it is the most common way a production
API leaks its internals. The message is still logged — on `http:request:error`,
with the context attached:

```ts
app.on(HttpEvent.RequestError, ({ event, error, ctx }) => {
  logger.error({ id: event.id, method: event.method, path: event.path, user: ctx.state.user }, error);
});
```

## Replacing the renderer

```ts
import { errorHandler, HttpException } from '@glandjs/http';

app.setErrorHandler((error, ctx) => {
  if (error instanceof HttpException) return errorHandler(error, ctx);
  ctx.json({ error: 'Something went wrong', traceId: ctx.requestId }, 500);
});
```

The signature is `(error, ctx)`, and it is the _terminal_ handler: it runs
instead of the chain, with the context already marked as failed. Returning from
it is enough — the pipeline does not write anything after it.

## Errors in middleware

A middleware that `throw`s reaches the error handler on every adapter. The
`try`/`catch` above it is what differs:

```ts
// Koa, Hono, node:http, and Fastify: a downstream throw reaches this catch.
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    ctx.status(503).json({ error: 'upstream unavailable' });
  }
});
```

On Express the catch does not fire for a downstream throw, because Express's
`next()` is a hand-off — the error is routed to the error handler instead. Both
paths reach the error handler; only the recovery point differs.
[Middleware → The Express caveat](middleware.md#the-express-caveat).

## `withErrors`

Makes the return path and the throw path symmetric, so a handler can
`return ctx.throw(404)` or `throw new NotFoundException()` and get the same
document:

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

## The 404

Unmatched requests get the same document, and the same `route:miss` event:

```json
{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Cannot GET /api/nope" }
```

Each adapter mounts it in the right place — behind the routes, or as the
framework's own not-found handler — so the response is identical everywhere.
`app.on(HttpEvent.RouteMiss, …)` is the place to count 404s, or to serve a
custom page.

## Body-size errors

```ts
app.use(bodyLimit(1_000_000)); // 1 MB
```

A `413` is raised while reading, not from `Content-Length` alone — a client
that lies about the declared length is exactly the case a limit exists for. The
middleware must be registered before the parsers.

## Statuses

Every status in the range is available:

```ts
import { HttpStatus } from '@medishn/toolkit';

ctx.throw(HttpStatus.TOO_MANY_REQUESTS, { detail: 'Slow down' }); // 429
ctx.throw(HttpStatus.PAYLOAD_TOO_LARGE, { detail: 'Body too large' }); // 413
```

| Code | Class                                  | Code | Class                           |
| ---- | -------------------------------------- | ---- | ------------------------------- |
| 400  | `BadRequestException`                  | 503  | `ServiceUnavailableException`   |
| 401  | `UnauthorizedException`                | 504  | `GatewayTimeoutException`       |
| 402  | `PaymentRequiredException`             | 409  | `ConflictException`             |
| 403  | `ForbiddenException`                   | 410  | `GoneException`                 |
| 404  | `NotFoundException`                    | 413  | `PayloadTooLargeException`      |
| 405  | `MethodNotAllowedException`            | 415  | `UnsupportedMediaTypeException` |
| 406  | `NotAcceptableException`               | 422  | `UnprocessableEntityException`  |
| 407  | `ProxyAuthenticationRequiredException` | 423  | `LockedException`               |
| 408  | `RequestTimeoutException`              | 429  | `TooManyRequestsException`      |
| 412  | `PreconditionFailedException`          | 500  | `InternalServerErrorException`  |
| 501  | `NotImplementedException`              | 502  | `BadGatewayException`           |
| 505  | `HttpVersionNotSupportedException`     | 418  | `ImATeapotException`            |
