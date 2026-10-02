/**
 * `@glandjs/koa`
 *
 * The Koa 3 adapter for Gland's HTTP layer. Koa's middleware onion *is* Gland's,
 * so this is the adapter with the least translation — and the one where
 * `await next()` genuinely waits and a downstream `throw` reaches an upstream
 * `catch`.
 *
 * @example
 * ```ts
 * import { GlandFactory } from '@glandjs/core';
 * import { KoaBroker } from '@glandjs/koa';
 *
 * const { app } = await GlandFactory.create(AppModule);
 * const http = app.connectTo(KoaBroker, { prefix: '/api' });
 * http.listen(3000);
 * ```
 *
 * @packageDocumentation
 */
import 'reflect-metadata';

export * from './adapter';
export * from './context';
export * from './core';
