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

export interface SendOptions {
  /**
   * Enable or disable accepting ranged requests, defaults to true.
   * Disabling this will not send Accept-Ranges and ignore the contents of the Range request header.
   */
  acceptRanges?: boolean | undefined

  /**
   * Enable or disable setting Cache-Control response header, defaults to true.
   * Disabling this will ignore the maxAge option.
   */
  cacheControl?: boolean | undefined

  /**
   * Set how "dotfiles" are treated when encountered.
   * A dotfile is a file or directory that begins with a dot (".").
   * Note this check is done on the path itself without checking if the path actually exists on the disk.
   * If root is specified, only the dotfiles above the root are checked (i.e. the root itself can be within a dotfile when when set to "deny").
   * 'allow' No special treatment for dotfiles.
   * 'deny' Send a 403 for any request for a dotfile.
   * 'ignore' Pretend like the dotfile does not exist and 404.
   * The default value is similar to 'ignore', with the exception that this default will not ignore the files within a directory that begins with a dot, for backward-compatibility.
   */
  dotfiles?: 'allow' | 'deny' | 'ignore' | undefined

  /**
   * Byte offset at which the stream ends, defaults to the length of the file minus 1.
   * The end is inclusive in the stream, meaning end: 3 will include the 4th byte in the stream.
   */
  end?: number | undefined

  /**
   * Enable or disable etag generation, defaults to true.
   */
  etag?: boolean | undefined

  /**
   * If a given file doesn't exist, try appending one of the given extensions, in the given order.
   * By default, this is disabled (set to false).
   * An example value that will serve extension-less HTML files: ['html', 'htm'].
   * This is skipped if the requested file already has an extension.
   */
  extensions?: string[] | string | boolean | undefined

  /**
   * Enable or disable the immutable directive in the Cache-Control response header, defaults to false.
   * If set to true, the maxAge option should also be specified to enable caching.
   * The immutable directive will prevent supported clients from making conditional requests during the life of the maxAge option to check if the file has changed.
   * @default false
   */
  immutable?: boolean | undefined

  /**
   * By default send supports "index.html" files, to disable this set false or to supply a new index pass a string or an array in preferred order.
   */
  index?: string[] | string | boolean | undefined

  /**
   * Enable or disable Last-Modified header, defaults to true.
   * Uses the file system's last modified value.
   */
  lastModified?: boolean | undefined

  /**
   * Provide a max-age in milliseconds for http caching, defaults to 0.
   * This can also be a string accepted by the ms module.
   */
  maxAge?: string | number | undefined

  /**
   * Serve files relative to path.
   */
  root?: string | undefined

  /**
   * Byte offset at which the stream starts, defaults to 0.
   * The start is inclusive, meaning start: 2 will include the 3rd byte in the stream.
   */
  start?: number | undefined
}
