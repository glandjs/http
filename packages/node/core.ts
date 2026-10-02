import { HttpBroker, HttpCore, type HttpApplicationOptions, type HttpEventRecord } from '@glandjs/http';
import type { Constructor } from '@medishn/toolkit';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { NodeAdapter } from './adapter';
import { NodeContext } from './context';

/**
 * The `node:http` application.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const app = new NodeCore<MyEvents>();
 * app.get('/health', (ctx) => ({ ok: true }));
 * app.listen(3000);
 * ```
 */
export class NodeCore<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpCore<Server, void, IncomingMessage, ServerResponse, NodeContext<TEvents>, TEvents> {
  constructor(options?: HttpApplicationOptions) {
    super(new NodeAdapter<TEvents>(), options);
  }
}

/**
 * Attaches `node:http` to a Gland application.
 *
 * The zero-dependency option. Useful for a small service, for a Lambda handler,
 * or as the reference implementation of the adapter contract.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const http = app.connectTo(NodeBroker, { prefix: '/api' });
 * http.listen(3000);
 * ```
 */
export class NodeBroker<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpBroker<TEvents, NodeCore<TEvents>, HttpApplicationOptions> {
  constructor(options?: HttpApplicationOptions) {
    super(new NodeCore<TEvents>(options), options);
  }
}

/** Constructor type of {@link NodeBroker}, for `connectTo()`. */
export type NodeBrokerClass<TEvents extends HttpEventRecord = HttpEventRecord> = Constructor<NodeBroker<TEvents>>;
