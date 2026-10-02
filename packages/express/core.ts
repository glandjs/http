import { HttpCore, type HttpApplicationOptions } from '@glandjs/http';
import type { HttpEventRecord } from '@glandjs/http';
import { isNil } from '@medishn/toolkit';
import type { Application, Request, Response } from 'express';
import type { Server } from 'node:http';
import { ExpressAdapter } from './adapter';
import { ExpressContext } from './context';

/**
 * The Express application.
 *
 * `ExpressCore` is `HttpCore` with Express's types in the five slots that matter.
 * There is no other logic here, and that is deliberate: an application that
 * depends on behaviour implemented in the adapter cannot be moved to another
 * transport, which is the one thing the adapter architecture exists to allow.
 *
 * @typeParam TEvents - the application's channel event map
 *
 * @example
 * ```ts
 * const app = new ExpressCore<MyEvents>({ prefix: '/api' });
 * app.json();
 * app.use(async (ctx, next) => { await next(); });
 * ```
 */
export class ExpressCore<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpCore<Server, Application, Request, Response, ExpressContext<TEvents>, TEvents> {
  constructor(options?: HttpApplicationOptions) {
    super(new ExpressAdapter<TEvents>(), options);
  }

  /**
   * Sets an Express setting.
   *
   * A pass-through to `app.set()`, exposed so an application does not have to
   * reach through `app.instance` for the handful of settings Gland does not
   * model. Anything Gland *does* model — `trustProxy`, `poweredBy` — belongs in
   * {@link HttpApplicationOptions} and takes effect at construction.
   */
  public set(key: string, value: unknown): this {
    this.instance.set(key, value as never);
    return this;
  }

  /** The framework's own middleware factory, for `app.instance`. */
  public express(): typeof import('express') {
    return this.instance as never;
  }

  /** Whether a path starts with `prefix`, on a segment boundary. */
  public static matches(prefix: string, path: string): boolean {
    if (isNil(prefix) || prefix === '/' || prefix === '') return true;
    const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return path === normalized || path.startsWith(`${normalized}/`);
  }
}
