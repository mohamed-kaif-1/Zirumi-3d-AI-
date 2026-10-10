import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MAX_AUDIO_BYTES, validateAudio, transcribeAudio } from '../server/transcription.js';
import { createTranscriptionServer } from '../server/index.js';

const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
const providerResponse = (text = 'Hello Aira') => ({ ok: true, json: async () => ({ text, duration: 2, segments: [{ text, no_speech_prob: 0.01 }] }) });

test('WAV validates RIFF length, PCM format and real sample chunks before multipart upload', async () => {
  const wav = Buffer.alloc(48);
  wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
  assert.equal(validateAudio(wav, 'audio/wav'), 'audio/wav');
  const broken = [];
  const truncated = Buffer.from(wav); truncated.writeUInt32LE(9999, 40); broken.push(truncated);
  const codec = Buffer.from(wav); codec.writeUInt16LE(99, 20); broken.push(codec);
  const empty = Buffer.from(wav); empty.writeUInt32LE(0, 40); broken.push(empty);
  const spoof = Buffer.from(wav); spoof.write('FAKE', 8); broken.push(spoof);
  for (const data of broken) assert.throws(() => validateAudio(data, 'audio/wav'), e => e.status === 415);
  let sent;
  assert.equal(await transcribeAudio(wav, 'audio/wav', { apiKey: 'test', fetchImpl: async (_, options) => { sent = options.body.get('file'); return providerResponse(); } }), 'Hello Aira');
  assert.equal(sent.name, 'recording.wav'); assert.equal(sent.type, 'audio/wav');
  assert.deepEqual(Buffer.from(await sent.arrayBuffer()), wav);
});

test('validates MIME, nonempty size, upload bound, and container magic', () => {
  assert.equal(validateAudio(audio, 'audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(validateAudio(Buffer.from('OggS test'), 'audio/ogg'), 'audio/ogg');
  for (const [data, type, status] of [[audio, 'text/plain', 415], [Buffer.alloc(0), 'audio/webm', 400], [Buffer.alloc(MAX_AUDIO_BYTES + 1), 'audio/webm', 413], [Buffer.from('not audio'), 'audio/webm', 415]]) assert.throws(() => validateAudio(data, type), error => error.status === status);
});

test('Groq transcription sends actual recorded bytes as multipart with file last and server-only bearer auth', async () => {
  for (const [data, type, filename] of [[audio, 'audio/webm;codecs=opus', 'recording.webm'], [Buffer.from('OggS recording'), 'audio/ogg', 'recording.ogg']]) {
    let call;
    const transcript = await transcribeAudio(data, type, { apiKey: 'test-key', language: 'en', fetchImpl: async (url, options) => { call = { url, options }; return providerResponse(); } });
    assert.equal(transcript, 'Hello Aira');
    assert.equal(call.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(call.options.headers.Authorization, 'Bearer test-key');
    assert.equal(call.options.headers['Content-Type'], undefined, 'fetch must generate the multipart boundary');
    const entries = [...call.options.body];
    assert.deepEqual(entries.map(([key]) => key), ['model', 'response_format', 'temperature', 'language', 'file']);
    assert.equal(call.options.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(call.options.body.get('response_format'), 'verbose_json');
    const file = entries.at(-1)[1];
    assert.equal(file.name, filename); assert.equal(file.type, type.split(';')[0]);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), data);
    assert.ok(!entries.some(([key]) => key === 'apiKey'));
  }
});

test('missing credentials, invalid audio and provider failures do not fabricate transcripts or expose upstream bodies', async () => {
  await assert.rejects(transcribeAudio(audio, 'audio/webm'), error => error.status === 503);
  for (const status of [400, 401, 402, 403, 404, 413, 415, 422, 429, 500, 503]) {
    await assert.rejects(transcribeAudio(audio, 'audio/webm', { apiKey: 'secret', fetchImpl: async () => Response.json({ error: { code: 'invalid_request_error', message: 'secret account details' } }, { status }) }), error => !error.message.includes('secret') && error.status === (status === 429 ? 429 : [401, 402, 403].includes(status) ? 503 : [400, 413, 415, 422].includes(status) ? 422 : 502));
  }
  await assert.rejects(transcribeAudio(audio, 'audio/webm', { apiKey: 'test', fetchImpl: async () => { throw new Error('offline secret'); } }), error => error.status === 502 && !error.message.includes('secret'));
  await assert.rejects(transcribeAudio(audio, 'audio/webm', { apiKey: 'test', signal: AbortSignal.abort(), fetchImpl: async () => { assert.fail('Cancelled work cannot run'); } }), error => error.status === 504);
});

test('empty and high-confidence no-speech responses stay empty; unknown responses are not silence', async () => {
  assert.equal(await transcribeAudio(audio, 'audio/webm', { apiKey: 'test', fetchImpl: async () => providerResponse('') }), '');
  assert.equal(await transcribeAudio(audio, 'audio/webm', { apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ text: 'Invented words in silence', segments: [{ no_speech_prob: 0.99 }] }) }) }), '');
  for (const data of [{ unknown: [] }, { text: null }, { text: 'x'.repeat(20_001) }]) await assert.rejects(transcribeAudio(audio, 'audio/webm', { apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => data }) }), error => error.status === 502);
});

async function runningServer(options, fn) {
  const innerFetch = options.fetchImpl;
  const server = createTranscriptionServer({ ...options, logger() {}, fetchImpl: (url, init) => url.endsWith('/models') ? Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'whisper-large-v3-turbo', active: true }] }) }) : innerFetch(url, init) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('real HTTP endpoint transcribes validated uploads and rejects hostile origin/MIME/empty/oversize', async () => {
  let calls = 0;
  await runningServer({ apiKey: 'test-key', fetchImpl: async () => { calls++; return providerResponse(); } }, async base => {
    const config = await (await fetch(`${base}/api/transcription/status`)).json();
    assert.equal(config.configured, true); assert.equal(config.provider, 'Groq');
    const send = (body, headers = {}) => fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus', ...headers }, body });
    const success = await send(audio); assert.equal(success.status, 200);
    const result = await success.json(); assert.equal(result.transcript, 'Hello Aira'); assert.equal(result.metadata.provider, 'Groq'); assert.equal(result.metadata.durationSeconds, 2);
    assert.equal((await send(audio, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await send(audio, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await send(Buffer.alloc(0))).status, 400);
    assert.equal((await send(Buffer.alloc(MAX_AUDIO_BYTES + 1))).status, 413);
    assert.equal((await send(Buffer.from('spoofed'))).status, 415);
    assert.equal(calls, 1);
  });
});

test('backend without Groq credentials reports setup and never falls back to another provider', async () => {
  await runningServer({ apiKey: '', fetchImpl: async () => { assert.fail('Provider must not run'); } }, async base => {
    const config = await (await fetch(`${base}/api/transcription/status`)).json();
    assert.equal(config.configured, false); assert.ok(!JSON.stringify(config).includes('apiKey'));
    const response = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: audio });
    assert.equal(response.status, 503); assert.match((await response.json()).error, /GROQ_API_KEY/);
  });
});
