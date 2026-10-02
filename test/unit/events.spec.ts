import { strict as assert } from 'node:assert';
import { HttpEventBroker } from '@glandjs/http';

/**
 * The lifecycle bus.
 *
 * Small, but the part that matters is `safeEmit`: it runs on every request, and
 * a listener-free event that still walks the emitter chain is a cost on the hot
 * path for nothing.
 */
describe('HttpEventBroker', () => {
  it('has an id', () => {
    assert.equal(typeof new HttpEventBroker().id, 'string');
  });

  it('reports whether anything is listening', () => {
    const events = new HttpEventBroker();
    assert.equal(events.hasListener('http:request:start'), false);
    events.on('http:request:start', () => undefined);
    assert.equal(events.hasListener('http:request:start'), true);
  });

  it('emits when a listener is present', () => {
    const events = new HttpEventBroker();
    let seen = 0;
    events.on('http:request:start', () => {
      seen += 1;
    });
    assert.equal(events.safeEmit('http:request:start', undefined as never), true);
    assert.equal(seen, 1);
  });

  it('skips the emit when nothing is listening, and says so', () => {
    // The old implementation emitted unconditionally and then called `off()` with
    // a fresh no-op listener, which removed nothing.
    const events = new HttpEventBroker();
    assert.equal(events.safeEmit('http:request:start', undefined as never), false);
    assert.equal(events.getListener('http:request:start').length, 0);
  });

  it('returns an unsubscribe function from observe', () => {
    const events = new HttpEventBroker();
    let seen = 0;
    const off = events.observe('http:request:end', () => {
      seen += 1;
    });

    events.emit('http:request:end', undefined as never);
    off();
    events.emit('http:request:end', undefined as never);

    assert.equal(seen, 1);
  });
});
