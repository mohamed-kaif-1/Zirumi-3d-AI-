// Synthetic provider responses; real Chromium WAV decoding, WebAudio and VRM animation.
// This verifies integration behavior, never Cartesia synthesis or voice quality.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const characters = [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']];
const voices = Object.fromEntries(characters.map(([id, name], i) => [id, { provider: 'cartesia', displayName: name, name: `Synthetic ${name} fixture`, voiceId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, available: true, metadataVerified: true }]));
const rate = 44100, samples = rate * 3, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) { const t = i / rate, volume = t > 0.3 && t < 1.2 || t > 1.8 && t < 2.6 ? 0.3 : 0; wav.writeInt16LE(Math.round(Math.sin(t * Math.PI * 880) * volume * 32767), 44 + i * 2); }
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const result = { liveCartesia: false, syntheticAudio: true, voiceDistinctnessAudiblyVerified: false, errors: [], previews: [], requests: [], passed: false };
page.on('pageerror', error => result.errors.push(error.message));
await mkdir('verification/phase1', { recursive: true });
await page.addInitScript(() => {
  window.__audio = []; window.__levels = []; window.__ended = 0;
  const OriginalAudio = window.Audio;
  window.Audio = function(url) { const audio = new OriginalAudio(url); audio.addEventListener('ended', () => window.__ended++); window.__audio.push(audio); return audio; };
  const analyse = AnalyserNode.prototype.getByteTimeDomainData;
  AnalyserNode.prototype.getByteTimeDomainData = function(buffer) { analyse.call(this, buffer); window.__levels.push(Math.sqrt(buffer.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / buffer.length)); };
});
await page.route('**/api/tts/status', route => route.fulfill({ json: { provider: 'Cartesia', model: 'sonic-3.6', configured: true, fallback: 'none', avatars: voices } }));
let pending;
await page.route('**/api/tts', async route => { const body = route.request().postDataJSON(); result.requests.push(body); if (pending) await pending; await route.fulfill({ contentType: 'audio/wav', headers: { 'X-Echo-Voice-Id': voices[body.avatarId].voiceId }, body: wav }).catch(() => {}); });
async function select(name) {
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  const button = page.getByRole('button', { name: `Select ${name} avatar`, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name, { timeout: 60000 });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
}
try {
  await page.goto(base); await page.getByText(/Avatar ready/).waitFor({ timeout: 60000 });
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/AvatarAnimationController.js'))?.name;
    const { AvatarAnimationController } = await import(url), update = AvatarAnimationController.prototype.updateExpressions;
    window.__mouth = [];
    AvatarAnimationController.prototype.updateExpressions = function(delta, time) { update.call(this, delta, time); if (this.audioSpeechAmplitude !== null) window.__mouth.push({ level: this.audioSpeechAmplitude, mouth: this.vrm?.expressionManager?.getValue('aa') || 0 }); };
  });
  for (const [id, name] of characters) {
    await select(name);
    const before = await page.evaluate(() => ({ audio: window.__audio.length, ended: window.__ended, mouth: window.__mouth.length, levels: window.__levels.length }));
    await page.getByRole('button', { name: `Preview ${name} voice`, exact: true }).click();
    await page.getByText('Speaking', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Start speaking', exact: true }).isDisabled(), true);
    await page.waitForFunction(n => window.__ended > n, before.ended);
    await page.getByText('Ready', { exact: true }).waitFor();
    const measurement = await page.evaluate(before => ({ peakRms: Math.max(...window.__levels.slice(before.levels)), peakMouth: Math.max(...window.__mouth.slice(before.mouth).map(m => m.mouth)), closedInSilence: window.__mouth.slice(before.mouth).some(m => m.level === 0 && m.mouth < 0.02) }), before);
    assert.ok(measurement.peakRms > 0.01); assert.ok(measurement.peakMouth > 0.1); assert.ok(measurement.closedInSilence); assert.equal(result.requests.at(-1).avatarId, id); assert.equal(result.requests.at(-1).voiceId, undefined);
    result.previews.push({ avatarId: id, ...measurement });
  }
  assert.equal(await page.locator('.message').count(), 0);
  const count = result.requests.length;
  await page.getByRole('button', { name: 'Preview Zyra voice', exact: true }).click(); await page.getByText('Speaking', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop Speaking', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__audio.filter(a => !a.paused && !a.ended).length), 0); assert.equal(result.requests.length, count, 'repeated previews use the bounded memory cache');
  let release; pending = new Promise(resolve => { release = resolve; });
  await select('Mira'); await page.getByRole('button', { name: 'Voice settings', exact: true }).click(); await page.getByLabel('Mira speaking rate', { exact: true }).press('ArrowLeft'); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const before = await page.evaluate(() => window.__audio.length);
  await page.getByRole('button', { name: 'Preview Mira voice', exact: true }).click();
  await page.getByRole('button', { name: 'Stop Speaking', exact: true }).click(); release(); pending = null;
  await page.waitForTimeout(300); assert.equal(await page.evaluate(() => window.__audio.length), before);
  result.stopCancelsPending = true; result.previewCacheVerified = true;
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'verification/phase1/cartesia-fixture-mobile.png' });
  assert.deepEqual(result.errors, []); result.passed = true;
  console.log('PASS simulated Cartesia WAV for all four actual VRMs, RMS mouth, silence, Stop, pending cancellation and preview cache.');
} catch (error) { result.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally { await writeFile('verification/phase1/browser-cartesia-fixture-results.json', JSON.stringify(result, null, 2)); await browser.close(); }
