---
'@glandjs/node': minor
'@glandjs/hono': minor
---

`useStaticAssets()` on `@glandjs/node` was a no-op — the adapter ignored the
option. It now queues a wildcard route, which is all `serveStatic` needs.

`ctx.body` on Hono is an object for an `application/x-www-form-urlencoded`
request, parsed with `URLSearchParams`. It used to be the raw body string, so a
handler written against the other four adapters had to reach for
`URLSearchParams` itself.

`useRaw()` on both reports that it was ignored rather than failing silently. On
Hono a raw middleware can add headers but cannot change the status or the body,
because a fetch `Response` is immutable.
