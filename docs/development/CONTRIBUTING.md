# Contributing to `@glandjs/http`

This repository is the HTTP transport layer for Gland. It is a monorepo: one
framework-agnostic core and one adapter per server.

Please read this before opening a pull request — most of the conventions below
exist because the alternative produced a bug that was hard to see.

---

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Support questions](#support-questions)
- [Getting set up](#getting-set-up)
- [Repository layout](#repository-layout)
- [Running the project](#running-the-project)
- [Coding guidelines](#coding-guidelines)
- [Testing](#testing)
- [Adding an adapter](#adding-an-adapter)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Releases](#releases)

---

## Code of conduct

Read [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md). Violations are not tolerated;
report them to the maintainers.

## Support questions

Do not open an issue for a usage question. Use:

- [GitHub Discussions](https://github.com/orgs/glandjs/discussions)
- the [Gland Discord](https://discord.gg/GtRtkrEYwR)

An issue that turns out to be a question gets closed with a pointer here, which
is faster for you and clearer for everyone else.

## Getting set up

**Requirements:** Node 20 or newer, pnpm 9 or newer, and git.

```sh
git clone https://github.com/glandjs/http.git
cd http
pnpm install
pnpm build
```

The workspace links `@glandjs/core` and `@glandjs/common` from the sibling
`../gland` checkout when one is present — see [Core version](#the-core-version)
below.

## Repository layout

```
http/
├── packages/
│   ├── http/          the framework-agnostic core — no framework imports
│   ├── express/       an Express 5 adapter
│   ├── fastify/       a Fastify 5 adapter
│   ├── koa/           a Koa 3 adapter
│   ├── hono/          a Hono 4 adapter, for Node and the edge
│   └── node/          a node:http adapter, zero dependencies
├── docs/
│   ├── architecture/  the five ideas, the contract, the lifecycle
│   ├── guides/        task-oriented
│   ├── api/           the reference and the adapter matrix
│   └── development/   this file
├── examples/          one runnable service per adapter
└── test/
    ├── unit/          framework-agnostic behaviour
    ├── shared/        the application and the contract both suites run
    └── integration/   the contract, against all five transports
```

`packages/http` must never import a server framework. A cycle that starts that
way is very hard to see and very hard to undo.

Each adapter has the same five files:

| File         | Responsibility                                                               |
| ------------ | ---------------------------------------------------------------------------- |
| `context.ts` | Reads the request, writes the response. A translation, not an interpretation |
| `adapter.ts` | The framework instance, the router, the socket                               |
| `core.ts`    | `HttpCore` with the framework's types in the slots                           |
| `broker.ts`  | What `app.connectTo()` takes                                                 |
| `index.ts`   | The public exports, with a `@packageDocumentation` block                     |

## Running the project

| Command                 | Does                                         |
| ----------------------- | -------------------------------------------- |
| `pnpm build`            | builds all six packages, in dependency order |
| `pnpm build:http`       | builds only the core                         |
| `pnpm build:adapters`   | builds the five adapters                     |
| `pnpm typecheck`        | type-checks without emitting                 |
| `pnpm test`             | unit tests, then the contract suite          |
| `pnpm test:unit`        | the framework-agnostic tests                 |
| `pnpm test:integration` | one application, five transports             |
| `pnpm lint`             | `prettier --check`                           |
| `pnpm format`           | `prettier --write`                           |
| `pnpm clean`            | removes build output                         |

## Coding guidelines

**TypeScript, `strict`.** `strictNullChecks` is on. A cast needs a comment
saying what it is standing in for; a cast with no comment is a bug marker.

**Comments explain why.** The code already says what it does. A comment earns
its place by recording a decision, a constraint, or a failure that would otherwise
be re-introduced:

```ts
// Good: what breaks without it, and what the symptom is.
const USE_SEGMENT_MATCHER = true; // a RegExp lets `:id` swallow a `/`

// Bad: restating the line below.
const x = y + 1; // adds y to x
```

**Naming.** Files are `kebab-case`; exported classes are `PascalCase`; a file
named for a class exports that class and nothing it did not need to.

**Public API needs TSDoc.** Every exported member gets a summary, and a `@example`
where the usage is not obvious. `@internal` marks a member that exists only to
satisfy a subclass.

**JSDoc comments cannot contain `*/`.** In a `/** … */` block it ends the
comment, and the rest of the file is a syntax error. Write `text/<any>` rather
than `text/*`.

## Testing

Two suites, and the split matters.

**`test/unit`** — the framework-agnostic behaviour: path normalisation, reply
coercion, cookie parsing, SSE framing, the `node:http` router, the lifecycle
bus. Fast, and the place a new helper goes.

**`test/integration`** — one application, booted on all five transports, with
the same assertions against each. This is the acceptance criterion for the whole
layer: a case that passes on four adapters and fails on one is a hole in the
abstraction, not a framework quirk.

```ts
const transport = {
  name: 'mine',
  // Name what this transport genuinely cannot do. A skip is a finding worth
  // writing down; a quietly different behaviour is not.
  skip: ['a cookie round-trips'],
  async start() { … },
  async stop() { … },
};
```

When a test fails, the question to ask first is _which layer is wrong_. A
framework quirk, an adapter bug, or the abstraction — in roughly that order of
frequency.

## Adding an adapter

[Writing an adapter](../architecture/writing-an-adapter.md) is the full walkthrough.
The short version:

1. `packages/<name>/context.ts` — extend `HttpContext`, translating only
2. `packages/<name>/adapter.ts` — extend `HttpServerAdapter`
3. `packages/<name>/core.ts` and `broker.ts`
4. `package.json`, `tsconfig.json`, `index.ts`, `README.md`
5. a transport in `test/integration/adapters.spec.ts`
6. a row in the [adapter matrix](../api/adapter-matrix.md)
7. an example in `examples/`

An adapter that needs a decision the contract does not cover is a finding. Ask
before adding the decision to the adapter, because five copies of a policy is the
problem this repository exists to solve.

## The core version

`pnpm.overrides` in the root `package.json` links `@glandjs/core` and
`@glandjs/common` from the sibling `../gland` checkout when one is present. That
is deliberate: the two repositories develop in lockstep, and the route replay
that `HttpBroker` depends on is not in a published core yet.

The ranges each package _publishes_ are in its own `package.json` and are what
ships. The override only affects this workspace.

If no routes arrive, the broker says so:

```
[HTTP:Broker] ERROR This HTTP adapter received no routes from the application binder.
```

## Commit messages

```
feat(http): add a body-limit middleware
fix(express): re-read req.params before the handler
docs(koa): explain the prefix rule
test(fastify): skip the cookie case without @fastify/cookie
chore: bump typescript
```

| Type       | For                      |
| ---------- | ------------------------ |
| `feat`     | a new feature            |
| `fix`      | a bug fix                |
| `docs`     | documentation            |
| `refactor` | no behaviour change      |
| `test`     | adding or updating tests |
| `perf`     | a performance change     |
| `chore`    | maintenance              |

The scope is the package. The subject is imperative, in the present tense, under
72 characters, and says what changed rather than where.

Commits are signed. The `commit-msg` hook checks.

## Pull requests

1. Branch from `main`: `feat/koa-static`
2. Make the change, with tests
3. `pnpm build && pnpm test && pnpm lint`
4. Push, open a PR against `main`
5. Fill in the template — what changed, why, and what you tested

A PR that changes routing, the reply contract or the error shape is a
**behaviour change**: describe the before and after explicitly, because the
answer to "does this break my controller" has to be in the PR rather than in the
review.

## Releases

Changesets. Add one for anything a consumer can observe:

```sh
pnpm changeset
```

```md
---
'@glandjs/http': minor
'@glandjs/express': patch
---

`ctx.getHeader` now reads the request header; `getResponseHeader` reads the response.
```

`main` publishes prereleases under the `beta` tag. A `feat` is a `minor`, a
behaviour change a consumer must react to is a `major` even in beta, and a fix is
a `patch`.

## Thank you

Fixing a bug, writing a guide, or adding an adapter all help. If something is
unclear, open an issue or ask in Discord — a question that had to be asked is a
documentation gap.
