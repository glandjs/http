# Writing an adapter

An adapter is a context, a request listener, and a handful of one-liners. This
is the whole walkthrough, using a framework that is not in the set to keep it
honest.

```sh
pnpm --filter @glandjs/core add @myframework/thing
mkdir -p packages/myframework
```

## 1. The context

Everything the framework can tell you about a request, and everything it can be
told to reply with. A pure translation — the restraint is the point, because a
context that _reinterprets_ the framework's API is one whose bugs are the
framework's bugs plus yours.

```ts
import { HttpContext, type HttpEventBroker, type HttpHeaderInput, type HttpHeaderValue, type RequestMethod } from '@glandjs/http';
import type { Request, Response } from '@myframework/thing';
import type { EventRecord } from '@glandjs/events';
import { HttpStatus, type Dictionary, type Maybe } from '@medishn/toolkit';

export class MyContext<TEvents extends EventRecord = EventRecord> extends HttpContext<Request, Response, TEvents> {
  constructor(events: HttpEventBroker<any>, req: Request, res: Response) {
    super(events, req, res);
    this.params = (req.params ?? {}) as Dictionary<string>;
  }

  get body(): any {
    return this.req.body;
  }
  get path(): string {
    return this.req.pathname;
  }
  get method(): RequestMethod {
    return this.req.method as RequestMethod;
  }
  get query(): Dictionary<string | string[] | undefined> {
    return this.req.searchParams;
  }
  get headers(): Dictionary<string | string[] | undefined> {
    return this.req.headers;
  }

  status(code: HttpStatus | number): this {
    this.res.status = code;
    return this;
  }
  send(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    return this.writeThrough(data, statusCode, headers);
  }
  json(data: any, statusCode?: number, headers?: Dictionary<HttpHeaderInput<string> | readonly string[]>): this {
    if (statusCode) this.res.status = statusCode;
    if (headers) this.setHeaders(headers);
    this.res.body = data; // framework does the encoding
    return this.markWritten();
  }
  html(body: string) {
    this.res.contentType = 'text/html';
    return this.send(body);
  }
  text(body: string) {
    this.res.contentType = 'text/plain';
    return this.send(body);
  }
  xml(body: string) {
    this.res.contentType = 'application/xml';
    return this.send(body);
  }
  end(): this {
    this.res.close();
    return this.markWritten();
  }

  // …and the rest of the abstract surface

  hasHeader(name: string) {
    return this.res.headers.has(name);
  }
  getHeader<T extends string>(name: T): HttpHeaderValue<T> {
    return (this.req.headers[String(name).toLowerCase()] ?? undefined) as HttpHeaderValue<T>;
  }
  getResponseHeader<T extends string>(name: T) {
    return this.res.headers.get(name) ?? (undefined as HttpHeaderValue<T>);
  }
  hasResponseHeader(name: string) {
    return this.res.headers.has(name);
  }
  setHeader<T extends string>(name: T, value: HttpHeaderInput<T>) {
    this.res.headers.set(name, String(value));
    return this;
  }
}
```

Two things to get right, both from the contract:

- **`getHeader` reads the request.** Every consumer — `accepts`, CORS, the body
  parsers — is asking what the client sent.
- **Every write marks itself.** `markWritten()` is what stops
  `return ctx.redirect(url)` being serialised as a body.

## 2. The adapter

```ts
export class MyAdapter<TEvents extends EventRecord = EventRecord> extends HttpServerAdapter<Server, App, Request, Response, MyContext<TEvents>, TEvents> {
  constructor() {
    super(createApp(), undefined, 'HTTP:MyFramework');
  }

  protected onInitialize(): void {
    this.instance.on('error', (error) => this.crash('Server error', error));

    // The 404 goes here, not in the middleware queue: it has to be *behind*
    // every route. A middleware mounted earlier answers first, and returns "not
    // found" for everything.
    this.defer(() => {});
  }

  protected override afterRoutes(): void {
    this.instance.on('not-found', (req, res) => void this.notFound(this.createContext(req, res, this.events)));
  }

  // Idempotent per request. A WeakMap is the least intrusive option.
  private readonly cache = new WeakMap<object, MyContext<any>>();

  public createContext(req: Request, res: Response, events = this.events): MyContext<any> {
    const existing = this.cache.get(req);
    if (existing) return existing;
    const ctx = new MyContext(events, req, res);
    this.cache.set(req, ctx);
    return ctx;
  }

  // Params may be filled after the middleware ran.
  protected override syncParams(ctx: MyContext<any>, req: Request): void {
    if (req.params) ctx.params = req.params as Record<string, string>;
  }

  public registerRoute(method: string, path: string, action: RouteAction<Request, Response, MyContext<any>>): void {
    const entry = this.pendingRoute ?? { method, verb: method.toLowerCase(), path, action, origin: 'manual' as const };
    this.instance.on(method.toLowerCase(), path, (req, res) => this.dispatch(entry, req, res));
  }

  public useOne(...args: unknown[]): unknown { return this.instance.use(...(args as never[])); }

  // Only if the framework cannot take a per-request closure.
  protected override mount(entry: MiddlewareEntry): void { … }

  public bridgeGland(entry: MiddlewareEntry): MyMiddleware {
    const middleware = entry.value as (ctx: MyContext<any>, next: () => Promise<void>) => unknown;
    return async (req, res, next) => {
      const ctx = this.createContext(req, res, this.events);
      await middleware(ctx, async () => { await next(); });
    };
  }

  public responded(ctx: MyContext<any>): boolean {
    return ctx.written || this.instance.isFinished(ctx.res);
  }

  public async write(ctx: MyContext<any>, payload: ReplyPayload): Promise<void> {
    ctx.wrote();
    if (payload.status) ctx.status(payload.status);
    if (payload.headers) ctx.setHeaders(payload.headers as never);

    const contentType = contentTypeFor(payload);
    if (contentType) ctx.setHeader('content-type', contentType);

    switch (payload.kind) {
      case 'empty':  ctx.end(); return;
      case 'json':   ctx.json(payload.body); return;
      case 'text':   ctx.text(String(payload.body ?? '')); return;
      case 'buffer': ctx.end(payload.body as Buffer); return;
      case 'stream': await pipe(ctx, payload.body as never); return;
      case 'sse':    for (const [n, v] of Object.entries((payload.body as SseStream).headers)) ctx.setHeader(n, v); await pipe(ctx, payload.body as never); return;
      case 'redirect': ctx.redirect(String(payload.body), payload.status ?? 302); return;
      case 'file':   ctx.sendFile(String(payload.body)); return;
      default:       ctx.json(payload.body);
    }
  }

  public bodyParser(options: BodyParserOptions | false): void { this.queue.push({ kind: 'raw', value: [myParser(options)] }); }
  public useStaticAssets(root: string, options = {}): void { this.queue.push({ kind: 'raw', value: [serve(root, options)] }); }

  public listen(port: number, options: ServerListening = {}): void {
    const server = this.instance.listen(port, options.host);
    server.on('listening', () => this.reportListening(port, options));
    this.server = server;
  }

  public async close(): Promise<void> { /* drain, then this.server = undefined */ }
}
```

`reportListening()` and `publishClosed()` are inherited helpers that resolve the
**bound** port — which is not the requested one when you passed `0`.

## 3. The core and the broker

```ts
export class MyCore<TEvents extends EventRecord = EventRecord> extends HttpCore<Server, App, Request, Response, MyContext<TEvents>, TEvents> {
  constructor(options?: HttpApplicationOptions) {
    super(new MyAdapter<TEvents>(), options);
  }
}

export class MyBroker<TEvents extends EventRecord = EventRecord> extends HttpBroker<TEvents, MyCore<TEvents>, HttpApplicationOptions> {
  constructor(options?: HttpApplicationOptions) {
    super(new MyCore<TEvents>(options), options);
  }
}
```

`HttpBroker` is the whole broker: it subscribes to `gland:define:route`, registers
each route with `fullPath`, and reports it when none arrive — a silent
zero-route table is the one failure this layer refuses to have.

## 4. The package

Mirror an existing adapter's `package.json`, `tsconfig.json` and `index.ts`, add
it to `pnpm-workspace.yaml` (already covered by `packages/*`), and add a
`build` script.

## 5. The test

Add a transport to `test/integration/adapters.spec.ts`. That is the real
acceptance criterion:

```ts
function myTransport(): Transport {
  let http: HttpApp | undefined;
  return {
    name: 'myframework',
    skip: [], // name what you genuinely cannot do
    async start() {
      const { app } = await GlandFactory.create(AppModule);
      http = app.connectTo(MyBroker, sharedOptions);
      sharedMiddleware(http);
      http.enableCors(sharedCors);
      http.listen(0, { host: '127.0.0.1' });
      await http.ready();
      return http.port!;
    },
    async stop() {
      await http?.close();
    },
  };
}
```

Twenty-odd assertions: JSON, text, HTML sniffing, a number, an explicit reply,
a `204`, parameters, a repeated query key, a body, a channel call, problem
details, a `500` with no leak, a stream, a `404`, the onion, path scoping,
CORS, a preflight, a cookie, a handler-set header, `PROPFIND`, a redirect.

Anything you cannot pass goes in `skip` **with a reason**. A skip is a finding
worth writing down; a quietly different behaviour is not.
