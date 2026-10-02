# CORS

One implementation, in `@glandjs/http`, for all five adapters.

```ts
app.enableCors();                                          // origin: '*'
app.enableCors({ origin: 'https://app.example.com' });
app.enableCors({ origin: ['https://a.example.com', 'https://b.example.com'] });
app.enableCors({ origin: /\.example\.com$/, credentials: true });
app.enableCors({ origin: async (requestOrigin, cb) => { … } });
```

## Why it is not `loadPackage('cors')`

The obvious implementation for the Express adapter is to delegate to the `cors`
package. That gives three different CORS implementations across three adapters,
and CORS is exactly the kind of policy that has to be identical on every edge —
a policy that differs by framework is a data leak waiting to happen.

So the adapter takes an optional peer dependency instead. On Express,
`app.useRaw(cors())` still works if you want the package's behaviour; `enableCors`
is Gland's own.

## The policy

```ts
app.enableCors({
  origin: 'https://app.example.com',
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['content-type', 'authorization'],
  exposedHeaders: ['x-request-id'],
  credentials: true,
  maxAge: 600,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  vary: true,
});
```

Every option has a default, and the defaults match the `cors` package — so a
configuration that already works in an Express application ports over unchanged.

| Option                 | Default                          | Header                             |
| ---------------------- | -------------------------------- | ---------------------------------- |
| `origin`               | `'*'`                            | `Access-Control-Allow-Origin`      |
| `methods`              | `GET,HEAD,PUT,PATCH,POST,DELETE` | `Access-Control-Allow-Methods`     |
| `allowedHeaders`       | echo the preflight's request     | `Access-Control-Allow-Headers`     |
| `exposedHeaders`       | —                                | `Access-Control-Expose-Headers`    |
| `credentials`          | `false`                          | `Access-Control-Allow-Credentials` |
| `maxAge`               | `600`                            | `Access-Control-Max-Age`           |
| `vary`                 | `true`                           | `Vary: Origin`                     |
| `optionsSuccessStatus` | `204`                            | —                                  |

## Three details worth knowing

### `Vary: Origin` is on by default

Whenever the origin is _reflected_ rather than answered with `*`, the response
gets `Vary: Origin`. Without it, a shared cache stores one tenant's reflected
origin and hands it to the next tenant.

That is a data leak, and it costs one header line.

### `credentials: true` with `origin: '*'` is rejected at boot

The browser refuses that combination, so a config that says it is a bug in the
config:

```
CORS configuration is contradictory: `credentials: true` cannot be combined with
`origin: "*"`. The browser rejects it. List the allowed origins explicitly, or
set `credentials: false`.
```

Failing at boot means a deploy catches it. Failing at runtime means a production
console that says _"The value of the 'Access-Control-Allow-Origin' header … must
be '_' …"\* while the application looks healthy.

### `maxAge` is capped at 600

Chrome and Firefox both cap the preflight cache at ten minutes and log a warning
you will never see. `maxAge: 86400` becomes 600.

## Origin forms

```ts
origin: '*'; // any origin
origin: false; // no CORS headers at all
origin: 'https://a.example.com'; // exactly one
origin: ['https://a.example.com', /\.example\.com$/]; // a whitelist
origin: /\.example\.com$/; // a pattern
origin: true; // reflect whatever arrived
```

A whitelist is a whitelist, not a fallback list. A request matches if it equals
an entry or matches an entry's `RegExp`; anything else gets **no**
`Access-Control-Allow-Origin` header, which is what makes the browser block it.
Writing `null` would be a subtler version of the same refusal.

## A dynamic policy

```ts
app.enableCors({
  origin: async (requestOrigin, callback) => {
    const tenant = await tenants.findByDomain(requestOrigin);
    callback(null, tenant ? requestOrigin : false);
  },
});
```

`callback(null, false)` refuses. `callback(error)` is an error, not a refusal —
the request fails, and the error handler renders it.

## What the preflight looks like

```
OPTIONS /api/products HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type
```

```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, HEAD, POST
Access-Control-Allow-Headers: content-type
Access-Control-Max-Age: 600
Vary: Origin
```

It is answered inside the CORS middleware and never reaches a route — the
middleware ends the request without calling `next()`. That is what
`preflightContinue: true` turns off, and it is the only reason to: the route
would have to answer an `OPTIONS` that no browser expects a body for.

## Credentials

```ts
app.enableCors({ origin: 'https://app.example.com', credentials: true });
app.cookies.set('session', '…', { httpOnly: true, secure: true, sameSite: 'lax' });
```

With `credentials: true` the response also carries
`Access-Control-Allow-Credentials: true`, and the client needs
`fetch(url, { credentials: 'include' })`. `SameSite: 'none'` with `secure: true`
is what a cross-site cookie needs; a `SameSite: 'lax'` cookie is not sent on a
cross-origin `fetch` whatever CORS says.
