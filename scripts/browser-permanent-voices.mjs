// Local browser pipeline verification. Default uses an explicitly synthetic MP3
// fixture, never claimed as ElevenLabs synthesis. --live calls the real backend.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { ELEVENLABS_VOICES } from '../src/elevenLabsVoices.js';

const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const live = process.argv.includes('--live');
// Deliberately synthetic Aira identity only inside fixture tests; never an app default.
const voices = { default: { voiceId: 'TESTAiraIdentity0001', displayName: 'Aira' }, ...ELEVENLABS_VOICES };
const target = process.argv.find(arg => arg.startsWith('--avatar='))?.split('=')[1];
if (target && !Object.hasOwn(voices, target)) throw new Error('Unknown test avatar');
const characters = [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']].filter(([id]) => !target || id === target);
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.ECHO_CHROMIUM_PATH || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], requests = [], results = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('verification/permanent-voices/browser', { recursive: true });
await page.addInitScript(() => {
  window.__audioEvents = []; window.__audioElements = []; window.__rms = [];
  const OriginalAudio = window.Audio;
  window.Audio = function(url) {
    const audio = new OriginalAudio(url); window.__audioElements.push(audio);
    for (const type of ['playing', 'ended', 'pause', 'error']) audio.addEventListener(type, () => window.__audioEvents.push({ event: type, time: audio.currentTime }));
    return audio;
  };
  const analyse = AnalyserNode.prototype.getByteTimeDomainData;
  AnalyserNode.prototype.getByteTimeDomainData = function(buffer) {
    analyse.call(this, buffer); let sum = 0;
    for (const sample of buffer) sum += ((sample - 128) / 128) ** 2;
    window.__rms.push(Math.sqrt(sum / buffer.length));
  };
});
let fixture;
if (!live) {
  const context = {};
  vm.runInNewContext(await readFile(path.join(process.env.TEMP, 'echo-browser-verification/node_modules/lamejs/lame.min.js'), 'utf8'), context);
  const encoder = new context.lamejs.Mp3Encoder(1, 44100, 128);
  const samples = new Int16Array(44100 * 7);
  for (let i = 0; i < samples.length; i++) {
    const t = i / 44100;
    const volume = t > 0.6 && t < 2.2 || t > 3.8 && t < 5.4 ? 0.35 : 0;
    samples[i] = Math.round(Math.sin(t * 2 * Math.PI * 440) * volume * 32767);
  }
  const chunks = [];
  for (let i = 0; i < samples.length; i += 1152) chunks.push(Buffer.from(encoder.encodeBuffer(samples.subarray(i, i + 1152))));
  chunks.push(Buffer.from(encoder.flush())); fixture = Buffer.concat(chunks);
}
if (!live) await page.route('**/api/tts/status', route => route.fulfill({ json: { provider: 'ElevenLabs', configured: true, fallback: 'none', avatars: Object.fromEntries(Object.entries(voices).map(([id, voice]) => [id, { ...voice, name: `Fixture ${voice.displayName}`, available: true, error: '' }])) } }));
await page.route('**/api/tts', async route => {
  const body = route.request().postDataJSON(); requests.push(body);
  if (live) await route.continue();
  else await route.fulfill({ status: 200, headers: { 'Content-Type': 'audio/mpeg', 'X-Echo-Voice-Id': voices[body.avatarId].voiceId }, body: fixture });
});
const select = async name => {
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  const button = page.getByRole('button', { name: `Select ${name} avatar`, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name, { timeout: 90000 });
  await page.getByRole('button', { name: 'Close dialog' }).click();
};
try {
  await page.goto(base);
  await page.getByText(/Avatar ready/).waitFor({ timeout: 60000 });
  const metadata = await (await page.request.get(`${base}/api/tts/status`)).json();
  // request context bypasses page route fixtures: metadata here is always actual backend status.
  if (live) assert.ok(metadata.configured && characters.every(([id]) => metadata.avatars[id]?.voiceId && (metadata.avatars[id].available || metadata.avatars[id].metadataRestricted)), 'Real ElevenLabs credentials and configured target voices are required for --live.');
  if (base.includes('5173')) await page.evaluate(async () => {
    // Observe the existing controller; leave its animation logic intact.
    const actualModule = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/AvatarAnimationController.js'))?.name;
    if (!actualModule) throw new Error('The actual loaded animation module was not found.');
    const { AvatarAnimationController } = await import(actualModule);
    const original = AvatarAnimationController.prototype.updateExpressions;
    window.__mouthSamples = [];
    AvatarAnimationController.prototype.updateExpressions = function(delta, time) {
      original.call(this, delta, time);
      if (this.audioSpeechAmplitude !== null) window.__mouthSamples.push({ avatarId: localStorage.getItem('echo_selected_avatar') || 'default', level: this.audioSpeechAmplitude, mouth: this.vrm?.expressionManager?.getValue('aa') || 0 });
    };
  });
  for (const [id, name] of characters) {
    await select(name);
    const before = await page.evaluate(() => ({ rms: window.__rms.length, events: window.__audioEvents.length, mouth: window.__mouthSamples?.length || 0 }));
    await page.locator('.voice-preview-btn').first().click();
    await page.getByText('Speaking', { exact: true }).waitFor({ timeout: 50000 });
    await page.waitForFunction(n => window.__rms.slice(n).some(value => value > 0.01), before.rms, { timeout: 20000 });
    await page.waitForFunction(n => window.__audioEvents.slice(n).some(event => event.event === 'ended'), before.events, { timeout: 40000 });
    await page.getByText('Ready', { exact: true }).waitFor();
    const measured = await page.evaluate(before => ({ peakRms: Math.max(...window.__rms.slice(before.rms)), silentRmsFrames: window.__rms.slice(before.rms).filter(value => value < 0.001).length, mouthSamples: window.__mouthSamples?.slice(before.mouth) || [], activeAudio: window.__audioElements.filter(a => !a.paused && !a.ended).length }), before);
    assert.equal(measured.activeAudio, 0);
    if (!live) assert.ok(measured.silentRmsFrames > 0);
    if (base.includes('5173')) assert.ok(measured.mouthSamples.length, 'Measure the actual app controller mouth, not a separate model');
    if (measured.mouthSamples.length) {
      assert.ok(measured.mouthSamples.some(sample => sample.mouth > 0.1));
      assert.ok(measured.mouthSamples.some(sample => sample.level === 0 && sample.mouth < 0.02));
    }
    assert.equal(requests.at(-1).avatarId, id);
    assert.ok(!Object.hasOwn(requests.at(-1), 'voiceId'));
    results.push({ avatarId: id, configuredVoiceId: voices[id].voiceId, liveElevenLabs: live, peakRms: measured.peakRms, silentRmsFrames: measured.silentRmsFrames, peakMouth: Math.max(0, ...measured.mouthSamples.map(s => s.mouth)), mouthAnalysisMeasured: measured.mouthSamples.length > 0 });
    await page.screenshot({ path: `verification/permanent-voices/browser/${id}-audio-completed.png` });
    console.log('AUDIO PIPELINE', JSON.stringify(results.at(-1)));
  }
  await page.locator('.voice-preview-btn').first().click();
  await page.getByText('Speaking', { exact: true }).waitFor({ timeout: 50000 });
  await page.getByRole('button', { name: 'Stop Speaking', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__audioElements.filter(a => !a.paused && !a.ended).length), 0);
  await page.locator('.voice-preview-btn').first().click();
  await page.getByText('Speaking', { exact: true }).waitFor({ timeout: 50000 });
  assert.equal(requests.length, characters.length, 'Repeated completed previews reuse audio rather than spend new synthesis quota');
  await select('Mira');
  assert.equal(await page.evaluate(() => window.__audioElements.filter(a => !a.paused && !a.ended).length), 0);
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.avatar-modal').getAnimations().every(animation => animation.playState === 'finished'));
  if (!live) {
    await page.getByRole('button', { name: 'Play Mira voice sample', exact: true }).click();
    await page.waitForFunction(() => window.__audioElements.some(audio => !audio.paused && !audio.ended), null, { timeout: 20000 });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    assert.equal(await page.evaluate(() => window.__audioElements.filter(audio => !audio.paused && !audio.ended).length), 0, 'Closing the selector cancels its preview');
    assert.equal(await page.locator('.message').count(), 0, 'Preview does not enter conversation memory');
    await page.getByRole('button', { name: 'Characters', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.avatar-modal').getAnimations().every(animation => animation.playState === 'finished'));
  }
  await page.screenshot({ path: 'verification/permanent-voices/browser/gallery.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'verification/permanent-voices/browser/mobile-gallery.png' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  await writeFile(`verification/permanent-voices/browser/browser-${base.includes('4173') ? 'production-' : ''}${live ? 'live' : 'fixture'}${target ? `-${target}` : ''}-audio-results.json`, JSON.stringify({ url: base, liveElevenLabs: live, metadata, results, requests, errors }, null, 2));
  console.log(`PASS audio completion, RMS sound/silence, stop, character switch, gallery and mobile. Actual app mouth measured: ${results.every(result => result.mouthAnalysisMeasured)}.`);
} finally {
  await writeFile('verification/permanent-voices/browser/last-audio-diagnostics.json', JSON.stringify(await page.evaluate(() => ({ events: window.__audioEvents, audio: window.__audioElements?.map(a => ({ paused: a.paused, ended: a.ended, currentTime: a.currentTime, duration: a.duration, error: a.error?.message })), rmsPeak: Math.max(0, ...window.__rms), status: document.body.innerText.slice(-1500) })), null, 2)).catch(() => {});
  await page.screenshot({ path: 'verification/permanent-voices/browser/last-browser-state.png' }).catch(() => {});
  await browser.close();
}
