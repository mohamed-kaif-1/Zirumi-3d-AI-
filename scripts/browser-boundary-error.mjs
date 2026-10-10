// Deliberately unavailable TTS fixture. No real synthesis or LLM calls.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { boundaryPhrase } from '../src/boundaryBehavior.js';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const language = process.argv[2] || 'ta-IN';
assert.ok(['en', 'ta-IN', 'hi-IN', 'en-IN'].includes(language), 'Unsupported verification locale');
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const result = { language, mockedTtsFailureOnly: true, requests: 0, errors: [], passed: false };
page.on('pageerror', e => result.errors.push(e.message));
await page.addInitScript(locale => { localStorage.setItem('zirumi_conversation_language', locale); localStorage.setItem('echo_selected_avatar', 'default'); window.__browserSpeechCalls = 0; speechSynthesis.speak = () => window.__browserSpeechCalls++; }, language);
await page.route('**/api/tts', route => { result.requests++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test-only unavailable configured voice.' }) }); });
try {
  await page.goto('http://127.0.0.1:5173'); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await page.evaluate(async () => {
    const entry = performance.getEntriesByType('resource').find(e => e.name.includes('/src/AvatarAnimationController.js'));
    const { AvatarAnimationController } = await import(entry.name), update = AvatarAnimationController.prototype.update;
    window.__costs = []; window.__gaps = []; window.__yaw = [];
    AvatarAnimationController.prototype.update = function(delta, time) { const start = performance.now(); update.call(this, delta, time); window.__controller = this; window.__costs.push(performance.now() - start); window.__gaps.push(delta * 1000); if (this.boundary) window.__yaw.push(this.currentHeadRot.yaw); };
  });
  await page.waitForFunction(() => window.__controller?.collision);
  await page.getByRole('button', { name: 'Character interaction', exact: true }).click();
  async function click(region) {
    result.clicking = region;
    const target = await page.evaluate(async region => {
      const entry = performance.getEntriesByType('resource').find(e => e.name.includes('/node_modules/.vite/deps/@react-three_fiber.js'));
      const { _roots } = await import(entry.name), canvas = document.querySelector('.avatar-canvas canvas'), { camera } = _roots.get(canvas).store.getState(), box = canvas.getBoundingClientRect(), c = window.__controller;
      c.collision.update(); const collider = c.collision.colliders.find(x => x.name === region), p = collider.start.clone().lerp(collider.end, .5); p.z += collider.radius * .9; p.project(camera);
      return { x: box.x + (p.x + 1) * box.width / 2, y: box.y + (1 - p.y) * box.height / 2 };
    }, region);
    await page.mouse.click(target.x, target.y);
  }
  await click('leftShoulder'); assert.equal(result.requests, 0, 'shoulder click must not refuse'); await click('head'); assert.equal(result.requests, 0, 'head click must not refuse'); result.safeShoulderAndHead = true;
  const start = Date.now(); await click('chestBoundary');
  await page.locator('.boundary-notice').filter({ hasText: boundaryPhrase(language) }).waitFor();
  result.refusalTextMs = Date.now() - start;
  await page.getByText('Test-only unavailable configured voice.', { exact: true }).waitFor();
  await page.waitForFunction(() => window.__controller.boundary === null, null, { timeout: 30000 });
  assert.equal(result.requests, 1); assert.equal(await page.evaluate(() => window.__browserSpeechCalls), 0);
  result.recoveryMs = Date.now() - start; result.refusalRetained = await page.locator('.boundary-notice').isVisible();
  result.performance = await page.evaluate(() => { const stats = a => ({ mean: a.reduce((s, x) => s + x, 0) / a.length, p95: a.toSorted((a, b) => a - b)[Math.floor(a.length * .95)] }); return { animationMs: stats(window.__costs), softwareRenderedFrameGapMs: stats(window.__gaps), positiveHeadShake: Math.max(...window.__yaw), negativeHeadShake: Math.min(...window.__yaw), note: 'SwiftShader software rendering; not a laptop hardware FPS guarantee.' }; });
  assert.deepEqual(result.errors, []); result.passed = true; console.log(`PASS deliberate ${language} refusal, safe shoulder/head, unavailable-voice error, no browser voice fallback and complete animation recovery.`);
} catch (e) { result.failure = e.message; process.exitCode = 1; console.error(e.message); }
finally {
  await page.screenshot({ path: `verification/avatar-motion/error-recovery-${language}.png` }).catch(() => {});
  await writeFile(`verification/avatar-motion/error-recovery-${language}.json`, JSON.stringify(result, null, 2));
  await writeFile('verification/avatar-motion/error-recovery.json', JSON.stringify(result, null, 2));
  await browser.close();
}
