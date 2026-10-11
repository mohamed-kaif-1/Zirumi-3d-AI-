import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const output = 'verification/animation-engine-2'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
const result = { errors: [], faceCapabilities: [], repeats: [], passed: false };
const speechOnly = process.argv.includes('--speech-only');
page.on('pageerror', error => result.errors.push(error.message));
const metadata = JSON.parse(await readFile(output + '/reference-en.json', 'utf8')), audio = await readFile(output + '/reference-en.wav');
await page.route('**/api/tts', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...metadata, mimeType: 'audio/wav', audio: audio.toString('base64') }) }));
await page.addInitScript(() => {
  window.__contexts = 0; window.__urls = 0;
  const Context = window.AudioContext;
  window.AudioContext = class extends Context { constructor(...args) { super(...args); window.__contexts++; } close() { return super.close().finally(() => { window.__contexts--; }); } };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { window.__urls++; return create(blob); }; URL.revokeObjectURL = url => { window.__urls--; return revoke(url); };
});
try {
  await page.goto('http://127.0.0.1:5173/?animationDebug=1'); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await page.evaluate(async () => {
    const resource = performance.getEntriesByType('resource').find(e => e.name.includes('/src/AvatarAnimationController.js'));
    const { AvatarAnimationController } = await import(resource.name), update = AvatarAnimationController.prototype.update;
    window.__samples = []; window.__speechSessions = 0;
    AvatarAnimationController.prototype.update = function(delta, time) {
      update.call(this, delta, time); window.__engine = this;
      if (this.lipSync.playback?.read().state === 'playing') window.__samples.push({ delta, seconds: this.lipSync.playback.read().position, aa: this.lipSync.weights.aa });
    };
  });
  await page.waitForFunction(() => window.__engine?.vrm);
  for (const [id, name] of speechOnly ? [] : [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    if (id !== 'default') {
      const uuid = await page.evaluate(() => window.__engine.vrm.scene.uuid);
      await page.getByRole('button', { name: 'Characters', exact: true }).click(); await page.getByRole('button', { name: `Select ${name} avatar`, exact: true }).click(); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.waitForFunction(previous => window.__engine?.vrm && window.__engine.vrm.scene.uuid !== previous, uuid, { timeout: 90000 });
    }
    await page.getByLabel('Preview expression', { exact: true }).selectOption('surprised');
    await page.waitForFunction(() => { const c = window.__engine; return c.vrm.expressionManager.getValue(c.face.names.surprised || 'surprised') > .2; });
    result.faceCapabilities.push(await page.evaluate(() => ({ expression: window.__engine.face.names.surprised, value: window.__engine.vrm.expressionManager.getValue(window.__engine.face.names.surprised), hasMouthMask: Boolean(window.__engine.face.masked.surprised) })));
    await page.getByRole('button', { name: 'Reset to neutral' }).click();
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const metrics = await cdp.send('Performance.getMetrics'); return metrics.metrics.find(m => m.name === 'JSHeapUsedSize').value / 1024 / 1024; };
  result.heapBeforeMB = await heap();
  for (let i = 0; i < (speechOnly ? 1 : 3); i++) {
    await page.evaluate(() => { window.__samples = []; });
    await page.getByRole('button', { name: 'Play lip-sync test sentence' }).click();
    await page.waitForFunction(() => window.__samples.length > 4 && !window.__engine.lipSync.playback, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__contexts === 0 && window.__urls === 0);
    const sample = await page.evaluate(() => ({ frames: window.__samples.length, fps: window.__samples.length / window.__samples.reduce((sum, s) => sum + s.delta, 0), closed: Object.values(window.__engine.lipSync.weights).every(w => w < .01), contexts: window.__contexts, urls: window.__urls }));
    assert.equal(sample.closed, true); result.repeats.push({ ...sample, heapMB: await heap() });
  }
  // Changing character in the middle of real HTMLAudio playback must release
  // the old voice session before the newly loaded rig takes over.
  await page.getByRole('button', { name: 'Play lip-sync test sentence' }).click();
  await page.waitForFunction(() => window.__engine.lipSync.playback?.read().state === 'playing');
  await page.getByRole('button', { name: 'Characters', exact: true }).click(); await page.getByRole('button', { name: `Select ${speechOnly ? 'Luna' : 'Aira'} avatar`, exact: true }).click(); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.waitForFunction(() => window.__contexts === 0 && window.__urls === 0 && !window.__engine.lipSync.playback);
  result.switchCleanup = true;
  assert.deepEqual(result.errors, []); result.passed = true;
  console.log(speechOnly ? 'PASS current audio-clock gestures and real character-switch cleanup.' : 'PASS actual custom expressions on four VRMs; three repeated speech sessions release audio contexts/URLs; character switching cancels speech.');
} catch (error) { result.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally { await writeFile(output + (speechOnly ? '/latest-playback-results.json' : '/lifecycle-results.json'), JSON.stringify(result, null, 2)); await browser.close(); }
