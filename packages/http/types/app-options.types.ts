import type { HttpContext } from '../context'

export type ServerListening = {
  host?: string
  message?: string
}
export type ServerCrashedEvent = {
  message: string
  error: Error
  stack: string
  timestamp: string
}

export type ServerListenerCallback = (error: ServerCrashedEvent) => void
export type ApplicationEventMap<TRequest, TResponse> = {
  crashed: ServerListenerCallback
  'router:miss': (ctx: HttpContext<TRequest, TResponse>) => Promise<void> | void
  'request:failed': (
    error: any,
    ctx: HttpContext<TRequest, TResponse>
  ) => Promise<void> | void
}
