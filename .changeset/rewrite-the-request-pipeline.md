---
'@glandjs/http': major
'@glandjs/express': major
'@glandjs/fastify': major
'@glandjs/koa': major
'@glandjs/hono': major
'@glandjs/node': major
---

Rework the request pipeline so the five adapters agree, and fix the bugs that
disagreement was hiding.

**Reading a header**

`ctx.getHeader()` read the _response_. Every caller of it — CORS, content
negotiation, auth — was asking what the client sent, so all of them were wrong.

- `ctx.getHeader(name)` now reads the **request** header.
- `ctx.getResponseHeader(name)` and `ctx.hasResponseHeader(name)` read the
  response.

**`return ctx.redirect(url)`**

A redirect was re-serialised after the framework had already written it, which
produced a `500` with a circular-structure error. The context now tracks whether
it has written, and a reply after that is ignored.

**Route registration**

`HttpBroker` read `payload.meta.path` from a route broadcast that carries
`fullPath`, so every controller route silently failed to register. Only manual
`app.get()` calls worked, and the failure presented as a `404` on every endpoint.

**Prefix**

Express and Koa applied the global prefix twice, producing `/api/api/...`.

**Body parsing**

`bodyParser: false` is now honoured everywhere. Fastify's built-in JSON parser
is removed when no parser is declared, and `node:http` no longer collects the
request bytes unconditionally.

**Replies**

`mount()` in the base adapter discarded the bridged handler, so every request
hung on Express and Koa. `HttpCore.settings` returned `undefined`. The HTTPS
listener was dropped by `ServerFactory.create`.

**Naming**

- `HttpCore.options()` is now `appOptions` — `options()` is the OPTIONS verb.
- `interfaces/` replaces `interface/`, and `types/` is merged into it.
- `HTTP_EVENTS`, `RouterEvent`, `PipelineEvent` and `MiddlewareEvent` are
  deprecated aliases, not removals.

**Packages**

`packages/http` is reorganised into `adapter/`, `constants/`, `context/`,
`contracts/`, `decorators/`, `enum/`, `events/`, `interfaces/`, `middleware/`,
`server/` and `utils/`, and the deep paths that moved are gone. `@glandjs/node`
is new: a zero-dependency `node:http` adapter, and the reference implementation
of the adapter contract.
