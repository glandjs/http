import { HttpBroker, HttpCore, type HttpApplicationOptions, type HttpEventRecord } from '@glandjs/http';
import type { Constructor } from '@medishn/toolkit';
import type Koa from 'koa';
import type { ParameterizedContext } from 'koa';
import type { Server } from 'node:http';
import { KoaAdapter } from './adapter';
import { KoaContext } from './context';

/**
 * The Koa application.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const app = new KoaCore<MyEvents>();
 * app.use(async (ctx, next) => { await next(); });   // a real onion
 * ```
 */
export class KoaCore<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpCore<Server, Koa, ParameterizedContext, ParameterizedContext, KoaContext<TEvents>, TEvents> {
  constructor(options?: HttpApplicationOptions) {
    super(new KoaAdapter<TEvents>(), options);
  }

  /** The underlying Koa instance, for `app.keys` and `app.use` of a raw middleware. */
  public get koa(): Koa {
    return this.instance;
  }
}

/**
 * Attaches Koa to a Gland application.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const http = app.connectTo(KoaBroker, { prefix: '/api' });
 * http.listen(3000);
 * ```
 */
export class KoaBroker<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpBroker<TEvents, KoaCore<TEvents>, HttpApplicationOptions> {
  constructor(options?: HttpApplicationOptions) {
    super(new KoaCore<TEvents>(options), options);
  }
}

/** Constructor type of {@link KoaBroker}, for `connectTo()`. */
export type KoaBrokerClass<TEvents extends HttpEventRecord = HttpEventRecord> = Constructor<KoaBroker<TEvents>>;
