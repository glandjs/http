/**
 * The middleware contract, identical on every adapter.
 *
 * Gland's middleware is a promise-based onion. That is the Koa model, not the
 * Express one, and the choice is deliberate:
 *
 * - `await next()` means "run everything downstream and wait for it", so a
 *   middleware can measure or transform what happens after it.
 * - A downstream `throw` reaches the upstream `catch`, because the call really
 *   is a call.
 *
 * Express cannot offer the second property — its `next()` is a hand-off, not a
 * call. The Express adapter bridges `next` for you and the difference is
 * documented in {@link file:../../docs/guides/middleware.md}. Every other
 * adapter gets the real thing.
 *
 * @example
 * ```ts
 * app.use(async (ctx, next) => {
 *   const started = performance.now();
 *   await next();                       // everything downstream has finished
 *   logger.info(`${ctx.method} ${ctx.path} in ${performance.now() - started}ms`);
 * });
 * ```
 */

/**
 * Advances the middleware chain.
 *
 * Calling it with an argument short-circuits the rest of the chain and hands
 * the error to the error handler — the same shape as `next(err)` on Express,
 * made uniform.
 */
export type NextFunction = (error?: unknown) => Promise<void>;

/**
 * One Gland middleware.
 *
 * @typeParam TContext - the adapter's request context, so a handler can read
 *        the request without narrowing `any`
 */
export type MiddlewareFunction<TContext = any> = (ctx: TContext, next: NextFunction) => unknown;

/**
 * Middleware registered under a path, or a set of paths.
 *
 * An array mounts the same middleware once per path, which is the shape
 * `app.use(['/a', '/b'], mw)` has in every framework and the one people reach
 * for when a prefix is variable.
 */
export type PathMiddlewareFunction<TContext = any> = (path: string | readonly string[], middleware: MiddlewareFunction<TContext>) => unknown;

/**
 * A terminal error handler.
 *
 * Registered with {@link file:./middleware.ts#GlandErrorHandler} semantics: it
 * runs instead of the chain, and the context is already marked as failed.
 */
export type ErrorHandlerFunction<TContext = any> = (error: unknown, ctx: TContext) => unknown;
