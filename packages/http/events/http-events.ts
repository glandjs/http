import type { EventRecord } from '@glandjs/events';
import type { HttpContext } from '../context/http-context';
import type { RegisteredRoute } from '../contracts/route-action';
import type { HttpApplicationOptions, RequestLifecycleEvent, ServerClosedEvent, ServerCrashedEvent, ServerListeningEvent } from '../interfaces';

/**
 * The event map of the HTTP layer's own broker.
 *
 * The broker is a lifecycle bus, not an application bus. Application channels
 * live on the core bus (`ctx.call('db:product:find', …)`); these events exist so
 * that logging, metrics and tracing can observe the transport without being
 * inside it.
 *
 * Every entry is optional-friendly: `EventRecord` is
 * `Record<string, any>`, so an application can extend the map and have its own
 * events typed at the same time.
 *
 * @example
 * ```ts
 * interface MyHttpEvents extends HttpEventRecord {
 *   'http:quota:exceeded': { tenant: string };
 * }
 *
 * const app = new ExpressCore<MyHttpEvents>();
 * app.on('http:quota:exceeded', ({ tenant }) => metrics.increment(tenant));
 * ```
 */
export interface HttpEventRecord extends EventRecord {
  /** Construction options, emitted once during `HttpCore` construction. */
  'http:options': HttpApplicationOptions | undefined;

  /** A route was handed to the adapter and registered on the framework router. */
  'http:route:registered': RegisteredRoute;

  /** No route matched. Emitted before the `404` is rendered. */
  'http:route:miss': HttpContext<any, any, any>;

  /** A request was accepted, before any middleware ran. */
  'http:request:start': RequestLifecycleEvent;

  /** A request finished — always, including for failed and aborted ones. */
  'http:request:end': RequestLifecycleEvent;

  /** A request threw. The context is attached, so a listener can read the route. */
  'http:request:error': { event: RequestLifecycleEvent; error: unknown; ctx: HttpContext<any, any, any> };

  /** The socket server began listening. */
  'http:server:listening': ServerListeningEvent;

  /** The socket server finished closing. */
  'http:server:closed': ServerClosedEvent;

  /** A listener threw, or the server failed to start. */
  'http:server:crashed': ServerCrashedEvent;
}

/** Any event name of {@link HttpEventRecord}. */
export type HttpEventKey = keyof HttpEventRecord & string;
