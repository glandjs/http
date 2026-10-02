/**
 * `@glandjs/hono`
 *
 * The Hono adapter for Gland's HTTP layer. Because Hono is built on the Fetch
 * API, this is the one adapter that also runs on Cloudflare Workers, Deno
 * Deploy, Bun and Lambda — where there is no socket to bind and the
 * application exports `fetch` instead.
 *
 * @example
 * ```ts
 * import { GlandFactory } from '@glandjs/core';
 * import { HonoBroker } from '@glandjs/hono';
 *
 * const { app } = await GlandFactory.create(AppModule);
 * const http = app.connectTo(HonoBroker);
 *
 * // Node:
 * http.listen(3000);
 *
 * // …or an edge runtime:
 * export default http.hono;
 * ```
 *
 * @packageDocumentation
 */
import 'reflect-metadata';

export * from './adapter';
export * from './context';
export * from './core';
