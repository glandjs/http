import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';
import {
  ContentType,
  HttpReply,
  SseStream,
  applyPrefix,
  baseContentType,
  isJsonContentType,
  isTextContentType,
  joinPath,
  looksLikeHtml,
  normalizePath,
  paramNames,
  parseCookieHeader,
  serializeCookie,
  splitUrl,
  toNamedWildcard,
  toReplyPayload,
} from '@glandjs/http';

describe('normalizePath', () => {
  it('guarantees one leading slash and no trailing slash', () => {
    assert.equal(normalizePath(), '/');
    assert.equal(normalizePath(''), '/');
    assert.equal(normalizePath('products'), '/products');
    assert.equal(normalizePath('/products'), '/products');
    assert.equal(normalizePath('/products/'), '/products');
    assert.equal(normalizePath('//products//'), '/products');
    assert.equal(normalizePath('api//v1//'), '/api/v1');
  });

  it('normalises identically with or without a leading slash', () => {
    // The previous version collapsed `//` only on the absolute branch, so
    // `api//v1` and `/api//v1` produced two different route tables.
    assert.equal(normalizePath('api//v1'), normalizePath('/api//v1'));
  });
});

describe('joinPath', () => {
  it('treats / as "nothing to add" on either side', () => {
    assert.equal(joinPath('/products', ':id'), '/products/:id');
    assert.equal(joinPath('products', '/'), '/products');
    assert.equal(joinPath('', '/'), '/');
    assert.equal(joinPath('/api', '/v1'), '/api/v1');
  });
});

describe('applyPrefix', () => {
  it('prefixes a path', () => {
    assert.equal(applyPrefix('/products', '/api'), '/api/products');
  });

  it('is idempotent', () => {
    // The prefix reaches a route twice in the normal path — once from
    // `HttpApplicationOptions.prefix` and once from `setGlobalPrefix()`.
    assert.equal(applyPrefix('/api/products', '/api'), '/api/products');
  });

  it('does not match a partial segment', () => {
    assert.equal(applyPrefix('/apixyz', '/api'), '/api/apixyz');
  });

  it('is a no-op without a prefix', () => {
    assert.equal(applyPrefix('/products', undefined), '/products');
    assert.equal(applyPrefix('/products', '/'), '/products');
  });
});

describe('paramNames', () => {
  it('lists the parameters of a pattern', () => {
    assert.deepEqual(paramNames('/products/:id/reviews/:reviewId'), ['id', 'reviewId']);
  });

  it('ignores a literal path', () => {
    assert.deepEqual(paramNames('/health'), []);
  });
});

describe('splitUrl', () => {
  it('separates the path from the query', () => {
    assert.deepEqual(splitUrl('/products/1?q=a'), { path: '/products/1', search: '?q=a' });
  });

  it('handles a path with no query', () => {
    assert.deepEqual(splitUrl('/'), { path: '/', search: '' });
  });

  it('drops a fragment', () => {
    assert.deepEqual(splitUrl('/a#top'), { path: '/a', search: '' });
  });
});

describe('toNamedWildcard', () => {
  it('names a bare star for routers that require one', () => {
    assert.equal(toNamedWildcard('/files/*', 'splat'), '/files/*splat');
  });

  it('leaves a named star alone', () => {
    assert.equal(toNamedWildcard('/files/*rest', 'splat'), '/files/*rest');
  });
});

describe('toReplyPayload', () => {
  it('takes an HttpReply as-is', () => {
    const reply = HttpReply.json({ a: 1 }, { status: 201 });
    assert.equal(toReplyPayload(reply), reply);
  });

  it('treats undefined and null as "the handler answered"', () => {
    // A handler that already called `ctx.json()` returns nothing, and that is
    // not the same as returning an empty body.
    assert.equal(toReplyPayload(undefined).kind, 'empty');
    assert.equal(toReplyPayload(null).kind, 'empty');
  });

  it('recognises a readable as a stream', () => {
    const payload = toReplyPayload(Readable.from(['a']));
    assert.equal(payload.kind, 'stream');
  });

  it('recognises a buffer as bytes', () => {
    assert.equal(toReplyPayload(Buffer.from('hi')).kind, 'buffer');
    assert.equal(toReplyPayload(new Uint8Array([1])).kind, 'buffer');
  });

  it('treats a string as text and an object as JSON', () => {
    assert.equal(toReplyPayload('ok').kind, 'text');
    assert.equal(toReplyPayload({ ok: true }).kind, 'json');
    assert.equal(toReplyPayload([1, 2]).kind, 'json');
  });

  it('treats a number and a boolean as JSON, not as a bare value', () => {
    // The alternative is a digit or "true" with no type information at all.
    assert.equal(toReplyPayload(42).kind, 'json');
    assert.equal(toReplyPayload(true).kind, 'json');
  });
});

describe('looksLikeHtml', () => {
  it('recognises markup', () => {
    assert.equal(looksLikeHtml('<h1>Hi</h1>'), true);
    assert.equal(looksLikeHtml('  <!DOCTYPE html><html>'), true);
    assert.equal(looksLikeHtml('<div class="x">'), true);
  });

  it('does not mistake prose or an expression for markup', () => {
    // A loose test turns `a < b` into an HTML page, and an API error message
    // into a download prompt.
    assert.equal(looksLikeHtml('a < b'), false);
    assert.equal(looksLikeHtml('Cannot GET /api/x'), false);
    assert.equal(looksLikeHtml(''), false);
  });
});

describe('content-type helpers', () => {
  it('strips parameters', () => {
    assert.equal(baseContentType('text/plain; charset=utf-8'), 'text/plain');
    assert.equal(baseContentType('APPLICATION/JSON'), 'application/json');
    assert.equal(baseContentType(undefined), undefined);
  });

  it('recognises the +json structured suffix', () => {
    assert.equal(isJsonContentType('application/json'), true);
    assert.equal(isJsonContentType('application/problem+json'), true);
    assert.equal(isJsonContentType('application/vnd.api+json'), true);
    assert.equal(isJsonContentType('text/html'), false);
  });

  it('separates text from json', () => {
    assert.equal(isTextContentType('text/plain; charset=utf-8'), true);
    assert.equal(isTextContentType('application/json'), false);
  });

  it('publishes the values the adapters write', () => {
    assert.equal(ContentType.json, 'application/json; charset=utf-8');
    assert.equal(ContentType.eventStream, 'text/event-stream; charset=utf-8');
  });
});

describe('parseCookieHeader', () => {
  it('parses a pair of cookies', () => {
    assert.deepEqual(parseCookieHeader('a=1; b=2'), {
      a: { value: '1', signed: false },
      b: { value: '2', signed: false },
    });
  });

  it('percent-decodes and unquotes', () => {
    // Both are what `res.cookie` writes, so both have to round-trip.
    assert.equal(parseCookieHeader('greeting=hello%20world').greeting?.value, 'hello world');
    assert.equal(parseCookieHeader('greeting="hello world"').greeting?.value, 'hello world');
  });

  it('returns an empty bag for an absent header', () => {
    assert.deepEqual(parseCookieHeader(undefined), {});
    assert.deepEqual(parseCookieHeader(''), {});
  });

  it('skips a malformed pair rather than producing an empty name', () => {
    const bag = parseCookieHeader('nonsense; =2; good=3');
    assert.deepEqual(Object.keys(bag), ['good']);
  });
});

describe('serializeCookie', () => {
  it('converts maxAge from milliseconds to seconds', () => {
    // The units differ between Gland and every framework that serialises this,
    // and forwarding the number unchanged produces a cookie that expires in
    // under a millisecond — which looks like "the cookie does not work".
    assert.match(serializeCookie('a', 'b', { maxAge: 60_000 }), /Max-Age=60/);
  });

  it('emits the security attributes', () => {
    const header = serializeCookie('session', 'abc', { httpOnly: true, secure: true, sameSite: 'strict', path: '/api' });
    assert.match(header, /HttpOnly/);
    assert.match(header, /Secure/);
    assert.match(header, /SameSite=Strict/);
    assert.match(header, /Path=\/api/);
  });

  it('percent-encodes the name and value', () => {
    assert.equal(serializeCookie('a b', 'c d'), 'a%20b=c%20d; Path=/');
  });
});

describe('SseStream', () => {
  it('serialises an event to the wire format', () => {
    const sse = new SseStream();
    assert.equal(sse.serialize({ event: 'tick', data: { n: 1 } }), 'event: tick\ndata: {"n":1}\n\n');
  });

  it('splits a multi-line payload across data: lines', () => {
    // A bare newline would be parsed as a field name and dropped by the client.
    const sse = new SseStream();
    assert.equal(sse.serialize({ data: 'a\nb' }), 'data: a\ndata: b\n\n');
  });

  it('writes an id and a retry', () => {
    const sse = new SseStream();
    assert.equal(sse.serialize({ id: '7', retry: 5000, data: 'x' }), 'id: 7\nretry: 5000\ndata: x\n\n');
  });

  it('remembers the last id, for a Last-Event-ID resume', () => {
    const sse = new SseStream();
    sse.send({ id: '7', data: 'x' });
    assert.equal(sse.lastEventId, '7');
  });

  it('publishes the headers an event stream needs', () => {
    const sse = new SseStream();
    assert.equal(sse.headers['Content-Type'], ContentType.eventStream);
    // Nginx buffers proxied responses by default, which defeats the point.
    assert.equal(sse.headers['X-Accel-Buffering'], 'no');
  });

  it('is safe to close twice', () => {
    const sse = new SseStream();
    sse.close();
    sse.close();
    assert.equal(sse.isClosed, true);
  });

  it('is a readable, so an adapter can pipe it like any other body', () => {
    assert.ok(new SseStream() instanceof Readable);
  });
});
