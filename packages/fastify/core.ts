import { HttpBroker, type HttpApplicationOptions } from '@glandjs/http';
import { HttpCore, type HttpEventRecord } from '@glandjs/http';
import type { Constructor } from '@medishn/toolkit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'node:http';
import { FastifyAdapter } from './adapter';
import { FastifyContext } from './context';

/**
 * The Fastify application.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const app = new FastifyCore<MyEvents>({ prefix: '/api' });
 * app.on(HttpEvent.RequestEnd, ({ method, path, duration }) => metrics.timing(method, duration));
 * ```
 */
export class FastifyCore<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpCore<Server, FastifyInstance, FastifyRequest, FastifyReply, FastifyContext<TEvents>, TEvents> {
  constructor(options?: HttpApplicationOptions) {
    super(new FastifyAdapter<TEvents>(), options);
  }

  /** The underlying Fastify instance, for `app.register(...)` and `app.decorate(...)`. */
  public get fastify(): FastifyInstance {
    return this.instance;
  }
}

/**
 * Attaches Fastify to a Gland application.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const http = app.connectTo(FastifyBroker, { prefix: '/api' });
 * await http.ready();
 * http.listen(3000);
 * ```
 */
export class FastifyBroker<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpBroker<TEvents, FastifyCore<TEvents>, HttpApplicationOptions> {
  constructor(options?: HttpApplicationOptions) {
    super(new FastifyCore<TEvents>(options), options);
  }
}

/** Constructor type of {@link FastifyBroker}, for `connectTo()`. */
export type FastifyBrokerClass<TEvents extends HttpEventRecord = HttpEventRecord> = Constructor<FastifyBroker<TEvents>>;
