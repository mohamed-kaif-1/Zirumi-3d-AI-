// One explicitly approved test preference; real Mem0/Groq calls. Clean up only
// this browser identity's test data. No cookies or private provider bodies saved.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
const result = { date: new Date().toISOString(), mockedProviderResponses: false, writesPlanned: 'One short non-sensitive favorite-subject preference', billingBalance: 'Unknown; no automatic write retries', errors: [], passed: false };
let enabled = false;
function watch() { page.on('pageerror', error => result.errors.push(error.message)); }
async function silence() { const button = page.getByRole('button', { name: 'Disable voice replies', exact: true }); if (await button.count()) await button.click(); }
async function open() { await page.getByRole('button', { name: 'Memory settings', exact: true }).click(); await page.getByRole('checkbox', { name: 'Enable Memory', exact: true }).waitFor(); }
async function post(route, input) { const response = await context.request.post(`${base}/api/memory/${route}`, { data: input }); const json = await response.json(); if (!response.ok()) throw new Error(json.error); return json; }
async function ask() {
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/chat'), { timeout: 60000 });
  await page.getByRole('textbox', { name: 'Message ZIRUMI' }).fill('What is my favorite subject? Answer briefly.'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const response = await responsePromise; assert.equal(response.status(), 200); return (await response.json()).reply;
}
try {
  watch(); await page.goto(base); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await silence();
  await open(); assert.equal(await page.getByRole('checkbox', { name: 'Enable Memory', exact: true }).isChecked(), false);
  await page.getByRole('checkbox', { name: 'Enable Memory', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Enable Memory"]').checked); enabled = true;
  await page.getByLabel('What should I remember?', { exact: true }).fill('Astronomy');
  const savePromise = page.waitForResponse(r => r.url().endsWith('/api/memory/save'), { timeout: 30000 });
  await page.getByRole('button', { name: 'Remember preference', exact: true }).click(); const saved = await savePromise;
  result.saveStatus = saved.status(); result.save = await saved.json(); assert.equal(saved.status(), 200); assert.equal(result.save.saved, true);
  await page.getByRole('button', { name: 'View remembered information', exact: true }).click();
  await page.getByText('Favorite subject: Astronomy', { exact: true }).waitFor({ timeout: 20000 }); result.liveSaveAndView = true;
  await page.screenshot({ path: 'verification/phase2/memory-saved.png' });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const state = await context.storageState(); await context.close();
  context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 1000 } }); page = await context.newPage(); watch();
  await page.goto(base); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await silence();
  await open(); assert.equal(await page.getByRole('checkbox', { name: 'Enable Memory', exact: true }).isChecked(), true); result.newBrowserContextPersistence = true;
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  result.recall = await ask(); assert.match(result.recall, /astronomy/i); result.liveRecall = true;
  await page.getByRole('button', { name: 'Characters', exact: true }).click(); await page.getByRole('button', { name: 'Select Luna avatar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Select Luna avatar"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 90000 }); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await silence();
  await page.getByRole('button', { name: 'Clear conversation', exact: true }).click(); result.crossAvatarRecall = await ask(); assert.match(result.crossAvatarRecall, /astronomy/i);
  const other = await browser.newContext(); const status = await other.request.get(`${base}/api/memory/status`); assert.equal((await status.json()).enabled, false); const list = await other.request.get(`${base}/api/memory/list`); assert.deepEqual((await list.json()).memories, []); await other.close(); result.liveUserIsolation = true;
  await open(); await page.getByRole('checkbox', { name: 'Enable Memory', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Enable Memory"]').checked);
  await page.getByRole('button', { name: 'View remembered information', exact: true }).click(); await page.getByText('Favorite subject: Astronomy', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await page.getByRole('button', { name: 'Clear conversation', exact: true }).click();
  result.disabledReply = await ask(); assert.doesNotMatch(result.disabledReply, /astronomy/i); result.disabledRecallExcluded = true;
  await open(); await page.getByRole('button', { name: 'View remembered information', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Favorite subject: Astronomy', exact: true }).click(); await page.getByText('No remembered preferences.', { exact: true }).waitFor(); result.liveIndividualDeletion = true;
  await page.getByRole('button', { name: 'Clear Memory', exact: true }).click(); await page.getByRole('button', { name: 'Delete all preferences', exact: true }).click();
  await page.getByText('All your remembered preferences were cleared.', { exact: true }).waitFor(); result.liveClear = true;
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: 'verification/phase2/memory-mobile.png' });
  assert.deepEqual(result.errors, []); result.passed = true; console.log('PASS real opt-in Mem0 save/view, fresh-browser and cross-avatar recall, isolation, disabled recall, deletion and clear.');
} catch (error) { result.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally {
  if (enabled || context) { try { await post('consent', { enabled: false }); await post('clear', { confirm: true }); result.testIdentityCleaned = true; } catch { result.testIdentityCleaned = false; } }
  await writeFile('verification/phase2/browser-live-memory-results.json', JSON.stringify(result, null, 2)); await browser.close();
}
