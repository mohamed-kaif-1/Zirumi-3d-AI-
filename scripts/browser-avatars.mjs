// Local verification only. Playwright is installed outside production dependencies.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification', 'runner.cjs'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: process.env.ECHO_CHROMIUM_PATH || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const downloads = [];
const capabilities = {};
const uiOnly = process.argv.includes('--ui-only');
page.on('request', request => { if (/\.vrm(?:\?|$)/.test(request.url()) && !request.url().includes('import')) downloads.push(request.url()); });
await mkdir('verification', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5173');
  await page.getByText(/Avatar ready/).waitFor({ timeout: 60000 });
  assert.equal(downloads.length, 1, 'Only default model loads at startup');
  const startCount = downloads.length;
  await page.getByLabel('Message ZIRUMI', { exact: true }).fill('Draft survives avatar changes');
  assert.equal(downloads.length, startCount, 'Typing does not reload models');
  if (!uiOnly) {
  await page.screenshot({ path: 'verification/echo-initial.png' });
  for (const [id, name] of [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    if (id !== 'default') {
      await page.getByRole('button', { name: 'Characters', exact: true }).click();
      await page.getByRole('button', { name: `Select ${name} avatar`, exact: true }).click();
      await page.getByRole('button', { name: `Select ${name} avatar`, exact: true }).getAttribute('aria-pressed').then(async value => {
        if (value !== 'true') await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name);
      });
      await page.getByRole('button', { name: 'Close dialog' }).click();
    }
    await page.getByText(/Avatar ready/).waitFor();
    await page.screenshot({ path: `verification/${id}.png` });
    console.log(`RENDERED ${name}`);
  }
  for (const id of ['default', 'sky', 'nova', 'ember']) {
    const url = id === 'default' ? '/AvatarSample_W.vrm' : `/models/${id}.vrm`;
    const result = await page.evaluate(async ({ url }) => (await import('/scripts/avatar-probe.js')).probe(url, true), { url });
    await writeFile(`public/avatars/${id}.png`, Buffer.from(result.thumbnail, 'base64'));
    delete result.thumbnail;
    assert.ok(result.maxBlink > 0.9);
    assert.ok(result.mouthSpeaking > 0.1);
    assert.ok(result.mouthStopped < 0.001);
    assert.ok(result.heldError < 0.001);
    for (const key of Object.keys(result.before)) assert.deepEqual(result.after[key].local, result.before[key].local, `${id}: ${key} rest translation preserved`);
    capabilities[id] = result;
    console.log(`ANIMATION AND REAL THUMBNAIL ${id}`);
  }
  await page.locator('button[title="Hold Pose: Disabled"]').click();
  for (const [id, name] of [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    if (id !== await page.evaluate(() => localStorage.getItem('echo_selected_avatar'))) {
      await page.getByRole('button', { name: 'Characters', exact: true }).click();
      await page.getByRole('button', { name: `Select ${name} avatar`, exact: true }).click();
      await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name);
      await page.getByRole('button', { name: 'Close dialog' }).click();
    }
    const box = await page.locator('.avatar-canvas canvas').boundingBox();
    const point = await page.evaluate(async ({ position, aspect }) => (await import('/scripts/avatar-probe.js')).projectPoint(position, aspect), { position: capabilities[id].after.rightHand.world, aspect: box.width / box.height });
    const x = box.x + (point[0] + 1) * box.width / 2;
    const y = box.y + (1 - point[1]) * box.height / 2;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.move(x, y);
    console.log(JSON.stringify({ dragging: id, x, y, cursor: await page.evaluate(() => document.body.style.cursor) }));
    await page.mouse.down();
    await page.mouse.move(x - 240, y - 250, { steps: 12 });
    await page.getByText('Reach Limit', { exact: true }).waitFor({ timeout: 10000 });
    await page.mouse.up();
    await page.screenshot({ path: `verification/${id}-hand-drag.png` });
    await page.locator('button[title="Reset arm pose to neutral"]').click();
    console.log(`PASS actual mouse hand drag ${id}`);
  }
  await page.locator('button[title="Hold Pose: Enabled"]').click();
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.avatar-modal-overlay')).opacity === '1' && getComputedStyle(document.querySelector('.avatar-modal')).transform === 'none');
  await page.screenshot({ path: 'verification/gallery.png' });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  // Delay Luna; Mira must win, and the old Zyra stays active until Mira is ready.
  let releaseLuna;
  const skyGate = new Promise(resolve => { releaseLuna = resolve; });
  await page.route('**/models/sky.vrm', async route => { await skyGate; await route.continue(); });
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Select Luna avatar', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Select Zyra avatar', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('echo_selected_avatar')), 'ember');
  await page.getByRole('button', { name: 'Select Mira avatar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Select Mira avatar"]')?.getAttribute('aria-pressed') === 'true');
  const lateLuna = page.waitForResponse(response => response.url().endsWith('/models/sky.vrm'));
  releaseLuna();
  await lateLuna;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => localStorage.getItem('echo_selected_avatar')), 'nova');
  await page.unroute('**/models/sky.vrm');
  console.log('PASS delayed selection race and preservation during loading');

  await page.route('**/models/sky.vrm', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>broken model</html>' }));
  await page.getByRole('button', { name: 'Select Luna avatar', exact: true }).click();
  await page.getByText(/VRM load failed/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Select Mira avatar', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('echo_selected_avatar')), 'nova');
  await page.unroute('**/models/sky.vrm');
  await page.getByRole('button', { name: 'Select Luna avatar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Select Luna avatar"]')?.getAttribute('aria-pressed') === 'true');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Import VRM avatar').setInputFiles({ name: 'broken.vrm', mimeType: 'application/octet-stream', buffer: Buffer.from('<html>not a VRM</html>') });
  await page.getByText(/VRM load failed/).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('echo_selected_avatar')), 'sky');
  console.log('PASS corrupt downloaded and imported files; retry recovers');
  } else {
    await page.getByRole('button', { name: 'Characters', exact: true }).click();
    await page.getByRole('button', { name: 'Select Luna avatar', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Select Luna avatar"]')?.getAttribute('aria-pressed') === 'true');
    await page.getByRole('button', { name: 'Close dialog' }).click();
  }

  // Controlled endpoint fixture tests conversation state across a real model swap.
  const chatBodies = [];
  await page.route('**/api/chat', async route => {
    chatBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: chatBodies.length === 1 ? 'Hello Aster. I will remember your name.' : 'Your name is Aster.' }) });
  });
  await page.locator('.voice-mute-toggle').click();
  await page.getByLabel('Message ZIRUMI', { exact: true }).fill('My name is Aster.');
  await page.getByLabel('Message ZIRUMI', { exact: true }).press('Enter');
  await page.getByText('Hello Aster. I will remember your name.', { exact: true }).waitFor();
  await page.locator('.voice-preset-trigger').click();
  for (const name of ['Sweet', 'Playful', 'Calm', 'Excited', 'Gentle', 'Best Friend']) {
    await page.locator('.preset-card').filter({ hasText: name }).click();
    assert.equal(await page.locator('.vp-name').innerText(), name);
  }
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Select Zyra avatar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Select Zyra avatar"]')?.getAttribute('aria-pressed') === 'true');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal(await page.locator('.vp-name').innerText(), 'Playful');
  await page.getByLabel('Message ZIRUMI', { exact: true }).fill('What is my name?');
  await page.getByLabel('Message ZIRUMI', { exact: true }).press('Enter');
  await page.getByText('Your name is Aster.', { exact: true }).waitFor();
  assert.equal(chatBodies[1].history[0].content, 'My name is Aster.');
  assert.equal(chatBodies[1].history.length, 2);
  await page.screenshot({ path: 'verification/conversation-preserved.png' });
  await page.locator('button[title="Clear conversation"]').click();
  assert.equal(await page.locator('.message').count(), 0);
  console.log('PASS conversation memory (fixture), all six voice presets and Clear');

  await page.reload();
  await page.getByText(/Avatar ready/).waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.stage-heading h2').innerText(), 'Zyra');
  await page.locator('button[title="Toggle camera framing"]').click();
  await page.screenshot({ path: 'verification/ember-full-body.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.avatar-modal').getAnimations().every(animation => animation.playState === 'finished'));
  await page.screenshot({ path: 'verification/mobile-gallery.png' });
  assert.ok(await page.getByRole('button', { name: 'Select Zyra avatar', exact: true }).isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.log('PASS persisted selection, full-body framing, mobile gallery');
  console.log(JSON.stringify({ downloads, errors }));
  assert.deepEqual(errors, []);
  await writeFile(`verification/${uiOnly ? 'browser-ui-results' : 'browser-results'}.json`, JSON.stringify({ downloads, errors, rendered: uiOnly ? undefined : 4, capabilities }, null, 2));
} finally {
  await page.screenshot({ path: 'verification/last-browser-state.png' }).catch(() => {});
  await browser.close();
}
