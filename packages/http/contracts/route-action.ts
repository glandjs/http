import type { HttpContext } from '../context/http-context';
import type { EventRecord } from '@glandjs/events';

/**
 * A route handler.
 *
 * The return value is the response — see {@link ReplyBody} for what is
 * understood. Returning `undefined` is always valid and means "the handler
 * already wrote to the context", which is the common shape when a controller
 * delegates to a channel that owns the response.
 *
 * @typeParam TRequest - the framework's request object
 * @typeParam TResponse - the framework's response object
 * @typeParam TContext - the adapter's context
 * @typeParam TEvents - the application's event map
 *
 * @example
 * ```ts
 * const list: RouteAction<Request, Response> = async (ctx) => {
 *   const page = Number(ctx.query.page ?? 1);
 *   return ctx.call('db:product:list', { page });
 * };
 * ```
 */
export type RouteAction<TRequest = any, TResponse = any, TContext extends HttpContext<TRequest, TResponse, any> = HttpContext<TRequest, TResponse, any>, TEvents extends EventRecord = EventRecord> = (
  ctx: TContext,
  ...args: unknown[]
) => unknown | Promise<unknown>;

/**
 * The subset of a route that the HTTP layer stores and dispatches.
 *
 * This is what the adapter puts on its own router; the extra fields are for
 * observability and are never required for dispatch to work.
 */
export interface RegisteredRoute<TRequest = any, TResponse = any, TContext extends HttpContext<TRequest, TResponse, any> = HttpContext<TRequest, TResponse, any>> {
  /** Upper-case wire method, e.g. `'GET'`. Never {@link RequestMethod.ALL}. */
  readonly method: string;
  /** The lower-case verb handed to the framework router. */
  readonly verb: string;
  /** The normalised path the framework matches against. */
  readonly path: string;
  /** The handler the adapter invokes on a match. */
  readonly action: RouteAction<TRequest, TResponse, TContext>;
  /** Where the route came from — a decorator, `app.get()`, a replayed binder log. */
  readonly origin?: 'decorator' | 'manual' | 'replay';
}
