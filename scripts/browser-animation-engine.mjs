import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const output = 'verification/animation-engine-2'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: output + '/recordings', size: { width: 1440, height: 1000 } } });
const page = await context.newPage();
const result = { errors: [], avatars: [], speech: [], renderer: 'Chromium SwiftShader, software rendering', passed: false };
page.on('pageerror', e => result.errors.push(e.message));
// Replay exact fixed provider audio; browser tests do not spend synthesis quota.
await page.route('**/api/tts', async route => {
  const lang = route.request().postDataJSON().language || 'en';
  const metadata = JSON.parse(await readFile(`${output}/reference-${lang}.json`, 'utf8'));
  const audio = await readFile(`${output}/reference-${lang}.wav`);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...metadata, mimeType: 'audio/wav', audio: audio.toString('base64') }) });
});
try {
  await page.goto('http://127.0.0.1:5173/?animationDebug=1'); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await page.evaluate(async () => {
    const resource = performance.getEntriesByType('resource').find(e => e.name.includes('/src/AvatarAnimationController.js'));
    const { AvatarAnimationController } = await import(resource.name), update = AvatarAnimationController.prototype.update;
    window.__engineFrames = [];
    AvatarAnimationController.prototype.update = function(delta, time) {
      update.call(this, delta, time); window.__animationEngine = this;
      const playback = this.lipSync.playback?.read();
      if (playback?.state === 'playing') window.__engineFrames.push({ position: playback.position, phoneme: this.lipSync.phoneme, viseme: this.lipSync.viseme, weights: { ...this.lipSync.weights }, delta });
    };
  });
  await page.waitForFunction(() => window.__animationEngine?.vrm);
  for (const [id, name] of [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    const audit = await page.evaluate(async ({ id, url }) => (await import('/scripts/animation-engine-probe.js')).verifyEngine(id, url), { id, url: id === 'default' ? '/AvatarSample_W.vrm' : `/models/${id}.vrm` });
    result.avatars.push({ id, name, ...audit });
    assert.equal(audit.gestures.length, 18); assert.ok(audit.gestures.every(g => g.completed && g.motion > .005));
    assert.equal(audit.postures.length, 10); assert.ok(audit.postures.every(p => p.selected)); assert.equal(audit.faces.length, 15);
    assert.equal(audit.fixedTranslations, true); assert.ok(audit.footDrift < .0001); assert.ok(audit.penetration < .003, name + ' penetration ' + audit.penetration); assert.equal(audit.ikPriority, true); assert.equal(audit.boundaryPriority, true); assert.equal(audit.mouthClosed, true);
    if (id !== 'default') {
      const previousRig = await page.evaluate(() => window.__animationEngine.vrm.scene.uuid);
      await page.getByRole('button', { name: 'Characters', exact: true }).click(); await page.getByRole('button', { name: `Select ${name} avatar`, exact: true }).click();
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.waitForFunction(uuid => window.__animationEngine?.vrm?.scene.uuid !== uuid, previousRig, { timeout: 90000 });
      await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
    }
    await page.getByLabel('Preview gesture', { exact: true }).selectOption('FRIENDLY_WAVE');
    await page.waitForFunction(() => window.__animationEngine?.gestureBlend > .85);
    await page.screenshot({ path: `${output}/${id}-wave.png` });
    await page.getByRole('button', { name: 'Reset to neutral' }).click();
    console.log('PASS ' + name + ': 18 gestures, 10 postures, 15 expressions, IK/boundary priority and grounded feet.');
  }
  await page.getByRole('button', { name: 'Play lip-sync test sentence' }).click();
  await page.waitForFunction(() => window.__animationEngine?.lipSync.playback?.read().state === 'playing', { timeout: 15000 });
  await page.screenshot({ path: output + '/speaking.png' });
  await page.getByRole('button', { name: 'Pause test speech', exact: true }).click();
  await page.waitForFunction(() => window.__animationEngine.lipSync.playback?.read().state === 'paused');
  const pausedAt = await page.evaluate(() => window.__animationEngine.lipSync.playback.read().position);
  await page.waitForFunction(() => Object.values(window.__animationEngine.lipSync.weights).every(w => w < .01));
  assert.equal(await page.evaluate(() => window.__animationEngine.lipSync.playback.read().position), pausedAt);
  await page.getByRole('button', { name: 'Resume test speech', exact: true }).click();
  await page.waitForFunction(() => window.__engineFrames.length > 5 && !window.__animationEngine.lipSync.playback, { timeout: 30000 });
  result.speech = await page.evaluate(() => window.__engineFrames);
  const metadata = JSON.parse(await readFile(output + '/reference-en.json', 'utf8'));
  // Measure the software controller against provider timestamps, without claiming
  // human acoustic ground truth or hardware display/audio output latency.
  const errors = [];
  for (const item of metadata.alignment?.phonemes || []) {
    if (item.end - item.start < .08) continue;
    const frames = result.speech.filter(f => f.position >= item.start && f.position <= item.end);
    const first = frames.find(f => f.phoneme === item.phoneme);
    if (first) errors.push(Math.max(0, first.position - item.start) * 1000);
  }
  result.clockTiming = { measuredIntervals: errors.length, meanMs: errors.length ? errors.reduce((a, b) => a + b) / errors.length : null, maxMs: errors.length ? Math.max(...errors) : null, limitation: 'Provider alignment vs controller clock; acoustic correctness and audiovisual output latency unmeasured.' };
  result.pauseResume = true;
  result.languagePlayback = [];
  for (const language of ['ta-IN', 'hi-IN']) {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.locator('#conversation-language').selectOption(language); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.evaluate(() => { window.__engineFrames = []; });
    await page.getByRole('button', { name: 'Play lip-sync test sentence' }).click();
    await page.waitForFunction(() => window.__engineFrames.length > 5 && !window.__animationEngine.lipSync.playback, null, { timeout: 30000 });
    const measurement = await page.evaluate(() => ({ mode: window.__animationEngine.lipSync.mode, frames: window.__engineFrames.length, maxMouth: Math.max(...window.__engineFrames.map(f => f.weights.aa)), closed: Object.values(window.__animationEngine.lipSync.weights).every(w => w < .01) }));
    assert.ok(measurement.maxMouth > .1); result.languagePlayback.push({ language, ...measurement });
    await page.screenshot({ path: `${output}/${language}-after-speech.png` });
  }
  assert.ok(result.speech.some(f => f.viseme === 'ih' || f.viseme === 'oh')); assert.deepEqual(result.errors, []); result.passed = true;
} catch (error) { result.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally {
  await writeFile(output + '/browser-results.json', JSON.stringify(result, null, 2)); await context.close(); await browser.close();
}
