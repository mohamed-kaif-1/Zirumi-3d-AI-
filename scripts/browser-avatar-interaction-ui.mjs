// Real pointer drags and rendered poses; no paid provider requests.
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const output = 'verification/avatar-motion'; await mkdir(output, { recursive: true });
const result = { errors: [], paidRequests: 0, avatars: [], passed: false };
page.on('pageerror', e => result.errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST' && /\/api\/(tts|chat|transcribe)/.test(r.url())) result.paidRequests++; });
try {
  await page.goto('http://127.0.0.1:5173'); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await page.evaluate(async () => {
    const entry = performance.getEntriesByType('resource').find(e => e.name.includes('/src/AvatarAnimationController.js'));
    const { AvatarAnimationController } = await import(entry.name), update = AvatarAnimationController.prototype.update;
    window.__updates = 0; AvatarAnimationController.prototype.update = function(delta, time) { update.call(this, delta, time); window.__live = this; window.__updates++; };
  });
  await page.waitForFunction(() => window.__live?.vrm);
  for (const [id, name] of [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    await page.getByRole('button', { name: 'Characters', exact: true }).click(); await page.getByRole('button', { name: `Select ${name} avatar`, exact: true }).click();
    await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name, { timeout: 90000 }); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const before = await page.evaluate(() => ({ frame: window.__updates, translations: Object.fromEntries(Object.entries(window.__live.bones).filter(([, b]) => b).map(([n, b]) => [n, b.position.toArray()])) }));
    await page.waitForFunction(n => window.__updates > n + 35, before.frame);
    const details = { id, name, poses: [] };
    for (const pose of ['torso', 'unreachable']) {
      const pointer = await page.evaluate(async pose => {
        const entry = performance.getEntriesByType('resource').find(e => e.name.includes('/node_modules/.vite/deps/@react-three_fiber.js'));
        const { _roots } = await import(entry.name), canvas = document.querySelector('.avatar-canvas canvas'), { camera } = _roots.get(canvas).store.getState(), box = canvas.getBoundingClientRect(), c = window.__live;
        const toScreen = p => { p.project(camera); return { x: box.x + (p.x + 1) * box.width / 2, y: box.y + (1 - p.y) * box.height / 2 }; };
        const hand = c.bones.rightHand.getWorldPosition(c._vTmp1).clone(), target = pose === 'torso' ? hand.clone().set(0, 1.24, hand.z) : hand.clone().add(c._vTmp2.set(-.75, .7, 0));
        return { hand: toScreen(hand), target: toScreen(target) };
      }, pose);
      await page.mouse.move(pointer.hand.x, pointer.hand.y); await page.mouse.down();
      assert.equal(await page.evaluate(() => window.__live.rightArmState), 'DRAGGING');
      await page.mouse.move(pointer.target.x, pointer.target.y, { steps: 15 });
      const frame = await page.evaluate(() => window.__updates); await page.waitForFunction(n => window.__updates > n + 30, frame);
      const actual = await page.evaluate(() => { const c = window.__live; c.collision.update(); return { state: c.rightArmState, penetration: c.collision.armPenetration('right'), wrist: c.bones.rightHand.getWorldPosition(c._vTmp1).toArray(), desired: c.desiredTargets.right.toArray(), boundary: c.boundary, translations: Object.fromEntries(Object.entries(c.bones).filter(([, b]) => b).map(([n, b]) => [n, b.position.toArray()])) }; });
      assert.equal(actual.boundary, null); assert.ok(actual.penetration <= .002); assert.deepEqual(actual.translations, before.translations);
      await page.screenshot({ path: `${output}/${id}-ik-${pose}.png` }); await page.mouse.up(); details.poses.push({ pose, ...actual });
      await page.getByRole('button', { name: 'Reset Pose', exact: true }).click(); const reset = await page.evaluate(() => window.__updates); await page.waitForFunction(n => window.__updates > n + 35, reset);
    }
    details.memory = await page.evaluate(async () => { const entry = performance.getEntriesByType('resource').find(e => e.name.includes('/node_modules/.vite/deps/@react-three_fiber.js')); const { _roots } = await import(entry.name); const { gl } = _roots.get(document.querySelector('.avatar-canvas canvas')).store.getState(); return { rendererResourceCounts: { ...gl.info.memory }, rendererDrawCalls: gl.info.render.calls, browserJsHeapBytes: performance.memory?.usedJSHeapSize || null, note: 'Resource counts and browser heap, not a total GPU-memory measurement.' }; });
    await page.getByRole('button', { name: 'Toggle camera framing', exact: true }).click(); await page.screenshot({ path: `${output}/${id}-full-body.png` }); await page.getByRole('button', { name: 'Toggle camera framing', exact: true }).click();
    result.avatars.push(details); console.log('PASS ' + name + ': actual hand drags, collision-constrained torso and unreachable poses, stable bones and loaded rendering.');
  }
  assert.equal(result.paidRequests, 0); assert.deepEqual(result.errors, []); result.passed = true;
} catch (e) { result.failure = e.message; process.exitCode = 1; console.error(e.message); }
finally { await page.screenshot({ path: `${output}/interaction-last-state.png` }).catch(() => {}); await writeFile(`${output}/interaction-ui.json`, JSON.stringify(result, null, 2)); await browser.close(); }
