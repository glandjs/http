import { HttpBroker, HttpCore, type HttpApplicationOptions, type HttpEventRecord } from '@glandjs/http';
import type { Constructor } from '@medishn/toolkit';
import type { Context as HonoContext, Env, Hono } from 'hono';
import type { Server } from 'node:http';
import { HonoAdapter } from './adapter';
import { HonoRequestContext } from './context';

/**
 * The Hono application.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const app = new HonoCore<MyEvents>();
 * app.use(async (ctx, next) => { await next(); });
 * ```
 */
export class HonoCore<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpCore<Server, Hono<Env>, HonoContext<Env, any>, Response, HonoRequestContext<TEvents>, TEvents> {
  constructor(options?: HttpApplicationOptions) {
    super(new HonoAdapter<TEvents>(), options);
  }

  /**
   * The Hono instance.
   *
   * On an edge runtime this is the export — `export default app.hono` — because
   * there is no socket to bind and the platform calls `fetch` directly.
   */
  public get hono(): Hono<Env> {
    return this.instance;
  }
}

/**
 * Attaches Hono to a Gland application.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const http = app.connectTo(HonoBroker);
 * http.listen(3000);
 * // …or, on an edge runtime:
 * export default http.hono;
 * ```
 */
export class HonoBroker<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpBroker<TEvents, HonoCore<TEvents>, HttpApplicationOptions> {
  constructor(options?: HttpApplicationOptions) {
    super(new HonoCore<TEvents>(options), options);
  }
}

/** Constructor type of {@link HonoBroker}, for `connectTo()`. */
export type HonoBrokerClass<TEvents extends HttpEventRecord = HttpEventRecord> = Constructor<HonoBroker<TEvents>>;
