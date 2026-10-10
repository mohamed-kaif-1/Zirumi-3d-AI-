import test from 'node:test';
import assert from 'node:assert/strict';
import { createCachedLookup } from '../server/services/groqTransport.js';

const resolve = (lookup, options = { all: true }) => new Promise((done, reject) => lookup('api.groq.com', options, (error, result, family) => error ? reject(error) : done({ result, family })));
test('DNS cache coalesces fresh resolution, respects address family, and expires without caching failures', async () => {
  let calls = 0, now = 0, fail = false;
  const lookup = createCachedLookup({ now: () => now, lookup(host, options, callback) {
    calls++; assert.equal(host, 'api.groq.com'); assert.equal(options.order, 'ipv4first');
    queueMicrotask(() => callback(fail ? Object.assign(new Error('DNS failure'), { code: 'ENOTFOUND' }) : null, [{ address: '192.0.2.1', family: 4 }, { address: '2001:db8::1', family: 6 }]));
  } });
  await Promise.all([resolve(lookup), resolve(lookup)]); assert.equal(calls, 1);
  fail = true;
  assert.equal((await resolve(lookup, { family: 4 })).result, '192.0.2.1');
  assert.equal((await resolve(lookup, { family: 6 })).family, 6); assert.equal(calls, 1);
  now = 60001;
  await assert.rejects(resolve(lookup), e => e.code === 'ENOTFOUND');
  await assert.rejects(resolve(lookup), e => e.code === 'ENOTFOUND'); assert.equal(calls, 3);
  fail = false; await resolve(lookup); assert.equal(calls, 4);
});
