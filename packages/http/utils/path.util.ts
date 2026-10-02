/**
 * Path handling shared by every adapter.
 *
 * Route paths arrive from three places — `@Controller('products')`,
 * `@Get(':id')`, and `app.get('/products/:id', …)` — and each arrives in a
 * different shape. Normalising them in one place is what stops `/products` and
 * `products/` from becoming two routes, and what makes a global prefix compose
 * predictably.
 *
 * The functions are deliberately minimal. They do not compile patterns to
 * regular expressions: matching is the framework router's job, and duplicating
 * it here would mean two routers disagreeing about which one is authoritative.
 */

/**
 * Guarantees a single leading slash, collapses repeated slashes, and drops the
 * trailing one.
 *
 * Express, Fastify, Koa and `node:http` all normalise internally but not
 * identically — `api//v1` and `/api//v1` used to produce different route tables
 * depending on the adapter. Normalising before registration removes the class
 * of bug.
 *
 * @param path - the raw path
 * @returns the normalised path; `'/'` for empty input
 *
 * @example
 * ```ts
 * normalizePath()             // '/'
 * normalizePath('products')   // '/products'
 * normalizePath('/products/') // '/products'
 * normalizePath('api//v1//')  // '/api/v1'
 * ```
 */
export function normalizePath(path?: string | null): string {
  if (!path) return '/';
  const collapsed = `/${path}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return collapsed || '/';
}

/**
 * Joins a base path with a child path.
 *
 * Unlike a plain `join`, `/` is treated as "nothing to add" rather than "the
 * root", so a controller with no prefix does not swallow a handler's path and a
 * handler with no path does not strip the controller's.
 *
 * @param base - the outer path, e.g. a controller prefix or global prefix
 * @param child - the inner path, e.g. a handler path
 * @returns the combined, normalised path
 *
 * @example
 * ```ts
 * joinPath('/products', ':id')  // '/products/:id'
 * joinPath('products', '/')     // '/products'
 * joinPath('/api', '/v1')       // '/api/v1'
 * joinPath('', '')              // '/'
 * ```
 */
export function joinPath(base?: string | null, child?: string | null): string {
  const head = normalizePath(base);
  const tail = normalizePath(child);
  if (head === '/') return tail;
  if (tail === '/') return head;
  return `${head}${tail}`;
}

/**
 * Prefixes a path, unless it already carries the prefix.
 *
 * Idempotence matters because the same prefix is applied twice in the normal
 * path: once from `HttpApplicationOptions.prefix` and once from
 * `setGlobalPrefix()`. Re-applying it would produce `/api/api/v1`.
 *
 * @param path - the route path
 * @param prefix - the global prefix, if any
 *
 * @example
 * ```ts
 * applyPrefix('/products', '/api')  // '/api/products'
 * applyPrefix('/api/products', '/api') // '/api/products'
 * applyPrefix('/products', undefined)  // '/products'
 * ```
 */
export function applyPrefix(path: string, prefix?: string | null): string {
  if (!prefix || prefix === '/') return normalizePath(path);
  const normalizedPrefix = normalizePath(prefix);
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)) {
    return normalizedPath;
  }
  return joinPath(normalizedPrefix, normalizedPath);
}

/**
 * The parameter names declared in a route pattern.
 *
 * Used to type `ctx.params` and, for adapters whose router does not populate
 * params on its own, to extract them.
 *
 * @example
 * ```ts
 * paramNames('/products/:id/reviews/:reviewId')
 * // ['id', 'reviewId']
 * ```
 */
export function paramNames(path: string): string[] {
  const names: string[] = [];
  const pattern = /:([A-Za-z0-9_]+)|\*([A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(path)) !== null) {
    names.push(match[1] ?? match[2] ?? '');
  }
  return names.filter(Boolean);
}

/**
 * Splits a raw URL into its path and query string.
 *
 * `req.url` is what a client sent, verbatim. Splitting it here rather than in
 * each adapter keeps `ctx.path` and `ctx.url` meaning the same thing everywhere.
 *
 * @param url - a raw request URL, e.g. `'/products/1?q=a#frag'`
 *
 * @example
 * ```ts
 * splitUrl('/products/1?q=a')  // { path: '/products/1', search: '?q=a' }
 * splitUrl('/')                // { path: '/', search: '' }
 * ```
 */
export function splitUrl(url: string): { path: string; search: string } {
  const withoutFragment = url.split('#', 1)[0] ?? '';
  const index = withoutFragment.indexOf('?');
  if (index === -1) return { path: withoutFragment || '/', search: '' };
  return { path: withoutFragment.slice(0, index) || '/', search: withoutFragment.slice(index) };
}

/**
 * Rewrites a pattern for a router that spells wildcards differently.
 *
 * Express and `node:http` treat `*` as "the rest of the path". Fastify 5 and
 * Hono require a *named* wildcard, or they treat the star as a literal
 * character. Translating here means a controller can declare `/files/*` once.
 *
 * @param path - the Gland route pattern
 * @param splatName - the name to give a bare `*`, per router dialect
 *
 * @example
 * ```ts
 * toNamedWildcard('/files/*', 'splat')    // '/files/{splat}'
 * toNamedWildcard('/files/*', '_')        // '/files/*' (Express 4 style)
 * ```
 */
export function toNamedWildcard(path: string, splatName: string): string {
  return path.replace(/\*([A-Za-z0-9_]*)/g, (_match, name: string) => (name ? `*${name}` : `*${splatName}`));
}
