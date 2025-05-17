import { BrokerAdapter } from "@glandjs/core";
import type { HttpCore } from "./http-core";
import type { EventRecord } from "@glandjs/events";

/**
 * HttpBroker bridges HTTP-specific logic to the core Gland event system
 */
export class HttpBroker<
  TEvents extends EventRecord,
  TApp extends HttpCore<any, any, any, any>,
  TOptions
> extends BrokerAdapter<TEvents, TApp, TOptions> {
  constructor(instance: TApp, options?: TOptions) {
    super(options);
    this.instance = instance;
    this.broker = this.instance.broker;
  }

  public initialize(): TApp {
    this.broker.on("gland:define:route", (payload) => {
      this.instance[payload.method.toLowerCase()](payload.meta.path, payload.action);
    });
    return this.instance;
  }
}
