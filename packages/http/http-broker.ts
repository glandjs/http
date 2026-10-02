import { BrokerAdapter } from '@glandjs/core';
import { GLAND_ROUTE_EVENT, HttpEvent, isGlandRoute, type GlandRoute } from './constants';
import type { Broker, EventRecord } from '@glandjs/events';
import { isString, Logger } from '@medishn/toolkit';
import type { HttpCore } from './http-core';
import type { HttpEventRecord } from './events/http-events';
import type { HttpApplicationOptions, RequestLifecycleEvent, ServerCrashedEvent, ServerListening, ServerListeningEvent } from './interfaces';

/**
 * The adapter Gland attaches to an application.
 *
 * `GlandBroker.connectTo()` takes one of these. It subscribes to the core bus,
 * registers every route the binder discovers, and hands back the HTTP
 * application. That is the whole contract — the same one the console sample in
 * `@glandjs/core` implements for a made-up protocol, which is the proof that
 * the transport really is a plugin.
 *
 * ### The route payload
 *
 * The core broadcasts `gland:define:route` with a
 * {@link GlandRoute} — `{ path, fullPath, method, action }`. The previous
 * implementation read `payload.meta.path` and `payload.method.toLowerCase()`,
 * which is a payload shape the core has not emitted since the channel registry
 * landed; every route silently failed to register and the application served
 * only its manual `app.get()` calls. `fullPath` is the field to register, and
 * `method` is already upper-case.
 *
 * @typeParam TEvents - the application's channel event map
 * @typeParam TApp - the HTTP application, e.g. `ExpressCore<TEvents>`
 * @typeParam TOptions - construction options
 *
 * @example
 * ```ts
 * const { app } = await GlandFactory.create(AppModule);
 * const http = app.connectTo(ExpressBroker, { prefix: '/api' });
 * http.listen(3000);
 * ```
 */
export class HttpBroker<
  TEvents extends EventRecord = HttpEventRecord,
  TApp extends HttpCore<any, any, any, any, any, any> = HttpCore<any, any, any, any, any, any>,
  TOptions extends HttpApplicationOptions = HttpApplicationOptions,
> extends BrokerAdapter<TEvents, TApp, TOptions> {
  /** Routes registered so far, in the order the core broadcast them. */
  private registered = 0;

  constructor(
    /** The HTTP application this broker drives. */
    public readonly http: TApp,
    options?: TOptions,
  ) {
    super(options);
    this.instance = http;
  }

  /**
   * The adapter's own bus.
   *
   * A getter, not a constructor assignment. `BrokerAdapter` declares `broker` as
   * an abstract *property*, and TypeScript does not allow a derived constructor
   * to write to one — it would already have been initialised by `super()`. The
   * HTTP application's lifecycle bus is created before the broker exists, so a
   * getter is not a workaround; it is the honest shape.
   */
  public override get broker(): Broker<TEvents> {
    return this.http.broker as unknown as Broker<TEvents>;
  }

  /** How many routes the core has published to this adapter. */
  public get routeCount(): number {
    return this.registered;
  }

  /**
   * Subscribes to the route broadcast and returns the application.
   *
   * Called by `GlandBroker.connectTo()` after the brokers are linked and before
   * it replays the binder's route log, so this must subscribe rather than
   * registering eagerly — a route registered here would miss the replay.
   */
  public initialize(): TApp {
    this.broker.on(GLAND_ROUTE_EVENT as never, ((route: GlandRoute) => this.onRoute(route)) as never);

    // Lifecycle forwarding. The application's bus already carries these, so
    // this is about giving an application a single place to observe the
    // transport without reaching into the adapter.
    this.http.on(HttpEvent.ServerCrashed, (event) => this.handleCrash(event));
    this.http.on(HttpEvent.ServerListening, (event) => this.onListening(event));

    this.assertRoutesArrived();
    this.logger.debug('HTTP broker initialized');
    return this.http;
  }

  /**
   * Raises a readable error when the application has controllers but the
   * adapter received nothing.
   *
   * The failure this guards against is silent and total: the binder broadcasts
   * every route during bootstrap, an adapter attaches afterwards, and a core
   * without route replay never delivers them. Every controller route then 404s,
   * while the server looks perfectly healthy and the logs say nothing wrong.
   *
   * It also catches the version mismatch directly: route replay landed in
   * `@glandjs/core` after `1.0.3-beta`, so an old core and a new HTTP layer is
   * the most likely way to get here.
   */
  private assertRoutesArrived(): void {
    if (this.registered > 0) return;

    // One tick, so a core that replays asynchronously still has a chance.
    setTimeout(() => {
      if (this.registered > 0) return;

      this.http.on(HttpEvent.RouteRegistered, () => undefined);
      this.logger.error(
        [
          'This HTTP adapter received no routes from the application binder.',
          '',
          'Every @Controller() route is delivered on the "gland:define:route" broadcast, and a',
          'protocol adapter only receives broadcasts published after it subscribes. @glandjs/core',
          'replays its route log to an adapter that attaches later — that replay is what makes',
          '`app.connectTo(Broker)` work at all, and it is not present in @glandjs/core <= 1.0.3-beta.',
          '',
          'Check that:',
          '  1. @glandjs/core is a version with route replay (see the peer dependency range), and',
          '  2. the application module actually declares controllers — a module with none is fine',
          '     and this message will not appear.',
        ].join('\n'),
      );
    }, 0).unref?.();
  }

  /**
   * Registers one route published by the core.
   *
   * @param route - the binder's route payload
   */
  private onRoute(route: GlandRoute): void {
    if (!isGlandRoute(route)) {
      this.logger.warn(`Ignoring a malformed route payload: ${JSON.stringify(route)}`);
      return;
    }

    // `fullPath` is what the framework should match: the controller prefix and
    // the handler path already combined, and normalised.
    const path = route.fullPath ?? route.path;
    if (!isString(path) || path.length === 0) {
      this.logger.warn(`Skipped a route with no path: ${JSON.stringify(route)}`);
      return;
    }

    this.http.registerRoute(route.method, path, route.action as never, 'replay');
    this.registered += 1;
    this.logger.debug(`Route registered [${route.method}] ${path}`);
  }
  private onListening(event: ServerListeningEvent): void {
    this.logger.info(event.message ?? `Listening on ${event.url}`);
  }

  private handleCrash(event: ServerCrashedEvent): void {
    this.logger.error(event.message, event.stack);
  }

  private readonly logger = new Logger({ context: 'HTTP:Broker' });
}

/** Payload types re-exported for a listener signature in application code. */
export type { RequestLifecycleEvent, ServerListening, ServerListeningEvent, ServerCrashedEvent };
