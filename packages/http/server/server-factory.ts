import { Logger } from '@medishn/toolkit';
import { createServer as createHttpServer, type RequestListener, type Server, type ServerOptions } from 'node:http';
import { createServer as createHttpsServer, type ServerOptions as HttpsServerOptions } from 'node:https';
import type { HttpApplicationOptions, HttpServerOptions } from '../interfaces';

/**
 * Creates the `node:http` or `node:https` server an adapter hands to
 * `listen()`.
 *
 * The class exists because four of the five adapters do not own a server —
 * Express, Koa, Fastify and Hono all want a `RequestListener` and start their
 * own socket — while the `@glandjs/node` adapter needs one built for it. Both
 * paths go through here, so the `https` decision is made once.
 *
 * The previous implementation called `createServer(options.https)` for TLS and
 * dropped the listener on the floor, which produced an HTTPS server that never
 * answered a request. Passing both is the entire fix.
 *
 * @example
 * ```ts
 * const server = ServerFactory.create({ https: { key, cert } }, app);
 * server.listen(8443);
 * ```
 */
export class ServerFactory {
  private static readonly logger = new Logger({ context: 'HTTP:Server' });

  /**
   * Builds a server.
   *
   * @param options - application options. `https` switches the server to TLS.
   * @param listener - the request listener. Required for HTTP; for HTTPS it is
   *        the TLS server's own handler and falls back to Node's default.
   * @returns the server
   */
  public static create(options?: HttpApplicationOptions, listener?: RequestListener): Server {
    const secure = Boolean(options?.https);
    this.logger.debug(`Creating ${secure ? 'HTTPS' : 'HTTP'} server`);

    // `HttpsOptions` is a hand-written structural mirror of Node's
    // `ServerOptions`, so the compiler cannot prove the two agree — a string
    // `minVersion` where Node wants a `SecureVersion` union, for instance. They
    // are the same shape at runtime, and narrowing here keeps the cast in one
    // place instead of at every call site that builds a server.
    if (secure) {
      return createHttpsServer(options!.https as HttpsServerOptions, listener as RequestListener | undefined);
    }

    const httpOptions = extractHttpOptions(options?.server as HttpServerOptions | undefined);
    return httpOptions ? createHttpServer(httpOptions, listener) : createHttpServer(listener);
  }

  /**
   * Whether a set of options will produce a TLS server.
   *
   * Exposed so an adapter can log which of two competing TLS configurations won
   * — a Fastify app that was given `https` in its Gland options but a
   * `tls` block of its own should say so, rather than serving plaintext
   * silently.
   */
  public static isSecure(options?: HttpApplicationOptions): boolean {
    return Boolean(options?.https);
  }
}

/**
 * Strips the Gland-only keys before handing options to `node:http`.
 *
 * `http.createServer` ignores unknown options, but passing a `https` block to it
 * is exactly the kind of silent no-op that produces a plaintext server on a
 * port that was supposed to be TLS.
 */
function extractHttpOptions(server?: HttpServerOptions): ServerOptions | undefined {
  if (!server) return undefined;
  const { noErrorListener: _ignored, ...rest } = server;
  return Object.keys(rest).length > 0 ? (rest as ServerOptions) : undefined;
}
