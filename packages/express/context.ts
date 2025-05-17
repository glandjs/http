import {
  HttpContext,
  type AcceptType,
  type CookieOptions,
  type ErrorCallback,
  type HttpEventCore,
  type HttpHeaderName,
  type HttpHeaderValue,
  type RequestMethod,
  type SendOptions,
} from '@glandjs/http'
import type { Dictionary, HttpStatus, Maybe } from '@medishn/toolkit'
import type { Request, Response } from 'express'
import { EventRecord } from '@glandjs/events'

export class ExpressContext<TEvents extends EventRecord> extends HttpContext<
  Request,
  Response,
  TEvents
> {
  constructor(events: HttpEventCore<TEvents>, req: Request, res: Response) {
    super(events, req, res)

    this.params = req.params
    this.host = req.host
  }
  public get body(): any {
    return this.req.body
  }
  public get path(): string {
    return this.req.path
  }

  public get xhr(): boolean {
    return this.req.xhr
  }

  public get stale(): boolean {
    return !this.fresh
  }

  public get fresh(): boolean {
    return this.req.fresh
  }

  public get method(): RequestMethod {
    return this.req.method as unknown as RequestMethod
  }

  public get hostname(): string {
    return this.req.hostname
  }

  public get ip(): string | undefined {
    return this.req.ip
  }

  public get protocol(): string {
    return this.req.protocol
  }

  public get secure(): boolean {
    return this.req.secure
  }

  public get url(): string {
    return this.req.url
  }

  public get originalUrl(): string {
    return this.req.originalUrl
  }

  public get query(): Dictionary<string | string[] | undefined> {
    return this.req.query as Dictionary<string | string[] | undefined>
  }

  public get subdomains(): string[] {
    return this.req.subdomains
  }

  public get accepts(): (types?: AcceptType) => string | false {
    return (types?: AcceptType) => {
      if (!types) {
        const result = this.req.accepts() || false
        if (Array.isArray(result)) {
          return result[0] || false
        }
        return result
      }

      if (Array.isArray(types)) {
        const result = this.req.accepts(types)
        if (Array.isArray(result)) {
          return result[0] || false
        }
        return typeof result === 'string' ? result : false
      }

      const result = this.req.accepts(types)
      if (Array.isArray(result)) {
        return result[0] || false
      }
      return typeof result === 'string' ? result : false
    }
  }

  public get is(): (type: string | string[]) => string | false | null {
    return (type: string | string[]) => {
      return this.req.is(type)
    }
  }

  public status(code: HttpStatus): this {
    this.res.status(code)
    return this
  }

  public redirect(url: string): this {
    this.res.redirect(url)
    return this
  }

  // Cookie Operations
  public setCookie(name: string, value: string, options?: CookieOptions): this {
    this.res.cookie(name, value, {
      domain: options?.domain,
      httpOnly: options?.httpOnly,
      expires: options?.expires,
      maxAge: options?.maxAge,
      path: options?.path,
      sameSite: options?.sameSite,
      secure: options?.secure,
      signed: options?.signed,
    })
    return this
  }

  public clearCookie(name: string, options?: Partial<CookieOptions>): this {
    this.res.clearCookie(name, options)
    return this
  }

  public getCookie(name: string): Maybe<string> {
    return this.req.cookies?.[name]
  }

  public deleteCookie(name: string, options?: Partial<CookieOptions>): void {
    this.res.clearCookie(name, options)
  }
  public get cookies(): Dictionary<string> {
    return this.req.cookies || {}
  }

  get signedCookies(): Dictionary<string> {
    return this.req.signedCookies || {}
  }

  // Send Operations
  public send(
    data: any,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this {
    if (statusCode) {
      this.res.status(statusCode)
    }

    if (headers) {
      this.setHeaders(headers)
    }

    this.res.send(data)
    return this
  }
  public json(
    data: any,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this {
    if (statusCode) {
      this.res.status(statusCode)
    }

    if (headers) {
      this.setHeaders(headers)
    }

    this.res.json(data)
    return this
  }
  public html(
    html: string,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this {
    if (statusCode) {
      this.res.status(statusCode)
    }

    if (headers) {
      this.setHeaders(headers)
    }

    this.res.setHeader('Content-Type', 'text/html')
    this.res.send(html)
    return this
  }
  public text(
    text: string,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this {
    if (statusCode) {
      this.res.status(statusCode)
    }

    if (headers) {
      this.setHeaders(headers)
    }

    this.res.setHeader('Content-Type', 'text/plain')
    this.res.send(text)
    return this
  }
  public xml(
    xml: string,
    statusCode?: number,
    headers?: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this {
    if (statusCode) {
      this.res.status(statusCode)
    }

    if (headers) {
      this.setHeaders(headers)
    }

    this.res.setHeader('Content-Type', 'application/xml')
    this.res.send(xml)
    return this
  }

  public format(formatters: Dictionary<() => void>): this {
    this.res.format(formatters as any)
    return this
  }
  public sendFile(
    filePath: string,
    options: SendOptions = {},
    fn?: ErrorCallback
  ): this {
    const opts: SendOptions & { headers?: Record<string, string> } = {
      ...options,
    }
    this.res.sendFile(filePath, opts, (err) => {
      if (err && fn) {
        fn(err)
      }
    })

    return this
  }

  public jsonp(data: any): this {
    this.res.jsonp(data)
    return this
  }
  public sse(): this {
    return this
  }

  public download(
    filePath: string,
    filename: string,
    options?: SendOptions
  ): this {
    this.res.download(filePath, filename, options as any)
    return this
  }

  public render(
    view: string,
    options?: Dictionary<any>,
    callback?: (err: Error, html: string) => void
  ): this {
    if (callback) {
      this.res.render(view, options, callback)
    } else {
      this.res.render(view, options)
    }
    return this
  }
  public end(): this {
    this.res.end()
    return this
  }

  public hasHeader(name: HttpHeaderName): boolean {
    return this.res.hasHeader(name as string)
  }

  public getHeader<T extends string, THeaders extends string>(
    name: HttpHeaderName<T>
  ): HttpHeaderValue<T, THeaders> | undefined
  public getHeader(name: string): string | string[] | undefined
  public getHeader(name: HttpHeaderName): string | string[] | undefined
  public getHeader<T extends string, THeaders extends string>(
    name: unknown
  ): string | string[] | HttpHeaderValue<T, THeaders> | undefined {
    return this.res.getHeader(name as string) as any
  }

  public setHeader<T extends string, XHeaders extends string>(
    name: HttpHeaderName<T>,
    value: HttpHeaderValue<T, XHeaders>
  ): this {
    this.res.setHeader(name as string, value as any)
    return this
  }

  public setHeaders(
    headers: Dictionary<HttpHeaderName | HttpHeaderName[]>
  ): this {
    Object.entries(headers).forEach(([key, value]) => {
      this.res.setHeader(key, value as any)
    })
    return this
  }

  public removeHeader<T extends string>(name: HttpHeaderName<T, string>): this {
    this.res.removeHeader(name as string)
    return this
  }

  public get headers(): Dictionary<string | string[]> {
    return this.req.headers as Dictionary<string | string[]>
  }
  public vary(fields: string): this {
    this.res.vary(fields)
    return this
  }

  public attachment(filename?: string): this {
    this.res.attachment(filename)
    return this
  }

  public location(url: string): this {
    this.res.location(url)
    return this
  }
}
