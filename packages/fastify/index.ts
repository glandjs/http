/**
 * `@glandjs/fastify`
 *
 * The Fastify 5 adapter for Gland's HTTP layer. It contributes a Fastify
 * instance, a `FastifyContext`, and nothing else — the onion, the request
 * lifecycle and the reply coercion all come from `@glandjs/http`, so the same
 * controller runs unchanged on Express, Koa, Hono or `node:http`.
 *
 * @example
 * ```ts
 * import { GlandFactory } from '@glandjs/core';
 * import { FastifyBroker } from '@glandjs/fastify';
 *
 * const { app } = await GlandFactory.create(AppModule);
 * const http = app.connectTo(FastifyBroker, { prefix: '/api' });
 * await http.ready();      // Fastify loads plugins asynchronously
 * http.listen(3000);
 * ```
 *
 * @packageDocumentation
 */
import 'reflect-metadata';

export * from './adapter';
export * from './context';
export * from './core';
