// Real browser offline state; controlled HTTP fixtures for quota/balance errors.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(); const errors = [], bodies = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('verification/groq', { recursive: true });
try {
  await page.goto(base); await page.getByText(/Avatar ready/).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Disable voice replies', exact: true }).click();
  await context.setOffline(true);
  await page.getByLabel('Message ZIRUMI', { exact: true }).fill('Hello, who are you?'); await page.getByLabel('Message ZIRUMI', { exact: true }).press('Enter');
  await page.getByRole('alert').filter({ hasText: /connection|could not reach/i }).waitFor();
  assert.equal(await page.locator('.message-assistant').count(), 0);
  await page.screenshot({ path: 'verification/groq/offline.png' });
  await context.setOffline(false);
  let failure = null;
  await page.route('**/api/chat', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: failure?.status || 200, contentType: 'application/json', body: JSON.stringify(failure ? { error: failure.error } : { reply: 'Hello. I am Aira, your ZIRUMI companion.' }) });
  });
  await page.getByRole('button', { name: 'Try again', exact: false }).click();
  await page.waitForFunction(() => document.querySelectorAll('.message-assistant').length === 1);
  assert.equal(await page.locator('.message-user').count(), 1, 'Retry must reuse the original user bubble');
  assert.equal(await page.getByRole('alert').count(), 0, 'Success clears the connection error');
  assert.deepEqual(bodies[0].history, []);
  for (const controlled of [
    { status: 503, error: 'Groq authentication failed. Check the backend API key and try again.' },
    { status: 429, error: 'Groq rate limit or quota reached. Wait before trying again.' },
    { status: 503, error: 'Groq account balance or spending limit reached. Check billing before trying again.' },
  ]) {
    failure = controlled;
    await page.getByRole('button', { name: 'Clear conversation', exact: true }).click();
    await page.getByLabel('Message ZIRUMI', { exact: true }).fill('Test failure recovery'); await page.getByLabel('Message ZIRUMI', { exact: true }).press('Enter');
    await page.getByRole('alert').filter({ hasText: controlled.error }).waitFor();
    assert.equal(await page.locator('.message-assistant').count(), 0);
    const count = bodies.length; await page.waitForTimeout(300); assert.equal(bodies.length, count, 'No automatic paid retries');
    failure = null; await page.getByRole('button', { name: 'Try again', exact: false }).click();
    await page.waitForFunction(() => document.querySelectorAll('.message-assistant').length === 1);
    assert.equal(await page.locator('.message-user').count(), 1);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.deepEqual(bodies.at(-1).history, []);
  }
  await page.getByRole('button', { name: 'Toggle camera framing', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Toggle camera framing', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Toggle Fullscreen', exact: true }).click();
  await page.locator('.fullscreen-avatar').waitFor(); assert.equal(await page.getByRole('button', { name: 'Start speaking', exact: true }).isVisible(), true);
  await page.screenshot({ path: 'verification/groq/fullscreen.png' }); await page.keyboard.press('Escape'); assert.equal(await page.locator('.fullscreen-avatar').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile('verification/groq/browser-recovery-results.json', JSON.stringify({ url: base, realBrowserOffline: true, liveGroq: false, controlledFailures: ['authentication', 'quota', 'balance'], retryReusesUserBubble: true, successClearsError: true, failedTurnsExcludedFromMemory: true, noAutomaticRetries: true, cameraAndFullscreen: true, bodies, errors }, null, 2));
  console.log('PASS real offline/reconnect, controlled authentication/quota/balance recovery, clean memory, camera and fullscreen controls.');
} finally { await browser.close(); }
