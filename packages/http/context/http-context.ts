import { Context } from '@glandjs/core'
import { HttpEventCore } from '../adapter/http-events'

import type { Broker } from '@glandjs/events'
import {
  HttpException,
  HttpExceptionOptions,
  HttpStatus,
  type Dictionary,
  type Maybe,
} from '@medishn/toolkit'
import type {
  ContentType,
  CookieOptions,
  ErrorCallback,
  HttpHeaderName,
  HttpHeaderValue,
} from '../interface'
import type { RequestMethod } from '../enum'
export type AcceptType = ContentType | string[]

/**
 * HTTP-specific context providing access to request/response objects and utility methods.
 * This abstract class defines a common interface for HTTP operations regardless of the underlying framework.
 *
 * @example
 * ctx.send('Hello World');
 * ctx.json({ message: 'Success' });
 * ctx.status(201).json({ id: 123 });
 */
export abstract class HttpContext<TRequest, TResponse> extends Context {
  public params: Dictionary<string | number | undefined> = {}
  public host?: Maybe<string>
  public body?: any
  constructor(
    protected readonly events: HttpEventCore,
    public readonly req: TRequest,
    public readonly res: TResponse
  ) {
    const broker = events['_channel']['broker'] as Broker
    super(broker)
  }
  // Request information getters
  public abstract get path(): string
  public abstract get xhr(): boolean
  public abstract get stale(): boolean
  public abstract get fresh(): boolean
  public abstract get method(): RequestMethod
  public abstract get hostname(): string
  public abstract get ip(): string | undefined
  public abstract get protocol(): string
  public abstract get secure(): boolean
  public abstract get url(): string
  public abstract get originalUrl(): string
  public abstract get query(): Dictionary<string | string[] | undefined>
  public abstract get subdomains(): string[]
  public abstract get accepts(): (types?: AcceptType) => string | false
  public abstract get is(): (type: string | string[]) => string | false | null
  public abstract status(code: HttpStatus): this
  public abstract redirect(url: string): this

  /**
   * Cookie Operations
   */
  public abstract setCookie(
    name: string,
    value: string,
    options?: CookieOptions
  ): this
  public abstract clearCookie(
    name: string,
    options?: Partial<CookieOptions>
  ): this
  public abstract getCookie(name: string): Maybe<string>
  public abstract deleteCookie(
    name: string,
    options?: Partial<CookieOptions>
  ): void
  public abstract get cookies(): Dictionary<string>
  public abstract get signedCookies(): Dictionary<string>

  /**
   * Send Operations
   */
  public abstract send(
    data: any,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this
  public abstract json(
    data: any,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this
  public abstract html(
    html: string,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this
  public abstract text(
    text: string,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this
  public abstract xml(
    xml: string,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this
  public abstract format(formatters: Dictionary<() => void>): this

  public throw(status: HttpStatus, options?: HttpExceptionOptions): this {
    const exception = new HttpException(status, options)

    this.status(exception.status)

    if (!this.getHeader('content-type')) {
      this.setHeader('content-type', 'application/json')
    }
    return this.send(exception.getProblemDetails())
  }

  public abstract sendFile(
    filePath: string,
    options?: SendOptions,
    fn?: ErrorCallback
  ): this

  public abstract jsonp(data: any): this
  public abstract sse(): this
  public abstract download(
    filePath: string,
    filename: string,
    options?: SendOptions
  ): this
  public abstract render(
    view: string,
    options?: Dictionary<any>,
    callback?: (err: Error, html: string) => void
  ): this

  public abstract end(): this

  /**
   * Header Operations
   */
  public abstract hasHeader(name: HttpHeaderName): boolean
  public abstract getHeader<T extends string, THeaders extends string>(
    name: HttpHeaderName<T>
  ): HttpHeaderValue<T, THeaders> | undefined
  public abstract getHeader(name: string): string | string[] | undefined
  public abstract getHeader(name: HttpHeaderName): string | string[] | undefined
  public abstract setHeader<T extends string, THeaders extends string>(
    name: HttpHeaderName<T>,
    value: HttpHeaderValue<T, THeaders>
  ): this
  public abstract setHeader(name: HttpHeaderName, value: any): this
  public abstract setHeaders(
    headers: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this
  public abstract removeHeader<T extends string>(
    name: HttpHeaderName<T, string>
  ): this
  public abstract get headers(): Dictionary<string | string[]>

  /**
   * Gets all response headers
   */
  public abstract vary(fields: string): this
  public abstract attachment(filename?: string): this
  public abstract location(url: string): this
}
