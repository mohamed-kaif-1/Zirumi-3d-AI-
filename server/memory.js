import { ApiError } from './errors.js';
import { createMem0Provider } from './services/mem0.js';
import { createMemoryIdentityStore } from './memoryIdentity.js';

const CATEGORIES = { subject: 'Favorite subject', topic: 'Preferred conversation topic', character: 'Favorite companion', language: 'Preferred response language', hobby: 'Favorite hobby' };
export function createMemoryService({ apiKey = '', provider = createMem0Provider({ apiKey }), identities = createMemoryIdentityStore(), now = Date.now, logger = () => {} } = {}) {
  let start = now(), count = 0, inFlight = 0;
  const mutations = new Set();
  async function body(request) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new ApiError(413, 'Memory request is too large.'); chunks.push(chunk); }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'Memory request contains invalid JSON.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Memory request must be an object.');
    return input;
  }
  return {
    configured: provider.configured,
    async context(request, query, { signal } = {}) {
      try {
        const user = await identities.resolve(request, null);
        if (!user?.enabled || !provider.configured) return { memories: [] };
        const version = user.version, memories = await provider.relevant(user.userId, query, { signal });
        return { memories: user.enabled && user.version === version ? memories : [] };
      } catch { return { memories: [], notice: 'Long-term memory is unavailable. This reply uses session context only.' }; }
    },
    async handle(request, response, send, requestId) {
      if (now() - start > 60_000) { start = now(); count = 0; }
      if (++count > 30 || inFlight >= 2) { send(429, { error: 'Memory is busy. Wait before trying again.' }); return; }
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 20_000);
      const close = () => { if (!response.writableEnded) abort.abort(); }; response.on('close', close); inFlight++;
      let user, locked = false;
      try {
        const route = request.url.split('?')[0];
        if (route === '/api/memory/status' && request.method === 'GET') {
          user = await identities.resolve(request, response, true);
          send(200, { configured: provider.configured, enabled: user.enabled, provider: 'Mem0', mode: 'explicit-preferences', scoped: true }); return;
        }
        user = await identities.resolve(request, response);
        if (!user) throw new ApiError(403, 'Open Memory settings before using long-term memory.');
        if (route === '/api/memory/consent' && request.method === 'POST') {
          const input = await body(request);
          if (typeof input.enabled !== 'boolean' || Object.keys(input).length !== 1) throw new ApiError(400, 'Choose whether Memory is enabled.');
          if (input.enabled && !provider.configured) throw new ApiError(503, 'Long-term memory is not configured.');
          await identities.consent(user, input.enabled);
          send(200, { configured: provider.configured, enabled: user.enabled, provider: 'Mem0' }); return;
        }
        if (!provider.configured) throw new ApiError(503, 'Long-term memory is not configured.');
        const options = { signal: abort.signal };
        if (route === '/api/memory/list' && request.method === 'GET') { send(200, { memories: await provider.list(user.userId, options) }); return; }
        if (request.method !== 'POST' || !['/api/memory/save', '/api/memory/delete', '/api/memory/clear'].includes(route)) throw new ApiError(404, 'Memory endpoint not found.');
        if (mutations.has(user.userId)) throw new ApiError(429, 'A memory change is already in progress.');
        mutations.add(user.userId); locked = true;
        const input = await body(request);
        if (route === '/api/memory/save') {
          if (!user.enabled) throw new ApiError(403, 'Enable Memory before saving a preference.');
          if (Object.keys(input).some(key => !['category', 'value'].includes(key)) || !Object.hasOwn(CATEGORIES, input.category) || typeof input.value !== 'string' || !input.value.trim() || input.value.length > 120 || [...input.value].some(char => char.charCodeAt(0) < 32) || /\b(?:password|api.?key|secret|credit.?card|diagnosis|medical)\b|\b\d{12,}\b/i.test(input.value)) throw new ApiError(400, 'Choose a short, non-sensitive preference to remember.');
          const text = `${CATEGORIES[input.category]}: ${input.value.trim()}`;
          const existing = await provider.list(user.userId, options);
          if (existing.some(item => item.text.toLowerCase() === text.toLowerCase())) { send(200, { saved: true, duplicate: true }); return; }
          if (existing.length >= 100) throw new ApiError(413, 'Memory can hold 100 preferences. Delete an old preference before adding another.');
          if (!user.enabled) throw new ApiError(403, 'Memory was disabled. This preference was not saved.');
          const result = await provider.save(user.userId, text, options);
          send(200, { saved: !result.pending, pending: result.pending, notice: result.pending ? 'Memory is processing this preference. Refresh remembered information to check it.' : 'Preference remembered.' }); return;
        }
        if (route === '/api/memory/delete') {
          if (Object.keys(input).length !== 1 || typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.id)) throw new ApiError(400, 'Choose a valid remembered preference.');
          send(200, await provider.remove(user.userId, input.id, options)); return;
        }
        if (Object.keys(input).length !== 1 || input.confirm !== true) throw new ApiError(400, 'Confirm clearing your remembered preferences.');
        send(200, await provider.clear(user.userId, options));
      } catch (error) {
        logger({ event: 'memory_request', requestId, provider: 'Mem0', status: error instanceof ApiError ? error.status : 500, ...(Number.isInteger(error.providerStatus) ? { providerStatus: error.providerStatus } : {}) });
        send(error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : 'Memory is unavailable. Session chat still works.' });
      } finally { if (locked) mutations.delete(user.userId); clearTimeout(timeout); response.removeListener('close', close); inFlight--; }
    },
  };
}
