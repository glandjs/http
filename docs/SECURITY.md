# Security policy

## Reporting a vulnerability

Please **do not open a public issue.** Email
[bitsgenix@gmail.com](mailto:bitsgenix@gmail.com) with:

- the package (`@glandjs/http`, `@glandjs/express`, `@glandjs/fastify`,
  `@glandjs/koa`, `@glandjs/hono`, `@glandjs/node`) and its version
- what an attacker can do, not just what breaks
- a minimal reproduction if you have one

You will get an acknowledgement. Fixes for a confirmed issue ship as a `patch`
changeset, and the advisory is published after the release — not before, so there
is a version to upgrade to.

## Supported versions

All six packages are released in lockstep from this repository.

| Line         | Versions     | Fixes               |
| ------------ | ------------ | ------------------- |
| `1.1.0-beta` | `1.1.x-beta` | yes                 |
| `1.0.x`      | any          | security fixes only |

`main` publishes under the `beta` tag. Beta is the _release channel_, not a
statement that the code is unreviewed — the adapters are covered by the same
[contract suite](development/CONTRIBUTING.md#testing) that ships on `main`.

## Where the risk actually is

This layer is a request pipeline, so most of what matters is in the adapters.
Worth knowing about before you configure them:

**Body parsing.** `@glandjs/http` installs no parser of its own; each adapter
uses its framework's. The limit defaults to 100 kB, not to the framework's own
default, because those defaults differ and the larger ones are generous for JSON.
See [Bodies and uploads](guides/bodies.md).

**CORS.** `enableCors()` is one implementation shared by all five adapters, so a
policy behaves the same everywhere. It is a _browser_ policy — it does not stop
a non-browser client. See [CORS](guides/cors.md).

**Cookie `maxAge`.** Gland's unit is **milliseconds**. `@fastify/cookie` uses
**seconds**; the adapters convert. Forwarding the number unchanged produces a
cookie that expires immediately.

**Error bodies.** An unhandled error is logged in full on the server and reduced
to an RFC 7807 problem on the wire. A stack trace, a file path or a secret in a
message does not reach the client. See [Errors](guides/errors.md).

**Static mounts.** `useStaticAssets()` delegates to the framework's own static
handler — `express.static`, `serve-static`, `@fastify/static`, `koa-static`,
`hono/serve-static`. Path traversal protection is that package's job, and it
differs between them. Pin it and keep it patched.

## Hardening checklist

```ts
app.connectTo(ExpressBroker, {
  bodyParser: { json: { limit: '256kb' } },
  poweredBy: false, // do not advertise the stack
  trustProxy: 'loopback', // only if a proxy you control sets X-Forwarded-*
  https: { key, cert }, // terminate TLS here, or set nothing behind a proxy
});

http.enableCors({
  origin: 'https://app.example.com', // a list, not '*'
  credentials: true,
});
```

`trustProxy: true` means _any_ client can set `X-Forwarded-For`, which is how a
rate limiter is bypassed. Scope it to the hop you trust.

## Resources

- [OWASP](https://owasp.org)
- [Node.js security](https://nodejs.org/en/docs/guides/security/)
- [RFC 7807 — problem details](https://datatracker.ietf.org/doc/html/rfc7807)
