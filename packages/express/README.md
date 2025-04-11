<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/gland/blob/main/docs/Logo.png" width="200" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/fastify" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/fastify.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/fastify" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/fastify.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/fastify" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/fastify.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/fastify</h1>

<p align="center">A protocol adapter for Fastify within the Gland architecture solution.</p>

## Description

> Fastify is not the whole app — it's just one way to handle HTTP. Gland abstracts that away.

**@glandjs/fastify** is the Fastify adapter for Gland's HTTP layer. It integrates the performance and modern features of Fastify with the event-driven, modular architecture of Gland.

This package acts as a bridge between Fastify's high-performance HTTP server and the Gland runtime. It listens to incoming HTTP requests using Fastify and converts them into internal Gland events. Similarly, it converts responses triggered by the Gland event system back into Fastify responses. This separation ensures that the core business logic remains decoupled from the underlying HTTP engine.

By relying on adapter packages like this one, Gland provides the flexibility to switch between different HTTP servers (Express, Fastify, or even custom implementations) without modifying your application's internal logic.

## Philosophy

The idea behind Gland's HTTP abstraction is to ensure that your application’s logic is independent of how data is transmitted over the network. **@glandjs/fastify** embraces this principle by using Fastify solely as an adapter — a translator between HTTP requests/responses and Gland's event-based messaging system.

Fastify's proven performance and developer-friendly API are leveraged here to efficiently process HTTP requests. However, once a request enters the Gland pipeline, it is treated as a message just like any other event. This means your internal modules remain isolated from Fastify-specific logic, promoting testability and maintainability.

With **@glandjs/fastify**, HTTP becomes just another channel in your application. The adapter standardizes communication by routing all HTTP-related events through Gland’s centralized broker, ensuring that your code can remain protocol-agnostic.

## Documentation

For the full Gland documentation, architecture overview, and usage guides:

- [Official Gland Documentation](https://github.com/glandjs/gland)
- [HTTP Layer Overview](https://github.com/glandjs/http)
- [Fastify Adapter Documentation](https://github.com/glandjs/http/tree/main/packages/fastify)

## License

Licensed under the [MIT License](https://github.com/glandjs/http/blob/main/LICENSE).
