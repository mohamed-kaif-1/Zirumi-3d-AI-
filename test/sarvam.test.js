import test from 'node:test';
import assert from 'node:assert/strict';
import { createSarvamProvider } from '../server/services/sarvam.js';
import { generateReplyDetailed, validateChatRequest } from '../server/chat.js';
import { createTranscriptionServer } from '../server/index.js';
import { LANGUAGES } from '../src/languages.js';

function wav() {
  const b = Buffer.alloc(48); b.write('RIFF'); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(4, 40); return b;
}
const input = (language, avatarId = 'sky') => ({ text: LANGUAGES[language].sample?.[avatarId] || 'Hello!', language, avatarId, rate: 1, presetId: 'sweet' });
test('Sarvam sends native transcription multipart to the official host with an explicit language/model', async () => {
  let sent;
  const provider = createSarvamProvider({ apiKey: 'fixture', fetchImpl: async (url, options) => { sent = { url, ...options }; return Response.json({ transcript: 'வணக்கம்', language_code: 'ta-IN' }); } });
  const result = await provider.transcribe(wav(), 'audio/wav', 'ta-IN');
  assert.equal(sent.url, 'https://api.sarvam.ai/speech-to-text'); assert.equal(sent.headers['api-subscription-key'], 'fixture');
  assert.equal(sent.headers['Content-Type'], undefined); assert.equal(sent.body.get('language_code'), 'ta-IN'); assert.equal(sent.body.get('model'), 'saaras:v4'); assert.equal(sent.body.get('mode'), null);
  assert.equal(sent.body.get('file').size, 48); assert.equal(result.transcript, 'வணக்கம்'); assert.equal(provider.transcriptionStatus('ta-IN').maxRecordingSeconds, 30);
});
test('Sarvam keeps twelve documented speaker assignments distinct and validates actual decoded PCM', async () => {
  const payloads = [];
  const provider = createSarvamProvider({ apiKey: 'fixture', fetchImpl: async (url, options) => { assert.equal(url, 'https://api.sarvam.ai/text-to-speech'); payloads.push(JSON.parse(options.body)); return Response.json({ audios: [wav().toString('base64')] }); } });
  for (const language of ['ta-IN', 'hi-IN', 'en-IN']) {
    assert.equal(provider.status(language).modelVerified, false);
    for (const id of ['default', 'sky', 'nova', 'ember']) { const result = await provider.synthesize(input(language, id)); assert.equal(result.mimeType, 'audio/wav'); assert.equal(result.audio.length, 48); }
    assert.equal(provider.status(language).modelVerified, true); assert.ok(Object.values(provider.status(language).avatars).every(v => v.synthesisVerified));
  }
  assert.equal(new Set(payloads.map(p => p.speaker)).size, 12); assert.ok(payloads.every(p => p.output_audio_codec === 'wav' && !Object.hasOwn(p, 'pitch')));
  assert.ok(payloads.filter(p => p.language_code === 'ta-IN').every(p => p.model === 'bulbul:v3'));
  assert.throws(() => createSarvamProvider({ voices: { 'ta-IN': { sky: 'cartesia-id' } } }), /catalog/);
});
test('Sarvam rejects corrupt audio, unsupported languages and wrong-script output before any fallback', async () => {
  let calls = 0;
  const provider = createSarvamProvider({ apiKey: 'fixture', fetchImpl: async () => { calls++; return Response.json({ audios: ['QUJDRA=='] }); } });
  await assert.rejects(provider.synthesize(input('hi-IN')), /invalid PCM/);
  await assert.rejects(provider.synthesize({ ...input('ta-IN'), text: 'English text' }), /did not answer in Tamil/);
  await assert.rejects(provider.synthesize({ ...input('ta-IN'), text: 'அ'.repeat(2501) }), /2,500/);
  assert.throws(() => provider.status('auto'), /Automatic language detection/); assert.equal(calls, 1);
  assert.equal(provider.status('hi-IN').modelVerified, false);
  const nullResponse = createSarvamProvider({ apiKey: 'fixture', fetchImpl: async () => Response.json(null) });
  await assert.rejects(nullResponse.synthesize(input('hi-IN')), /invalid speech audio/);
  await assert.rejects(nullResponse.transcribe(wav(), 'audio/wav', 'hi-IN'), /invalid or oversized transcript/);
});
test('Sarvam rejects mismatched transcription and safely surfaces credential/quota errors', async () => {
  const wrong = createSarvamProvider({ apiKey: 'fixture', fetchImpl: async () => Response.json({ transcript: 'Hello', language_code: 'en-IN' }) });
  await assert.rejects(wrong.transcribe(wav(), 'audio/wav', 'hi-IN'), /different language/);
  for (const status of [401, 403, 402, 429, 500]) {
    const provider = createSarvamProvider({ apiKey: 'fixture', fetchImpl: async () => Response.json({ private: 'never expose recorded input or keys' }, { status, headers: { 'retry-after': '5' } }) });
    await assert.rejects(provider.synthesize(input('hi-IN')), error => error.providerStatus === status && !error.message.includes('never expose'));
  }
  const empty = createSarvamProvider({ apiKey: 'fixture', fetchImpl: async () => Response.json({ transcript: '', language_code: null }) });
  assert.equal((await empty.transcribe(wav(), 'audio/wav', 'hi-IN')).transcript, '');
});
test('Groq retains server personality and adds native-language instructions while rejecting English substitution', async () => {
  let payload;
  const options = { apiKey: 'fixture', fetchImpl: async (_, req) => { payload = JSON.parse(req.body); return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'நான் லூனா. வணக்கம்!' } }] }); } };
  const request = validateChatRequest({ message: 'உன் பெயர் என்ன?', history: [], avatarId: 'sky', language: 'ta-IN' });
  const result = await generateReplyDetailed(request, options); assert.match(result.reply, /லூனா/);
  assert.match(payload.messages[0].content, /Luna/); assert.ok(payload.messages.some(m => /Tamil/.test(m.content)));
  options.fetchImpl = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'I am Luna.' } }] });
  await assert.rejects(generateReplyDetailed(request, options), /did not answer in Tamil/);
  assert.throws(() => validateChatRequest({ ...request, language: 'constructor' }), /Choose English/);
});
test('HTTP routes Indian-language speech independently of Groq credentials and validate language requests', async () => {
  const calls = [];
  const sarvamProvider = { transcriptionStatus: language => ({ provider: 'Sarvam', language, configured: true }), status: language => ({ provider: 'Sarvam', language }), transcribe: async (_, __, language) => { calls.push(language); return { transcript: 'नमस्ते' }; }, synthesize: async body => { calls.push(body.language); return { audio: wav(), mimeType: 'audio/wav', voiceId: 'ritu_hi_social_lively', model: 'bulbul:v4-flash' }; } };
  const server = createTranscriptionServer({ apiKey: '', sarvamProvider, memoryService: { configured: false }, logger() {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await fetch(base + '/api/tts/status?language=ta-IN'); assert.equal((await status.json()).provider, 'Sarvam');
    const stt = await fetch(base + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Zirumi-Language': 'hi-IN' }, body: wav() }); assert.equal(stt.status, 200);
    const tts = await fetch(base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input('hi-IN')) }); assert.equal(tts.status, 200); assert.equal(tts.headers.get('x-zirumi-tts-provider'), 'Sarvam'); await tts.arrayBuffer();
    assert.deepEqual(calls, ['hi-IN', 'hi-IN']); assert.equal((await fetch(base + '/api/tts/status?language=auto')).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
