import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechLipSyncController, VISEMES } from '../src/animation/SpeechLipSyncController.js';
import { validateAlignment, phonemeToViseme } from '../src/animation/AudioAlignmentService.js';
import { GESTURES, gestureWeight } from '../src/animation/GestureLibrary.js';
import { GestureScheduler, analyzePhrase } from '../src/animation/GestureScheduler.js';
import { POSTURES } from '../src/animation/PostureController.js';
import { FACE_EXPRESSIONS, FacialExpressionController } from '../src/animation/FacialExpressionController.js';
import { VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm';
import { Mesh } from 'three';
import { readCartesiaAlignment } from '../server/services/cartesiaAlignment.js';
import { createAudioSpeechPlayer } from '../src/audioSpeechPlayer.js';
import { AvatarAnimationController } from '../src/AvatarAnimationController.js';

const aligned = { source: 'provider', phonemes: [{ phoneme: 'm', start: 0, end: .1 }, { phoneme: 'ɑ', start: .1, end: .3 }, { phoneme: 'i', start: .4, end: .6 }], words: [{ word: 'Hello', start: 0, end: .6 }] };
const supported = new Set(VISEMES);
test('all 18 gestures have bounded envelopes, ownership and safe interruption rules', () => {
  assert.equal(Object.keys(GESTURES).length, 18); assert.equal(Object.keys(POSTURES).length, 10); assert.equal(Object.keys(FACE_EXPRESSIONS).length, 15);
  for (const g of Object.values(GESTURES)) {
    assert.equal(gestureWeight(g, 0), 0); assert.equal(gestureWeight(g, g.duration), 0);
    assert.ok(g.duration >= 2.5 && g.duration <= 4); assert.ok(g.ownership.length); assert.ok(g.constraints.includes('joint-limits')); assert.match(g.interruption, /IK/);
    for (let t = 0; t < g.duration; t += .01) assert.ok(gestureWeight(g, t) >= 0 && gestureWeight(g, t) <= 1);
  }
});
test('alignment rejects malformed, unordered, overlapping and fabricated source timings', () => {
  assert.equal(validateAlignment({ ...aligned, source: 'estimated' }), null);
  assert.equal(validateAlignment(aligned, .2).phonemes.length, 0);
  for (const start of [NaN, -1, .5]) assert.equal(validateAlignment({ ...aligned, phonemes: [{ phoneme: 'a', start, end: .3 }] }).phonemes.length, 0);
  assert.equal(validateAlignment({ ...aligned, phonemes: [aligned.phonemes[1], aligned.phonemes[0]] }).phonemes.length, 0);
});
test('English, Tamil and Hindi IPA maps only actual phonemes and handles bilabial closure', () => {
  for (const phoneme of ['m', 'b', 'p', 'M', 'B', 'P']) assert.equal(phonemeToViseme(phoneme), 'closed');
  for (const [phoneme, shape] of [['ɑː', 'aa'], ['IY1', 'ih'], ['uː', 'ou'], ['eː', 'ee'], ['oː', 'oh'], ['t̪ʰ', 'consonant']]) assert.equal(phonemeToViseme(phoneme), shape);
  assert.equal(phonemeToViseme('f', { f: 'customF' }), 'customF');
});
test('lip sync follows playback seeks, pauses, resume, silence and stop without accumulating drift', () => {
  const c = new SpeechLipSyncController(); let position = 0, state = 'buffering';
  c.bind({ alignment: aligned, read: () => ({ position, state }) });
  const step = () => { for (let i = 0; i < 8; i++) c.update(1 / 120, .8, true, supported); };
  position = .2; step(); assert.equal(c.weights.aa, 0, 'buffering cannot move the mouth');
  state = 'playing'; step(); assert.ok(c.weights.aa > .7); assert.equal(c.mode, 'PHONEME-ALIGNED');
  state = 'paused'; step(); assert.ok(c.weights.aa < .02);
  state = 'playing'; position = .5; step(); assert.ok(c.weights.ih > .7);
  position = .35; step(); assert.ok(c.weights.ih < .02, 'real phoneme gap is silence');
  for (let repeat = 0; repeat < 200; repeat++) { position = .2; step(); assert.equal(c.phoneme, 'ɑ'); position = .5; step(); assert.equal(c.phoneme, 'i'); }
  position = .05; step(); assert.ok(Object.values(c.weights).every(w => w < .02));
  c.reset(); assert.ok(Object.values(c.weights).every(w => w === 0));
});
test('amplitude fallback closes at the noise floor and never cycles fake vowels', () => {
  const c = new SpeechLipSyncController();
  for (let i = 0; i < 60; i++) c.update(1 / 60, .02, true, supported);
  assert.equal(c.weights.aa, 0);
  for (let i = 0; i < 60; i++) c.update(1 / 60, .8, true, supported);
  assert.ok(c.weights.aa > .7); for (const shape of VISEMES.slice(1)) assert.equal(c.weights[shape], 0);
  for (let i = 0; i < 15; i++) c.update(1 / 60, 0, true, supported);
  assert.ok(c.weights.aa < .001);
});
test('declared custom visemes use available mouth targets and cannot claim emotion bones', () => {
  const c = new SpeechLipSyncController(); c.bind({ alignment: { source: 'provider', phonemes: [{ phoneme: 'f', start: 0, end: .3 }] }, read: () => ({ position: .1, state: 'playing' }) });
  const rig = new Set([...VISEMES, 'customF', 'happy']);
  for (let i = 0; i < 10; i++) c.update(.016, .5, true, rig, { f: 'customF' });
  assert.ok(c.weights.customF > .7); assert.equal(c.weights.aa, 0);
  c.reset(); assert.equal(c.weights.customF, 0);
  c.bind({ alignment: { source: 'provider', phonemes: [{ phoneme: 'f', start: 0, end: .3 }] }, read: () => ({ position: .1, state: 'playing' }) });
  c.update(.016, .5, true, rig, { f: 'happy' }); assert.equal(c.weights.happy, undefined); assert.ok(c.weights.aa > 0);
});
test('semantic scheduling uses documented word clocks, cooldowns, IK exclusion and no immediate repeats', () => {
  const s = new GestureScheduler(() => 0);
  assert.equal(analyzePhrase("I'm sorry that happened."), 'empathetic'); assert.equal(analyzePhrase('There are three main steps.'), 'count');
  assert.equal(analyzePhrase('வணக்கம்!'), 'greeting'); assert.equal(analyzePhrase('नमस्ते!'), 'greeting');
  s.prepare('Hello! There are three steps.', { words: [{ word: 'Hello', start: 0, end: .5 }, { word: 'There', start: 5.4, end: 5.6 }] });
  const first = s.next(0, 'caring'); assert.ok(first); assert.equal(s.next(.3, 'caring'), null);
  assert.equal(s.next(5, 'caring'), null); assert.equal(s.next(5.4, 'caring'), 'COUNT_FINGERS');
  s.prepare('Hello! An explanation.', null); assert.ok(s.next(0, 'composed')); assert.equal(s.next(8, 'composed'), null, 'unaligned later phrases require an observed pause');
  assert.ok(s.next(8, 'composed', 5, ['right'], true, true));
  const a = s.select('explain', 'caring'), b = s.select('explain', 'caring'); assert.notEqual(a, b);
  assert.equal(s.select('explain', 'caring', ['left', 'right']), null);
});
test('speaking emotion masks preserve mouth and blink even with VRM override block', () => {
  const em = new VRMExpressionManager(), mesh = new Mesh(); mesh.morphTargetDictionary = { Fcl_MTH_A: 0, Fcl_BRW_Joy: 1, Fcl_MTH_Joy: 2, Fcl_EYE_Blink: 3 }; mesh.morphTargetInfluences = [0, 0, 0, 0];
  for (const [name, indices] of [['aa', [0]], ['happy', [1, 2]], ['blink', [3]]]) {
    const expr = new VRMExpression(name); for (const index of indices) expr.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index, weight: 1 }));
    if (name === 'happy') expr.overrideMouth = 'block'; em.registerExpression(expr);
  }
  const face = new FacialExpressionController(); face.bind(em);
  em.setValue('aa', .8); em.setValue('blink', .5);
  face.update(em, new Set(['happy']), .5, 'happy', true); em.update();
  assert.equal(mesh.morphTargetInfluences[0], .8); assert.ok(mesh.morphTargetInfluences[1] > .3); assert.equal(mesh.morphTargetInfluences[2], 0); assert.equal(mesh.morphTargetInfluences[3], .5);
});
test('Cartesia SSE reconstructs exact PCM and validates provider phoneme events', async () => {
  const pcm = Buffer.alloc(88200); const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
  const stream = event({ type: 'chunk', data: pcm.subarray(0, 40000).toString('base64') }) + event({ type: 'phoneme_timestamps', phoneme_timestamps: { phonemes: ['m', 'ɑ'], start: [0, .1], end: [.1, .3] } }) + event({ type: 'chunk', data: pcm.subarray(40000).toString('base64') }) + event({ type: 'done' });
  const res = () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  const result = await readCartesiaAlignment(res()); assert.deepEqual(result.audio.subarray(44), pcm); assert.equal(result.alignment.method, 'PHONEME-ALIGNED');
  await assert.rejects(readCartesiaAlignment(new Response(stream.replace(event({ type: 'done' }), ''), { headers: { 'Content-Type': 'text/event-stream' } })), /incomplete/);
});
test('custom Surprised names resolve to existing morphs without assuming a preset', () => {
  const manager = new VRMExpressionManager(), expression = new VRMExpression('Surprised'); manager.registerExpression(expression);
  const face = new FacialExpressionController(); face.bind(manager);
  face.update(manager, new Set(['Surprised']), 1, 'surprised', false);
  assert.ok(manager.getValue('Surprised') > .39); assert.equal(face.names.surprised, 'Surprised');
});
test('a paused audio session retains mouth ownership against idle smiles', () => {
  const em = new VRMExpressionManager(), mesh = new Mesh(); mesh.morphTargetDictionary = { Fcl_MTH_Joy: 0, Fcl_BRW_Joy: 1 }; mesh.morphTargetInfluences = [0, 0];
  const happy = new VRMExpression('happy'); for (const index of [0, 1]) happy.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index, weight: 1 })); em.registerExpression(happy);
  const c = new AvatarAnimationController(); c.vrm = { expressionManager: em }; c.supportedExpressions = new Set(['happy']); c.face.bind(em);
  c.setSpeechPlayback({ read: () => ({ position: .2, state: 'paused' }) }); c.setConversationState('IDLE');
  c.updateExpressions(1); em.update(); assert.equal(mesh.morphTargetInfluences[0], 0); assert.ok(mesh.morphTargetInfluences[1] > .1);
});
test('audio playback publishes a single actual clock, pauses without disposing, and ignores stale callbacks', async () => {
  const audios = [], events = [], revoked = []; let latest;
  class Audio { constructor() { this.currentTime = 0; audios.push(this); } play() { this.onplaying?.(); return Promise.resolve(); } pause() { this.onpause?.(); } removeAttribute() {} load() {} }
  const env = { Audio, fetch: async () => Response.json({ audio: 'UklGRg==', mimeType: 'audio/wav', alignment: aligned }), URL: { createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url) }, setTimeout: () => 1, clearTimeout() {} };
  const c = createAudioSpeechPlayer({ env, onState: value => events.push(value.status), onPlayback: value => { latest = value; }, onAmplitude() {}, onFailure: assert.fail });
  c.play('Hello', { avatarId: 'default', volume: 1, rate: 1, provider: 'cartesia' }); await new Promise(resolve => setImmediate(resolve));
  audios[0].currentTime = .2; assert.equal(latest.read().position, .2); const old = latest;
  c.pause(); assert.equal(latest.read().state, 'paused'); assert.equal(revoked.length, 0); await c.resume(); assert.equal(latest.read().state, 'playing');
  const stale = audios[0].onplaying; c.cancel(); assert.equal(latest, null); stale(); assert.equal(old.read().state, 'stopped'); assert.equal(revoked.length, 1);
});
