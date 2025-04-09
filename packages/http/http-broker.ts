import { BrokerAdapter } from '@glandjs/core'
import type { RouteRegister } from '@glandjs/core/injector'
import type { HttpCore } from './http-core'

/**
 * HttpBroker bridges HTTP-specific logic to the core Gland event system
 */
export class HttpBroker<
  TApp extends HttpCore<any, any, any, any>,
  TOptions,
> extends BrokerAdapter<TApp, TOptions> {
  constructor(instance: TApp, options?: TOptions) {
    super(options)
    this.instance = instance
    this.broker = this.instance.broker
  }

  public initialize(): TApp {
    this.broker.on<[RouteRegister]>('gland:router:register', (payload) => {
      const { method, action, controller } = payload
      this.instance[method.toLowerCase()](controller.path, action)
    })
    return this.instance
  }
}
