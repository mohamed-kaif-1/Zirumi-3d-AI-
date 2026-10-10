import dns from 'node:dns';
import { Agent } from 'undici';

// Cache successful resolutions briefly; never cache a DNS failure or replay a
// provider request. TLS still uses the official hostname and certificate checks.
export function createCachedLookup({ lookup = dns.lookup, now = Date.now, ttlMs = 60_000 } = {}) {
  const cache = new Map(), pending = new Map();
  return function cachedLookup(hostname, options, callback) {
    const family = typeof options === 'number' ? options : options?.family || 0;
    const all = typeof options === 'object' && options.all;
    const deliver = (error, records) => {
      if (error) { callback(error); return; }
      const selected = records.filter(record => !family || record.family === Number(family));
      if (!selected.length) { callback(Object.assign(new Error('No address for requested family.'), { code: 'ENOTFOUND' })); return; }
      if (all) callback(null, selected.map(record => ({ ...record })));
      else callback(null, selected[0].address, selected[0].family);
    };
    const hit = cache.get(hostname);
    if (hit && now() < hit.expires) { queueMicrotask(() => deliver(null, hit.records)); return; }
    cache.delete(hostname);
    if (pending.has(hostname)) { pending.get(hostname).push(deliver); return; }
    pending.set(hostname, [deliver]);
    lookup(hostname, { all: true, order: 'ipv4first' }, (error, records) => {
      if (!error && records?.length) cache.set(hostname, { records, expires: now() + ttlMs });
      const waiters = pending.get(hostname); pending.delete(hostname);
      for (const waiter of waiters) waiter(error, records || []);
    });
  };
}

// Close each completed HTTP connection so a later upload never reuses a socket
// that the upstream or local network has silently expired. DNS remains cached.
const dispatcher = new Agent({ connections: 2, pipelining: 0, autoSelectFamily: true, connect: { lookup: createCachedLookup(), timeout: 15_000 } });
export function groqFetch(url, options) {
  if (new URL(url).origin !== 'https://api.groq.com') throw new Error('Unsupported Groq transport origin.');
  return fetch(url, { ...options, dispatcher });
}
