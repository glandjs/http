# Changelog

There is no hand-written changelog in this repository.

Releases are driven by [changesets](https://github.com/changesets/changesets):

```sh
pnpm changeset
```

Each changeset is a small markdown file in [`.changeset/`](../.changeset) naming
the affected packages and the version bump. On merge, changesets collects them
into a `CHANGELOG.md` **per package** and bumps the version, so the published
history lives in `packages/<name>/CHANGELOG.md` on npm rather than here.

## Why it matters when writing a commit

A changeset is how a consumer learns that behaviour changed. The bar for adding
one is _anything a caller can observe_:

- a new method, option or export
- a fix for a behaviour that was wrong
- a **behaviour change** that is not a bug fix — a caller has to react, so it is
  a `major` even while the package is in beta

Pure refactors and test-only changes do not need one. The format and the
`beta` prerelease policy are in [CONTRIBUTING.md](development/CONTRIBUTING.md#releases).

## Recent history

Read the per-package changelogs on npm:

- [`@glandjs/http`](https://npmjs.com/package/@glandjs/http)
- [`@glandjs/express`](https://npmjs.com/package/@glandjs/express)
- [`@glandjs/fastify`](https://npmjs.com/package/@glandjs/fastify)
- [`@glandjs/koa`](https://npmjs.com/package/@glandjs/koa)
- [`@glandjs/hono`](https://npmjs.com/package/@glandjs/hono)
- [`@glandjs/node`](https://npmjs.com/package/@glandjs/node)
