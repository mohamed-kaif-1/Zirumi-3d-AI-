import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDeepgramProvider } from '../server/services/deepgram.js';
import { createCartesiaProvider } from '../server/services/cartesia.js';
import { readProviderConfig } from '../server/providerConfig.js';
import { createTranscriptionServer } from '../server/index.js';
import { speechRequest } from '../server/services/speechHttp.js';

// Clearly synthetic UUIDs and PCM fixtures, never production voice assignments.
const voices = Object.fromEntries(['default', 'sky', 'nova', 'ember'].map((id, i) => [id, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
function wav(rate = 44100) {
  const bytes = Buffer.alloc(48); bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(4, 40); bytes.writeInt16LE(1000, 44); bytes.writeInt16LE(-1000, 46); return bytes;
}
function cartesiaFixture({ change = {}, failure, audio = wav() } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/voices/')) return Response.json({ id: url.split('/').at(-1), status: 'active', access: 'public', is_owner: false, gender: 'feminine', language: 'en', name: 'Synthetic test catalog voice', ...change });
    if (failure) return new Response('private-key-and-transcript', { status: failure, headers: { 'retry-after': '7' } });
    return new Response(audio, { headers: { 'content-type': 'audio/wav' } });
  };
  return { calls, fetchImpl };
}

test('routing defaults to new providers and supports explicit legacy/browser routes only', () => {
  assert.equal(readProviderConfig({}).sttProvider, 'deepgram'); assert.equal(readProviderConfig({}).ttsProvider, 'cartesia');
  const config = readProviderConfig({ DEFAULT_STT_PROVIDER: 'groq', DEFAULT_TTS_PROVIDER: 'elevenlabs' });
  assert.equal(config.sttProvider, 'groq'); assert.equal(config.ttsProvider, 'elevenlabs');
  assert.equal(readProviderConfig({ DEFAULT_STT_PROVIDER: 'browser' }).sttProvider, 'browser');
  for (const env of [{ DEFAULT_STT_PROVIDER: 'sarvam' }, { DEFAULT_TTS_PROVIDER: 'invented' }, { DEFAULT_LLM_PROVIDER: 'grok' }, { DEFAULT_LANGUAGE: 'ta' }]) assert.throws(() => readProviderConfig(env));
});

test('Deepgram sends real container bytes with Token auth and extracts only final prerecorded text', async () => {
  let call;
  const provider = createDeepgramProvider({ apiKey: 'server-secret', fetchImpl: async (url, options) => { call = { url, options }; return Response.json({ metadata: { duration: 0.2, privateKey: 'must-not-escape' }, results: { channels: [{ alternatives: [{ transcript: ' Hello Aira. ', confidence: 0.9 }] }] } }); } });
  const audio = wav(16000), result = await provider.transcribe(audio, 'audio/wav');
  const url = new URL(call.url); assert.equal(url.origin, 'https://api.deepgram.com'); assert.equal(url.pathname, '/v1/listen'); assert.equal(url.searchParams.get('model'), 'nova-3'); assert.equal(url.searchParams.get('language'), 'en');
  assert.equal(call.options.headers.Authorization, 'Token server-secret'); assert.equal(call.options.headers['Content-Type'], 'audio/wav'); assert.equal(call.options.body, audio); assert.equal(call.options.redirect, 'error');
  assert.equal(result.transcript, 'Hello Aira.'); assert.equal(result.metadata.mode, 'prerecorded'); assert.equal(provider.status().modelVerified, true); assert.ok(!JSON.stringify(result).includes('must-not-escape'));
});

test('Deepgram preserves silence, rejects malformed transcripts and validates audio before billing', async () => {
  let calls = 0, transcript = '';
  const provider = createDeepgramProvider({ apiKey: 'key', fetchImpl: async () => { calls++; return Response.json({ results: { channels: [{ alternatives: [{ transcript }] }] } }); } });
  assert.equal((await provider.transcribe(wav(), 'audio/wav')).transcript, '');
  transcript = null; await assert.rejects(provider.transcribe(wav(), 'audio/wav'), /invalid final transcript/);
  await assert.rejects(provider.transcribe(Buffer.from('<html>'), 'audio/wav')); assert.equal(calls, 2);
  await assert.rejects(createDeepgramProvider({}).transcribe(wav(), 'audio/wav'), /DEEPGRAM_API_KEY/);
});

test('Cartesia verifies distinct catalog identities before synthesis, returns WAV and uses documented request shape', async () => {
  const f = cartesiaFixture(), service = createCartesiaProvider({ apiKey: 'server-secret', voices, fetchImpl: f.fetchImpl });
  const before = await service.status(); assert.equal(before.modelVerified, false); assert.equal(before.distinctAssignments, 4); assert.equal(before.fallback, 'none');
  for (const id of Object.keys(voices)) {
    const result = await service.synthesize({ avatarId: id === 'default' ? 'original' : id, text: 'Hello.', rate: 1 });
    assert.equal(result.voiceId, voices[id]); assert.equal(result.mimeType, 'audio/wav'); assert.deepEqual(result.audio, wav());
    const call = f.calls.at(-1), body = JSON.parse(call.options.body);
    assert.equal(call.url, 'https://api.cartesia.ai/tts/bytes'); assert.equal(call.options.headers.Authorization, 'Bearer server-secret'); assert.equal(call.options.headers['Cartesia-Version'], '2026-08-14');
    assert.equal(body.model_id, 'sonic-3.6'); assert.equal(body.voice, voices[id]); assert.equal(body.locale, 'en'); assert.equal(body.language, undefined); assert.equal(body.output_format.encoding, 'pcm_s16le'); assert.equal(body.transcript, 'Hello.');
    assert.equal((await service.status()).avatars[id].synthesisVerified, true);
  }
  assert.equal(f.calls.filter(c => c.url.includes('/voices/')).length, 4, 'metadata reads coalesce and cache');
  assert.equal((await service.status()).modelVerified, true);
  assert.throws(() => createCartesiaProvider({ voices: { default: voices.sky, sky: voices.sky } }), /distinct/);
  assert.throws(() => createCartesiaProvider({ voices: { sky: 'tnSpp4vdxKPjI9w0GnoV' } }), /UUID/);
});

test('Cartesia repairs completed streaming WAV sentinel lengths and preserves metadata chunks', async () => {
  // Observed provider layout: PCM fmt, LIST metadata, then unknown-size data.
  const stream = Buffer.alloc(82);
  wav().copy(stream, 0, 0, 36);
  stream.writeUInt32LE(0xffffffff, 4);
  stream.write('LIST', 36); stream.writeUInt32LE(26, 40);
  stream.write('data', 70); stream.writeUInt32LE(0xffffffff, 74);
  stream.writeInt16LE(1000, 78); stream.writeInt16LE(-1000, 80);
  const f = cartesiaFixture({ audio: stream });
  const service = createCartesiaProvider({ apiKey: 'key', voices: { sky: voices.sky }, fetchImpl: f.fetchImpl });
  const result = await service.synthesize({ avatarId: 'sky', text: 'Hello.' });
  assert.equal(result.audio.readUInt32LE(4), 74);
  assert.equal(result.audio.readUInt32LE(74), 4);
  assert.deepEqual(result.audio.subarray(36, 70), stream.subarray(36, 70));
  assert.equal(stream.readUInt32LE(4), 0xffffffff, 'does not mutate the original response');
  for (const invalid of [stream.subarray(0, 81), stream.subarray(0, 78)]) {
    const bad = cartesiaFixture({ audio: invalid });
    await assert.rejects(createCartesiaProvider({ apiKey: 'key', voices: { sky: voices.sky }, fetchImpl: bad.fetchImpl }).synthesize({ avatarId: 'sky', text: 'Hello.' }), /incomplete/);
  }
  const corrupt = Buffer.from(stream); corrupt.writeUInt32LE(1000, 40);
  const bad = cartesiaFixture({ audio: corrupt });
  await assert.rejects(createCartesiaProvider({ apiKey: 'key', voices: { sky: voices.sky }, fetchImpl: bad.fetchImpl }).synthesize({ avatarId: 'sky', text: 'Hello.' }), /truncated/);
});

test('Cartesia blocks ineligible voices, missing assignments and cancelled calls without synthesis', async () => {
  for (const change of [{ gender: 'masculine' }, { status: 'archived' }, { access: 'private', is_owner: false }, { language: 'fr' }, { id: voices.nova }]) {
    const f = cartesiaFixture({ change }), service = createCartesiaProvider({ apiKey: 'key', voices: { sky: voices.sky }, fetchImpl: f.fetchImpl });
    await assert.rejects(service.synthesize({ avatarId: 'sky', text: 'Hello' })); assert.ok(f.calls.every(c => c.url.includes('/voices/')));
  }
  const f = cartesiaFixture(), service = createCartesiaProvider({ apiKey: 'key', voices: { sky: voices.sky }, fetchImpl: f.fetchImpl });
  await assert.rejects(service.synthesize({ avatarId: 'default', text: 'Hello' }), /Assign/); assert.equal(f.calls.length, 0);
  const abort = new AbortController(); abort.abort(); await assert.rejects(service.synthesize({ avatarId: 'sky', text: 'Hello' }, { signal: abort.signal }), /cancelled/); assert.equal(f.calls.length, 0);
});

test('Cartesia errors stay visible, quota is not retried and failed synthesis is never marked ready', async () => {
  for (const failure of [401, 402, 403, 404, 429, 500]) {
    const f = cartesiaFixture({ failure }), service = createCartesiaProvider({ apiKey: 'key', voices: { sky: voices.sky }, fetchImpl: f.fetchImpl });
    await assert.rejects(service.synthesize({ avatarId: 'sky', text: 'Private conversation' }), error => { assert.ok(!error.message.includes('private-key')); assert.equal(error.status, failure === 429 ? 429 : failure === 500 ? 502 : 503); if (failure === 429) assert.equal(error.retryAfter, 7); return true; });
    assert.equal(f.calls.filter(c => c.url.includes('/tts/')).length, 1); const state = await service.status(); assert.equal(state.avatars.sky.available, false); assert.equal(state.avatars.sky.synthesisVerified, false);
  }
  for (const audio of [Buffer.alloc(0), Buffer.from('RIFFbroken'), wav(16000), Buffer.from('<html>')]) { const f = cartesiaFixture({ audio }); await assert.rejects(createCartesiaProvider({ apiKey: 'key', voices: { sky: voices.sky }, fetchImpl: f.fetchImpl }).synthesize({ avatarId: 'sky', text: 'Hello' })); }
});

test('speech HTTP rejects alternate hosts, bounds bodies and observes deadline/caller cancellation', async () => {
  let calls = 0;
  await assert.rejects(speechRequest('https://evil.example/tts', { provider: 'Cartesia', apiKey: 'key', fetchImpl: async () => { calls++; }, consume() {} }), /official/); assert.equal(calls, 0);
  const provider = createDeepgramProvider({ apiKey: 'key', fetchImpl: async () => new Response('x'.repeat(512 * 1024 + 1), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(provider.transcribe(wav(), 'audio/wav'), /oversized/);
  const abort = new AbortController();
  const pending = speechRequest('https://api.deepgram.com/v1/listen', { provider: 'Deepgram', apiKey: 'key', signal: abort.signal, fetchImpl: (_, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('private-secret')), { once: true }); }), consume() {} });
  abort.abort(); await assert.rejects(pending, error => error.status === 504 && !error.message.includes('private-secret'));
});

test('HTTP adapters preserve routes, return provider metadata/correlation IDs and keep Groq credentials independent', async () => {
  const logs = [], f = cartesiaFixture();
  const server = createTranscriptionServer({ apiKey: '', sttProvider: 'deepgram', deepgramApiKey: 'deepgram-private', ttsProvider: 'cartesia', cartesiaApiKey: 'cartesia-private', cartesiaVoices: voices, logger: value => logs.push(value), fetchImpl: async (url, options) => url.startsWith('https://api.deepgram.com') ? Response.json({ results: { channels: [{ alternatives: [{ transcript: 'Hello' }] }] } }) : f.fetchImpl(url, options) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav() }); assert.equal(response.status, 200); assert.match(response.headers.get('x-zirumi-request-id'), /^[a-f\d-]{36}$/); assert.equal((await response.json()).metadata.provider, 'Deepgram');
    const tts = await fetch(`${url}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId: 'sky', text: 'Hello' }) }); assert.equal(tts.status, 200); assert.equal(tts.headers.get('content-type'), 'audio/wav'); assert.equal(tts.headers.get('x-echo-voice-id'), voices.sky); assert.equal(tts.headers.get('x-zirumi-tts-provider'), 'Cartesia');
    const health = await (await fetch(`${url}/api/providers/status`)).json(); assert.equal(health.streamingTranscription, false); assert.equal(health.automaticFallback, false);
    assert.equal((await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId: 'sky', message: 'Hello' }) })).status, 503);
    assert.ok(logs.every(record => record.requestId)); assert.ok(!JSON.stringify(logs).includes('private'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
