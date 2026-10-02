# API reference

Every public export, grouped by package. The [guides](../guides) explain _when_
to use each of these; this page is for looking one up.

## `@glandjs/http`

The framework-agnostic core. No server, no router, no framework import.

### Application

| Export                    | Kind  | What it is                                |
| ------------------------- | ----- | ----------------------------------------- |
| `HttpCore`                | class | The application. Every adapter extends it |
| `HttpBroker`              | class | What `app.connectTo()` takes              |
| `HttpApplicationSettings` | type  | The shape of `app.settings`               |

#### `HttpCore`

| Member                                                                      | Notes                                  |
| --------------------------------------------------------------------------- | -------------------------------------- |
| `get` `post` `put` `patch` `delete` `head` `options`                        | route verbs, fluent                    |
| `all` `trace` `connect` `purge` `search`                                    | the rest, fluent                       |
| `propfind` `proppatch` `mkcol` `copy` `move` `lock` `unlock` `acl` `report` | WebDAV, fluent                         |
| `registerRoute(method, path, action, origin?)`                              | for anything else                      |
| `use(mw)` / `use(path, mw)`                                                 | Gland middleware                       |
| `useRaw(...args)`                                                           | framework-native middleware            |
| `setErrorHandler(fn)`                                                       | the terminal error renderer            |
| `listen(port, options?)`                                                    | bind, and return `this`                |
| `ready()`                                                                   | resolves once the socket is bound      |
| `close()`                                                                   | drain and release                      |
| `enableCors(config?)`                                                       | the shared CORS middleware             |
| `json` `urlencoded` `text` `multipart` `raw` `bodyParser`                   | parsers                                |
| `useStaticAssets(root, options?)`                                           | a static mount                         |
| `setGlobalPrefix(prefix)`                                                   | idempotent                             |
| `setViewEngine(engine)` / `setBaseViewsDir(dir)`                            | views, in module form                  |
| `on(event, fn)` / `off(event, fn)`                                          | the lifecycle bus                      |
| `handleError(error, message)`                                               | report a transport failure             |
| `get adapter` `instance` `broker` `id` `port`                               | the framework, and the bus             |
| `get routes` `middleware` `settings`                                        | the route table, the queue, the config |

#### Events

`app.on(...)` accepts the `HttpEvent` names.

| Constant                    | Fires                                           |
| --------------------------- | ----------------------------------------------- |
| `HttpEvent.Options`         | construction options                            |
| `HttpEvent.RouteRegistered` | a route reached the adapter                     |
| `HttpEvent.RouteMiss`       | nothing matched                                 |
| `HttpEvent.RequestStart`    | a request was accepted                          |
| `HttpEvent.RequestEnd`      | a request finished, always                      |
| `HttpEvent.RequestError`    | a request threw, with the context               |
| `HttpEvent.ServerListening` | the socket is bound                             |
| `HttpEvent.ServerClosed`    | the socket is released                          |
| `HttpEvent.ServerCrashed`   | a listener threw, or the server failed to start |

### Context

| Export        | Kind                                       |
| ------------- | ------------------------------------------ |
| `HttpContext` | abstract class — the whole request surface |
| `AcceptType`  | type                                       |

### Contracts

| Export                                 | Kind  | What it is                                  |
| -------------------------------------- | ----- | ------------------------------------------- |
| `HttpReply`                            | class | An explicit reply. Nine static constructors |
| `ReplyBody` `ReplyKind` `ReplyPayload` | types | What a handler may return                   |
| `HttpReplyOptions`                     | type  | Status, headers, content type, filename     |
| `NextFunction`                         | type  | `(error?) => Promise<void>`                 |
| `MiddlewareFunction`                   | type  | `(ctx, next) => unknown`                    |
| `ErrorHandlerFunction`                 | type  | `(error, ctx) => unknown`                   |
| `RouteAction`                          | type  | `(ctx, ...args) => unknown`                 |
| `RegisteredRoute`                      | type  | One entry of the route table                |

### Adapters

| Export                   | Kind           | What it is                 |
| ------------------------ | -------------- | -------------------------- |
| `HttpServerAdapter`      | abstract class | What an adapter implements |
| `MiddlewareEntry`        | type           | One queued middleware      |
| `HttpEventBroker`        | class          | The lifecycle bus          |
| `HttpServerAdapterClass` | type           | For a factory function     |

### Methods and routes

| Export                                                                        | Kind                                |
| ----------------------------------------------------------------------------- | ----------------------------------- |
| `RequestMethod`                                                               | enum — the wire methods, plus `ALL` |
| `HTTP_VERBS` `CORE_HTTP_VERBS` `ROUTABLE_METHODS` `ROUTABLE_VERBS` `ALL_VERB` | consts                              |
| `HttpVerb` `CoreHttpVerb`                                                     | types                               |
| `toVerb` `isHttpVerb` `isCoreVerb` `isRequestMethod`                          | functions                           |

### Decorators

`Get` `Post` `Put` `Patch` `Delete` `Head` `Options` `All` `Trace` `Connect`
`Purge` `Search` `Propfind` `Proppatch` `Mkcol` `Copy` `Move` `Lock` `Unlock`
`Acl` `Report` `RequestMapping`.

All from `@glandjs/http`, not from the adapter — a controller should not change
when the transport does.

### Middleware

| Export                          | Kind     | What it is                                   |
| ------------------------------- | -------- | -------------------------------------------- |
| `createCorsMiddleware(config?)` | function | The CORS middleware                          |
| `errorHandler`                  | function | The default problem-details renderer         |
| `withErrors(handler, onError?)` | function | Return and throw symmetrically               |
| `bodyLimit(limit)`              | function | Reject an oversized body, before the parsers |
| `toHttpException(error)`        | function | Normalise anything into an `HttpException`   |
| `notFoundReply(method, path)`   | const    | A ready-made 404                             |

### Utils

| Export                                                                                                   | What it does                                     |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `normalizePath(path)`                                                                                    | One leading slash, no trailing slash, no doubles |
| `joinPath(base, child)`                                                                                  | `/` is "nothing to add" on either side           |
| `applyPrefix(path, prefix)`                                                                              | Idempotent prefixing                             |
| `paramNames(pattern)`                                                                                    | The parameters in a pattern                      |
| `splitUrl(url)`                                                                                          | Path and query                                   |
| `toNamedWildcard(path, name)`                                                                            | A bare `*` for routers that require a name       |
| `toReplyPayload(value)`                                                                                  | The one return-value decision                    |
| `contentTypeFor(payload)`                                                                                | The header for a payload                         |
| `looksLikeHtml(text)`                                                                                    | A deliberately narrow sniff                      |
| `isReadableStream` `isBinary` `isSseStream`                                                              | Type guards                                      |
| `baseContentType` `isJsonContentType` `isTextContentType` `isHtmlContentType` `isEventStreamContentType` | Content-type helpers                             |
| `ContentType`                                                                                            | The values the adapters write                    |
| `parseCookieHeader(header)`                                                                              | `Cookie` → a bag                                 |
| `serializeCookie(name, value, options)`                                                                  | `Set-Cookie`                                     |
| `SseStream` `SseEvent` `SseStreamOptions`                                                                | A live event stream, and a `Readable`            |
| `collectBody(limit)`                                                                                     | The `node:http` body collector                   |

### Constants and the core contract

| Export              | What it is                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `HttpEvent`         | The lifecycle event names                                                      |
| `GLAND_ROUTE_EVENT` | The route broadcast, duplicated so the layer is not pinned to one core version |
| `GlandRoute`        | Its payload — `{ path, fullPath, method, action }`                             |
| `GlandContextState` | What the binder attaches to `ctx.state`                                        |
| `isGlandRoute`      | A type guard                                                                   |

### Interfaces

`HttpApplicationOptions` `BodyParserOptions` `JsonBodyParserOptions`
`UrlencodedBodyParserOptions` `MultipartBodyParserOptions`
`TextBodyParserOptions` `RawBodyParserOptions` `CookieOptions` `SendOptions`
`ErrorCallback` `RequestCookie` `RequestCookies` `HttpsOptions`
`HttpServerOptions` `CorsOptions` `CorsConfig` `CorsOptionsDelegate`
`CorsOptionsCallback` `StaticOrigin` `CustomOrigin` `ServerListening`
`ServerListeningEvent` `ServerClosedEvent` `ServerCrashedEvent`
`RequestLifecycleEvent` `HttpHeaderName` `HttpHeaderValue` `HttpHeaderInput`
`HeaderBag` `ContentTypeValue` `HttpEventRecord` `HttpEventKey` `HttpEventName`

## `@glandjs/express`

| Export                                 | Kind                     |
| -------------------------------------- | ------------------------ |
| `ExpressBroker` / `ExpressBrokerClass` | What `connectTo()` takes |
| `ExpressCore`                          | The application          |
| `ExpressAdapter`                       | The adapter              |
| `ExpressContext`                       | The context              |
| `EXPRESS_VERBS` `ExpressApp`           | Extras                   |

## `@glandjs/fastify`

| Export                                 | Kind                                           |
| -------------------------------------- | ---------------------------------------------- |
| `FastifyBroker` / `FastifyBrokerClass` | What `connectTo()` takes                       |
| `FastifyCore`                          | The application, with a typed `fastify` getter |
| `FastifyAdapter`                       | The adapter                                    |
| `FastifyContext` `FastifyRouteOptions` | The context                                    |

## `@glandjs/koa`

| Export                                    | Kind                                       |
| ----------------------------------------- | ------------------------------------------ |
| `KoaBroker` / `KoaBrokerClass`            | What `connectTo()` takes                   |
| `KoaCore`                                 | The application, with a typed `koa` getter |
| `KoaAdapter`                              | The adapter                                |
| `KoaContext` `KoaState` `GlandKoaContext` | The context                                |

## `@glandjs/hono`

| Export                                                | Kind                                        |
| ----------------------------------------------------- | ------------------------------------------- |
| `HonoBroker` / `HonoBrokerClass`                      | What `connectTo()` takes                    |
| `HonoCore`                                            | The application, with a typed `hono` getter |
| `HonoAdapter`                                         | The adapter                                 |
| `HonoRequestContext` `FetchBodyInit` `parseFetchBody` | The context                                 |

## `@glandjs/node`

| Export                           | Kind                           |
| -------------------------------- | ------------------------------ |
| `NodeBroker` / `NodeBrokerClass` | What `connectTo()` takes       |
| `NodeCore`                       | The application                |
| `NodeAdapter`                    | The adapter                    |
| `NodeContext` `parseBody`        | The context                    |
| `compile` `matchSegments`        | The router, exported for tests |

## Where a decorator comes from

The one that catches people:

```ts
import { Controller, Channel, Module, On } from '@glandjs/common'; // composition
import { Get, Post, Put, Delete } from '@glandjs/http'; // ROUTES
import { ExpressBroker } from '@glandjs/express'; // transport
```

Route decorators come from `@glandjs/http`. A route declared against the adapter
package would not survive a transport change, which is the one thing the adapter
architecture exists to allow.
