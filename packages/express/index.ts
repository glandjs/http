/**
 * `@glandjs/express`
 *
 * The Express 5 adapter for Gland's HTTP layer. It contributes an Express
 * application, an `ExpressContext`, and nothing else — the onion, the request
 * lifecycle and the reply coercion all come from `@glandjs/http`, so the same
 * controller runs unchanged on Fastify, Koa, Hono or `node:http`.
 *
 * @example
 * ```ts
 * import { GlandFactory } from '@glandjs/core';
 * import { ExpressBroker } from '@glandjs/express';
 *
 * const { app } = await GlandFactory.create(AppModule);
 * const http = app.connectTo(ExpressBroker, { prefix: '/api' });
 * http.listen(3000);
 * ```
 *
 * @packageDocumentation
 */
import 'reflect-metadata';

export * from './adapter';
export * from './broker';
export * from './context';
export * from './core';
