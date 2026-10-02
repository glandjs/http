/**
 * `@glandjs/node`
 *
 * Gland's HTTP layer on `node:http`, with no framework and no runtime
 * dependencies at all. Router, reply writer, body collector and cookie
 * serialiser are all in this package.
 *
 * It exists to prove the adapter contract is genuinely framework-agnostic — if
 * it can be done here, the four framework adapters are doing the minimum — and
 * to give a small service a small install.
 *
 * @example
 * ```ts
 * import { GlandFactory } from '@glandjs/core';
 * import { NodeBroker } from '@glandjs/node';
 *
 * const { app } = await GlandFactory.create(AppModule);
 * const http = app.connectTo(NodeBroker);
 * http.listen(3000);
 * ```
 *
 * @packageDocumentation
 */
import 'reflect-metadata';

export * from './adapter';
export * from './context';
export * from './core';
