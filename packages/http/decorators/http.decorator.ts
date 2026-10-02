import { METHOD_METADATA, PATH_METADATA } from '@glandjs/common';
import { RequestMethod } from '../enum';

/**
 * Metadata written by the route decorators.
 *
 * The shape is keyed by the shared constants from `@glandjs/common` rather than
 * by literal strings, so the writer here and the reader in `@glandjs/core`
 * cannot drift apart.
 */
export interface RequestMappingMetadata {
  /** Handler path, relative to the controller prefix. `':id'`, `'/find'`. */
  path?: string | string[];
  /** Wire method. */
  method?: RequestMethod;
}

/** Fallback metadata for a decorator called with no arguments. */
const DEFAULT_METADATA: RequestMappingMetadata = {
  [PATH_METADATA]: '/',
  [METHOD_METADATA]: RequestMethod.GET,
};

/**
 * Base route decorator.
 *
 * Writes the handler's path and method into `Reflect` metadata on the method's
 * **function object** — not the prototype, not the class. That is the only
 * place both are reachable from, and it is what `Explorer` reads back when it
 * builds the route list the binder broadcasts to every adapter.
 *
 * Applied to a property decorator (where `descriptor` is `undefined`) the
 * metadata lands on the target instead, so `@Get` can decorate a getter.
 *
 * @param metadata - path and method; defaults to `GET /`
 *
 * @example
 * ```ts
 * class HealthController {
 *   @RequestMapping({ path: '/live', method: RequestMethod.GET })
 *   live(ctx: HttpContext) { return { alive: true }; }
 * }
 * ```
 */
export function RequestMapping(metadata: RequestMappingMetadata = DEFAULT_METADATA): MethodDecorator & PropertyDecorator {
  const path = normalizePath(metadata[PATH_METADATA]);
  const method = metadata[METHOD_METADATA] ?? RequestMethod.GET;

  return ((target: object, key: string | symbol, descriptor?: TypedPropertyDescriptor<unknown>) => {
    // A property decorator has no descriptor; a method decorator does. Writing
    // to `descriptor.value` keeps the metadata off the prototype, so two
    // controllers with a `find` method cannot collide.
    const owner = (descriptor === undefined ? target : descriptor.value) as object;
    Reflect.defineMetadata(PATH_METADATA, path, owner);
    Reflect.defineMetadata(METHOD_METADATA, method, owner);
    return descriptor;
  }) as MethodDecorator & PropertyDecorator;
}

/**
 * Builds a decorator bound to one HTTP method.
 *
 * The reason this is a factory rather than thirty hand-written decorators is
 * that a hand-written one drifts: the previous `createMappingDecorator` had a
 * subtly different `path` default than `RequestMapping` did, so `@Get()` and
 * `@Get(undefined)` registered different paths.
 */
function routeDecorator(method: RequestMethod): (path?: string | string[]) => MethodDecorator & PropertyDecorator {
  return (path?: string | string[]) => RequestMapping({ [PATH_METADATA]: path, [METHOD_METADATA]: method });
}

/** `''` and `undefined` both mean "the controller prefix, unchanged". */
function normalizePath(path: string | string[] | undefined): string | string[] {
  if (Array.isArray(path)) {
    const cleaned = path.map((entry) => (entry ? entry : '/'));
    return cleaned.length > 0 ? cleaned : '/';
  }
  return path ? path : '/';
}

/** Routes `GET` requests. @publicApi */
export const Get = routeDecorator(RequestMethod.GET);

/** Routes `POST` requests. @publicApi */
export const Post = routeDecorator(RequestMethod.POST);

/** Routes `PUT` requests. @publicApi */
export const Put = routeDecorator(RequestMethod.PUT);

/** Routes `PATCH` requests. @publicApi */
export const Patch = routeDecorator(RequestMethod.PATCH);

/** Routes `DELETE` requests. @publicApi */
export const Delete = routeDecorator(RequestMethod.DELETE);

/** Routes `HEAD` requests. @publicApi */
export const Head = routeDecorator(RequestMethod.HEAD);

/** Routes `OPTIONS` requests — useful for a per-route preflight. @publicApi */
export const Options = routeDecorator(RequestMethod.OPTIONS);

/** Routes requests of every method. @publicApi */
export const All = routeDecorator(RequestMethod.ALL);

/** Routes `TRACE` requests. @publicApi */
export const Trace = routeDecorator(RequestMethod.TRACE);

/** Routes `CONNECT` requests. @publicApi */
export const Connect = routeDecorator(RequestMethod.CONNECT);

/** Routes `PURGE` requests, for a CDN. @publicApi */
export const Purge = routeDecorator(RequestMethod.PURGE);

/** Routes `SEARCH` requests (RFC 5323). @publicApi */
export const Search = routeDecorator(RequestMethod.SEARCH);

/** Routes `PROPFIND` requests (WebDAV). @publicApi */
export const Propfind = routeDecorator(RequestMethod.PROPFIND);

/** Routes `PROPPATCH` requests (WebDAV). @publicApi */
export const Proppatch = routeDecorator(RequestMethod.PROPPATCH);

/** Routes `MKCOL` requests (WebDAV). @publicApi */
export const Mkcol = routeDecorator(RequestMethod.MKCOL);

/** Routes `COPY` requests (WebDAV). @publicApi */
export const Copy = routeDecorator(RequestMethod.COPY);

/** Routes `MOVE` requests (WebDAV). @publicApi */
export const Move = routeDecorator(RequestMethod.MOVE);

/** Routes `LOCK` requests (WebDAV). @publicApi */
export const Lock = routeDecorator(RequestMethod.LOCK);

/** Routes `UNLOCK` requests (WebDAV). @publicApi */
export const Unlock = routeDecorator(RequestMethod.UNLOCK);

/** Routes `ACL` requests (WebDAV access control). @publicApi */
export const Acl = routeDecorator(RequestMethod.ACL);

/** Routes `REPORT` requests (WebDAV versioning). @publicApi */
export const Report = routeDecorator(RequestMethod.REPORT);
