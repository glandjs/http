# Contributing

This guide has moved to **[`development/CONTRIBUTING.md`](development/CONTRIBUTING.md)**.

The short version:

```sh
git clone https://github.com/glandjs/http.git
cd http
pnpm install
pnpm build
pnpm test
pnpm lint
```

The full guide covers the repository layout, the conventions — and the reasoning
behind them — how to add an adapter, the commit format, and releases.

## Why it moved

The version that used to live here was written for a single package and had
drifted from the repository: it said Node 18 and `npm install` for what is a
pnpm workspace of six packages, listed two scripts out of nine, and pointed at a
`main` branch and a Discord link that no longer matched either. Two contributing
documents in one repository means one of them is always wrong.

`docs/development/CONTRIBUTING.md` is the one that is maintained. This file stays
so that the links in the root [README](../README.md) and in the
[documentation index](README.md) keep resolving.

| Also here                             |                                    |
| ------------------------------------- | ---------------------------------- |
| [Code of conduct](CODE_OF_CONDUCT.md) |                                    |
| [Security policy](SECURITY.md)        |                                    |
| [Changelog](CHANGELOG.md)             | Kept per package, in `.changeset/` |
