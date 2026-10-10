import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMem0Provider } from '../server/services/mem0.js';
import { createMemoryIdentityStore } from '../server/memoryIdentity.js';
import { createMemoryService } from '../server/memory.js';
import { createTranscriptionServer } from '../server/index.js';

const userId = 'zirumi-' + randomUUID();
const memoryId = randomUUID();
function fixture() {
  const calls = [];
  const record = { id: memoryId, user_id: userId, app_id: 'zirumi', memory: 'Favorite subject: Astronomy', score: 0.2365 };
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return Response.json(url.includes('search') || url.includes('?page=') ? { results: [record, { ...record, user_id: 'someone-else' }, { ...record, score: 0.01 }] } : url.includes('/add/') ? { status: 'SUCCEEDED', results: [record] } : options.method === 'DELETE' ? { message: 'deleted' } : record); };
  return { calls, record, fetchImpl };
}
test('official hosted Mem0 SDK stays scoped, bounded and does not initialize telemetry or ping', async () => {
  const f = fixture(), provider = createMem0Provider({ apiKey: 'server-test-key', fetchImpl: f.fetchImpl });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await provider.relevant(userId, 'What is my favorite subject?'), ['Favorite subject: Astronomy']);
  const call = f.calls[0], body = JSON.parse(call.options.body);
  assert.equal(call.url, 'https://api.mem0.ai/v3/memories/search/'); assert.deepEqual(body.filters, { user_id: userId, app_id: 'zirumi' }); assert.equal(body.top_k, 3); assert.equal(call.options.headers.Authorization, 'Token server-test-key'); assert.equal(call.options.redirect, 'error');
  const saved = await provider.save(userId, 'Favorite subject: Astronomy'); assert.equal(saved.pending, false);
  const add = JSON.parse(f.calls.at(-1).options.body); assert.equal(add.user_id, userId); assert.equal(add.app_id, 'zirumi'); assert.equal(add.infer, false); assert.equal(add.messages.length, 1);
  assert.ok(f.calls.every(c => !c.url.includes('ping') && new URL(c.url).origin === 'https://api.mem0.ai'));
  await assert.rejects(provider.list('*'), /verified/);
});
test('memory deletion rejects foreign records and clear always includes verified user/app scope', async () => {
  const f = fixture(), provider = createMem0Provider({ apiKey: 'key', fetchImpl: f.fetchImpl });
  f.record.user_id = 'another-user'; await assert.rejects(provider.remove(userId, memoryId), /not found/); assert.ok(!f.calls.some(c => c.options.method === 'DELETE'));
  await provider.clear(userId); const url = new URL(f.calls.at(-1).url); assert.equal(url.searchParams.get('user_id'), userId); assert.equal(url.searchParams.get('app_id'), 'zirumi');
});
test('memory errors hide provider bodies and cancellation stops real SDK transport', async () => {
  const provider = createMem0Provider({ apiKey: 'key', fetchImpl: async () => new Response('private-user-and-key', { status: 401 }) });
  await assert.rejects(provider.list(userId), error => error.providerStatus === 401 && !error.message.includes('private-user'));
  const abort = new AbortController(); abort.abort();
  const cancelled = createMem0Provider({ apiKey: 'key', fetchImpl: async (_, options) => { if (options.signal.aborted) throw new Error('private-key'); } });
  await assert.rejects(cancelled.list(userId, { signal: abort.signal }), error => error.status === 504 && !error.message.includes('private-key'));
});
test('opaque HttpOnly identity and consent survive a backend store restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zirumi-memory-test-')), filePath = path.join(dir, 'identities.json');
  let cookie; const response = { setHeader: (_, value) => { cookie = value; } };
  try {
    const store = createMemoryIdentityStore({ filePath });
    const user = await store.resolve({ headers: {} }, response, true); assert.equal(user.enabled, false); assert.match(cookie, /HttpOnly; SameSite=Strict/);
    await store.consent(user, true);
    const restored = await createMemoryIdentityStore({ filePath }).resolve({ headers: { cookie: cookie.split(';')[0] } }, null);
    assert.equal(restored.userId, user.userId); assert.equal(restored.enabled, true);
    assert.equal(await store.resolve({ headers: { cookie: 'zirumi_memory=' + 'f'.repeat(64) } }, null), null);
  } finally { await unlink(filePath); await rmdir(dir); }
});
test('HTTP memory is opt-in, isolates browser identities, deduplicates saves and preserves disabled management', async () => {
  const records = new Map(), calls = [];
  const provider = { configured: true, list: async id => records.get(id) || [], relevant: async id => { calls.push(['search', id]); return (records.get(id) || []).map(v => v.text); }, save: async (id, text) => { calls.push(['save', id]); records.set(id, [{ id: memoryId, text }]); return { pending: false }; }, remove: async (id, target) => { assert.equal(target, memoryId); records.set(id, []); return { deleted: true }; }, clear: async id => { records.set(id, []); return { cleared: true }; } };
  const memory = createMemoryService({ provider, identities: createMemoryIdentityStore({ filePath: null }) });
  const server = createTranscriptionServer({ apiKey: 'key', memoryService: memory, logger() {} }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/memory/`;
  const request = (route, cookie, input) => fetch(base + route, { method: input ? 'POST' : 'GET', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) }, body: input ? JSON.stringify(input) : undefined });
  try {
    const first = await request('status'); const cookieA = first.headers.get('set-cookie').split(';')[0]; assert.equal((await first.json()).enabled, false);
    const second = await request('status'); const cookieB = second.headers.get('set-cookie').split(';')[0]; assert.notEqual(cookieA, cookieB);
    assert.equal((await request('save', cookieA, { category: 'subject', value: 'Astronomy' })).status, 403); assert.equal(calls.length, 0);
    assert.equal((await request('consent', cookieA, { enabled: true })).status, 200);
    assert.equal((await request('save', cookieA, { category: 'constructor', value: 'Astronomy' })).status, 400);
    assert.equal((await request('save', cookieA, { category: 'subject', value: 'password: do not store' })).status, 400);
    assert.equal((await request('save', cookieA, { category: 'subject', value: 'Astronomy' })).status, 200);
    assert.equal((await (await request('save', cookieA, { category: 'subject', value: 'Astronomy' })).json()).duplicate, true); assert.equal(calls.length, 1);
    assert.deepEqual((await (await request('list', cookieB)).json()).memories, []);
    assert.deepEqual((await memory.context({ headers: { cookie: cookieB } }, 'subject')).memories, []);
    assert.deepEqual((await memory.context({ headers: { cookie: cookieA } }, 'subject')).memories, ['Favorite subject: Astronomy']);
    await request('consent', cookieA, { enabled: false }); const count = calls.length;
    assert.deepEqual((await memory.context({ headers: { cookie: cookieA } }, 'subject')).memories, []); assert.equal(calls.length, count);
    assert.equal((await (await request('list', cookieA)).json()).memories.length, 1);
    assert.equal((await request('clear', cookieA, { confirm: false })).status, 400);
    assert.equal((await request('clear', cookieA, { confirm: true })).status, 200);
    assert.deepEqual((await (await request('list', cookieA)).json()).memories, []);
  } finally { server.close(); await once(server, 'close'); }
});
test('unavailable memory degrades to session context without failing conversation', async () => {
  const identities = createMemoryIdentityStore({ filePath: null }); let cookie;
  const user = await identities.resolve({ headers: {} }, { setHeader: (_, value) => { cookie = value.split(';')[0]; } }, true); await identities.consent(user, true);
  const service = createMemoryService({ identities, provider: { configured: true, relevant: async () => { throw new Error('private provider body'); } } });
  const context = await service.context({ headers: { cookie } }, 'favorite subject'); assert.deepEqual(context.memories, []); assert.match(context.notice, /session context/); assert.ok(!context.notice.includes('private provider'));
});
