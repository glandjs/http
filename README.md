<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="200" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/http.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/http.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/http.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/http</h1>

<p align="center">An HTTP transport layer built on Gland's event-driven architecture – fully pluggable, protocol-agnostic, and minimal.</p>

## Description

> What if HTTP was just another event?

**@glandjs/http** is the official HTTP adapter for the Gland architecture. It implements an extensible and modular layer that transforms incoming HTTP requests into Gland-compatible events and routes them to the appropriate channel for processing.

Unlike traditional HTTP routers, this package does not define “controllers” or “routes” in a conventional sense. Instead, it seamlessly integrates with the Gland event system, allowing you to treat HTTP interactions just like any other message within the system.

## Features

- 🚦 Lightweight HTTP server (Express, Fastify support planned)
- 🔌 Pluggable HTTP broker with full channel support
- 📦 Built-in request lifecycle hooks
- ⚙️ Fully integrated with Gland DI container and event broker
- 🛡️ Supports middleware-style interceptors via event channels
- 🌐 Easily extendable to support REST APIs, RPC over HTTP, etc.

## Philosophy

HTTP is just a transport layer.

`@glandjs/http` treats HTTP not as a monolithic interface but as a message-based protocol. Instead of focusing on REST conventions, it listens to HTTP events, converts them to internal messages, and passes them through the same event-driven lifecycle used throughout Gland.

By abstracting away the server and routing logic, we allow developers to focus on core application behavior and reuse the same channel logic across different protocols (WebSocket, RPC, etc.).

---

## Documentation

- [Official Documentation](#)
- [Channel API Reference](#)
- [Example Projects](#)
- [Contributing Guide](./docs/CONTRIBUTING.md)

---

## Contributing

We welcome contributions to help improve `@glandjs/http` and strengthen Gland's transport ecosystem.

To contribute:

1. Fork this repository.
2. Follow the [CONTRIBUTING.md](./docs/CONTRIBUTING.md) guidelines.
3. Use the appropriate [Issue templates](./.github/ISSUE_TEMPLATE) for bug reports and feature requests.
4. Follow our [Pull Request template](./.github/PULL_REQUEST_TEMPLATE.md) when submitting PRs.

---

## License

Licensed under the MIT License. See the [LICENSE](./LICENSE) file for full details.

---

## Related Packages

- [`@glandjs/core`](https://npmjs.com/package/@glandjs/core) – Core application & DI
- [`@glandjs/events`](https://npmjs.com/package/@glandjs/events) – Event bus and broker infrastructure
- [`@glandjs/common`](https://npmjs.com/package/@glandjs/common) – Shared decorators and utilities

---

## Stay in Touch

- Discord Community: https://discord.gg/GtRtkrEYwR
- GitHub Discussions: https://github.com/orgs/glandjs/discussions
