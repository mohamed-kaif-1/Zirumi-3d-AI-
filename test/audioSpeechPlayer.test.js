import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioSpeechPlayer } from '../src/audioSpeechPlayer.js';
import { createSpeechController } from '../src/speechController.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
test('language changes discard stale voice metadata and cached previews never cross languages', async () => {
  const f = fixture(); let release;
  f.env.fetch = async (url, options) => {
    if (url === '/api/tts/status') return new Promise(resolve => { release = resolve; });
    if (url.includes('/status?')) return Response.json({ provider: 'Sarvam', model: 'bulbul:v3', fallback: 'none', avatars: { sky: { name: 'ritu', voiceId: 'ritu' } } });
    f.requests.push({ url, options }); return new Response('fixture', { headers: { 'content-type': 'audio/wav' } });
  };
  const speaker = createSpeechController({ env: f.env, initialAvatarId: 'sky', onChange() {} });
  const old = speaker.checkTts(); speaker.setLanguage('ta-IN'); await speaker.checkTts();
  release(Response.json({ provider: 'Cartesia', avatars: { sky: { voiceId: 'old-English' } } })); await old;
  assert.equal(speaker.getSnapshot().profiles.sky.provider, 'sarvam'); assert.equal(speaker.getSnapshot().profiles.sky.providerVoiceId, 'ritu');
  speaker.preview(); await flush(); assert.equal(JSON.parse(f.requests[0].options.body).language, 'ta-IN'); assert.match(JSON.parse(f.requests[0].options.body).text, /வணக்கம்/);
  speaker.setLanguage('hi-IN'); await speaker.checkTts(); speaker.preview(); await flush();
  assert.equal(f.requests.length, 2); assert.equal(JSON.parse(f.requests[1].options.body).language, 'hi-IN'); speaker.dispose();
});
test('Cartesia WAV uses the same actual playback/RMS owner and previews never substitute browser voices', async () => {
  const f = fixture(), spoken = [];
  f.env.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(u) { spoken.push(u); } };
  f.env.SpeechSynthesisUtterance = class {};
  f.env.fetch = async (url, options) => {
    if (url.endsWith('/status')) return Response.json({ provider: 'Cartesia', model: 'sonic-3.6', fallback: 'none', avatars: { default: { provider: 'cartesia', voiceId: null, error: 'Assign a voice' }, sky: { provider: 'cartesia', voiceId: 'synthetic-catalog-id', name: 'Catalog fixture' } } });
    f.requests.push({ url, options });
    return new Response('RIFF-test-fixture-validated-by-backend', { headers: { 'content-type': 'audio/wav' } });
  };
  const speaker = createSpeechController({ env: f.env, initialAvatarId: 'sky', onChange() {} });
  await speaker.checkTts(); speaker.preview(); await flush();
  assert.equal(speaker.getSnapshot().profiles.sky.provider, 'cartesia'); assert.equal(speaker.getSnapshot().playbackEngine, 'cartesia'); assert.equal(spoken.length, 0);
  const body = JSON.parse(f.requests[0].options.body); assert.equal(body.avatarId, 'sky'); assert.equal(body.voiceId, undefined); assert.equal(body.provider, undefined);
  f.audio[0].onplaying(); assert.equal(speaker.getSnapshot().status, 'speaking'); assert.equal(speaker.getSnapshot().profiles.sky.metadata.synthesisVerified, true);
  speaker.cancel(); assert.equal(f.audio[0].paused, true);
  speaker.setAvatar('default'); f.env.fetch = async url => url.endsWith('/status') ? Response.json({ provider: 'Cartesia', avatars: {} }) : Response.json({ error: 'Assign a Cartesia voice.' }, { status: 503 });
  speaker.preview(); await flush(); assert.equal(spoken.length, 0); assert.equal(speaker.getSnapshot().status, 'error'); assert.match(speaker.getSnapshot().error, /Assign/);
  speaker.dispose();
});
function fixture() {
  const audio = [], timers = new Map(), frames = new Map(), revoked = [], states = [], levels = [], errors = [], requests = [];
  let timer = 0, frame = 0, sample = 128;
  const env = {
    Audio: class { constructor(url) { this.url = url; audio.push(this); } play() { return Promise.resolve(); } pause() { this.paused = true; } removeAttribute() {} load() {} },
    AudioContext: class { constructor() { this.destination = {}; } createAnalyser() { return { fftSize: 512, connect() {}, disconnect() {}, getByteTimeDomainData(buffer) { buffer.fill(sample); } }; } createMediaElementSource() { return { connect() {}, disconnect() {} }; } resume() { return Promise.resolve(); } close() { this.closed = true; return Promise.resolve(); } },
    URL: { createObjectURL: () => 'blob:ephemeral', revokeObjectURL(url) { revoked.push(url); } },
    fetch: async (url, options) => { requests.push({ url, options }); return new Response('ID3unit', { headers: { 'Content-Type': 'audio/mpeg' } }); },
    setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.set(++frame, fn); return frame; }, cancelAnimationFrame(id) { frames.delete(id); },
  };
  const player = createAudioSpeechPlayer({ env, onState: value => states.push(value), onAmplitude: value => levels.push(value), onFailure: value => errors.push(value) });
  return { env, player, audio, timers, frames, revoked, states, levels, errors, requests, setSample(value) { sample = value; }, tick() { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); } };
}

test('MP3 animation starts on actual playing, follows RMS sound/silence and cleans up on end', async () => {
  const f = fixture();
  f.player.play('Hello.', { avatarId: 'sky', rate: 0.96, presetId: 'sweet', volume: 0.6 });
  await flush();
  assert.equal(f.states.at(-1).status, 'starting');
  assert.equal(f.audio[0].volume, 0.6);
  f.audio[0].onplaying(); assert.equal(f.states.at(-1).status, 'speaking'); assert.equal(f.levels.at(-1), 0);
  f.setSample(160); f.tick(); assert.ok(f.levels.at(-1) > 0.5);
  f.setSample(128); f.tick(); assert.equal(f.levels.at(-1), 0);
  f.audio[0].ended = true;
  f.audio[0].onpause();
  assert.equal(f.revoked.length, 0, 'natural pause must not unload audio before ended');
  f.audio[0].onended();
  assert.equal(f.states.at(-1).status, 'idle');
  assert.deepEqual(f.revoked, ['blob:ephemeral']); assert.equal(f.timers.size, 0); assert.equal(f.frames.size, 0);
});

test('cancelling a pending request and stale audio callbacks cannot start or resume playback', async () => {
  const f = fixture(); let release;
  f.env.fetch = (_, options) => { f.requests.push({ options }); return new Promise(resolve => { release = resolve; }); };
  f.player.play('Old reply', { avatarId: 'sky', rate: 1, presetId: 'sweet', volume: 1 });
  f.player.cancel(); assert.equal(f.requests[0].options.signal.aborted, true);
  release(new Response('ID3test', { headers: { 'Content-Type': 'audio/mpeg' } })); await flush();
  assert.equal(f.audio.length, 0);
  f.env.fetch = async () => new Response('ID3test', { headers: { 'Content-Type': 'audio/mpeg' } });
  f.player.play('New reply', { avatarId: 'nova', rate: 1, presetId: 'calm', volume: 1 }); await flush();
  const late = f.audio[0].onplaying;
  f.audio[0].onplaying(); f.player.cancel(); late();
  assert.equal(f.audio[0].paused, true); assert.equal(f.timers.size, 0); assert.equal(f.frames.size, 0);
});

test('provider and autoplay failures are visible and never reported as completed speech', async () => {
  const f = fixture(); f.env.fetch = async () => Response.json({ error: 'Quota reached.' }, { status: 429 });
  f.player.play('Hello', { avatarId: 'sky', rate: 1, presetId: 'sweet', volume: 1 }); await flush();
  assert.match(f.errors[0], /Quota/); assert.equal(f.audio.length, 0); assert.ok(!f.states.some(state => state.status === 'speaking'));
  f.env.fetch = async () => new Response('ID3test', { headers: { 'Content-Type': 'audio/mpeg' } });
  f.env.Audio.prototype.play = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  f.player.play('Hello', { avatarId: 'sky', rate: 1, presetId: 'sweet', volume: 1 }); await flush();
  assert.match(f.errors.at(-1), /blocked/); assert.equal(f.timers.size, 0);
});

test('hybrid owner uses fixed ElevenLabs routing and only a visibly configured browser fallback', async () => {
  const f = fixture(), utterances = [];
  f.env.navigator = { language: 'en-US' };
  f.env.speechSynthesis = { getVoices: () => [{ voiceURI: 'zira', name: 'Microsoft Zira', lang: 'en-US' }], addEventListener() {}, removeEventListener() {}, cancel() {}, resume() {}, speak(u) { utterances.push(u); } };
  f.env.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  f.env.fetch = async (url, options) => {
    if (url.endsWith('/status')) return Response.json({ provider: 'ElevenLabs', configured: false, fallback: 'browser', avatars: {} });
    f.requests.push({ url, options }); return Response.json({ error: 'ElevenLabs key is missing.' }, { status: 503 });
  };
  const speaker = createSpeechController({ env: f.env, initialAvatarId: 'sky', onChange() {} });
  await speaker.checkTts(); speaker.preview(); await flush();
  assert.equal(utterances.length, 0, 'An ElevenLabs preview must never substitute browser speech');
  assert.equal(speaker.getSnapshot().status, 'error');
  speaker.speak('Reply'); await flush();
  assert.equal(JSON.parse(f.requests[0].options.body).avatarId, 'sky');
  assert.ok(!Object.hasOwn(JSON.parse(f.requests[0].options.body), 'voiceId'));
  assert.equal(utterances[0].voice.voiceURI, 'zira');
  assert.match(speaker.getSnapshot().notice, /configured browser fallback/);
  speaker.dispose();
});

test('only previews are cached, delivery and avatar identities separate caches, and waiting stops analysis', async () => {
  const f = fixture();
  const options = { avatarId: 'sky', rate: 1, presetId: 'sweet', volume: 1, preview: true };
  f.player.play('Sample', options); await flush(); f.audio[0].onplaying();
  f.audio[0].onwaiting(); assert.equal(f.frames.size, 0); assert.equal(f.levels.at(-1), 0);
  f.player.cancel(); f.player.play('Sample', options); await flush();
  assert.equal(f.requests.length, 1, 'Repeated ready sample uses in-memory audio');
  assert.equal(f.audio[0].paused, true);
  f.player.play('Sample', { ...options, avatarId: 'nova' }); await flush();
  f.player.play('Sample', { ...options, rate: 0.9 }); await flush();
  f.player.play('Sample', { ...options, preview: false }); await flush();
  assert.equal(f.requests.length, 4, 'Another avatar, speed or reply requires new synthesis');
  f.player.dispose(); f.player.play('Sample', options); await flush();
  assert.equal(f.requests.length, 5, 'Disposal releases cached samples'); f.player.cancel();
});

test('Aira resolves server identity before first playback and cancelled metadata cannot replay late speech', async () => {
  const f = fixture(); let release;
  f.env.fetch = (url, options) => {
    if (url.endsWith('/status')) return new Promise(resolve => { release = resolve; });
    f.requests.push({ url, options }); return Promise.resolve(new Response('ID3test', { headers: { 'Content-Type': 'audio/mpeg' } }));
  };
  const speaker = createSpeechController({ env: f.env, onChange() {} });
  speaker.preview(); speaker.cancel();
  release(Response.json({ provider: 'ElevenLabs', fallback: 'none', avatars: { default: { voiceId: 'TESTAiraIdentity0001', name: 'Configured Aira', available: true } } })); await flush();
  assert.equal(f.requests.length, 0, 'Cancelled first preview cannot start synthesis later');
  speaker.preview(); await flush();
  assert.equal(JSON.parse(f.requests[0].options.body).avatarId, 'default');
  assert.equal(speaker.getSnapshot().profiles.default.provider, 'elevenlabs');
  assert.equal(speaker.getSnapshot().playbackVoice.name, 'Configured Aira'); speaker.dispose();
});

test('switching all four server-configured voices cancels pending old requests and never accepts client voice IDs', async () => {
  const f = fixture(), pending = [];
  f.env.fetch = (url, options) => {
    if (url.endsWith('/status')) return Promise.resolve(Response.json({ provider: 'ElevenLabs', fallback: 'none', avatars: { default: { voiceId: 'TESTAiraIdentity0001', name: 'Aira', available: true } } }));
    f.requests.push({ url, options }); return new Promise(resolve => pending.push(resolve));
  };
  const speaker = createSpeechController({ env: f.env, onChange() {} }); await speaker.checkTts();
  for (const id of ['default', 'sky', 'nova', 'ember']) { speaker.setAvatar(id); speaker.speak('A reply'); }
  assert.deepEqual(f.requests.map(r => JSON.parse(r.options.body).avatarId), ['default', 'sky', 'nova', 'ember']);
  assert.ok(f.requests.slice(0, 3).every(r => r.options.signal.aborted));
  assert.ok(f.requests.every(r => !Object.hasOwn(JSON.parse(r.options.body), 'voiceId')));
  for (const resolve of pending) resolve(new Response('ID3test', { headers: { 'Content-Type': 'audio/mpeg' } })); await flush();
  assert.equal(f.audio.length, 1, 'Only latest character may play'); speaker.cancel(); assert.equal(f.audio[0].paused, true); speaker.dispose();
});
