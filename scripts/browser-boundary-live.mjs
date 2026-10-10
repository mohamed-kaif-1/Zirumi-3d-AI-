// Actual UI clicks, real provider audio; only the final failure case is mocked.
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { boundaryPhrase } from '../src/boundaryBehavior.js';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const output = 'verification/avatar-motion'; await mkdir(output, { recursive: true });
const result = { date: new Date().toISOString(), errors: [], requests: [], reactions: [], normalProviderResponsesMocked: false, passed: false };
page.on('pageerror', e => result.errors.push(e.message));
page.on('request', r => { if (r.method() === 'POST' && /\/api\/(tts|chat|transcribe|memory)/.test(r.url())) result.requests.push({ endpoint: r.url().split('/').at(-1), ...r.postDataJSON() }); });
await page.addInitScript(() => {
  localStorage.setItem('zirumi_conversation_language', 'en'); localStorage.setItem('echo_selected_avatar', 'default');
  window.__audioEnded = 0; window.__levels = []; window.__head = []; window.__mouth = []; window.__frameCosts = []; window.__frameGaps = [];
  const Audio = window.Audio; window.Audio = function(url) { const a = new Audio(url); a.addEventListener('ended', () => window.__audioEnded++); return a; };
  const measure = AnalyserNode.prototype.getByteTimeDomainData;
  AnalyserNode.prototype.getByteTimeDomainData = function(buffer) { measure.call(this, buffer); window.__levels.push(Math.sqrt(buffer.reduce((s, n) => s + ((n - 128) / 128) ** 2, 0) / buffer.length)); };
});
async function point(region) {
  return page.evaluate(async region => {
    const fiber = performance.getEntriesByType('resource').find(e => e.name.includes('/node_modules/.vite/deps/@react-three_fiber.js'));
    const { _roots } = await import(fiber.name);
    const canvas = document.querySelector('.avatar-canvas canvas'), { camera } = _roots.get(canvas).store.getState(), box = canvas.getBoundingClientRect(), c = window.__controller;
    const collider = c.collision.colliders.find(p => p.name === region);
    c.collision.update(); const p = collider.start.clone().lerp(collider.end, .5); p.z += collider.radius * .65;
    p.project(camera);
    const { raycaster } = _roots.get(canvas).store.getState();
    const { Vector2 } = await import('/node_modules/.vite/deps/three.js');
    c.vrm.scene.traverse(o => { if (o.isSkinnedMesh) { o.computeBoundingBox(); o.computeBoundingSphere(); } });
    raycaster.setFromCamera(new Vector2(p.x, p.y), camera); const hit = raycaster.intersectObject(c.vrm.scene, true)[0];
    return { x: box.x + (p.x + 1) * box.width / 2, y: box.y + (1 - p.y) * box.height / 2, hit: hit ? { name: hit.object.name, point: hit.point.toArray(), region: c.collision.classifySurface(hit.point), distances: c.collision.colliders.map(collider => ({ name: collider.name, center: collider.start.toArray(), radius: collider.radius, distance: c.collision.distance(hit.point, collider) })) } : null };
  }, region);
}
async function clickPrivate() { const p = await point('chestBoundary'); result.lastPointerDiagnostic = p; await page.mouse.click(p.x, p.y); }
async function language(locale) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Conversation Language', exact: true }).selectOption(locale);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.waitForFunction(() => window.__controller?.boundary === null);
}
async function select(id, name) {
  const start = Date.now(); await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: `Select ${name} avatar`, exact: true }).click();
  await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name, { timeout: 90000 });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.waitForFunction(() => window.__controller?.vrm && window.__controller?.collision);
  await page.waitForTimeout(500); return { id, switchMs: Date.now() - start };
}
try {
  await page.goto('http://127.0.0.1:5173'); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await page.evaluate(async () => {
    const entry = performance.getEntriesByType('resource').find(e => e.name.includes('/src/AvatarAnimationController.js'));
    const { AvatarAnimationController } = await import(entry.name); const update = AvatarAnimationController.prototype.update;
    AvatarAnimationController.prototype.update = function(delta, time) {
      const start = performance.now(); update.call(this, delta, time); window.__controller = this;
      window.__frameCosts.push(performance.now() - start); window.__frameGaps.push(delta * 1000);
      if (window.__frameCosts.length > 1200) { window.__frameCosts.shift(); window.__frameGaps.shift(); }
      if (this.boundary) { window.__head.push(this.currentHeadRot.yaw); window.__mouth.push(this.vrm.expressionManager?.getValue('aa') || 0); }
    };
  });
  await page.waitForFunction(() => window.__controller?.collision);
  const mode = page.getByRole('button', { name: 'Character interaction', exact: true });
  assert.equal(await mode.getAttribute('aria-pressed'), 'false');
  await clickPrivate(); const p = await point('chestBoundary'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 60, p.y, { steps: 8 }); await page.mouse.up(); await page.mouse.wheel(0, -50);
  assert.equal(result.requests.length, 0); assert.equal(await page.evaluate(() => window.__controller.boundary), null); result.cameraNoFalseTrigger = true;
  // Restore framing after the actual camera test.
  await page.getByRole('button', { name: 'Toggle camera framing', exact: true }).click(); await page.getByRole('button', { name: 'Toggle camera framing', exact: true }).click();
  await mode.click(); const hover = await point('chestBoundary'); await page.mouse.move(hover.x, hover.y); await page.waitForTimeout(250); assert.equal(result.requests.length, 0); result.hoverNoFalseTrigger = true;
  for (const [id, name] of [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    const switched = await select(id, name);
    for (const locale of ['en', 'ta-IN', 'hi-IN']) {
      await language(locale); const status = await (await page.request.get('http://127.0.0.1:5173/api/tts/status?language=' + locale)).json();
      const before = await page.evaluate(() => ({ ended: window.__audioEnded, levels: window.__levels.length, head: window.__head.length, mouth: window.__mouth.length }));
      const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/tts'), { timeout: 25000 }).catch(() => null);
      await clickPrivate(); await page.locator('.boundary-notice').filter({ hasText: boundaryPhrase(locale) }).waitFor({ timeout: 10000 });
      const response = await responsePromise; assert.equal(response.status(), 200); assert.equal(response.headers()['x-echo-voice-id'], status.avatars[id].voiceId);
      assert.equal(response.headers()['x-zirumi-tts-provider'], locale === 'en' ? 'Cartesia' : 'Sarvam');
      await clickPrivate(); // Immediate repeated click must not overlap or synthesize again.
      await page.waitForFunction(n => window.__audioEnded > n, before.ended, { timeout: 35000 });
      await page.waitForFunction(() => window.__controller.boundary === null, null, { timeout: 20000 });
      const measured = await page.evaluate(b => ({ peakRms: Math.max(0, ...window.__levels.slice(b.levels)), maxHeadYaw: Math.max(0, ...window.__head.slice(b.head)), minHeadYaw: Math.min(0, ...window.__head.slice(b.head)), peakMouth: Math.max(0, ...window.__mouth.slice(b.mouth)), returnedToIdle: window.__controller.boundary === null }), before);
      result.lastMeasurement = measured;
      assert.ok(measured.peakRms > .01); assert.ok(measured.peakMouth > .1); assert.ok(measured.maxHeadYaw > .005 && measured.minHeadYaw < -.005);
      result.reactions.push({ id, name, language: locale, speaker: status.avatars[id].voiceId, provider: status.provider, ...switched, ...measured });
      assert.equal(result.requests.filter(r => r.endpoint === 'tts').length, result.reactions.length);
      await page.screenshot({ path: `${output}/${id}-${locale}.png` });
      console.log(`PASS ${name} ${locale}: actual deliberate selection, head shake, configured voice, non-silent audio, mouth motion, cooldown and recovery.`);
      await page.waitForTimeout(6600); // Explicit cooldown; no extra API calls during the wait.
    }
  }
  assert.equal(result.requests.filter(r => ['chat', 'transcribe', 'memory'].includes(r.endpoint)).length, 0); result.noLlmOrMemoryCalls = true;
  // Same completed fixed reaction is reused from memory, not synthesized again.
  const count = result.requests.length, ended = await page.evaluate(() => window.__audioEnded); await clickPrivate();
  await page.waitForFunction(n => window.__audioEnded > n, ended, { timeout: 20000 }); await page.waitForFunction(() => window.__controller.boundary === null);
  assert.equal(result.requests.length, count); result.cacheReused = true;
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${output}/mobile.png` });
  const control = await mode.boundingBox(); assert.ok(control.x >= 0 && control.y >= 0 && control.x + control.width <= 390 && control.y + control.height <= 844); result.mobileControlFits = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  result.performance = await page.evaluate(() => { const stats = a => ({ mean: a.reduce((s, x) => s + x, 0) / a.length, p95: a.toSorted((a, b) => a - b)[Math.floor(a.length * .95)] }); return { animationMs: stats(window.__frameCosts), softwareRenderedFrameGapMs: stats(window.__frameGaps) }; });
  assert.deepEqual(result.errors, []); result.passed = true;
} catch (e) { result.failure = e.message; process.exitCode = 1; console.error(e.message); }
finally { await page.screenshot({ path: `${output}/boundary-last-state.png` }).catch(() => {}); await writeFile(`${output}/boundary-live.json`, JSON.stringify(result, null, 2)); await browser.close(); }
