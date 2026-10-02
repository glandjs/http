import { HttpException, HttpStatus } from '@medishn/toolkit';
import { ContentType } from '../constants/content-type.const';
import { HttpReply } from '../contracts/reply';
import type { ErrorHandlerFunction, MiddlewareFunction, NextFunction } from '../contracts/middleware';
import type { HttpContext } from '../context/http-context';

/**
 * The default error renderer: RFC 7807 problem details.
 *
 * Installed by every adapter unless the application replaces it. Three rules,
 * and the third is the one that matters:
 *
 * 1. an `HttpException` sends its own status, title and `type`
 * 2. a validation-style error with a `status` property is trusted — that is how
 *    a channel can reject a call without importing an HTTP class
 * 3. **anything else is a `500` and its message is dropped**
 *
 * Rule 3 is why this function exists rather than `String(error)`. A stack trace,
 * a SQL fragment or a file path in an error message is a disclosure bug, and it
 * is the single most common way a production API leaks its internals. Log it
 * with `HttpEvent.RequestError`; do not send it.
 *
 * @example
 * ```ts
 * app.setErrorHandler((error, ctx) => {
 *   if (error instanceof HttpException) return errorHandler(error, ctx);
 *   return ctx.json({ ok: false }, 500);
 * });
 * ```
 */
export const errorHandler = async function glandErrorHandler<TContext extends HttpContext<any, any, any>>(error: unknown, ctx: TContext): Promise<void> {
  const exception = toHttpException(error);

  ctx.status(exception.status);

  // The *response* content type — a problem document must not be sent as
  // whatever the handler happened to set on the way out.
  if (!ctx.getResponseHeader('content-type')) {
    ctx.setHeader('content-type', ContentType.problem);
  }

  ctx.send(exception.getProblemDetails(ctx.requestId));
};

/**
 * Runs `handler` and hands anything it throws to `onError`.
 *
 * The point is to make the *return* path and the *throw* path symmetric. A
 * handler that `return`s an `HttpException` and a handler that `throw`s one are
 * the same intent, and both should produce the same response.
 *
 * @example
 * ```ts
 * app.get('/orders/:id', withErrors(async (ctx) => {
 *   const order = await ctx.call('db:order:find', ctx.params.id);
 *   if (!order) return ctx.throw(HttpStatus.NOT_FOUND);
 *   return order;
 * }));
 * ```
 */
export function withErrors<TContext extends HttpContext<any, any, any>>(
  handler: (ctx: TContext) => unknown | Promise<unknown>,
  onError: ErrorHandlerFunction<TContext> = errorHandler,
): (ctx: TContext, next: NextFunction) => Promise<void> {
  return async function glandWithErrors(ctx: TContext, next: NextFunction) {
    try {
      const result = await handler(ctx);
      // A returned exception is a thrown one, as far as the client is concerned.
      if (result instanceof Error) throw result;
      await next();
    } catch (error) {
      await onError(error, ctx);
    }
  };
}

/**
 * Rejects a request whose body exceeds `limit`.
 *
 * Placed before the body parsers, because a parser that has already buffered a
 * 2 GB upload has already lost.
 *
 * @param limit - maximum body size in bytes
 */
export function bodyLimitMiddleware<TContext extends HttpContext<any, any, any>>(limit: number): MiddlewareFunction<TContext> {
  return async function glandBodyLimit(ctx: TContext, next: NextFunction) {
    const declared = Number(ctx.getHeader('content-length') ?? 0);

    if (Number.isFinite(declared) && declared > limit) {
      // Thrown rather than returned: a rejected body must stop the chain, and
      // `return ctx.throw(...)` would leave the downstream parsers free to read
      // the very body that was just refused.
      throw new HttpException(HttpStatus.PAYLOAD_TOO_LARGE, {
        detail: `Request body exceeds the ${limit} byte limit`,
        extensions: { limit },
      });
    }

    await next();
  };
}

/**
 * Normalises anything thrown into an {@link HttpException}.
 *
 * A duck-typed `status` is honoured so a channel can reject a call with
 * `{ status: 409, message: 'duplicate' }` without depending on this package.
 */
export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) return error;

  if (error instanceof Error) {
    // A framework that sets `statusCode` (Express, Fastify) or `status` (Koa)
    // is describing a client-visible outcome, not an internal failure.
    const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return new HttpException(status as HttpStatus, { detail: error.message });
    }
    return new HttpException(HttpStatus.INTERNAL_SERVER_ERROR, { detail: 'Internal Server Error' });
  }

  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return new HttpException(status as HttpStatus, { detail: String((error as { message?: unknown }).message ?? '') });
    }
  }

  return new HttpException(HttpStatus.INTERNAL_SERVER_ERROR, { detail: 'Internal Server Error' });
}

/** A ready-made 404 reply, for adapters that need to bypass the context. */
export const notFoundReply = (method: string, path: string): HttpReply => HttpReply.json({ type: 'about:blank', title: 'Not Found', status: 404, detail: `Cannot ${method} ${path}` }, { status: 404 });
