import { Readable } from 'node:stream';
import { ContentType } from '../constants/content-type.const';

/** One field of an SSE message. */
export interface SseEvent {
  /** `event:` — the event name a client listens for. Defaults to `message`. */
  id?: string;
  /** `event:` — the event name. */
  event?: string;
  /** `retry:` — reconnection delay in ms, telling the browser how long to wait. */
  retry?: number;
  /** `data:` — the payload. A multi-line string is split across `data:` lines. */
  data?: unknown;
  /** `:` — a comment. Used as a keep-alive heartbeat. */
  comment?: string;
}

/** Options for {@link SseStream}. */
export interface SseStreamOptions {
  /**
   * Reconnection delay advertised to the client, in ms.
   *
   * @default 3000
   */
  retry?: number;
  /**
   * Emit a comment every `heartbeat` ms to keep intermediaries from idling the
   * connection out.
   *
   * Load balancers routinely close a connection that carries no bytes for
   * 30–60 s. Set `0` to disable.
   *
   * @default 15000
   */
  heartbeat?: number;
  /** `Last-Event-ID` the client reconnects with, replayed by {@link SseStream.resumeFrom}. */
  lastEventId?: string;
}

/**
 * A server-sent-events stream.
 *
 * Returned by `ctx.sse()` and a `Readable` underneath, so every adapter can
 * treat it as a stream and pipe it to its socket without a special case beyond
 * the `Content-Type` header.
 *
 * The class buffers rather than writes directly. That is the whole design: a
 * controller can build the stream, hand it to application code, and let the
 * adapter decide when and how the bytes leave. It also means a stream created
 * before the response is ready does not lose events.
 *
 * Backpressure is honoured — `push()` returning `false` pauses the writes, and
 * the stream resumes on `drain`. Without that, a fast producer will buffer the
 * entire event history in memory on a slow client.
 *
 * @example
 * ```ts
 * @Get('/events')
 * async stream(ctx: HttpContext) {
 *   const sse = ctx.sse();
 *   sse.send({ hello: 'world' });
 *
 *   const timer = setInterval(() => sse.send({ tick: Date.now() }), 1000);
 *   ctx.events.once('http:request:end', () => clearInterval(timer));
 *
 *   return sse;
 * }
 * ```
 */
export class SseStream extends Readable {
  /** Lets {@link file:./reply.util.ts} recognise a stream without a class check. */
  public readonly kind = 'sse' as const;

  private readonly options: Required<Pick<SseStreamOptions, 'retry' | 'heartbeat'>> & SseStreamOptions;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  /** Whether {@link SseStream.close} has run. Named `disposed` because `Readable.closed` is taken. */
  private disposed = false;

  /** The id of the most recently written event, for `Last-Event-ID` resumes. */
  public lastEventId?: string;

  constructor(options: SseStreamOptions = {}) {
    super({ objectMode: false });
    this.options = { retry: 3000, heartbeat: 15000, ...options };
    this.lastEventId = options.lastEventId;
  }

  /** The headers an adapter should set before piping this stream. */
  public get headers(): Record<string, string> {
    return {
      'Content-Type': ContentType.eventStream,
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx buffers proxied responses by default, which defeats the whole
      // point. The header is a no-op everywhere else.
      'X-Accel-Buffering': 'no',
    };
  }

  /**
   * Writes one event.
   *
   * @param event - the payload, or a full {@link SseEvent} for an `event:`/`id:`
   * @returns `this`, so calls chain
   */
  public send(event: SseEvent | unknown): this {
    this.writeEvent(typeof event === 'object' && event !== null && hasSseFields(event) ? (event as SseEvent) : { data: event });
    return this;
  }

  /** Writes an event under a specific name, for `addEventListener(name, …)`. */
  public event(name: string, data: unknown): this {
    return this.send({ event: name, data });
  }

  /** Writes a bare `:` comment — the cheapest possible keep-alive. */
  public comment(text = ''): this {
    this.writeEvent({ comment: text });
    return this;
  }

  /** Overrides the client's reconnection delay mid-stream. */
  public retry(ms: number): this {
    this.writeEvent({ retry: ms });
    return this;
  }

  /**
   * Starts the heartbeat.
   *
   * Called automatically unless `heartbeat` is `0`. Exposed so an adapter that
   * has to defer — say, until the socket is writable — can start it later.
   */
  public startHeartbeat(intervalMs = this.options.heartbeat): this {
    if (this.heartbeatTimer || intervalMs <= 0) return this;
    this.heartbeatTimer = setInterval(() => this.comment('heartbeat'), intervalMs);
    // A pending heartbeat must not hold the process open on its own.
    this.heartbeatTimer.unref?.();
    return this;
  }

  /** Stops the heartbeat. Called by {@link SseStream.close}. */
  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Ends the stream and pushes an empty chunk.
   *
   * Safe to call twice, and safe to call from a `finally` block — which is the
   * point, since the usual source of a leaked SSE connection is a handler that
   * threw and never closed.
   */
  public close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();
    if (!this.destroyed) this.push(null);
  }
  /** Whether {@link SseStream.close} has been called. */
  public get isClosed(): boolean {
    return this.disposed;
  }

  /** Serialises one event to the wire format. */
  public serialize(event: SseEvent): string {
    const lines: string[] = [];

    if (event.comment !== undefined) {
      for (const line of String(event.comment).split(/\r?\n/)) lines.push(`: ${line}`);
    }
    if (event.id !== undefined) lines.push(`id: ${event.id}`);
    if (event.event !== undefined) lines.push(`event: ${event.event}`);
    if (event.retry !== undefined) lines.push(`retry: ${event.retry}`);

    if (event.data !== undefined) {
      // A data payload containing newlines must be split, or the second line
      // would be parsed as a bare field name and dropped by the client.
      const text = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
      for (const line of String(text).split(/\r?\n/)) lines.push(`data: ${line}`);
    }

    return `${lines.join('\n')}\n\n`;
  }

  /** @internal Called by `Readable` to produce the next chunk. */
  public override _read(): void {
    this.startHeartbeat();
  }

  /** @internal Called by `Readable` when the consumer goes away. */
  public override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.stopHeartbeat();
    callback(error);
  }

  private writeEvent(event: SseEvent): void {
    if (this.disposed || this.destroyed) return;
    if (event.id !== undefined) this.lastEventId = event.id;
    this.push(this.serialize(event));
  }
}

/** Whether a value is an {@link SseEvent} rather than a bare payload. */
function hasSseFields(value: object): value is SseEvent {
  return 'data' in value || 'event' in value || 'id' in value || 'retry' in value || 'comment' in value;
}
