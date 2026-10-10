// UI-only verification, with actual backend status requests and no paid calls.
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage(); const output = 'verification/language-selector'; await mkdir(output, { recursive: true });
const result = { mocked: false, paidRequests: 0, errors: [], viewports: [], passed: false };
page.on('pageerror', e => result.errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST' && /\/api\/(chat|tts|transcribe)/.test(r.url())) result.paidRequests++; });
try {
  await page.goto('http://127.0.0.1:5173');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const button = page.getByRole('button', { name: 'Open settings', exact: true }); await button.getByText('Settings', { exact: true }).waitFor();
    const box = await button.boundingBox(); result.measuredHeader = { width, ...box }; assert.ok(box.x >= 0 && box.x + box.width <= width);
    await button.click(); await page.getByRole('heading', { name: 'Conversation Language', exact: true }).waitFor();
    for (const language of ['en', 'ta-IN', 'hi-IN', 'en-IN']) {
      await page.locator('#conversation-language').selectOption(language); assert.equal(await page.locator('#conversation-language').inputValue(), language);
    }
    await page.locator('#conversation-language').selectOption('ta-IN');
    await page.waitForFunction(() => [...document.querySelectorAll('.avatar-modal-overlay, .avatar-modal')].every(e => getComputedStyle(e).opacity === '1' && !e.getAnimations().some(a => a.playState === 'running')));
    const field = await page.locator('#conversation-language').boundingBox(); assert.ok(field.x >= 0 && field.x + field.width <= width && field.y + field.height <= (width === 1440 ? 1000 : 844));
    await page.screenshot({ path: `${output}/settings-${width}.png` });
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.reload(); await page.getByRole('button', { name: 'Conversation Language: Tamil', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click(); assert.equal(await page.locator('#conversation-language').inputValue(), 'ta-IN'); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    result.viewports.push({ width, selectorVisibleWithoutScrolling: true, persistedAfterRefresh: true, settingsButtonFits: true });
  }
  assert.equal(result.paidRequests, 0); assert.deepEqual(result.errors, []); result.passed = true; console.log('PASS visible language settings and refresh persistence at 320, 390 and 1440 pixels; no paid calls.');
} catch (e) { result.failure = e.message; process.exitCode = 1; console.error(e.message); }
finally { await page.screenshot({ path: `${output}/ui-last-state.png` }).catch(() => {}); await writeFile(`${output}/ui.json`, JSON.stringify(result, null, 2)); await browser.close(); }
