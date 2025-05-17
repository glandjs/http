import { EventType, EventRecord, EventBroker } from '@glandjs/events'
export class HttpEventCore<
  TEvents extends EventRecord,
> extends EventBroker<TEvents> {
  constructor(name: string) {
    super({ name })
  }

  safeEmit<K extends keyof TEvents & EventType>(
    event: K,
    payload: TEvents[K]
  ): boolean {
    this.emit(event, payload, { watch: true })

    const listeners = this.getListener(event)

    if (listeners.length === 0) {
      this.off(event, () => {})
      return false
    }
    return true
  }
}
