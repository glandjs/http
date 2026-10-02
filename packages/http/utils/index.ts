/**
 * Framework-agnostic helpers.
 *
 * Nothing here imports a server framework, and nothing here touches a socket.
 * That is the property that lets every adapter share the same behaviour instead
 * of re-deriving it: path normalisation, reply coercion, and the SSE framing
 * are decided once, in `@glandjs/http`.
 *
 * @packageDocumentation
 */
export * from './cookie.util';
export * from './path.util';
export * from './reply.util';
export * from './sse-stream';
