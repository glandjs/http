import {
  HttpServerAdapter,
  ROUTABLE_METHODS,
  contentTypeFor,
  isReadableStream,
  toNamedWildcard,
  type HttpEventBroker,
  type HttpApplicationOptions,
  type HttpEventRecord,
  type MiddlewareEntry,
  type ReplyPayload,
  type RouteAction,
  type SseStream,
} from '@glandjs/http';
import { HttpEvent, isCoreVerb } from '@glandjs/http';
import { HttpStatus, type Dictionary } from '@medishn/toolkit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type { Server } from 'node:http';
import { FastifyContext } from './context';

/**
 * The Fastify adapter.
 *
 * Fastify is the one framework here whose lifecycle is genuinely asynchronous:
 * `listen()` returns a promise because plugins are still registering when it is
 * called, and `close()` drains connections rather than dropping them. Both are
 * surfaced properly — `HttpCore.listen()` stays synchronous for the usual
 * `app.listen(3000)` call, and `HttpCore.ready()` is the way to wait.
 *
 * ### Middleware
 *
 * Fastify has no `use()`. Gland middleware is mounted as `preHandler` hooks, one
 * hook per middleware, in registration order. That is closer to Express's model
 * than to Koa's: `await next()` resolves as soon as Fastify moves on, because
 * the hook chain is a hand-off rather than a call. A hook that `throw`s is routed
 * by Fastify's own error handler, so an upstream `catch` is the only thing you
 * do not get — the same caveat as Express, and for the same reason.
 *
 * ### Body parsing
 *
 * Native. `@fastify/formbody` is registered for
 * `application/x-www-form-urlencoded` and `@fastify/cookie` so that
 * `ctx.cookies` works, both through {@link defer} and both reported by name when
 * missing. `register()` is synchronous and queues the plugin for `ready()`, so
 * there is no race between construction and the first request.
 *
 * @typeParam TEvents - the application's channel event map
 */
export class FastifyAdapter<TEvents extends HttpEventRecord = HttpEventRecord> extends HttpServerAdapter<Server, FastifyInstance, FastifyRequest, FastifyReply, FastifyContext<TEvents>, TEvents> {
  /** Body parsers to register, in the order they were requested. */
  private readonly parsers: string[] = [];

  constructor(options?: HttpApplicationOptions) {
    // Fastify has no `instance.set()`, so `trustProxy` and the request-logging
    // switch have to be constructor options. Building the instance here rather
    // than in a field initialiser is what makes `options` available for them.
    super(
      Fastify({
        // Fastify's own logger is off: Gland publishes `request:start` and
        // `request:end`, and two loggers emitting the same line per request is
        // worse than one. Turn Fastify's back on with `app.log` if you want it.
        logger: false,
        ...(options?.https ? { https: options.https } : {}),
        ...(options?.trustProxy !== undefined ? { trustProxy: options.trustProxy as never } : {}),
      }),
      options,
      'HTTP:Fastify',
    );
  }

  // ── Set-up ─────────────────────────────────────────────────────────────

  protected async onInitialize(options?: HttpApplicationOptions): Promise<void> {
    const app = this.instance;

    // Fastify's `disable()` is not on every 5.x build, and a missing method is
    // not a reason to fail the boot. `x-powered-by` is off by default in Fastify
    // anyway; the option only matters for a reverse proxy that adds one.
    if (options?.poweredBy === false) {
      const disable = (app as { disable?: (name: string) => void }).disable;
      if (typeof disable === 'function') disable.call(app, 'x-powered-by');
    }

    // Plugins are deferred: `bodyParser()` is called *after* construction, so
    // the parser list is not populated yet, and Fastify refuses a `register()`
    // once it is ready. `defer` runs after the middleware flush and before the
    // first route, which is the only window that works.
    this.defer((instance) => {
      // JSON is the exception, because it is the one parser Fastify brings with
      // it. Gland's documented default is that no parser is installed until one
      // is declared, so an application that never declared one has to have
      // Fastify's removed — otherwise Fastify is the only adapter that parses a
      // body nobody asked for, and it hands the handler an object where the
      // other four hand it `undefined`.
      if (!this.wantsBodyParser) removeJsonParser(instance);

      for (const parser of this.parsers) {
        if (parser === 'formbody') {
          // `qs`-style nesting, because a browser sends `a[b]=1` and Fastify's
          // default parser would hand back the literal key `'a[b]'`.
          instance.register(loadPlugin('@fastify/formbody') as never, { querystringParser: parseNestedQuery } as never);
        } else if (parser === 'cookie') {
          instance.register(loadPlugin('@fastify/cookie') as never);
        }
      }
    });

    // `all` expands to every routable method, and most of the extended ones are
    // not in Fastify's table. Declaring them up front — rather than as each
    // route is registered — means one pass instead of one per route.
    for (const method of ROUTABLE_METHODS) {
      if (!isCoreVerb(method.toLowerCase())) this.declareMethod(method);
    }

    app.setNotFoundHandler((request, reply) => {
      if (reply.sent) return;
      void this.notFound(this.createContext(request, reply, this.events));
    });

    app.setErrorHandler((error, request, reply) => {
      if (reply.sent) return;
      void this.safelyRenderError(error, this.createContext(request, reply, this.events));
    });

    this.logger.info('Fastify adapter configured');
  }

  /**
   * Registers the whole Gland chain as a single `preHandler` hook.
   *
   * One hook, not one per middleware. Fastify's hook chain is a hand-off — a
   * hook continues it by returning — so mounting N hooks gives N independent
   * middlewares rather than an onion: `outer` would finish before `inner` began,
   * and a downstream `throw` would never reach an upstream `catch`.
   *
   * Walking the chain as one promise-based onion inside a single hook fixes both
   * and costs almost nothing. What is given up is the ability for a Gland
   * middleware to short-circuit into a *Fastify* hook, which is a rare thing to
   * want and is reachable through `app.fastify` if it is needed.
   *
   * This is the same reason Express cannot have it — its `next()` is a hand-off
   * too — and the same reason Koa, Hono and `node:http` get it for free.
   */
  protected override afterMiddleware(): void {
    if (this.chain.length === 0) return;

    const chain = [...this.chain];

    this.instance.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = this.createContext(request, reply, this.events);
      const path = request.url.split('?')[0] ?? '/';

      const run = async (index: number): Promise<void> => {
        const entry = chain[index];
        if (!entry) return;

        if (entry.prefixes.length > 0 && !entry.prefixes.some((prefix) => matchesPrefix(path, prefix))) {
          await run(index + 1);
          return;
        }

        ctx.next = async (error?: unknown) => {
          if (error) throw error;
          await run(index + 1);
        };
        await entry.middleware(ctx, ctx.next);
      };

      await run(0);
    });

    this.logger.debug(`Installed the Gland middleware chain as one Fastify hook (${chain.length} entries)`);
  }

  /**
   * Records the parsers the application asked for.
   *
   * `false` and *never called at all* mean the same thing, and both mean no
   * parser: `HttpApplicationOptions.bodyParser` is documented as defaulting to
   * `false`, so an absent key is a request for nothing. The removal happens in
   * `onInitialize`, because that is the first point at which the final answer is
   * known — `HttpCore` calls this method from its constructor, and Fastify
   * refuses to change its content type parsers once `ready()` has run.
   */
  public bodyParser(options: Parameters<HttpServerAdapter<Server, FastifyInstance, FastifyRequest, FastifyReply, FastifyContext<TEvents>, TEvents>['bodyParser']>[0]): void {
    if (options === false) {
      this.parsers.length = 0;
      this.wantsBodyParser = false;
      return;
    }

    this.wantsBodyParser = true;

    // Everything else needs a plugin, and a plugin cannot be loaded once the
    // server has started. JSON is Fastify's own and needs nothing.
    if (options.urlencoded !== false && !this.parsers.includes('formbody')) this.parsers.push('formbody');
    if (!this.parsers.includes('cookie')) this.parsers.push('cookie');
  }

  /** Whether the application declared any parser. Default: no. */
  private wantsBodyParser = false;

  public useStaticAssets(root: string, options: Record<string, unknown> = {}): void {
    const { prefix, ...staticOptions } = options;
    // Deferred: `@fastify/static` has to be registered before the instance is
    // sealed, and after the Gland hooks are installed so a hook can still read
    // the request for logging.
    this.defer((app) => {
      app.register(loadPlugin('@fastify/static') as never, { root, prefix: (prefix as string) ?? '/', ...staticOptions } as never);
    });
  }

  // ── Routes ─────────────────────────────────────────────────────────────

  public registerRoute(method: string, path: string, action: RouteAction<FastifyRequest, FastifyReply, FastifyContext<TEvents>>): void {
    const entry = this.pendingRoute ?? { method, verb: method.toLowerCase(), path, action, origin: 'manual' as const };
    const url = toNamedWildcard(path, 'splat');
    const verb = method.toLowerCase();

    // Fastify validates every method against a fixed list, and `PROPFIND` is not
    // on it — the route is rejected at boot with "PROPFIND method is not
    // supported". `addHttpMethod` is Fastify's own answer to that, and it has to
    // run before the route is declared.
    if (!isCoreVerb(verb) && verb !== 'all') this.declareMethod(method);

    const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await this.dispatch(entry, request, reply);
    };

    // Fastify has no `all`. A method array is the equivalent — the same intent
    // as `app.all()` on Express and `router.register(path, methods)` on Koa.
    const methods = verb === 'all' ? [...ROUTABLE_METHODS] : [method as never];

    try {
      this.instance.route({
        method: methods as never,
        url,
        // A `GET` route answers `HEAD` too, which is the right default and also
        // produces a duplicate row in a route table when a controller declares
        // both. Left on deliberately.
        exposeHeadRoute: verb === 'get',
        handler: handler as never,
      });
    } catch (error) {
      // Naming the route turns "PROPFIND method is not supported" — which says
      // nothing about *which* route — into a message that points at the
      // controller, and a hint about the usual cause.
      this.crash(
        `Fastify rejected the route [${method} ${url}]. Fastify 5 only routes methods in node's http.METHODS, ` +
          'and addHttpMethod() cannot add anything outside that list — a WebDAV verb such as MKWORKSPACE has no ' +
          'Fastify equivalent and must be served by another adapter.',
        error,
      );
      throw error;
    }
  }

  /**
   * Teaches Fastify a method it does not know.
   *
   * `find-my-way` — Fastify's router — only handles the methods in Fastify's
   * own default set, which is *narrower* than `node:http`'s `METHODS`: the
   * WebDAV verbs and `SEARCH` are absent, and a route that uses one is rejected
   * with `PROPFIND method is not supported`. `addHttpMethod` is the documented
   * way in.
   *
   * Two things that are easy to get wrong, and both were:
   *
   * - **The check cannot be `http.METHODS`.** `addHttpMethod` accepts anything
   *   in that list, and `PROPFIND` is in it — so a guard that skips "known"
   *   methods skips exactly the ones that need declaring, and the route is then
   *   rejected. This guard therefore asks whether Fastify *already* has the
   *   method, which `addHttpMethod` itself reports by deprecating a repeat call.
   *   Passing `overrideExisting` is what keeps that warning out of the log.
   * - **Methods outside `http.METHODS`** — `MKWORKSPACE` and `UPDATE` — are
   *   rejected outright. Fastify has no equivalent, so the route is reported
   *   and the application continues without it.
   */
  private declareMethod(method: string): void {
    const upper = method.toUpperCase();
    if (this.declaredMethods.has(upper)) return;
    this.declaredMethods.add(upper);

    const add = (this.instance as { addHttpMethod?: (m: string, opts?: { overrideExisting?: boolean; hasBody?: boolean }) => void }).addHttpMethod;
    if (typeof add !== 'function') {
      this.logger.warn(`Fastify cannot accept "${upper}" — this build exposes no addHttpMethod(), so the route will not match.`);
      return;
    }

    try {
      // `hasBody: false` because a WebDAV `PROPFIND` and a `SEARCH` carry one,
      // but Fastify's body parser only handles the types it knows either way, and
      // declaring them body-bearing would reject a JSON body schema outright.
      add.call(this.instance, upper, { overrideExisting: true, hasBody: true });
      this.logger.debug(`Declared the extended HTTP method ${upper} on Fastify`);
    } catch (error) {
      this.logger.warn(
        `Fastify cannot route "${upper}" (${error instanceof Error ? error.message : String(error)}). ` +
          'The method is not in node:http#METHODS, so it has no Fastify equivalent. Use @glandjs/express, ' +
          '@glandjs/koa, @glandjs/hono or @glandjs/node if the application needs it.',
      );
    }
  }

  private readonly declaredMethods = new Set<string>();

  // ── Middleware ─────────────────────────────────────────────────────────

  /**
   * Framework-native middleware is not supported.
   *
   * Fastify has no `use()`, and silently dropping a `useRaw(compression())` call
   * would leave an application that believes compression is on. Reporting it is
   * the only honest option; the fix is to register a Fastify plugin.
   */
  public useOne(...args: unknown[]): unknown {
    this.logger.warn('useRaw() is not supported by the Fastify adapter — the middleware was ignored. ' + `Register it as a Fastify plugin instead, e.g. app.register(${describe(args[0])}).`);
    return undefined;
  }

  /**
   * Records one Gland middleware for the chain this adapter will run.
   *
   * The *raw* middleware is stored, not a wrapped hook. The chain is walked in
   * {@link FastifyAdapter.afterMiddleware}, where `next` can be the real
   * continuation — wrapping first and running the wrappers second is what made
   * every middleware resolve its own `next` to a no-op, so only the outermost
   * ever reached the handler.
   */
  protected override mount(entry: MiddlewareEntry): void {
    const middleware = entry.value as (ctx: FastifyContext<TEvents>, next: (error?: unknown) => Promise<void>) => unknown;
    const prefixes = (Array.isArray(entry.path) ? entry.path : entry.path ? [entry.path] : []).map(String);

    this.chain.push({ middleware, prefixes });
  }

  /** The recorded Gland middleware, in registration order. */
  private readonly chain: Array<{ middleware: (ctx: FastifyContext<TEvents>, next: (error?: unknown) => Promise<void>) => unknown; prefixes: string[] }> = [];

  /**
   * Wraps one Gland middleware in Fastify's hook signature.
   *
   * Reachable only when a caller invokes it directly; {@link mount} is what
   * records the chain and {@link FastifyAdapter.afterMiddleware} is what runs
   * it.
   */
  public bridgeGland(entry: MiddlewareEntry, _request?: FastifyRequest, _reply?: FastifyReply, _next?: unknown): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
    const middleware = entry.value as (ctx: FastifyContext<TEvents>, next: (error?: unknown) => Promise<void>) => unknown;

    return async (req: FastifyRequest, res: FastifyReply) => {
      const ctx = this.createContext(req, res, this.events);
      await middleware(ctx, async () => undefined);
    };
  }

  // ── Context ────────────────────────────────────────────────────────────

  /**
   * Returns the request's context, creating it once.
   *
   * Fastify passes the same `request` and `reply` objects to every hook and to
   * the handler, so memoising on them is what makes `ctx.state` shared.
   */
  public createContext(req: FastifyRequest, res: FastifyReply, events: HttpEventBroker<TEvents> = this.events): FastifyContext<TEvents> {
    const existing = (req as FastifyRequest & { glandContext?: FastifyContext<TEvents> }).glandContext;
    if (existing) return existing;

    const ctx = new FastifyContext<TEvents>(events, req, res);
    Object.defineProperty(req, 'glandContext', { value: ctx, enumerable: false, configurable: true, writable: true });
    ctx.loggerUnsupported = (what, detail) => this.logger.warn(`ctx.${what}() does not support "${detail}" on Fastify — the option was ignored.`);

    res.raw.on('close', () => {
      if (!res.sent) ctx.aborted = true;
    });

    return ctx;
  }

  /**
   * Copies `request.params` onto the context.
   *
   * Fastify fills params in the route handler, so a context first built by a
   * `preHandler` hook has none. Reading them back here is what makes
   * `ctx.params` mean the same thing on every adapter.
   */
  protected override syncParams(ctx: FastifyContext<TEvents>, req: FastifyRequest): void {
    const params = (req.params ?? {}) as Record<string, unknown>;
    if (Object.keys(params).length > 0) ctx.params = params as Dictionary<string>;
  }

  // ── Replies ────────────────────────────────────────────────────────────

  public responded(ctx: FastifyContext<TEvents>): boolean {
    return ctx.responded;
  }

  public async write(ctx: FastifyContext<TEvents>, payload: ReplyPayload): Promise<void> {
    ctx.wrote();
    const reply = ctx.res;

    if (payload.status) reply.status(payload.status);
    if (payload.headers) ctx.setHeaders(payload.headers as never);

    const contentType = contentTypeFor(payload);
    if (contentType && !reply.getHeader('Content-Type')) reply.header('Content-Type', contentType);
    if (payload.filename) ctx.attachment(payload.filename);

    switch (payload.kind) {
      case 'empty':
        reply.send();
        return;

      case 'json':
        // `reply.send(object)` is the JSON path. `reply.json()` is an alias for
        // it, but `send` is what Fastify's serializer pipeline is built around.
        reply.send(payload.body);
        return;

      case 'text':
        reply.send(payload.body === undefined ? '' : String(payload.body));
        return;

      case 'buffer':
        reply.send(payload.body as Buffer);
        return;

      case 'stream':
        await this.pipeStream(ctx, payload.body as NodeJS.ReadableStream);
        return;

      case 'sse': {
        const sse = payload.body as SseStream;
        for (const [name, value] of Object.entries(sse.headers)) reply.header(name, value);
        reply.raw.flushHeaders?.();
        await this.pipeStream(ctx, sse);
        return;
      }

      case 'redirect':
        // Fastify's order is `redirect(dest, status)`, the reverse of Express's.
        reply.redirect(String(payload.body), payload.status ?? HttpStatus.FOUND);
        return;

      case 'file':
        reply.send(createReadStream(String(payload.body)));
        return;

      default:
        reply.send(payload.body);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Resolves once Fastify has finished loading its plugins. */
  public async ready(): Promise<void> {
    await this.instance.ready();
  }

  public async listen(port: number, options: { host?: string; message?: string } = {}): Promise<void> {
    const host = options.host ?? 'localhost';
    const instance = this.instance;

    try {
      // `ready()` first. Without it a `listen()` racing plugin registration
      // throws `FST_ERR_INSTANCE_ALREADY_LISTENING`, and the failure surfaces as
      // an unhandled rejection rather than as a boot error.
      await instance.ready();
      await instance.listen({ port, host });

      const address = instance.server.address();
      this.boundPort = typeof address === 'object' && address ? address.port : port;
      this.events.safeEmit(HttpEvent.ServerListening, {
        host,
        port: this.boundPort,
        url: `http${this.options?.https ? 's' : ''}://${host}:${this.boundPort}`,
        message: options.message,
        timestamp: new Date().toISOString(),
      });
      this.logger.info(options.message ?? `Fastify listening on ${host}:${this.boundPort}`);
    } catch (error) {
      this.crash(`Fastify failed to listen on ${host}:${port}`, error);
    }
  }

  public async close(): Promise<void> {
    const startedAt = Date.now();
    if (this.boundPort === undefined) {
      this.publishClosed(startedAt, true);
      return;
    }

    try {
      // Fastify's `close()` refuses new requests and waits for in-flight ones,
      // which is the correct shutdown order and the reason it is not a plain
      // `server.close()`.
      await this.instance.close();
    } catch (error) {
      this.crash('Error while closing the Fastify server', error);
    }

    this.server = undefined;
    this.boundPort = undefined;
    this.publishClosed(startedAt, false);
    this.logger.info('Fastify server closed');
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async pipeStream(ctx: FastifyContext<TEvents>, source: NodeJS.ReadableStream): Promise<void> {
    if (!isReadableStream(source)) {
      ctx.res.send();
      return;
    }

    const streamHeaders = (source as { getHeaders?: () => Record<string, string> }).getHeaders?.();
    if (streamHeaders && ctx.res.getHeader('Content-Type') === undefined && streamHeaders.type) {
      ctx.res.header('Content-Type', streamHeaders.type);
    }

    try {
      // `reply.raw` rather than `reply`: writing through `reply` would run the
      // payload back through Fastify's serializer, which cannot handle a stream
      // that is already piped. `hijack()` tells Fastify the response is no
      // longer its to manage, so it does not try to send one afterwards.
      ctx.res.hijack();
      await streamPipeline(source, ctx.res.raw);
    } catch (error) {
      this.logger.error('Error while streaming a Fastify response', error instanceof Error ? error.stack : String(error));
      if (!ctx.res.raw.writableEnded) ctx.res.raw.end();
    }
  }
}

/**
 * Removes Fastify's built-in JSON parser.
 *
 * With it gone, a `Content-Type: application/json` request is answered with
 * `415 Unsupported Media Type` before any handler runs — which is the behaviour
 * `@glandjs/http` documents for `bodyParser: false`, and what Express, Koa and
 * `node:http` all do. Leaving Fastify's default in place would make it the one
 * adapter that parses a body nobody declared.
 */
function removeJsonParser(app: FastifyInstance): void {
  const remove = (app as { removeContentTypeParser?: (type: string) => void }).removeContentTypeParser;
  if (typeof remove !== 'function') return;
  remove.call(app, 'application/json');
  // The shorthand is a second registration of the same parser on some Fastify
  // builds, and leaving it means a request with no `Content-Type` still parses.
  try {
    remove.call(app, 'application/json; charset=utf-8');
  } catch {
    // Not registered under that key on this build, which is the common case.
  }
}

/**
 * Requires a Fastify plugin and unwraps its default export.
 *
 * Two things matter here. `loadPackage` from `@glandjs/common` does the require,
 * but it is a peer dependency and a static import of its types is not worth the
 * coupling for one call. And the unwrap matters more than it looks: every
 * `@fastify/*` package is compiled to ESM, so `require()` hands back a module
 * namespace — `{ default, fastifyCookie, serialize, … }` — and
 * `app.register(namespace)` registers *nothing useful*. The result is a Fastify
 * app with no `reply.setCookie`, which surfaces as a `TypeError` inside a handler
 * rather than as a boot error.
 *
 * @throws with the package name when it is not installed
 */
function loadPlugin(name: string): unknown {
  let module: Record<string, unknown>;
  try {
    module = require(name) as Record<string, unknown>;
  } catch {
    throw new Error(`The "${name}" package is missing. Install it to use the Fastify feature that needs it.`);
  }

  if (typeof module === 'function') return module;
  // A `@fastify/*` package names its plugin after the package, so
  // `@fastify/cookie` → `fastifyCookie`.
  const named = module[`${name.replace('@fastify/', 'fastify')}`];
  return module.default ?? named ?? module;
}

/** A readable description of a rejected middleware, for the warning. */
function describe(value: unknown): string {
  if (typeof value === 'function') return (value as { name?: string }).name || 'the plugin';
  return String(value);
}

/** Whether `path` starts with `prefix` on a segment boundary. */
function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix === '/' || prefix === '') return true;
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === normalized || path.startsWith(`${normalized}/`);
}

/**
 * Parses `a[b]=1&c=2` into `{ a: { b: '1' }, c: '2' }`.
 *
 * Fastify's default body querystring parser is the flat `querystring` one, so a
 * bracketed form body would arrive with the literal key `'a[b]'` unless this is
 * installed. Twelve lines, no dependency, and it is what a browser actually
 * sends.
 */
function parseNestedQuery(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, rawValue] of new URLSearchParams(input)) {
    const segments = key.match(/[^[\]]+/g);
    if (!segments || segments.length === 0) continue;

    let cursor = result;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] as string;
      if (typeof cursor[segment] !== 'object' || cursor[segment] === null) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }

    const leaf = segments[segments.length - 1] as string;
    const existing = cursor[leaf];
    // A repeated key becomes an array, matching the behaviour of every other
    // Gland adapter rather than Express's "last value wins".
    cursor[leaf] = existing === undefined ? rawValue : ([] as string[]).concat(existing as string, rawValue);
  }
  return result;
}
