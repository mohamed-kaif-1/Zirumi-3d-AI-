import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const result = { mocked: false, paidRequests: 0, errors: [], passed: false };
page.on('pageerror', e => result.errors.push(e.message));
page.on('request', r => { if (r.method() === 'POST' && /\/api\/(chat|tts|transcribe|memory)/.test(r.url())) result.paidRequests++; });
try {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  assert.deepEqual(await page.locator('#conversation-language option').evaluateAll(items => items.map(i => i.value)), ['en', 'ta-IN', 'hi-IN', 'en-IN']);
  await page.locator('#voice-input-method').selectOption('native');
  await page.locator('#conversation-language').selectOption('ta-IN');
  assert.equal(await page.locator('#voice-input-method').inputValue(), 'auto');
  assert.equal(await page.locator('#voice-input-method option[value=native]').isDisabled(), true);
  await page.getByText(/Recorded speech uses Sarvam/).waitFor();
  const box = await page.getByRole('dialog').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391 && box.height <= 844);
  await page.screenshot({ path: 'verification/phase3/mobile-language-settings.png' });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  assert.equal(await page.locator('#conversation-language').inputValue(), 'ta-IN');
  await page.locator('#conversation-language').selectOption('en');
  const response = await page.request.get('http://127.0.0.1:5173/api/providers/status'); const providers = await response.json(); assert.equal(providers.stt, 'deepgram'); assert.equal(providers.tts, 'cartesia');
  result.englishRestored = true; result.mobileFits = true; result.noUnverifiedAuto = true; assert.equal(result.paidRequests, 0); assert.deepEqual(result.errors, []); result.passed = true;
  console.log('PASS mobile language settings, explicit provider notice and English restoration; no paid calls.');
} catch (e) { result.failure = e.message; process.exitCode = 1; console.error(e.message); }
finally { await writeFile('verification/phase3/browser-ui.json', JSON.stringify(result, null, 2)); await browser.close(); }
