import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createGroqModelRegistry, groqJson, safeUsage } from '../server/services/groq.js';
import { generateReplyDetailed } from '../server/chat.js';
import { createTranscriptionServer } from '../server/index.js';

const json = data => Response.json(data);
const models = () => json({ data: [{ id: 'openai/gpt-oss-120b', active: true }, { id: 'openai/gpt-oss-20b', active: true }, { id: 'whisper-large-v3-turbo', active: true }, { id: 'retired', active: false }] });
const completion = () => json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello Kaif.', reasoning: 'Hidden reasoning' } }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, completion_tokens_details: { reasoning_tokens: 1 }, secret: 'must not escape' } });

test('Groq model discovery coalesces and caches account access, rejects unavailable models, expires and respects cancellation', async () => {
  let calls = 0, time = 1000;
  const registry = createGroqModelRegistry({ apiKey: 'private', now: () => time, fetchImpl: async () => { calls++; return models(); } });
  await Promise.all([registry.verify('openai/gpt-oss-120b'), registry.verify('whisper-large-v3-turbo')]);
  assert.equal(calls, 1); assert.equal(registry.isVerified('openai/gpt-oss-120b'), true);
  for (const model of ['missing', 'retired']) await assert.rejects(registry.verify(model), error => error.status === 503);
  await assert.rejects(registry.verify('openai/gpt-oss-120b', { signal: AbortSignal.abort() }), error => error.status === 504);
  assert.equal(calls, 1);
  time += 300_001; assert.equal(registry.isVerified('openai/gpt-oss-120b'), false);
  await registry.verify('openai/gpt-oss-120b'); assert.equal(calls, 2);
});

test('Groq cannot send credentials to an alternate host, URL credentials, insecure URL or redirect', async () => {
  for (const baseUrl of ['http://api.groq.com/openai/v1', 'https://evil.example/openai/v1', 'https://api.groq.com.evil.example/openai/v1', 'https://user:password@api.groq.com/openai/v1', 'https://api.groq.com/openai/v1?target=evil']) await assert.rejects(groqJson('models', { apiKey: 'private', baseUrl, fetchImpl: async () => assert.fail('Untrusted endpoint must not receive credentials') }), error => error.status === 503);
  await groqJson('models', { apiKey: 'private', fetchImpl: async (url, options) => { assert.equal(url, 'https://api.groq.com/openai/v1/models'); assert.equal(options.redirect, 'error'); return models(); } });
});

test('Groq bounds provider bodies, rejects invalid JSON and aborts a stalled request without retries', async () => {
  for (const response of [new Response('{broken'), new Response('x'.repeat(512 * 1024 + 1))]) await assert.rejects(groqJson('models', { apiKey: 'private', fetchImpl: async () => response }), error => error.status === 502);
  let calls = 0;
  // Keep the test alive while the provider timer (deliberately unref'ed) expires.
  const keeper = setTimeout(() => {}, 100);
  try {
    await assert.rejects(groqJson('models', { apiKey: 'private', timeoutMs: 10, fetchImpl: (_, options) => { calls++; return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); } }), error => error.status === 504);
    assert.equal(calls, 1);
  } finally { clearTimeout(keeper); }
});

test('AI usage allows numeric usage and returned cost only, never provider objects or reasoning', async () => {
  assert.deepEqual(safeUsage({ prompt_tokens: 3, total_tokens: NaN, cost_usd: 0.001, cost_in_usd_ticks: 4, apiKey: 'private', prompt: 'private', completion_time: -1 }), { prompt_tokens: 3, cost_usd: 0.001, cost_in_usd_ticks: 4 });
  let payload;
  const result = await generateReplyDetailed({ message: 'Hello' }, { apiKey: 'private', fetchImpl: async (_, options) => { payload = JSON.parse(options.body); return completion(); } });
  assert.equal(result.reply, 'Hello Kaif.'); assert.deepEqual(result.metadata.usage, { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, reasoning_tokens: 1 });
  assert.equal(payload.model, 'openai/gpt-oss-20b'); assert.equal(payload.reasoning_effort, 'low'); assert.equal(payload.include_reasoning, false);
  assert.equal(payload.tools, undefined); assert.equal(payload.previous_response_id, undefined);
  assert.equal(payload.max_completion_tokens, 2048); assert.ok(!JSON.stringify(result).includes('Hidden reasoning')); assert.ok(!JSON.stringify(result).includes('private'));
  await generateReplyDetailed({ message: 'Hello' }, { model: 'llama-3.3-70b-versatile', apiKey: 'private', fetchImpl: async (_, options) => { const alternate = JSON.parse(options.body); assert.equal(alternate.reasoning_effort, undefined); assert.equal(alternate.include_reasoning, undefined); return completion(); } });
});

test('Groq truncated, filtered, malformed and tool responses do not enter conversation history', async () => {
  for (const choice of [
    { finish_reason: 'length', message: { role: 'assistant', content: 'Partial text' } },
    { finish_reason: 'content_filter', message: { role: 'assistant', content: 'Blocked text' } },
    { finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{}] } },
    { finish_reason: 'stop', message: { role: 'assistant', content: null } },
    { finish_reason: 'stop', message: { role: 'user', content: 'Wrong role' } },
  ]) await assert.rejects(generateReplyDetailed({ message: 'Hi' }, { apiKey: 'private', fetchImpl: async () => json({ choices: [choice] }) }), error => [422, 502].includes(error.status));
});

async function serverRun(options, run) {
  const server = createTranscriptionServer({ apiKey: 'private', elevenLabsApiKey: '', logger() {}, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const post = (base, endpoint, body = '{}', type = 'application/json') => fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': type }, body });

test('chat and transcription rate limits stop cost amplification and reset after the bounded window', async () => {
  let time = 1000, calls = 0;
  await serverRun({ now: () => time, fetchImpl: async url => { if (url.endsWith('/models')) return models(); calls++; return url.endsWith('transcriptions') ? json({ text: 'Hello' }) : completion(); } }, async base => {
    for (let i = 0; i < 16; i++) assert.equal((await post(base, 'chat', JSON.stringify({ message: 'Hi' }))).status, 200);
    const limited = await post(base, 'chat', JSON.stringify({ message: 'Hi' })); assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60'); assert.equal(calls, 16);
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]);
    for (let i = 0; i < 10; i++) assert.equal((await post(base, 'transcribe', audio, 'audio/webm')).status, 200);
    assert.equal((await post(base, 'transcribe', audio, 'audio/webm')).status, 429); assert.equal(calls, 26);
    time += 60_000; assert.equal((await post(base, 'chat', JSON.stringify({ message: 'Hi' }))).status, 200);
  });
});

test('unavailable account models and invalid credentials prevent generation and return only safe errors', async () => {
  for (const status of [401, 402, 403, 429, 503]) await serverRun({ fetchImpl: async url => { assert.ok(url.endsWith('/models')); return new Response('private-key internal account details', { status }); } }, async base => {
    const response = await post(base, 'chat', JSON.stringify({ message: 'Hi' }));
    const body = await response.json(); assert.equal(response.status, status === 429 ? 429 : status === 503 ? 502 : 503);
    assert.ok(!JSON.stringify(body).includes('private-key')); assert.equal(body.reply, undefined);
  });
  await serverRun({ chatModel: 'missing', fetchImpl: async url => { assert.ok(url.endsWith('/models')); return models(); } }, async base => {
    const response = await post(base, 'chat', JSON.stringify({ message: 'Hi' })); assert.equal(response.status, 503); assert.match((await response.json()).error, /unavailable to this account/);
  });
});

test('HTTPS deployment origins must be exact; existing origin and host restrictions remain', async () => {
  assert.throws(() => createTranscriptionServer({ allowedOrigins: '*' }));
  assert.throws(() => createTranscriptionServer({ allowedOrigins: 'http://public.example' }));
  await serverRun({ allowedOrigins: 'https://zirumi.example', fetchImpl: async url => url.endsWith('/models') ? models() : completion() }, async base => {
    assert.equal((await fetch(`${base}/api/chat/status`, { headers: { Origin: 'https://zirumi.example' } })).status, 200);
    assert.equal((await fetch(`${base}/api/chat/status`, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const hostileHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(`${base}/api/chat/status`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(hostileHostStatus, 403);
  });
});
