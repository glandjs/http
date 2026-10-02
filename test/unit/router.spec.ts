import { strict as assert } from 'node:assert';
import { ALL_VERB, CORE_HTTP_VERBS, HTTP_VERBS, RequestMethod, ROUTABLE_METHODS, isCoreVerb, isHttpVerb, isRequestMethod, toVerb } from '@glandjs/http';
import { compile, matchSegments } from '@glandjs/node';

describe('RequestMethod', () => {
  it('is upper case, because that is what goes on the wire', () => {
    for (const method of Object.values(RequestMethod)) {
      assert.equal(method, method.toUpperCase(), `${method} is not upper case`);
    }
  });

  it('excludes ALL from the routable set', () => {
    assert.ok(!ROUTABLE_METHODS.includes(RequestMethod.ALL));
    assert.ok(ROUTABLE_METHODS.includes(RequestMethod.GET));
    assert.ok(ROUTABLE_METHODS.includes(RequestMethod.PROPFIND));
  });

  it('has a verb for every routable method', () => {
    for (const method of ROUTABLE_METHODS) {
      const verb = toVerb(method);
      assert.ok(isHttpVerb(verb), `${method} → "${verb}" is not a known verb`);
    }
  });

  it('narrows with isRequestMethod', () => {
    assert.equal(isRequestMethod('GET'), true);
    assert.equal(isRequestMethod('ALL'), false);
    assert.equal(isRequestMethod('BREW'), false);
    assert.equal(isRequestMethod(42), false);
  });
});

describe('toVerb', () => {
  it('lower-cases a wire method', () => {
    assert.equal(toVerb('GET'), 'get');
    assert.equal(toVerb(RequestMethod.PROPFIND), 'propfind');
  });

  it('maps ALL to the catch-all verb', () => {
    assert.equal(toVerb(RequestMethod.ALL), ALL_VERB);
  });

  it('passes an unknown method through rather than throwing', () => {
    // A WebDAV extension method is a legitimate thing to hit, and a controller
    // that declares it should reach the adapter rather than fail at boot.
    assert.equal(toVerb('BREW'), 'brew');
  });
});

describe('isCoreVerb', () => {
  it('accepts exactly the seven verbs every adapter registers natively', () => {
    for (const verb of CORE_HTTP_VERBS) assert.equal(isCoreVerb(verb), true);
    assert.equal(isCoreVerb('propfind'), false);
    assert.equal(isCoreVerb('all'), false);
  });

  it('agrees with HTTP_VERBS', () => {
    for (const verb of HTTP_VERBS) {
      assert.equal(isCoreVerb(verb), CORE_HTTP_VERBS.includes(verb as never), `${verb} disagrees`);
    }
  });
});

describe('the node router', () => {
  it('matches a literal path', () => {
    assert.deepEqual(matchSegments(compile('/api/health'), ['api', 'health']), {});
  });

  it('captures a parameter', () => {
    assert.deepEqual(matchSegments(compile('/api/users/:id'), ['api', 'users', '42']), { id: '42' });
  });

  it('does not let a parameter swallow a slash', () => {
    // The reason the matcher is a segment matcher and not a regular expression:
    // `/a/:x/b` must not match `/a/1/2/b`.
    assert.equal(matchSegments(compile('/a/:x/b'), ['a', '1', '2', 'b']), undefined);
  });

  it('captures a wildcard as the rest of the path', () => {
    // A bare `*` is named `wildcard`, so a handler can read it like any other
    // parameter instead of guessing which key the router picked.
    assert.deepEqual(matchSegments(compile('/files/*'), ['files', 'a', 'b', 'c']), { wildcard: 'a/b/c' });
    assert.deepEqual(matchSegments(compile('/files/*rest'), ['files', 'a']), { rest: 'a' });
  });

  it('is case sensitive, as a path is per RFC 3986', () => {
    assert.equal(matchSegments(compile('/api/Health'), ['api', 'health']), undefined);
  });

  it('decodes a parameter', () => {
    assert.deepEqual(matchSegments(compile('/tag/:name'), ['tag', 'a%20b']), { name: 'a b' });
  });

  it('rejects a shorter and a longer path', () => {
    assert.equal(matchSegments(compile('/a/b'), ['a']), undefined);
    assert.equal(matchSegments(compile('/a'), ['a', 'b']), undefined);
  });

  it('rejects an empty parameter segment', () => {
    // `//` must not produce `id: ''`, which would then read as a falsy id.
    assert.equal(matchSegments(compile('/a/:id'), ['a', '']), undefined);
  });

  it('treats the root path as zero segments', () => {
    assert.deepEqual(matchSegments(compile('/'), []), {});
  });
});
