import { EventBroker, type EventPayload, type EventRecord, type Events, type Listener } from '@glandjs/events';
import type { HttpEventRecord } from '../events/http-events';

/**
 * The HTTP layer's lifecycle broker.
 *
 * One per adapter, linked to the core bus by `GlandBroker.connectTo()`. It
 * carries the transport's own events — a request started, a route registered, a
 * server closed — and nothing else. Application channels stay on the core bus,
 * which is what keeps a channel name from colliding with a lifecycle event.
 *
 * The cache is raised to 64 because a busy server touches a dozen event names
 * per request (`request:start`, `route:miss`, `request:end`) and the default of
 * 5 would evict and re-parse the emitter chain constantly.
 */
export class HttpEventBroker<TEvents extends EventRecord = HttpEventRecord> extends EventBroker<TEvents> {
  constructor(name = 'http') {
    super({ name, cacheSize: 64, maxListeners: 100 });
  }

  /**
   * Emits `event` only if something is listening.
   *
   * Lifecycle events fire on every request, and a listener-free
   * `request:start` would otherwise cost an emitter walk on the hot path for no
   * reason. This is the check the old `safeEmit` meant to do — it emitted
   * unconditionally and then called `off()` with a fresh no-op listener, which
   * removed nothing.
   *
   * @param event - the event name
   * @param payload - the event payload
   * @returns `true` when at least one listener ran
   *
   * @example
   * ```ts
   * if (this.events.hasListener(HttpEvent.RequestStart)) {
   *   this.events.emit(HttpEvent.RequestStart, event);
   * }
   * ```
   */
  public safeEmit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): boolean {
    if (this.getListener(event).length === 0) return false;
    this.emit(event, payload);
    return true;
  }

  /** Whether at least one listener is registered for `event`. */
  public hasListener<K extends keyof TEvents & string>(event: K): boolean {
    return this.getListener(event).length > 0;
  }

  /**
   * Subscribes to a lifecycle event, returning an unsubscribe function.
   *
   * Ergonomics over symmetry with `on()`: the interesting case for a lifecycle
   * bus is a temporary observer, and making the caller keep a reference to a
   * bound function just to detach it is a leak waiting to happen. Named
   * `observe` rather than `watch` because `Broker.watch(event, timeout)` is
   * already taken by the await-one-delivery API in `@glandjs/events`.
   *
   * @returns a function that removes the listener
   */
  public observe<K extends keyof TEvents & string>(event: K, listener: Listener<EventPayload<TEvents, K>, void>): () => void {
    this.on(event, listener);
    return () => {
      this.off(event, listener);
    };
  }
}
