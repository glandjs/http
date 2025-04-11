<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/gland/blob/main/docs/Logo.png" width="200" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/http.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/http.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/http" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/http.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/http</h1>

<p align="center">A protocol layer for HTTP communication within the Gland architecture solution.</p>

## Description

> HTTP is not your app — it’s just a protocol. Gland treats it that way.

**@glandjs/http** is the official HTTP layer for Gland. It provides a protocol interface that listens to incoming HTTP requests and converts them into internal Gland events — allowing your application to stay decoupled from any specific networking stack or server framework.

Rather than tying your code directly to Express, Fastify, or raw HTTP servers, `@glandjs/http` acts as a bridge between your HTTP server (via an adapter) and the Gland runtime. It creates an isolated, internal channel named `http` which routes messages from incoming HTTP requests into your Gland modules and controllers — and then emits outgoing responses back through the same channel.

The result is an elegant separation of concerns: Your core business logic doesn’t know or care where a request came from or how the response is sent. It only handles events.

This package doesn’t implement any HTTP server itself. Instead, it defines the **interface** — a protocol contract — and relies on adapter packages like [`@glandjs/express`](https://npmjs.com/package/@glandjs/express) to handle the actual server lifecycle. This gives you the flexibility to plug in any HTTP engine you like, now or later.

## Philosophy

The HTTP layer in Gland is designed to be replaceable. Gland doesn’t tie your application to a specific transport protocol or middleware engine. Whether you're using Express, Fastify, or something custom, the logic of your system remains untouched.

`@glandjs/http` brings this idea to life by abstracting away the server details and focusing purely on event-based communication. HTTP becomes just another entry point into the system — a message in, a message out.

This package introduces a dedicated event channel for HTTP (`http`) and exposes a broker that routes all HTTP-related events through the Gland runtime. Every adapter connected to this layer (like Express or Fastify) becomes a plug-in that speaks the same language — one that's message-driven, modular, and completely testable.

It’s not about reinventing HTTP — it’s about putting it in its place.

## Documentation

For the full Gland documentation, architecture overview, and usage guides:

- [Official Gland Documentation](https://github.com/glandjs/gland)
- [Express Adapter](https://github.com/glandjs/http/tree/main/packages/express)
- [Fastify Adapter](https://github.com/glandjs/http/tree/main/packages/fastify)

## License

Licensed under the [MIT License](https://github.com/glandjs/http/blob/main/LICENSE).
