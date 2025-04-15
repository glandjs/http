export interface CookieOptions {
  maxAge?: number
  name?: string
  secret?: string
  path?: string
  domain?: string
  sameSite?: 'strict' | 'lax' | 'none' | boolean
  secure?: boolean
  secureProxy?: boolean
  httpOnly?: boolean
  signed?: boolean
  overwrite?: boolean
  expires?: Date
}
