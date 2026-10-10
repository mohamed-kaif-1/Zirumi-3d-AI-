import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceController, MAX_AUDIO_BYTES } from '../src/voiceController.js';

function fixture({ supported = true, configured = true, getUserMedia, fetchImpl } = {}) {
  const recognitions = [], recorders = [], messages = [], states = [], timers = new Map(), uploads = [];
  const track = { stops: 0, stop() { this.stops++; } };
  const stream = { getTracks: () => [track] };
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.starts = (this.starts || 0) + 1; }
    stop() { this.stops = (this.stops || 0) + 1; }
    abort() { this.aborts = (this.aborts || 0) + 1; }
  }
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
    constructor(stream, { mimeType }) { this.stream = stream; this.mimeType = mimeType; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])]) });
        this.onstop?.();
      });
    }
  }
  let nextTimer = 0;
  const env = {
    webkitSpeechRecognition: supported ? Recognition : undefined,
    MediaRecorder: Recorder, isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn: () => { timers.delete(id); fn(); }, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: fetchImpl || (async (url, options) => {
      if (url.endsWith('/status')) return { ok: true, json: async () => ({ configured }) };
      uploads.push({ url, options });
      return { ok: true, json: async () => ({ transcript: 'Hello from the recording' }) };
    }),
  };
  const controller = createVoiceController({ env, onChange: (s) => states.push(s), onTranscript: (s) => messages.push(s) });
  return { controller, env, recognitions, recorders, messages, states, timers, track, uploads, stream };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const result = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });
test('Tamil recording uses an explicit Sarvam route, a thirty-second limit and releases capture on language change', async () => {
  const f = fixture();
  f.env.fetch = async (url, options) => {
    if (url.includes('/status')) { assert.match(url, /language=ta-IN/); return Response.json({ configured: true, provider: 'Sarvam', mode: 'prerecorded', maxRecordingSeconds: 30 }); }
    assert.equal(options.headers['X-Zirumi-Language'], 'ta-IN'); assert.ok(f.track.stops > 0); f.uploads.push({ url, options }); return Response.json({ transcript: 'வணக்கம்' });
  };
  f.controller.setLanguage('ta-IN'); await f.controller.start(); assert.equal(f.recognitions.length, 0); assert.match(f.controller.getSnapshot().notice, /30 seconds/);
  assert.ok([...f.timers.values()].some(t => t.ms === 30000)); f.controller.stop(); await flush(); assert.deepEqual(f.messages, ['வணக்கம்']);
  await f.controller.start(); f.controller.setLanguage('hi-IN'); await flush(); assert.equal(f.uploads.length, 1); assert.ok(f.track.stops >= 2); assert.equal(f.controller.getSnapshot().status, 'idle'); f.controller.dispose();
});
test('Automatic honors the backend Deepgram route, commits once after releasing capture and allows explicit Browser', async () => {
  const f = fixture();
  f.env.fetch = async (url, options) => {
    if (url.endsWith('/status')) return Response.json({ configured: true, provider: 'Deepgram', model: 'nova-3', prefersServer: true, mode: 'prerecorded' });
    assert.ok(f.track.stops > 0, 'tracks must be released before provider upload');
    f.uploads.push({ url, options }); return Response.json({ transcript: 'Hello Deepgram.' });
  };
  await f.controller.start(); assert.equal(f.recognitions.length, 0); assert.equal(f.controller.getSnapshot().engine, 'server'); assert.match(f.controller.getSnapshot().notice, /Deepgram/);
  f.controller.stop(); f.controller.stop(); await flush(); assert.deepEqual(f.messages, ['Hello Deepgram.']); assert.equal(f.uploads.length, 1);
  await f.controller.start('native'); assert.equal(f.recognitions.length, 1); f.controller.dispose();
});

test('locks before onstart, shows interim, and commits final results once on end', async () => {
  const f = fixture();
  await Promise.all([f.controller.start(), f.controller.start()]);
  assert.equal(f.recognitions.length, 1);
  assert.equal(f.controller.getSnapshot().status, 'starting');
  const r = f.recognitions[0];
  r.onstart(); r.onaudiostart();
  r.onresult({ results: [result('Hello', true), result('world', false)] });
  assert.equal(f.controller.getSnapshot().liveText, 'Hello world');
  r.onresult({ results: [result('Hello', true), result('world', true)] });
  r.onresult({ results: [result('Hello', true), result('world', true)] });
  const lateEnd = r.onend;
  f.controller.stop(); r.onend(); lateEnd();
  assert.deepEqual(f.messages, ['Hello world']);
  assert.equal(f.controller.getSnapshot().status, 'completed');
  assert.equal(f.timers.size, 0);
  f.controller.dispose();
});

test('network failure switches next attempt to real server recording and ignores old callbacks', async () => {
  const f = fixture();
  await f.controller.start();
  const r = f.recognitions[0], lateEnd = r.onend;
  r.onerror({ error: 'network' });
  assert.match(f.controller.getSnapshot().error, /service\/network/);
  assert.match(f.controller.getSnapshot().notice, /repeat your sentence/);
  await f.controller.start(); lateEnd();
  assert.equal(f.controller.getSnapshot().status, 'listening');
  assert.equal(f.controller.getSnapshot().engine, 'server');
  f.controller.stop();
  assert.equal(f.track.stops, 1);
  assert.equal(f.controller.getSnapshot().status, 'processing');
  await flush();
  assert.deepEqual(f.messages, ['Hello from the recording']);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].options.body.type, 'audio/webm;codecs=opus');
  assert.equal(f.timers.size, 0);
});

test('unsupported native API uses recording, not a fake transcript', async () => {
  const f = fixture({ supported: false });
  await f.controller.start();
  assert.equal(f.recorders.length, 1);
  assert.deepEqual(f.messages, []);
  f.controller.stop(); f.controller.stop(); await flush();
  assert.equal(f.uploads.length, 1);
});

test('missing credentials avoids opening microphone and keeps an actionable setup error', async () => {
  const f = fixture({ supported: false, configured: false });
  await f.controller.start();
  assert.match(f.controller.getSnapshot().error, /not configured.*API key/);
  assert.equal(f.recorders.length, 0);
  assert.equal(f.timers.size, 0);
});

test('Stop during permission prompt releases a late stream without recording/upload', async () => {
  let resolve;
  const f = fixture({ supported: false, getUserMedia: () => new Promise((r) => { resolve = r; }) });
  const pending = f.controller.start(); await flush();
  f.controller.stop(); resolve(f.stream); await pending;
  assert.equal(f.track.stops, 1);
  assert.equal(f.recorders.length, 0);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.controller.getSnapshot().status, 'idle');
});

test('permission denial does not retry, and no-speech/aborted/service errors are actionable', async () => {
  for (const error of ['not-allowed', 'audio-capture', 'no-speech', 'aborted', 'service-not-allowed']) {
    const f = fixture(); await f.controller.start();
    f.recognitions[0].onerror({ error });
    assert.equal(f.controller.getSnapshot().status, 'idle');
    assert.ok(f.controller.getSnapshot().error);
    assert.equal(f.recognitions.length, 1);
    assert.equal(f.timers.size, 0);
    if (error === 'not-allowed') assert.equal(f.controller.getSnapshot().permission, 'denied');
  }
  const f = fixture({ supported: false, getUserMedia: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } });
  await f.controller.start();
  assert.equal(f.controller.getSnapshot().permission, 'denied');
  assert.equal(f.uploads.length, 0);
});

test('repeated starts/stops release tracks, dispose discards recording without submission', async () => {
  const f = fixture({ supported: false });
  for (let i = 0; i < 8; i++) { await f.controller.start(); f.controller.stop(); await flush(); }
  assert.equal(f.uploads.length, 8);
  assert.equal(f.track.stops, 8);
  await f.controller.start(); f.controller.dispose(); await flush();
  assert.equal(f.track.stops, 9);
  assert.equal(f.uploads.length, 8);
  assert.equal(f.timers.size, 0);
});

test('cancel during upload aborts the request and prevents a late transcript', async () => {
  let resolve, uploadSignal;
  const f = fixture({ supported: false, fetchImpl: async (url, options) => {
    if (url.endsWith('/status')) return { ok: true, json: async () => ({ configured: true }) };
    uploadSignal = options.signal;
    return new Promise((r) => { resolve = r; });
  } });
  await f.controller.start(); f.controller.stop(); await flush();
  f.controller.cancel();
  assert.equal(uploadSignal.aborted, true);
  resolve({ ok: true, json: async () => ({ transcript: 'Must not appear' }) }); await flush();
  assert.deepEqual(f.messages, []);
  assert.equal(f.track.stops, 1);
});

test('bounded startup, recording and native-stop watchdogs prevent stuck resources', async () => {
  const f = fixture(); await f.controller.start();
  [...f.timers.values()].find((t) => t.ms === 30_000).fn();
  assert.equal(f.recognitions[0].aborts, 1);
  assert.equal(f.controller.getSnapshot().status, 'idle');
  const g = fixture(); await g.controller.start(); g.recognitions[0].onstart(); g.controller.stop();
  [...g.timers.values()].find((t) => t.ms === 1500).fn();
  assert.equal(g.recognitions[0].aborts, 1);
  assert.equal(g.timers.size, 0);
  const h = fixture({ supported: false }); await h.controller.start();
  [...h.timers.values()].find((t) => t.ms === 45_000).fn(); await flush();
  assert.equal(h.track.stops, 1);
  assert.equal(h.uploads.length, 1);
});

test('oversized recording is discarded and microphone released', async () => {
  const f = fixture({ supported: false }); await f.controller.start();
  f.recorders[0].ondataavailable({ data: new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]) }); await flush();
  assert.equal(f.track.stops, 1);
  assert.equal(f.uploads.length, 0);
  assert.match(f.controller.getSnapshot().error, /5 MB/);
});

test('measured silence never uploads or creates a transcript, and a new recording can recover', async () => {
  const f = fixture({ supported: false });
  let energy = 128, nextFrame = 0;
  const frames = new Map();
  f.env.AudioContext = class {
    constructor() { this.state = 'running'; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { getByteTimeDomainData: buffer => buffer.fill(energy) }; }
  };
  f.env.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
  f.env.cancelAnimationFrame = id => frames.delete(id);
  const tick = () => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); };
  await f.controller.start(); tick(); tick(); f.controller.stop(); await flush();
  assert.equal(f.uploads.length, 0); assert.deepEqual(f.messages, []); assert.equal(f.track.stops, 1);
  assert.match(f.controller.getSnapshot().error, /No spoken words/);
  energy = 142;
  await f.controller.start(); tick(); tick(); tick(); f.controller.stop(); await flush();
  assert.equal(f.uploads.length, 1); assert.deepEqual(f.messages, ['Hello from the recording']); assert.equal(f.track.stops, 2);
  f.controller.dispose(); assert.equal(frames.size, 0);
});
