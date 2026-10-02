/**
 * Event names Gland's HTTP layer broadcasts on its own bus.
 *
 * These are distinct from the route and channel events of `@glandjs/core`.
 * `gland:define:route` is how the framework *tells* an adapter about a route;
 * everything below is how an application *observes* its own HTTP server — the
 * requests it accepted, the routes it registered, the crashes it survived.
 *
 * They are plain strings rather than symbols so that a listener can be attached
 * from a config file, a test, or another process's debug tooling.
 *
 * @see {@link file:../events/http-events.ts} for the payload of each event.
 *
 * @example
 * ```ts
 * import { HttpEvent } from '@glandjs/http';
 *
 * app.on(HttpEvent.RequestStart, ({ method, path }) => {
 *   logger.info(`${method} ${path}`);
 * });
 * ```
 */
export const HttpEvent = {
  /** Construction options, replayed once to whoever subscribes first. */
  Options: 'http:options',

  /** A route reached the adapter and was registered on the framework router. */
  RouteRegistered: 'http:route:registered',

  /** No route matched. Emitted before the 404 is rendered. */
  RouteMiss: 'http:route:miss',

  /** A request was accepted. Emitted before any middleware runs. */
  RequestStart: 'http:request:start',

  /** A request finished. Always emitted, including for failed requests. */
  RequestEnd: 'http:request:end',

  /** A request threw. Carries the context so a logger can read the route. */
  RequestError: 'http:request:error',

  /** The underlying socket server began listening. */
  ServerListening: 'http:server:listening',

  /** The socket server finished closing. */
  ServerClosed: 'http:server:closed',

  /** A listener threw, or the server failed to start. */
  ServerCrashed: 'http:server:crashed',
} as const;

/** Any {@link HttpEvent} name. */
export type HttpEventName = (typeof HttpEvent)[keyof typeof HttpEvent];

/**
 * @deprecated Retained for source compatibility. The unprefixed names were
 * ambiguous with application channels on a shared bus; use {@link HttpEvent}.
 */
export const HTTP_EVENTS = {
  ROUTER: 'router',
  PIPELINE: 'pipeline',
  MIDDLEWARE: 'middleware',
} as const;

/**
 * @deprecated Use {@link HttpEvent.RouteRegistered} and
 * {@link HttpEvent.RouteMiss} instead.
 */
export const RouterEvent = {
  MATCH: `${HTTP_EVENTS.ROUTER}:match`,
  ROUTER_REGISTER: `${HTTP_EVENTS.ROUTER}:register`,
} as const;

/** @deprecated Use {@link HttpEvent} instead. */
export type RouterEventType = keyof typeof RouterEvent;

/**
 * @deprecated Use {@link HttpEvent.RequestStart} and
 * {@link HttpEvent.RequestEnd} instead.
 */
export const PipelineEvent = {
  PIPELINE_EXECUTE: `${HTTP_EVENTS.PIPELINE}:execute`,
  PIPELINE_REGISTER: `${HTTP_EVENTS.PIPELINE}:register`,
} as const;

/** @deprecated Use {@link HttpEvent} instead. */
export type PipelineEventType = keyof typeof PipelineEvent;

/**
 * @deprecated Use {@link HttpEvent.RequestStart} instead. Middleware execution
 * is no longer observable as a separate event — it is part of the request.
 */
export const MiddlewareEvent = {
  MIDDLEWARE_REGISTER: `${HTTP_EVENTS.MIDDLEWARE}:register`,
  MIDDLEWARE_EXECUTE: `${HTTP_EVENTS.MIDDLEWARE}:execute`,
  GLOBAL: `${HTTP_EVENTS.MIDDLEWARE}:global`,
  RESOLVER: `${HTTP_EVENTS.MIDDLEWARE}:resolve`,
  FOR_ROUTE: `${HTTP_EVENTS.MIDDLEWARE}:route-specific`,
  MOUNT: `${HTTP_EVENTS.MIDDLEWARE}:mount`,
  APPLY_GLOBAL: `${HTTP_EVENTS.MIDDLEWARE}:apply-global`,
  USE: `${HTTP_EVENTS.MIDDLEWARE}:use`,
} as const;

/** @deprecated Use {@link HttpEvent} instead. */
export type MiddlewareEventType = keyof typeof MiddlewareEvent;

/**
 * Every event name the HTTP layer has ever exposed.
 *
 * Kept as a union so user code migrating off the deprecated names keeps
 * compiling while `app.on()` still accepts either spelling.
 */
export type AllHttpEvents = HttpEventName | RouterEventType | PipelineEventType | MiddlewareEventType;
