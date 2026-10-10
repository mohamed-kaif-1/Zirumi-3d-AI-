import MemoryClient from 'mem0ai';
import { ApiError } from '../errors.js';
import { readProviderJson } from './speechHttp.js';

// Pin mem0ai 3.3.1. Its public operations use this transport override so SDK
// telemetry, automatic initialization, private error bodies and unbounded fetch
// never bypass the application's cancellation/privacy policy.
class ScopedMemoryClient extends MemoryClient {
  _initializeClient() { return Promise.resolve({ telemetryId: '', organizationId: null, projectId: null }); }
  _captureEvent() {}
  async _fetchRawJson(url, options) {
    const target = new URL(url);
    if (target.origin !== 'https://api.mem0.ai' || target.username || target.password || target.hash) throw new ApiError(503, 'Memory requires the official Mem0 endpoint.');
    const deadline = AbortSignal.timeout(15_000);
    try {
      const res = await this.zirumiFetch(url, { ...options, redirect: 'error', signal: this.zirumiSignal ? AbortSignal.any([deadline, this.zirumiSignal]) : deadline });
      if (!res.ok) {
        await res.body?.cancel();
        throw Object.assign(new ApiError(res.status === 429 ? 429 : 503, res.status === 401 ? 'Mem0 rejected its backend credential.' : res.status === 403 ? 'Mem0 denied access. Check key permissions.' : [402, 429].includes(res.status) ? 'Memory credits or request quota are unavailable.' : 'Memory is temporarily unavailable. Session chat still works.'), { providerStatus: res.status });
      }
      return res.status === 204 ? { success: true } : await readProviderJson(res);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(deadline.aborted || this.zirumiSignal?.aborted ? 504 : 502, 'Memory could not be reached. Session chat still works.');
    }
  }
}

export function createMem0Provider({ apiKey = '', fetchImpl = fetch } = {}) {
  function client(signal) {
    if (!apiKey.trim()) throw new ApiError(503, 'Long-term memory is not configured. Session chat still works.');
    const sdk = new ScopedMemoryClient({ apiKey: apiKey.trim(), host: 'https://api.mem0.ai' });
    sdk.zirumiFetch = fetchImpl; sdk.zirumiSignal = signal;
    return sdk;
  }
  const scope = userId => {
    if (!/^zirumi-[0-9a-f-]{36}$/.test(userId)) throw new ApiError(403, 'A verified memory identity is required.');
    return { user_id: userId, app_id: 'zirumi' };
  };
  const clean = (item, userId) => {
    if (!item || item.userId !== userId || item.appId !== 'zirumi' || typeof item.id !== 'string' || typeof item.memory !== 'string' || item.memory.length > 500) return null;
    return { id: item.id, text: item.memory, score: typeof item.score === 'number' ? item.score : undefined };
  };
  async function list(userId, { signal } = {}) {
    const result = await client(signal).getAll({ filters: scope(userId), page: 1, pageSize: 100 });
    if (!Array.isArray(result?.results)) throw new ApiError(502, 'Memory returned an invalid list.');
    return result.results.map(item => clean(item, userId)).filter(Boolean);
  }
  return {
    configured: Boolean(apiKey.trim()), list,
    async save(userId, text, { signal } = {}) {
      scope(userId);
      const sdk = client(signal);
      // Explicit preference form: store only that approved short fact, without
      // extraction or automatic recording of the entire conversation.
      const result = await sdk.add([{ role: 'user', content: text }], { userId, appId: 'zirumi', infer: false, metadata: { source: 'zirumi_explicit_preference' } });
      if (result?.status === 'FAILED') throw new ApiError(503, 'Memory could not save this preference.');
      if (result?.status === 'PENDING') return { pending: true };
      const saved = result?.results?.map(item => ({ id: item.id, text: item.memory || item.data?.memory })).filter(item => typeof item.id === 'string' && typeof item.text === 'string') || [];
      if (!saved.length) throw new ApiError(502, 'Memory did not confirm saving this preference. Refresh remembered information to check.');
      return { pending: false, memories: saved };
    },
    async relevant(userId, query, { signal } = {}) {
      // Mem0's documented default: a real exact-subject recall scored 0.2365,
      // so the earlier uncalibrated 0.35 cutoff discarded the correct fact.
      const result = await client(signal).search(query, { filters: scope(userId), topK: 3, threshold: 0.1 });
      if (!Array.isArray(result?.results)) throw new ApiError(502, 'Memory returned invalid search results.');
      return result.results.map(item => clean(item, userId)).filter(item => item && Number.isFinite(item.score) && item.score >= 0.1).slice(0, 3).map(item => item.text);
    },
    async remove(userId, id, { signal } = {}) {
      scope(userId);
      const sdk = client(signal), item = await sdk.get(id);
      if (!clean(item, userId)) throw new ApiError(404, 'This memory was not found in your account.');
      await sdk.delete(id); return { deleted: true };
    },
    async clear(userId, { signal } = {}) { scope(userId); await client(signal).deleteAll({ userId, appId: 'zirumi' }); return { cleared: true }; },
  };
}
