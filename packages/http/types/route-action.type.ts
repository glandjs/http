import type { HttpContext } from '../context'

export type RouteAction<TRequest, TResponse> = (
  ctx: HttpContext<TRequest, TResponse>
) => any | Promise<any>
