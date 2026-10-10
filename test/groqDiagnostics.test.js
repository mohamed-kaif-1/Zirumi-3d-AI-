import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGroqModelRegistry, groqJson } from '../server/services/groq.js';
import { createTranscriptionServer } from '../server/index.js';

const catalog = () => Response.json({ data: [{ id: 'openai/gpt-oss-20b' }, { id: 'retired', active: false }] });
test('Groq model verification coalesces account discovery, expires, and prevents unavailable generation', async () => {
  let calls = 0, now = 0;
  const registry = createGroqModelRegistry({ apiKey: 'test-groq', now: () => now, fetchImpl: async () => { calls++; return catalog(); } });
  await Promise.all([registry.verify('openai/gpt-oss-20b'), registry.verify('openai/gpt-oss-20b')]);
  assert.equal(calls, 1);
  for (const id of ['missing', 'retired']) await assert.rejects(registry.verify(id), e => e.errorCode === 'model_not_found');
  await assert.rejects(registry.verify('openai/gpt-oss-20b', { signal: AbortSignal.abort() }), e => e.status === 504);
  now = 300001;
  assert.equal(registry.isVerified('openai/gpt-oss-20b'), false);
  await registry.verify('openai/gpt-oss-20b'); assert.equal(calls, 2);
});
test('Groq credentials cannot reach xAI or other endpoints and redirect following is disabled', async () => {
  for (const baseUrl of ['https://api.x.ai/v1', 'http://api.groq.com/openai/v1', 'https://api.groq.com.evil/openai/v1', 'https://user:secret@api.groq.com/openai/v1', 'https://api.groq.com/openai/v1?key=secret']) {
    await assert.rejects(groqJson('models', { apiKey: 'secret', baseUrl, fetchImpl: () => assert.fail('credential escaped') }), e => e.status === 503);
  }
  await assert.rejects(groqJson('../models', { apiKey: 'secret' }), e => e.status === 503);
  await groqJson('models', { apiKey: 'secret', fetchImpl: async (url, options) => { assert.equal(url, 'https://api.groq.com/openai/v1/models'); assert.equal(options.headers.Authorization, 'Bearer secret'); assert.equal(options.redirect, 'error'); return catalog(); } });
});
test('Groq failures retain actual HTTP status and only recognized provider error codes', async () => {
  for (const [status, localStatus] of [[400,422],[401,503],[402,503],[403,503],[404,502],[429,429],[500,502],[502,502],[503,502]]) {
    await assert.rejects(groqJson('chat/completions', { apiKey: 'secret', fetchImpl: async () => Response.json({ error: { code: 'invalid_api_key', message: 'private secret prompt' } }, { status }) }), e => e.status === localStatus && e.providerStatus === status && e.errorCode === 'invalid_api_key' && !e.message.includes('secret'));
  }
  await assert.rejects(groqJson('models', { apiKey: 'secret', fetchImpl: async () => Response.json({ error: { code: 'secret' } }, { status: 403 }) }), e => e.errorCode === undefined);
  await assert.rejects(groqJson('models', { apiKey: 'secret', fetchImpl: async () => Response.json({ error: { code: 'credits_exhausted' } }, { status: 400 }) }), e => e.status === 503 && /credits/.test(e.message));
});
test('Groq distinguishes DNS, TLS and socket failures, sanitizes exceptions and never retries', async () => {
  for (const [code, pattern] of [['ENOTFOUND', /resolve/], ['CERT_HAS_EXPIRED', /secure connection/], ['ECONNRESET', /interrupted/]]) {
    let calls = 0;
    await assert.rejects(groqJson('models', { apiKey: 'secret', fetchImpl: async () => { calls++; throw new Error('private secret', { cause: { code } }); } }), e => e.status === 502 && e.networkCode === code && pattern.test(e.message) && !e.message.includes('secret'));
    assert.equal(calls, 1);
  }
  const keeper = setTimeout(() => {}, 100);
  try { await assert.rejects(groqJson('models', { apiKey: 'secret', timeoutMs: 10, fetchImpl: (_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')))) }), e => e.status === 504 && e.errorCode === 'timeout'); }
  finally { clearTimeout(keeper); }
  for (const response of [new Response('{bad'), new Response('x'.repeat(512 * 1024 + 1))]) await assert.rejects(groqJson('models', { apiKey: 'secret', fetchImpl: async () => response }), e => e.status === 502);
  await assert.rejects(groqJson('models', { apiKey: 'secret', fetchImpl: async () => { throw new Error('private details', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }); } }), e => e.status === 504 && e.networkCode === 'UND_ERR_CONNECT_TIMEOUT' && /timed out/.test(e.message));
});
test('Groq 429 forwards only bounded numeric Retry-After, and insufficient recordings get their own message', async () => {
  for (const [value, expected] of [['2.5', 3], ['99999999', 86400], ['private secret', undefined]]) {
    await assert.rejects(groqJson('chat/completions', { apiKey: 'secret', fetchImpl: async () => Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'Retry-After': value } }) }), e => e.status === 429 && e.retryAfter === expected);
  }
  await assert.rejects(groqJson('audio/transcriptions', { apiKey: 'secret', kind: 'transcription', fetchImpl: async () => Response.json({ error: { code: 'audio_too_short' } }, { status: 400 }) }), e => e.status === 422 && /too little audio/.test(e.message));
});
test('chat uses Groq credentials and safe logs record endpoint/model/status/code/duration', async () => {
  const records = [], requests = [];
  let deny = true;
  const server = createTranscriptionServer({ apiKey: 'groq-only-secret', elevenLabsApiKey: '', logger: record => records.push(record), fetchImpl: async (url, options) => {
    requests.push({ url, auth: options.headers.Authorization });
    if (deny) return Response.json({ error: { code: 'permission_denied', message: 'private account secret' } }, { status: 403 });
    return url.endsWith('/models') ? catalog() : Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Test response.' } }] });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const send = () => fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'private user message' }) });
    assert.equal((await send()).status, 503);
    assert.equal(records[0].providerStatus, 403); assert.equal(records[0].errorCode, 'permission_denied');
    assert.equal(records[0].endpoint, 'https://api.groq.com/openai/v1/models'); assert.equal(records[0].model, 'openai/gpt-oss-20b');
    assert.equal(records[0].provider, 'Groq'); assert.equal(typeof records[0].latencyMs, 'number');
    assert.ok(!JSON.stringify(records).includes('private')); assert.ok(!JSON.stringify(records).includes('secret'));
    deny = false; assert.equal((await send()).status, 200);
    assert.ok(requests.every(r => r.url.startsWith('https://api.groq.com/openai/v1/') && r.auth === 'Bearer groq-only-secret'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const missing = createTranscriptionServer({ apiKey: '', elevenLabsApiKey: '', logger() {}, fetchImpl: () => assert.fail('Missing credential must never call a provider') });
  missing.listen(0, '127.0.0.1'); await once(missing, 'listening');
  try { const response = await fetch(`http://127.0.0.1:${missing.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hi' }) }); assert.equal(response.status, 503); assert.match((await response.json()).error, /GROQ_API_KEY/); }
  finally { missing.closeAllConnections(); await new Promise(resolve => missing.close(resolve)); }
});
