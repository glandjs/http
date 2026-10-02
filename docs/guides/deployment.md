# Deployment

Everything between `listen()` and a process that a load balancer can talk to:
TLS, proxies, graceful shutdown, static files, templates, and the health check
that makes a rolling deploy safe.

## The smallest correct bootstrap

```ts
import { GlandFactory } from '@glandjs/core';
import { ExpressBroker } from '@glandjs/express';

const { app, shutdown } = await GlandFactory.create(AppModule);

const http = app.connectTo(ExpressBroker, {
  poweredBy: false,
  bodyParser: { json: { limit: '256kb' } },
});

http.listen(Number(process.env.PORT ?? 3000), { host: '0.0.0.0' });

const stop = async (signal: string): Promise<void> => {
  await http.close();
  await shutdown(signal);
  process.exit(0);
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
```

Two details are load-bearing:

**`host: '0.0.0.0'`.** The default is `localhost`. In a container that binds only
the loopback interface, so the port is open and nothing can reach it — which
presents as a healthy container that never receives a request.

**Drain before you exit.** `http.close()` refuses new connections and waits for
in-flight ones. Without it, a rolling deploy cuts a response mid-body, and the
client sees a truncated payload rather than a retryable error.

## `listen()` is synchronous, `ready()` is how you wait

```ts
http.listen(3000); // binds, returns immediately
await http.ready(); // middleware mounted, routes registered, plugins loaded
```

`listen()` calls `finalize()` internally — that is what mounts middleware and
registers routes — but it does not wait for it, because `app.listen(3000)` reads
better than `await app.listen(3000)` in a bootstrap file. `ready()` is where the
waiting happens, and it also resolves the bound port.

```ts
http.listen(0); // ask the OS for a free port
await http.ready();
console.log(http.port); // the real port, not 0
```

That matters in tests and in a Lambda-style handler, and it is why
`http:server:listening` reports the **bound** port rather than the requested
one — reporting `0` makes every subsequent request fail with an opaque
`fetch failed`.

## TLS

Present, even as `{}`, switches the socket to `node:https`:

```ts
app.connectTo(ExpressBroker, {
  https: { key: readFileSync('tls/key.pem'), cert: readFileSync('tls/cert.pem') },
});
```

Fastify and Hono own their servers and take their own `tls` option. The adapter
logs which one won rather than silently ignoring yours.

In production, terminating TLS at a proxy is usually the better trade — cert
renewal stops being an application problem. In that case do not set `https`,
and see the next section.

## Behind a proxy

`trustProxy` decides whether `X-Forwarded-*` is believed.

```ts
app.connectTo(ExpressBroker, { trustProxy: 'loopback' }); // a proxy I control
```

`trustProxy: true` means _any_ client can set `X-Forwarded-For`. That is not a
formality: it is how a rate limiter is bypassed and how `ctx.ip` becomes
attacker-controlled. Scope it to the hop you actually trust — an address, a
subnet, or a hop count.

| Setting                       | `ctx.ip` and `ctx.protocol`                     |
| ----------------------------- | ----------------------------------------------- |
| unset                         | the socket's address, and `http`                |
| `'loopback'`, `1`, an address | the forwarded values, from the trusted hop only |

## Graceful shutdown

```ts
let closing = false;

const stop = async (signal: string): Promise<void> => {
  if (closing) return; // a second SIGTERM must not double-close
  closing = true;

  http.close().catch((error) => logger.error({ error }, 'close failed'));
  await shutdown(signal); // the application's own resources
  process.exit(0);
};
```

The order is: stop accepting, drain, release. `close()` does the first two and
emits `http:server:closed` when it is done; `shutdown()` from
`GlandFactory` releases what the application opened — channels, timers, database
pools.

`server.closeIdleConnections()` is called by the adapters, so a keep-alive
connection that is not mid-request does not hold the process open.

**Exit explicitly.** A server with an open handle will not end the process, and a
container that ignores `SIGTERM` is killed at the grace period with requests in
flight.

## Health checks

Two endpoints, and they are not the same thing:

```ts
@Controller()
class HealthController {
  /** Liveness — is the process up? Never touches a dependency. */
  @Get('/healthz')
  live() {
    return { ok: true };
  }

  /** Readiness — can it serve? Checks what serving actually needs. */
  @Get('/readyz')
  @All('/readyz')
  async ready(ctx) {
    try {
      await ctx.call('db:ping');
      return { ok: true };
    } catch (error) {
      ctx.status(503);
      return { ok: false };
    }
  }
}
```

Liveness that queries a database is a self-inflicted outage: a slow dependency
makes the orchestrator kill every replica, which makes the dependency slower
still. Liveness answers "is this process wedged", and only that.

Readiness is the one that should fail when a dependency is down, because it is
what removes the replica from the load balancer without killing it.

## Static files

```ts
http.useStaticAssets('public', { prefix: '/assets/', maxAge: '1y', immutable: true });
```

Delegated to the framework's own handler — `express.static`, `serve-static`,
`@fastify/static`, `koa-static`, `hono/serve-static`. Two consequences:

- **Path traversal protection is that package's job, and it differs between
  them.** Pin it and keep it patched. On `@glandjs/node` a static mount is a
  wildcard route and is your business entirely.
- **Order is not yours to control.** The mount is queued with the middleware, so
  a `useStaticAssets` after a catch-all middleware never runs.

## Templates

```ts
app.connectTo(ExpressBroker, {
  views: { engine: require('ejs'), directory: 'views', extension: 'ejs' },
});
```

`engine` is a **resolved module**, not a name. Gland has no opinion about which
template engine you use, and a string lookup would be a silent failure waiting
for the first render.

Gland has no opinion about templates at all — `views` is passed through, and
`render()` is the framework's. A handler that returns HTML gets `text/html` and
a 200; a handler that returns a path does not get rendered for you.

## Proxy headers and HTTPS redirects

`ctx.protocol` reads the socket, so behind a TLS-terminating proxy it says
`http` unless `trustProxy` is set. A redirect built from it sends the user back
to `http://` and the browser refuses.

```ts
http.use(async (ctx, next) => {
  await next();
  if (ctx.secure === false && ctx.getHeader('x-forwarded-proto') === 'https') {
    ctx.location(ctx.url); // tell the client to retry over TLS
  }
});
```

Only safe because `trustProxy` is already scoped to a hop you control. Without
it, the check is trivially bypassed.

## Checklist

|                                    |                                                           |
| ---------------------------------- | --------------------------------------------------------- |
| `host: '0.0.0.0'`                  | not `localhost`, or nothing can reach the container       |
| `SIGTERM` handled, drained, exited | or a deploy cuts responses in half                        |
| `trustProxy` scoped                | `true` lets a client forge its own IP                     |
| `/healthz` touches nothing         | a database check here restarts the whole fleet            |
| `/readyz` checks a dependency      | so a broken one leaves the pool                           |
| Body limit set                     | the default is 100 kB; confirm it is the number you meant |
| `poweredBy: false`                 | do not advertise the stack to a scanner                   |
