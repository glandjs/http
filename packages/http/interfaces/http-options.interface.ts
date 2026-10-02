/**
 * `node:https` / `node:tls` server options.
 *
 * A structural copy of `https.ServerOptions` rather than a re-export, so that
 * `@glandjs/http` does not force a `@types/node` version on its consumers. The
 * shape is stable; anything Node adds later is still accepted at the call site
 * because {@link HttpsOptions} carries an index signature.
 */
export interface HttpsOptions {
  /** PFX/PKCS12 bundle. */
  pfx?: string | Buffer | Array<string | Buffer>;

  /** Private key, PEM. */
  key?: string | Buffer | Array<string | Buffer>;

  /** Passphrase for an encrypted `key`. */
  passphrase?: string;

  /** Certificate chain, PEM. */
  cert?: string | Buffer | Array<string | Buffer>;

  /** Trusted CA, for client-certificate validation. */
  ca?: string | Buffer | Array<string | Buffer>;

  /** Certificate revocation list. */
  crl?: string | Buffer | Array<string | Buffer>;

  /** OpenSSL cipher list. */
  ciphers?: string;

  /** Honour the server's cipher preference over the client's. */
  honorCipherOrder?: boolean;

  /** Ask the client for a certificate. */
  requestCert?: boolean;

  /** Reject clients whose certificate does not verify. */
  rejectUnauthorized?: boolean;

  /** TLS session timeout, ms. */
  sessionTimeout?: number;

  /** Minimum TLS version. */
  minVersion?: string;

  /** Maximum TLS version. */
  maxVersion?: string;

  /** ALPN protocol list. */
  ALPNProtocols?: Array<string | Uint8Array>;

  /** SNI callback. */
  SNICallback?: (servername: string, cb: (err: Error | null, ctx?: unknown) => void) => void;

  /** A libuv `secureOptions` mask. */
  secureOptions?: number;

  /** Anything else Node accepts, forwarded verbatim. */
  [key: string]: unknown;
}

/** Options shared by the `http` and `https` server factories. */
export interface HttpServerOptions {
  /** Socket keep-alive timeout, ms. */
  keepAliveTimeout?: number;
  /** Headers timeout, ms. */
  headersTimeout?: number;
  /** Maximum accepted request line + headers, bytes. */
  maxHeaderSize?: number;
  /** Emit `http.Server` errors instead of crashing the process. */
  noErrorListener?: boolean;
  /** Connection backlog. */
  backlog?: number;
  [key: string]: unknown;
}
