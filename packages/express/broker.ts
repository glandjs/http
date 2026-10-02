import { HttpBroker, type HttpApplicationOptions } from '@glandjs/http';
import type { HttpEventRecord } from '@glandjs/http';
import type { Constructor } from '@medishn/toolkit';
import { ExpressCore } from './core';

/**
 * Attaches Express to a Gland application.
 *
 * This is the class `GlandBroker.connectTo()` takes:
 *
 * ```ts
 * const http = app.connectTo(ExpressBroker, { prefix: '/api' });
 * http.listen(3000);
 * ```
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * import { GlandFactory } from '@glandjs/core';
 * import { ExpressBroker } from '@glandjs/express';
 *
 * const { app } = await GlandFactory.create(AppModule);
 * app.connectTo(ExpressBroker).listen(3000);
 * ```
 */
export class ExpressBroker<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpBroker<TEvents, ExpressCore<TEvents>, HttpApplicationOptions> {
  constructor(options?: HttpApplicationOptions) {
    super(new ExpressCore<TEvents>(options), options);
  }
}

/**
 * Constructor type of {@link ExpressBroker}.
 *
 * `connectTo()` takes a class, and TypeScript cannot infer a class expression's
 * type parameters. This alias is what makes `app.connectTo(ExpressBroker)`
 * return `ExpressCore<TEvents>` rather than `unknown`.
 */
export type ExpressBrokerClass<TEvents extends HttpEventRecord = HttpEventRecord> = Constructor<ExpressBroker<TEvents>>;
