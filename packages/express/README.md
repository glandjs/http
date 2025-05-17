<p align="center">
  <a href="#" target="blank"><img src="https://github.com/glandjs/glandjs.github.io/blob/main/public/logo.png" width="200" alt="Gland Logo" /></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@glandjs/express" target="_blank"><img src="https://img.shields.io/npm/v/@glandjs/express.svg" alt="NPM Version" /></a>
  <a href="https://npmjs.com/package/@glandjs/express" target="_blank"><img src="https://img.shields.io/npm/l/@glandjs/express.svg" alt="Package License" /></a>
  <a href="https://npmjs.com/package/@glandjs/express" target="_blank"><img src="https://img.shields.io/npm/dm/@glandjs/express.svg" alt="NPM Downloads" /></a>
</p>

<h1 align="center">@glandjs/express</h1>

<p align="center">A protocol adapter for Express within the Gland architecture solution.</p>

## Description

> Express is not your application — it's just one way to deliver HTTP. Gland abstracts that detail.

**@glandjs/express** is the Express adapter for Gland's HTTP layer. It allows you to integrate the simplicity and ecosystem of Express with the modular, event-driven design of Gland.

This package serves as a bridge between the Express HTTP server and Gland’s internal architecture. It listens to HTTP requests via Express and transforms them into internal Gland events. Likewise, responses generated within the Gland runtime are seamlessly mapped back into Express's response format.

This separation allows your application's core logic to remain independent from the underlying HTTP server implementation, enabling protocol flexibility and better long-term maintainability.

## Philosophy

Gland's architectural vision is based on keeping the application's logic completely decoupled from protocol details like HTTP. **@glandjs/express** embodies this principle by treating Express purely as an adapter — translating between raw HTTP and Gland events.

Express’s intuitive API and wide ecosystem are fully supported, but once a request enters the Gland system, it’s treated just like any other event in the broker-based system. This ensures that your business logic is not tied to Express and can be reused with different protocols or servers without rewriting the core.

With **@glandjs/express**, HTTP is just another communication channel. All events are routed through Gland's centralized broker, ensuring full protocol-agnostic behavior across your system.

## Documentation

To learn more about Gland's architecture and usage:

- [Official Gland Documentation](https://github.com/glandjs/gland)
- [HTTP Layer Overview](https://github.com/glandjs/http)

## License

Licensed under the [MIT License](https://github.com/glandjs/http/blob/main/LICENSE).
