import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createTtsService, validateTtsRequest, DEFAULT_TTS_MODEL, MAX_TTS_TEXT } from '../server/tts.js';
import { createTranscriptionServer } from '../server/index.js';
import { ELEVENLABS_VOICES } from '../src/elevenLabsVoices.js';

const mp3 = Buffer.from('ID3unit-audio-container');
const json = body => Response.json(body);
function provider({ failure, models, voiceChange, audio = mp3, type = 'audio/mpeg' } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (failure) return new Response('private-provider-body-secret', { status: failure });
    if (url.endsWith('/models')) return json(models || [{ model_id: DEFAULT_TTS_MODEL, can_do_text_to_speech: true, can_use_style: true, serves_pro_voices: true, maximum_text_length_per_request: 10000 }]);
    if (url.includes('/voices/')) {
      const id = url.split('/').at(-1);
      return json({ voice_id: id, name: `Verified ${id}`, category: 'professional', labels: { gender: 'female', age: 'young', apiKey: 'private-field' }, high_quality_base_model_ids: [DEFAULT_TTS_MODEL], ...voiceChange });
    }
    return new Response(audio, { headers: { 'Content-Type': type } });
  };
  return { calls, fetchImpl };
}

test('TTS accepts only fixed avatar IDs and bounded text/delivery settings', () => {
  assert.equal(validateTtsRequest({ avatarId: 'sky', text: ' Hello ' }).text, 'Hello');
  assert.equal(validateTtsRequest({ avatarId: 'nova', text: 'Hello' }).rate, 0.92);
  assert.equal(validateTtsRequest({ avatarId: 'original', text: 'Aira' }).avatarId, 'default');
  for (const body of [null, [], { avatarId: '__proto__', text: 'x' }, { avatarId: 'unknown', text: 'x' }, { avatarId: 'sky', text: '' }, { avatarId: 'sky', text: 'x'.repeat(MAX_TTS_TEXT + 1) }, { avatarId: 'sky', text: 'x', voiceId: 'arbitrary' }, { avatarId: 'sky', text: 'x', rate: NaN }, { avatarId: 'sky', text: 'x', rate: 1.3 }, { avatarId: 'sky', text: 'x', presetId: 'arbitrary' }]) assert.throws(() => validateTtsRequest(body));
});

test('provider metadata is cached and each character synthesizes its exact allowlisted voice', async () => {
  const p = provider();
  const service = createTtsService({ apiKey: 'server-only-key', fetchImpl: p.fetchImpl });
  const status = await service.status();
  assert.equal(status.modelVerified, true);
  assert.equal(status.outputFormat, 'mp3_44100_128');
  assert.equal(status.avatars.sky.labels.gender, 'female');
  assert.ok(!JSON.stringify(status).includes('private-field'));
  await service.status(); assert.equal(p.calls.length, 4);
  for (const [avatarId, config] of Object.entries(ELEVENLABS_VOICES)) {
    const result = await service.synthesize({ avatarId, text: 'Accurate response, including 42.', rate: 0.9 });
    assert.equal(result.voiceId, config.voiceId);
    assert.deepEqual(result.audio, mp3);
    const call = p.calls.at(-1);
    assert.ok(call.url.includes(`/text-to-speech/${config.voiceId}?output_format=mp3_44100_128`));
    assert.equal(call.options.headers['xi-api-key'], 'server-only-key');
    const body = JSON.parse(call.options.body);
    assert.equal(body.text, 'Accurate response, including 42.');
    assert.equal(body.model_id, DEFAULT_TTS_MODEL);
    assert.equal(body.voice_settings.speed, 0.9);
    assert.ok(!call.url.includes('server-only-key'));
    assert.equal((await service.status()).avatars[avatarId].synthesisVerified, true);
  }
});

test('missing credentials, inaccessible voices, unsupported models and invalid audio fail explicitly', async () => {
  const p = provider();
  const missing = createTtsService({ apiKey: '', fetchImpl: p.fetchImpl });
  assert.equal((await missing.status()).configured, false);
  await assert.rejects(missing.synthesize({ avatarId: 'sky', text: 'Hello' }), /ELEVENLABS_API_KEY/);
  assert.equal(p.calls.length, 0);
  for (const status of [401, 403, 404, 429, 500]) {
    const denied = provider({ failure: status });
    const service = createTtsService({ apiKey: 'private', fetchImpl: denied.fetchImpl });
    const metadata = await service.status();
    assert.equal(metadata.avatars.sky.available, false);
    assert.ok(!JSON.stringify(metadata).includes('private-provider-body'));
    await assert.rejects(service.synthesize({ avatarId: 'sky', text: 'Hello' }), error => status !== 429 || error.status === 429);
  }
  for (const fixture of [provider({ models: [{ model_id: DEFAULT_TTS_MODEL, can_do_text_to_speech: false }] }), provider({ voiceChange: { voice_id: 'someone-else' } }), provider({ voiceChange: { voice_verification: { requires_verification: true, is_verified: false } } })]) {
    const service = createTtsService({ apiKey: 'private', fetchImpl: fixture.fetchImpl });
    await assert.rejects(service.synthesize({ avatarId: 'sky', text: 'Hello' }));
    assert.ok(!fixture.calls.some(call => call.url.includes('text-to-speech')));
  }
  for (const fixture of [provider({ audio: Buffer.alloc(0) }), provider({ audio: Buffer.from('<html>broken</html>') }), provider({ type: 'application/json' })]) await assert.rejects(createTtsService({ apiKey: 'private', fetchImpl: fixture.fetchImpl }).synthesize({ avatarId: 'sky', text: 'Hello' }));
});

test('cancellation prevents synthesis after shared metadata completes', async () => {
  const p = provider();
  const service = createTtsService({ apiKey: 'private', fetchImpl: p.fetchImpl });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(service.synthesize({ avatarId: 'sky', text: 'Hello' }, { signal: abort.signal }), /cancelled/);
  assert.ok(!p.calls.some(call => call.url.includes('text-to-speech')));
});

test('Aira remains pending without an invented voice; configured server identity serves stable ID and original alias', async () => {
  const p = provider();
  const missing = createTtsService({ apiKey: 'private', airaVoiceId: null, fetchImpl: p.fetchImpl });
  const status = await missing.status();
  assert.equal(status.avatars.default.configurationPending, true);
  assert.equal(status.avatars.default.voiceId, null);
  assert.equal(status.avatars.default.provider, 'browser');
  await assert.rejects(missing.synthesize({ avatarId: 'default', text: 'Hello' }), /AIRA_VOICE_ID/);
  const exact = 'TESTAiraIdentity0001';
  const ready = createTtsService({ apiKey: 'private', airaVoiceId: exact, fetchImpl: p.fetchImpl });
  for (const avatarId of ['default', 'original']) {
    const result = await ready.synthesize({ avatarId, text: 'Hello Aira' });
    assert.equal(result.voiceId, exact); assert.match(p.calls.at(-1).url, new RegExp(`/text-to-speech/${exact}`));
  }
  assert.equal((await ready.status()).avatars.default.provider, 'elevenlabs');
  assert.throws(() => createTtsService({ airaVoiceId: '../attacker?key', apiKey: 'private' }), /AIRA_VOICE_ID/);
  assert.equal(p.calls.at(-1).options.redirect, 'error', 'Credentials must not follow provider redirects');
});

test('negative metadata expires quickly so repaired credentials/voice access can recover without repeated billing', async () => {
  let now = 0, blocked = true; const p = provider();
  const service = createTtsService({ apiKey: 'private', airaVoiceId: null, now: () => now, fetchImpl: (url, options) => blocked ? Promise.resolve(new Response('', { status: 403 })) : p.fetchImpl(url, options) });
  assert.equal((await service.status()).avatars.sky.available, false);
  blocked = false; now = 15001;
  assert.equal((await service.status()).avatars.sky.available, true);
  assert.ok(!p.calls.some(call => call.url.includes('text-to-speech')));
});

test('provider permission, billing and quota errors are distinguished without returning private upstream text', async () => {
  const p = provider();
  for (const [status, code, safeStatus, message] of [[401, 'missing_permissions', 503, /Voices Read and Models Read/], [402, 'paid_plan_required', 503, /billing update/], [401, 'quota_exceeded', 429, /quota/]]) {
    const service = createTtsService({ apiKey: 'private', airaVoiceId: null, fetchImpl: (url, options) => url.includes('/text-to-speech/') ? Promise.resolve(Response.json({ detail: { status: code, message: 'secret-client-text-api-key' } }, { status })) : p.fetchImpl(url, options) });
    await assert.rejects(service.synthesize({ avatarId: 'sky', text: 'Hello' }), error => error.status === safeStatus && message.test(error.message) && !error.message.includes('secret-client'));
  }
});

test('TTS-scoped keys synthesize fixed voices despite catalog read restrictions, without inventing metadata', async () => {
  const p = provider(); let now = 0;
  const service = createTtsService({ apiKey: 'private', airaVoiceId: null, now: () => now, fetchImpl: (url, options) => url.includes('/text-to-speech/') ? p.fetchImpl(url, options) : Promise.resolve(Response.json({ detail: { status: 'missing_permissions' } }, { status: 401 })) });
  const before = await service.status();
  assert.equal(before.modelVerified, false); assert.equal(before.avatars.ember.metadataVerified, false);
  assert.equal(before.avatars.ember.name, null);
  const result = await service.synthesize({ avatarId: 'ember', text: 'Hello Zyra' });
  assert.equal(result.voiceId, ELEVENLABS_VOICES.ember.voiceId); assert.deepEqual(result.audio, mp3);
  assert.equal((await service.status()).avatars.ember.synthesisVerified, true);
  now = 15001;
  const after = await service.status(); assert.equal(after.avatars.ember.available, true); assert.equal(after.avatars.ember.name, null);
});

test('real HTTP TTS route returns uncached audio, validates input, blocks hostile origins and limits requests', async () => {
  const p = provider();
  const server = createTranscriptionServer({ apiKey: '', elevenLabsApiKey: 'server-only-key', fetchImpl: p.fetchImpl });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const metadata = await (await fetch(`${base}/api/tts/status`)).json();
    assert.equal(metadata.avatars.sky.voiceId, ELEVENLABS_VOICES.sky.voiceId);
    const response = await post({ avatarId: 'sky', text: 'Hello' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-echo-voice-id'), ELEVENLABS_VOICES.sky.voiceId);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3);
    assert.equal((await post({ avatarId: 'sky', text: 'Hello', voiceId: 'arbitrary' })).status, 400);
    assert.equal((await fetch(`${base}/api/tts`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    for (let i = 0; i < 8; i++) await post({ avatarId: 'nova', text: 'Preview' });
    const limited = await post({ avatarId: 'ember', text: 'Preview' });
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /limit/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
