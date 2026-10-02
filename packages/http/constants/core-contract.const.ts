import type { EventRecord } from '@glandjs/events';
import type { HttpContext } from '../context/http-context';

/**
 * The wire contract between `@glandjs/core` and a protocol adapter.
 *
 * These names and shapes are duplicated here on purpose. `@glandjs/common`
 * exports the same `GLAND_ROUTE_EVENT` constant, but importing it would pin the
 * HTTP layer to the exact core version that introduced it — and the two packages
 * are released on independent schedules. Duplicating a string literal is a far
 * smaller cost than a resolver failure at boot for users whose lockfile holds an
 * older core.
 *
 * When a payload shape changes, the change lands in both places in the same
 * commit; the values are asserted equal in
 * `test/unit/core-contract.spec.ts`.
 *
 * @packageDocumentation
 */

/**
 * Broadcast event carrying one discovered route.
 *
 * The core emits it once per decorated controller method, and replays its whole
 * log to an adapter that attaches later.
 */
export const GLAND_ROUTE_EVENT = 'gland:define:route';

/** Prefix of the fully-qualified event backing a channel handler. */
export const GLAND_CHANNEL_EVENT = 'gland:define:channel';

/**
 * Payload of a {@link GLAND_ROUTE_EVENT} broadcast.
 *
 * An adapter subscribes and registers each of these on its own router. This is
 * the entire extension seam of the framework.
 *
 * @typeParam TContext - the adapter's request context
 */
export interface GlandRoute<TContext = any> {
  /** The handler's own path, relative to the controller prefix, e.g. `':id'`. */
  readonly path: string;
  /**
   * The fully-qualified path, controller prefix included, e.g.
   * `'/products/:id'`.
   *
   * **This is the field an adapter registers.** The core has already combined
   * and normalised the two halves; re-joining them in an adapter is how
   * `/api/api/v1` and duplicate route entries appear.
   */
  readonly fullPath: string;
  /** Upper-case wire method, e.g. `'GET'`. */
  readonly method: string;
  /**
   * Invoked by the adapter on a match.
   *
   * The binder has already attached the broker id and the channel registry to
   * `ctx.state`, so `ctx.call()` and `ctx.emit()` work inside the handler. Extra
   * arguments the adapter passes — route params — are forwarded after the
   * context.
   */
  readonly action: (ctx: TContext, ...args: unknown[]) => unknown;
}

/**
 * The state the binder attaches to every request context.
 *
 * Stored under a reserved `channel` key as a frozen, shared object — not a
 * per-request copy — so applications should treat it as read-only.
 */
export interface GlandContextState {
  /** Id of the core broker serving this request. */
  readonly brokerId?: string;
  /** Frozen `publicEventName -> brokerEventName` index. */
  readonly channel?: Readonly<Record<string, string>>;
}

/** The event map of the core bus, from a protocol adapter's point of view. */
export interface GlandEvents extends EventRecord {
  [GLAND_ROUTE_EVENT]: GlandRoute;
  [key: string]: unknown;
}

/** Narrows a broker payload to a {@link GlandRoute}, or `undefined`. */
export function isGlandRoute(value: unknown): value is GlandRoute {
  return typeof value === 'object' && value !== null && typeof (value as GlandRoute).action === 'function' && typeof (value as GlandRoute).method === 'string';
}

/** Narrows a context to something the binder has already attached to. */
export function isAttachedContext(value: unknown): value is HttpContext<any, any, any> & { state: GlandContextState } {
  return typeof value === 'object' && value !== null && typeof (value as { attachRegistry?: unknown }).attachRegistry === 'function';
}
