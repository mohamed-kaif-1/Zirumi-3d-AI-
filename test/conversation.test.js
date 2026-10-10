import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationController, recentHistory } from '../src/conversationController.js';
import { createSpeechController } from '../src/speechController.js';
import { mouthOpenForState } from '../src/avatarAnimation.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const ok = (body) => ({ ok: true, json: async () => body });
test('connection checks recover after timeout with a fresh signal', async () => {
  const f = browserFixture();
  const fetch = f.env.fetch; let checks = 0;
  f.env.fetch = (url, options) => {
    if (url !== '/api/chat/status') return fetch(url, options);
    checks++;
    assert.equal(options.signal.aborted, false);
    if (checks === 1) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
    return Promise.resolve(ok({ configured: true, model: 'openai/gpt-oss-20b' }));
  };
  const echo = createConversationController({ env: f.env, onChange() {} });
  const first = echo.checkConnection();
  [...f.timers.values()].find(timer => timer.ms === 8000).run();
  await first; assert.equal(echo.getSnapshot().connection, 'offline');
  await echo.checkConnection(); assert.equal(echo.getSnapshot().connection, 'configured');
  echo.dispose();
});
test('retry reuses the original failed turn, locks concurrent retries, clears errors and preserves context', async () => {
  let fail = false, resolve;
  const f = browserFixture(() => fail ? Promise.resolve({ ok: false, json: async () => ({ error: 'Grok rate limit reached.' }) }) : resolve ? new Promise(done => { resolve = done; }) : Promise.resolve(ok({ reply: 'Hello Cedar.' })));
  const echo = createConversationController({ env: f.env, onChange() {} });
  echo.setVoiceEnabled(false);
  await echo.submit('My name is Cedar.');
  fail = true; await echo.submit('How was your day?');
  const original = echo.getSnapshot().messages.at(-1);
  assert.equal(original.status, 'failed'); assert.equal(echo.getSnapshot().messages.length, 3);
  fail = false; resolve = true;
  const retry = echo.retry();
  assert.equal(await echo.retry(), false); assert.equal(await echo.submit('Duplicate'), false);
  assert.equal(echo.getSnapshot().messages.length, 3); assert.equal(echo.getSnapshot().messages.at(-1).id, original.id);
  const body = JSON.parse(f.requests.filter(r => r.url === '/api/chat').at(-1).options.body);
  assert.equal(body.message, 'How was your day?'); assert.equal(body.history.length, 2);
  resolve(ok({ reply: 'A pleasant day, Cedar.' })); assert.equal(await retry, true);
  assert.equal(echo.getSnapshot().error, ''); assert.equal(echo.getSnapshot().messages.length, 4);
  assert.equal(recentHistory(echo.getSnapshot().messages).length, 4);
  assert.equal(await echo.retry(), false);
  echo.dispose();
});
function browserFixture(fetchImpl) {
  const timers = new Map(), utterances = [], recognitions = [], recorders = [], requests = [];
  let timerId = 0, voiceListener;
  const track = { stops: 0, stop() { this.stops++; } };
  const synth = {
    voices: [{ voiceURI: 'en', name: 'English', lang: 'en-IN', default: true }, { voiceURI: 'ta', name: 'Tamil', lang: 'ta-IN' }],
    getVoices() { return this.voices; },
    speak(utterance) { utterances.push(utterance); }, cancel() { this.cancels = (this.cancels || 0) + 1; }, resume() {},
    addEventListener(_, fn) { voiceListener = fn; }, removeEventListener() { voiceListener = null; },
  };
  class Recognition {
    constructor() { recognitions.push(this); }
    start() {} stop() {} abort() {}
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(_, { mimeType }) { this.mimeType = mimeType; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }); }
  }
  const env = {
    SpeechRecognition: Recognition, MediaRecorder: Recorder, isSecureContext: true,
    navigator: { language: 'en-IN', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } },
    speechSynthesis: synth, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { ms, run() { timers.delete(id); fn(); } }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/status')) return ok({ configured: true, model: 'test-model' });
      if (url === '/api/transcribe') return ok({ transcript: 'Hello from my microphone' });
      return fetchImpl ? fetchImpl(url, options) : ok({ reply: 'Hello, I am ECHO.' });
    },
  };
  return { env, synth, timers, utterances, recognitions, recorders, requests, track, voicesChanged: () => voiceListener?.() };
}

test('speech uses voice selection, actual start/end events, and cancels prior utterances', () => {
  const f = browserFixture();
  const speaker = createSpeechController({ env: f.env, onChange() {} });
  speaker.selectVoice('ta'); speaker.speak('Hello');
  const old = f.utterances[0], lateStart = old.onstart;
  assert.equal(old.voice.lang, 'ta-IN');
  assert.equal(speaker.getSnapshot().status, 'starting');
  old.onstart(); assert.equal(speaker.getSnapshot().status, 'speaking');
  speaker.speak('Second'); lateStart();
  assert.equal(speaker.getSnapshot().status, 'starting');
  assert.equal(old.onend, null);
  f.utterances[1].onstart(); f.utterances[1].onend();
  assert.equal(speaker.getSnapshot().status, 'idle');
  assert.equal(f.timers.size, 0);
  speaker.dispose();
});

test('autoplay errors offer manual playback; voice toggle prevents automatic speech', () => {
  const f = browserFixture();
  const speaker = createSpeechController({ env: f.env, onChange() {} });
  speaker.speak('Reply'); f.utterances[0].onerror({ error: 'not-allowed' });
  assert.match(speaker.getSnapshot().error, /Play reply/);
  speaker.setEnabled(false); speaker.speak('Should not play');
  assert.equal(f.utterances.length, 1);
  speaker.speak('Manual reply', { manual: true });
  assert.equal(f.utterances.length, 2);
  speaker.cancel(); assert.equal(f.timers.size, 0);
  speaker.dispose();
});

test('unavailable synthesis, late-installed voices and silent startup failure are visible', () => {
  const f = browserFixture();
  f.synth.voices = [];
  const speaker = createSpeechController({ env: f.env, onChange() {} });
  speaker.speak('Reply');
  [...f.timers.values()].find((timer) => timer.ms === 8000).run();
  assert.match(speaker.getSnapshot().error, /did not start/);
  f.synth.voices = [{ voiceURI: 'new', name: 'New', lang: 'en-IN' }]; f.voicesChanged();
  assert.equal(speaker.getSnapshot().voices[0].id, 'new');
  speaker.dispose();
  const unsupported = createSpeechController({ env: {}, onChange() {} });
  assert.equal(unsupported.speak('Reply'), false);
  assert.match(unsupported.getSnapshot().error, /unavailable/);
  unsupported.dispose();
});

test('typed conversation transitions THINKING to actual SPEAKING to IDLE; microphone locked during playback', async () => {
  const f = browserFixture(); const states = [];
  const echo = createConversationController({ env: f.env, onChange: (s) => states.push(s.state) });
  const pending = echo.submit('Hello');
  assert.equal(echo.getSnapshot().state, 'THINKING');
  assert.equal(echo.startListening(), false);
  await pending;
  assert.deepEqual(echo.getSnapshot().messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(echo.startListening(), false); // Utterance is queued, not yet audible.
  f.utterances[0].onstart(); assert.equal(echo.getSnapshot().state, 'SPEAKING');
  assert.equal(echo.startListening(), false);
  f.utterances[0].onend(); assert.equal(echo.getSnapshot().state, 'IDLE');
  assert.equal(f.recognitions.length, 0); // No automatic microphone restart.
  assert.ok(states.includes('THINKING') && states.includes('SPEAKING'));
  echo.dispose(); assert.equal(f.timers.size, 0);
});

test('switching avatars during speech cancels safely, preserves history and uses the next identity', async () => {
  const f = browserFixture();
  f.synth.voices.push({ voiceURI: 'zira', name: 'Microsoft Zira', lang: 'en-US' }, { voiceURI: 'mark', name: 'Microsoft Mark', lang: 'en-US' });
  const echo = createConversationController({ env: f.env, onChange() {} });
  await echo.submit('My name is Aster.');
  const old = f.utterances[0], lateEnd = old.onend;
  old.onstart(); assert.equal(echo.getSnapshot().state, 'SPEAKING');
  const messages = echo.getSnapshot().messages;
  echo.beginAvatarSwitch();
  assert.equal(echo.getSnapshot().state, 'IDLE');
  echo.finishAvatarSwitch('sky');
  lateEnd();
  assert.deepEqual(echo.getSnapshot().messages, messages);
  await echo.submit('What is my name?');
  const requests = f.requests.filter(request => request.url === '/api/chat');
  const input = JSON.parse(requests[1].options.body);
  assert.equal(input.avatarId, 'sky');
  assert.equal(input.history[0].content, 'My name is Aster.');
  assert.equal(f.utterances.length, 1, 'Cloud speech cannot silently become a browser utterance');
  assert.match(echo.getSnapshot().speech.error, /ElevenLabs audio playback is unavailable/);
  echo.dispose();
});

test('switching during a pending reply retains it in chat without replaying it in another avatar voice', async () => {
  let finish;
  const f = browserFixture(() => new Promise(resolve => { finish = resolve; }));
  const echo = createConversationController({ env: f.env, onChange() {} });
  const pending = echo.submit('A question.');
  echo.beginAvatarSwitch(); echo.finishAvatarSwitch('nova');
  finish(ok({ reply: 'An answer.' })); await pending;
  assert.equal(echo.getSnapshot().messages.length, 2);
  assert.equal(echo.getSnapshot().messages[1].avatarId, 'default', 'Aira remains the author after a pending reply completes in Mira’s view');
  assert.equal(f.utterances.length, 0);
  echo.dispose();
});

test('preview playback follows actual events, never overlaps, and voice edits leave microphone capture intact', async () => {
  const f = browserFixture();
  const echo = createConversationController({ env: f.env, onChange() {} });
  echo.previewVoice();
  assert.equal(echo.getSnapshot().state, 'IDLE');
  f.utterances[0].onstart(); assert.equal(echo.getSnapshot().state, 'SPEAKING');
  assert.equal(echo.startListening(), false);
  echo.stopSpeaking();
  assert.equal(echo.getSnapshot().state, 'IDLE');
  echo.startListening(); await flush(); f.recognitions[0].onstart();
  assert.equal(echo.getSnapshot().voice.status, 'listening');
  echo.selectPreset('calm'); echo.setPitch(1.02); echo.selectVoice('ta');
  assert.equal(echo.getSnapshot().voice.status, 'listening');
  assert.equal(echo.previewVoice(), false);
  echo.dispose();
});

test('in-flight duplicate submits are rejected before adding a second message', async () => {
  let resolve;
  const f = browserFixture(() => new Promise((r) => { resolve = r; }));
  const echo = createConversationController({ env: f.env, onChange() {} });
  const first = echo.submit('Hello');
  assert.equal(await echo.submit('Hello'), false);
  assert.equal(echo.getSnapshot().messages.length, 1);
  resolve(ok({ reply: 'Hi' })); await first;
  assert.equal(f.requests.filter((r) => r.url === '/api/chat').length, 1);
  echo.dispose();
});

test('memory preserves roles/order and sends only six recent completed pairs', async () => {
  const f = browserFixture();
  const echo = createConversationController({ env: f.env, onChange() {} });
  echo.setVoiceEnabled(false);
  for (let i = 0; i < 8; i++) await echo.submit(`Message ${i}`);
  const last = JSON.parse(f.requests.filter((r) => r.url === '/api/chat').at(-1).options.body);
  assert.equal(last.history.length, 12);
  assert.deepEqual(last.history.map((m) => m.role), Array.from({ length: 12 }, (_, i) => i % 2 ? 'assistant' : 'user'));
  assert.equal(last.history[0].content, 'Message 1');
  assert.equal(last.message, 'Message 7');
  echo.dispose();
});

test('failed turns stay visible, are excluded from memory, and a later request recovers', async () => {
  let fail = true;
  const f = browserFixture(() => fail ? { ok: false, json: async () => ({ error: 'Provider unavailable' }) } : ok({ reply: 'Recovered' }));
  const echo = createConversationController({ env: f.env, onChange() {} });
  echo.setVoiceEnabled(false);
  await echo.submit('First'); assert.equal(echo.getSnapshot().state, 'ERROR');
  assert.equal(echo.getSnapshot().messages[0].status, 'failed');
  assert.equal(f.utterances.length, 0);
  fail = false; await echo.submit('Second');
  assert.equal(echo.getSnapshot().state, 'IDLE');
  assert.deepEqual(JSON.parse(f.requests.at(-1).options.body).history, []);
  echo.dispose();
});

test('cancellation aborts requests and late responses cannot overwrite newer state or speak', async () => {
  const pending = [];
  const f = browserFixture((_, options) => new Promise((resolve) => pending.push({ resolve, signal: options.signal })));
  const echo = createConversationController({ env: f.env, onChange() {} });
  const first = echo.submit('Old'); echo.cancelRequest();
  assert.equal(pending[0].signal.aborted, true);
  const second = echo.submit('New');
  pending[0].resolve(ok({ reply: 'Stale reply' })); await first;
  assert.equal(echo.getSnapshot().state, 'THINKING');
  assert.equal(f.utterances.length, 0);
  pending[1].resolve(ok({ reply: 'Current reply' })); await second;
  assert.equal(echo.getSnapshot().messages.at(-1).text, 'Current reply');
  assert.equal(f.utterances.length, 1);
  echo.dispose();
});

test('Clear cancels recording, AI request and speech; preserves settings and clears memory', async () => {
  const f = browserFixture();
  const echo = createConversationController({ env: f.env, onChange() {} });
  await echo.submit('Hello'); const lateStart = f.utterances[0].onstart;
  echo.clear(); lateStart();
  assert.equal(echo.getSnapshot().state, 'IDLE');
  assert.deepEqual(echo.getSnapshot().messages, []);
  assert.equal(echo.startListening('server'), true); await flush();
  echo.clear(); await flush();
  assert.equal(f.track.stops, 1);
  assert.deepEqual(echo.getSnapshot().messages, []);
  assert.equal(f.requests.filter((r) => r.url === '/api/transcribe').length, 0);
  echo.dispose(); assert.equal(f.timers.size, 0);
});

test('Clear during thinking prevents a late answer and resets history', async () => {
  let resolve;
  const f = browserFixture(() => new Promise((r) => { resolve = r; }));
  const echo = createConversationController({ env: f.env, onChange() {} });
  const pending = echo.submit('Hello'); echo.clear();
  resolve(ok({ reply: 'Stale' })); await pending;
  assert.equal(echo.getSnapshot().messages.length, 0);
  assert.equal(f.utterances.length, 0);
  echo.dispose();
});

test('native interim results never reach AI, final session submits once', async () => {
  const f = browserFixture();
  const echo = createConversationController({ env: f.env, onChange() {} });
  echo.startListening(); await flush(); const r = f.recognitions[0]; r.onstart();
  r.onresult({ results: [Object.assign([{ transcript: 'Hello' }], { isFinal: false })] });
  assert.equal(f.requests.filter((r) => r.url === '/api/chat').length, 0);
  r.onresult({ results: [Object.assign([{ transcript: 'Hello' }], { isFinal: true })] });
  const lateEnd = r.onend; r.onend(); lateEnd(); await flush();
  assert.equal(f.requests.filter((r) => r.url === '/api/chat').length, 1);
  assert.equal(echo.getSnapshot().messages.length, 2);
  echo.dispose();
});

test('recorded transcript takes the same AI pipeline after tracks stop', async () => {
  const f = browserFixture();
  const echo = createConversationController({ env: f.env, onChange() {} });
  echo.startListening('server'); await flush();
  assert.equal(echo.getSnapshot().state, 'LISTENING');
  assert.equal(await echo.submit('Cannot interrupt recording'), false);
  echo.stopListening(); assert.equal(echo.getSnapshot().state, 'TRANSCRIBING');
  assert.equal(f.track.stops, 1); await flush();
  assert.equal(echo.getSnapshot().messages[0].text, 'Hello from my microphone');
  assert.deepEqual(f.requests.filter((r) => !r.url.endsWith('/status')).map((r) => r.url), ['/api/transcribe', '/api/chat']);
  assert.equal(f.utterances.length, 1);
  echo.dispose();
});

test('typed interruption stops speech; timeout and disposal cannot produce late playback', async () => {
  const f = browserFixture();
  const echo = createConversationController({ env: f.env, onChange() {} });
  await echo.submit('One'); f.utterances[0].onstart();
  const staleEnd = f.utterances[0].onend;
  const second = echo.submit('Two'); staleEnd(); await second;
  assert.equal(f.utterances[0].onend, null);
  echo.dispose(); assert.equal(f.timers.size, 0);
  let resolve;
  const g = browserFixture(() => new Promise((r) => { resolve = r; }));
  const slow = createConversationController({ env: g.env, onChange() {} });
  const pending = slow.submit('Slow'); [...g.timers.values()].find((t) => t.ms === 50_000).run();
  assert.equal(slow.getSnapshot().state, 'ERROR');
  resolve(ok({ reply: 'Late' })); await pending;
  assert.equal(g.utterances.length, 0); slow.dispose();
});

test('empty input never creates a turn; memory excludes cancelled turns and animation follows state', async () => {
  const f = browserFixture(); const echo = createConversationController({ env: f.env, onChange() {} });
  await echo.submit(' '); assert.equal(echo.getSnapshot().messages.length, 0);
  assert.deepEqual(recentHistory([{ role: 'user', text: 'Cancelled', status: 'cancelled' }]), []);
  assert.equal(mouthOpenForState('IDLE', 1), 0);
  assert.equal(mouthOpenForState('THINKING', 1), 0);
  assert.ok(mouthOpenForState('SPEAKING', 1) > 0);
  echo.dispose();
});
