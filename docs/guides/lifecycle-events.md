# Lifecycle events

The HTTP layer publishes what its server is doing on a bus of its own. It exists
so logging, metrics and tracing can observe the transport **without being inside
it** — a middleware that only watches costs nothing when it returns, and can be
removed without touching the request path.

## Two buses, not one

This is the thing to get right first.

| Bus              | Carries                                        | Reached by                         |
| ---------------- | ---------------------------------------------- | ---------------------------------- |
| The **core** bus | Your application: channels, route declarations | `ctx.call('db:product:find', id)`  |
| The **HTTP** bus | The transport: requests, routes, the socket    | `http.on(HttpEvent.RequestEnd, …)` |

They are separate objects with separate namespaces. `ctx.call()` never reaches a
lifecycle event, and a lifecycle listener never sees an application event. That
separation is what lets an application call a channel named `http:request:start`
without colliding with the framework.

```ts
import { HttpEvent } from '@glandjs/http';

// Observation — does not run in the request path
http.on(HttpEvent.RequestEnd, (e) => metrics.timing('http.request', e.duration, { route: e.path, status: e.status }));

// Application — reaches your own code
const product = await ctx.call('db:product:find', ctx.params.id);
```

## The nine events

| Event                   | Payload                  | When                                                            |
| ----------------------- | ------------------------ | --------------------------------------------------------------- |
| `http:options`          | `HttpApplicationOptions` | Once, during construction, and replayed to the first subscriber |
| `http:route:registered` | `RegisteredRoute`        | A route reached the framework's router                          |
| `http:route:miss`       | `HttpContext`            | Nothing matched — **before** the 404 is rendered                |
| `http:request:start`    | `RequestLifecycleEvent`  | A request was accepted, before any middleware                   |
| `http:request:end`      | `RequestLifecycleEvent`  | A request finished — **always**, including failures and aborts  |
| `http:request:error`    | `{ event, error, ctx }`  | Something threw                                                 |
| `http:server:listening` | `ServerListeningEvent`   | The socket bound                                                |
| `http:server:closed`    | `ServerClosedEvent`      | `close()` finished                                              |
| `http:server:crashed`   | `ServerCrashedEvent`     | Boot failed, or a listener threw                                |

They are plain strings, not symbols, so a listener can be attached from a config
file or another process's debug tooling. The `HttpEvent` map is the typed
spelling:

```ts
import { HttpEvent } from '@glandjs/http';

http.on(HttpEvent.RequestStart, ({ method, path }) => logger.info(method, path));
```

`HttpEvent.RequestStart` and the string `'http:request:start'` are the same key.

## What is on a lifecycle payload

```ts
interface RequestLifecycleEvent {
  id: string; // X-Request-Id, or a generated one — the correlation key
  method: string; // upper-case wire method
  path: string; // no query string
  url: string; // full URL as received
  ip?: string; // honours X-Forwarded-For when trustProxy is on
  startedAt: number; // Date.now() at the start
  status?: number; // populated on request:end
  duration?: number; // populated on request:end, in ms
  timestamp: string; // ISO
}
```

`status` and `duration` are populated on `request:end` and absent on
`request:start`. `id` is the one worth keeping: `ctx.requestId` is the same
value, so a log line from a handler and a metric from a listener join on it.

```ts
http.on(HttpEvent.RequestStart, (e) => logger.info({ requestId: e.id }, 'start'));
http.use(async (ctx, next) => {
  await next();
  logger.info({ requestId: ctx.requestId }, 'done'); // the same id
});
```

## `request:end` always fires

A listener on `request:end` is how you count _served_ requests rather than
_attempted_ ones. It is emitted for a 500, for a 404, for a client that hung up
mid-body, and for a middleware that short-circuited without calling a handler.

That is also its failure mode: the most common mistake is emitting a success
metric here without checking `status`, which silently reports a wave of 500s as
a healthy traffic increase.

```ts
http.on(HttpEvent.RequestEnd, (e) => {
  metrics.timing('http.request', e.duration ?? 0, {
    path: e.path,
    status: String(e.status), // never drop this
    method: e.method,
  });
});
```

## Adding your own events

`HttpEventRecord` is an open record, so an application can extend the map and
have its own events typed alongside the built-in ones.

```ts
import { HttpEventRecord } from '@glandjs/http';

interface MyHttpEvents extends HttpEventRecord {
  'http:quota:exceeded': { tenant: string; limit: number };
}

const http = app.connectTo(ExpressBroker<MyHttpEvents>, options);

http.on('http:quota:exceeded', ({ tenant, limit }) => metrics.increment('quota', { tenant, limit }));
```

## Observing without leaking

`safeEmit` is the reason a listener-free server is not slower than one with
listeners. It checks for a subscriber before emitting, so an unobserved
`request:start` costs one array length check rather than an emitter walk.

Two consequences worth knowing:

**A throwing listener does not break the request.** `http:server:crashed` is
emitted, and the server keeps serving. A metrics exporter that throws in the
request path takes down observability, not traffic — which is the correct
trade, and is why the crash event exists.

**`observe()` returns an unsubscribe function.** `on()` requires you to keep a
reference to a bound function to detach it, and a listener that leaks on a
long-lived server is a slow memory leak.

```ts
const stop = http.broker.observe(HttpEvent.RequestEnd, onEnd);
// later
stop();
```

## The five that are worth wiring up on day one

```ts
http.on(HttpEvent.ServerListening, ({ url, port }) => logger.info(`listening on ${url} (${port})`));
http.on(HttpEvent.ServerCrashed, ({ message, stack }) => logger.error(message, { stack }));
http.on(HttpEvent.RequestEnd, (e) => metrics.timing('http.request', e.duration ?? 0, { status: String(e.status), path: e.path }));
http.on(HttpEvent.RouteMiss, (ctx) => logger.debug({ path: ctx.path }, 'no route'));
http.on(HttpEvent.RequestError, ({ event, error }) => logger.warn({ requestId: event.id }, String(error)));
```

The first two matter on any server. The third is how you find a regression
before a customer does. The last two are what you turn on when something is
already wrong.

## See also

- [The request lifecycle](../architecture/request-lifecycle.md) — where each event sits in the order
- [Architecture → The lifecycle bus](../architecture/README.md) — why it is observability and not control flow
- [Errors](errors.md) — what the default renderer does with a throw
