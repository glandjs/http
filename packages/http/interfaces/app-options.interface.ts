import type { BodyParserOptions } from './body-parser.interface';
import type { HttpServerOptions, HttpsOptions } from './http-options.interface';

/**
 * Options accepted by `listen()`.
 *
 * `port` may be `0`, which asks the OS for a free port — useful in tests, where
 * a fixed port is a race condition.
 */
export interface ServerListening {
  /** Interface to bind. Defaults to `localhost`, not `0.0.0.0`. */
  host?: string;
  /** Log line to print instead of the generated one. */
  message?: string;
  /** IPv6 stack to bind. Only meaningful with a host of `::`. */
  ipv6Only?: boolean;
  /** Passed through to the underlying socket server. */
  server?: HttpServerOptions;
}

/** Payload of `HttpEvent.ServerListening`. */
export interface ServerListeningEvent extends ServerListening {
  /** The bound port. Resolved, so `port: 0` reports the real one. */
  port: number;
  /** The bound host. */
  host: string;
  /** The address `listen()` was called with, for correlation. */
  url: string;
  /** ISO timestamp. */
  timestamp: string;
}

/** Payload of `HttpEvent.ServerClosed`. */
export interface ServerClosedEvent {
  /** `true` when the server was not open to begin with. */
  alreadyClosed: boolean;
  /** Milliseconds the close took, or `undefined` for a no-op. */
  duration?: number;
  /** ISO timestamp. */
  timestamp: string;
}

/** Payload of `HttpEvent.ServerCrashed`. */
export interface ServerCrashedEvent {
  /** What was being attempted, e.g. `'start listening'`. */
  message: string;
  /** The thrown value. Not narrowed to `Error` — a listener may throw anything. */
  error: unknown;
  /** The stack, when `error` has one. */
  stack?: string;
  /** ISO timestamp. */
  timestamp: string;
}

/**
 * Construction options for an HTTP application.
 *
 * Everything is optional. An adapter passes what it understands to the
 * framework and warns about the rest, so the same object type works whether the
 * transport is Express or `node:http`.
 */
export interface HttpApplicationOptions {
  /**
   * Serve over TLS.
   *
   * Present, even as `{}`, switches the socket server to `node:https`. Adapters
   * that own their server (Fastify, Hono on Node) ignore it in favour of their
   * own `tls` option and log which one won.
   */
  https?: HttpsOptions;

  /**
   * Prefix every registered route, e.g. `'/api/v1'`.
   *
   * Equivalent to calling `app.setGlobalPrefix()`, which is what a controller
   * tree usually reaches for. Order does not matter — either may be set, and
   * the last one wins.
   */
  prefix?: string;

  /**
   * Mount a view engine and a views directory.
   *
   * `engine` is a resolved module — `require('ejs')` — not a name, because
   * Gland has no opinion about which template engine you use and string
   * lookup would be a silent failure waiting for the first render.
   */
  views?: {
    engine: unknown;
    directory: string | readonly string[];
    extension?: string;
  };

  /**
   * Parse request bodies.
   *
   * `false` — the default — means "no parser is installed", which is the safe
   * choice: an API that never declares it wants JSON rejected with `415`, not
   * an unparsed body handed to a handler that expects an object.
   */
  bodyParser?: BodyParserOptions | false;

  /**
   * Value of the `X-Powered-By` response header.
   *
   * Defaults to `'Gland'`. Set to `false` to omit it.
   */
  poweredBy?: string | false;

  /**
   * Logger verbosity, forwarded to the adapter's `Logger` child.
   *
   * @default 'info'
   */
  logLevel?: 'info' | 'error' | 'warn' | 'debug' | 'verbose';

  /** Serve these directories as static assets. */
  static?: readonly StaticAssetOptions[];

  /** Trust `X-Forwarded-*` headers for `protocol`, `ip` and `hostname`. */
  trustProxy?: boolean | number | string;

  [key: string]: unknown;
}

/** One `static` entry of {@link HttpApplicationOptions}. */
export interface StaticAssetOptions {
  /** Directory on disk. */
  root: string;
  /** URL prefix it is served under. Defaults to `root`. */
  prefix?: string;
  /** Framework-native static options, forwarded verbatim. */
  options?: Record<string, unknown>;
}

/** Called with a crash payload. */
export type ServerListenerCallback = (event: ServerCrashedEvent) => void;
