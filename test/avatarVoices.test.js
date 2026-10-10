import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_VOICE_PROFILES, defaultVoiceSettings, resolveAvatarVoices, voiceIdentity, loadVoicePreferences, saveVoicePreferences, VOICE_SETTINGS_KEY, sanitizeVoiceSettings } from '../src/avatarVoiceProfiles.js';
import { createSpeechController } from '../src/speechController.js';

const voice = (name, lang = 'en-US') => ({ voiceURI: name, name: `Microsoft ${name}`, lang, localService: true });
const four = [voice('David'), voice('Mark'), voice('Zira'), voice('Hazel', 'en-GB')];
const preferences = () => Object.fromEntries(Object.keys(AVATAR_VOICE_PROFILES).map(id => [id, defaultVoiceSettings(id)]));

function fixture(voices = four) {
  const saved = new Map(), spoken = [], timers = new Map();
  let voicesChanged, timerId = 0;
  const synth = { voices, getVoices() { return this.voices; }, speak(u) { spoken.push(u); }, cancel() { this.cancelCount = (this.cancelCount || 0) + 1; }, resume() {}, addEventListener(_, fn) { voicesChanged = fn; }, removeEventListener() {} };
  const env = { speechSynthesis: synth, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, navigator: { language: 'en-US' }, localStorage: { getItem(key) { return saved.get(key); }, setItem(key, value) { saved.set(key, value); } }, setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  return { env, synth, spoken, timers, saved, voicesChanged: () => voicesChanged() };
}

test('four profiles have the requested defaults and stable distinct assignments independent of ordering', () => {
  assert.deepEqual(Object.values(AVATAR_VOICE_PROFILES).map(p => p.preset), ['best_friend', 'sweet', 'calm', 'playful']);
  const first = resolveAvatarVoices(four, preferences());
  const reordered = resolveAvatarVoices([...four].reverse(), preferences());
  assert.equal(first.distinctCount, 4);
  for (const id of Object.keys(first.resolved)) assert.equal(first.resolved[id].voice.voiceURI, reordered.resolved[id].voice.voiceURI);
  assert.equal(first.resolved.sky.voice.voiceURI, 'Zira');
  assert.equal(first.resolved.nova.voice.voiceURI, 'Hazel');
});

test('scarce voices report shared identities rather than counting pitch variants as voices', () => {
  const result = resolveAvatarVoices(four.slice(0, 3), preferences());
  assert.equal(result.distinctCount, 3);
  assert.equal(result.resolved.sky.voice.voiceURI, 'Zira');
  assert.equal(result.resolved.nova.voice.voiceURI, 'Zira');
  assert.equal(result.resolved.sky.shared, true);
  assert.match(result.resolved.nova.notice, /Shared/);
  const none = resolveAvatarVoices([], preferences());
  assert.equal(none.distinctCount, 0);
  assert.match(none.resolved.default.notice, /browser default/);
});

test('settings serialization is bounded and excludes unknown avatars, credentials and recordings', () => {
  const f = fixture();
  const prefs = preferences();
  prefs.sky = { ...prefs.sky, pitch: 9, volume: -2, apiKey: 'do-not-store', recording: 'do-not-store' };
  prefs.other = { apiKey: 'do-not-store' };
  saveVoicePreferences(f.env.localStorage, prefs);
  const serialized = f.saved.get(VOICE_SETTINGS_KEY);
  assert.ok(!serialized.includes('do-not-store'));
  const read = loadVoicePreferences(f.env.localStorage);
  assert.equal(read.sky.pitch, 1.2);
  assert.equal(read.sky.volume, 0);
  assert.equal(read.other, undefined);
  assert.equal(sanitizeVoiceSettings('nova', { pitch: NaN, rate: Infinity }).rate, 0.92);
});

test('saved base voice uses URI and language and is restored when temporarily unavailable', () => {
  const prefs = preferences();
  prefs.nova.voice = voiceIdentity(four[3]);
  const absent = resolveAvatarVoices(four.slice(0, 3), prefs);
  assert.equal(absent.resolved.nova.unavailable, true);
  assert.equal(prefs.nova.voice.voiceURI, 'Hazel');
  const returned = resolveAvatarVoices([...four].reverse(), prefs);
  assert.equal(returned.resolved.nova.voice.lang, 'en-GB');
  assert.equal(returned.resolved.nova.automatic, false);
});

test('per-avatar custom voice, preset, pitch, rate and volume survive switches and recreation', () => {
  const f = fixture();
  const speaker = createSpeechController({ env: f.env, onChange() {} });
  speaker.setAvatar('sky'); speaker.selectPreset('gentle'); speaker.selectVoice('Hazel'); speaker.setPitch(1.07); speaker.setRate(0.88); speaker.setVolume(0.6);
  speaker.setAvatar('nova'); assert.equal(speaker.getSnapshot().presetId, 'calm');
  speaker.setAvatar('sky');
  assert.equal(speaker.getSnapshot().presetId, 'gentle');
  speaker.preview();
  assert.equal(f.spoken.length, 0, 'A cloud character cannot substitute the saved browser identity');
  assert.equal(speaker.getSnapshot().pitch, 1.07); assert.equal(speaker.getSnapshot().rate, 0.88); assert.equal(speaker.getSnapshot().volume, 0.6);
  assert.match(speaker.getSnapshot().error, /ElevenLabs audio playback is unavailable/);
  speaker.dispose();
  const restored = createSpeechController({ env: f.env, initialAvatarId: 'sky', onChange() {} });
  assert.equal(restored.getSnapshot().presetId, 'gentle');
  assert.equal(restored.getSnapshot().selectedVoice, 'Hazel');
  restored.resetVoice(); assert.equal(restored.getSnapshot().presetId, 'sweet');
  assert.equal(restored.getSnapshot().profiles.nova.presetId, 'calm');
  restored.dispose();
});

test('previews and replies share real start/end/cancel lifecycle and suppress stale callbacks', () => {
  const f = fixture();
  const speaker = createSpeechController({ env: f.env, onChange() {} });
  speaker.preview('default');
  const old = f.spoken[0], lateStart = old.onstart, lateEnd = old.onend, lateBoundary = old.onboundary;
  assert.equal(speaker.getSnapshot().status, 'starting');
  old.onstart(); assert.equal(speaker.getSnapshot().status, 'speaking');
  speaker.setAvatar('default');
  assert.equal(speaker.getSnapshot().status, 'idle');
  assert.equal(old.onboundary, null);
  speaker.speak('A reply.');
  lateStart(); lateEnd(); lateBoundary({ name: 'word' });
  assert.equal(speaker.getSnapshot().status, 'starting');
  assert.equal(f.spoken[1].voice.voiceURI, 'David');
  f.spoken[1].onstart(); f.spoken[1].onend();
  assert.equal(speaker.getSnapshot().status, 'idle');
  assert.equal(f.timers.size, 0);
  speaker.dispose();
});

test('voiceschanged reassigns automatic voices without discarding saved unavailable preferences', () => {
  const f = fixture([]);
  f.saved.set(VOICE_SETTINGS_KEY, JSON.stringify({ version: 1, avatars: { nova: { ...defaultVoiceSettings('nova'), voice: voiceIdentity(four[3]) } } }));
  const speaker = createSpeechController({ env: f.env, initialAvatarId: 'nova', onChange() {} });
  assert.equal(speaker.getSnapshot().selectedVoice, '');
  f.synth.voices = four; f.voicesChanged();
  assert.equal(speaker.getSnapshot().selectedVoice, 'Hazel');
  f.synth.voices = [...four].reverse(); f.voicesChanged();
  assert.equal(speaker.getSnapshot().selectedVoice, 'Hazel');
  speaker.dispose();
});
