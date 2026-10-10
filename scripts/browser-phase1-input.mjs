// Real Deepgram + Groq. Virtual microphone fixture; speech output is disabled.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(process.env.TEMP, 'zirumi-microphone-sample.wav')}`] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['microphone'] });
const page = await context.newPage();
const result = { date: new Date().toISOString(), liveDeepgram: false, liveGroq: false, liveCartesia: false, physicalMicrophoneVerified: false, virtualSpokenInput: true, mockedProviderResponses: false, speechOutputDisabled: true, requests: [], errors: [], passed: false };
await mkdir('verification/phase1', { recursive: true });
page.on('pageerror', error => result.errors.push(error.message));
page.on('request', request => { if (/\/api\/(transcribe|chat|tts)$/.test(request.url())) result.requests.push({ endpoint: request.url().split('/').at(-1) }); });
await page.addInitScript(() => { window.__streams = []; const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (...args) => capture(...args).then(stream => { window.__streams.push(stream); return stream; }); });
try {
  const health = await (await page.request.get(`${base}/api/transcription/status`)).json(); assert.equal(health.provider, 'Deepgram'); assert.equal(health.configured, true);
  await page.goto(base); await page.getByText(/Avatar ready/).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Disable voice replies', exact: true }).click();
  const transcriptionPromise = page.waitForResponse(response => response.url().endsWith('/api/transcribe'), { timeout: 60000 }).catch(() => null);
  await page.getByRole('button', { name: 'Start speaking', exact: true }).click();
  await page.locator('.stage-status').filter({ hasText: 'Listening' }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'verification/phase1/deepgram-listening.png' });
  await page.waitForTimeout(4000); await page.getByRole('button', { name: 'Stop listening', exact: true }).press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.message-assistant').length || document.querySelector('.error-message'), null, { timeout: 60000 });
  const transcription = await transcriptionPromise;
  if (transcription) { result.transcriptionStatus = transcription.status(); const body = await transcription.json(); result.transcriptionMetadata = body.metadata; result.transcript = body.transcript; result.liveDeepgram = transcription.status() === 200 && body.metadata?.provider === 'Deepgram'; }
  if (await page.locator('.error-message').count()) throw new Error(await page.locator('.error-message').innerText());
  assert.equal(result.liveDeepgram, true); result.reply = await page.locator('.message-assistant p').innerText(); result.liveGroq = true;
  assert.match(result.transcript, /my name|remember/i); assert.ok(result.reply.length); assert.equal(await page.locator('.message-user').count(), 1);
  result.microphoneReleased = await page.evaluate(() => window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))); assert.equal(result.microphoneReleased, true);
  assert.equal(result.requests.filter(r => r.endpoint === 'transcribe').length, 1); assert.equal(result.requests.filter(r => r.endpoint === 'chat').length, 1); assert.equal(result.requests.filter(r => r.endpoint === 'tts').length, 0);
  await page.getByRole('button', { name: 'Characters', exact: true }).click(); await page.getByRole('button', { name: 'Select Mira avatar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Select Mira avatar"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message ZIRUMI' }).fill('What is my name? Answer in one short sentence.'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.message-assistant').length === 2 || document.querySelector('.error-message'), null, { timeout: 60000 });
  if (await page.locator('.error-message').count()) throw new Error(await page.locator('.error-message').innerText());
  result.recall = await page.locator('.message-assistant p').last().innerText(); assert.match(result.recall, /Aster/i); result.crossAvatarSessionMemory = true;
  await page.screenshot({ path: 'verification/phase1/live-input-completed.png' });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'verification/phase1/live-input-mobile.png' });
  assert.deepEqual(result.errors, []); result.passed = true;
  console.log(JSON.stringify({ passed: true, liveDeepgram: true, liveGroq: true, liveCartesia: false, transcript: result.transcript, recall: result.recall, microphoneReleased: true }));
} catch (error) { result.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally { await page.screenshot({ path: 'verification/phase1/live-input-last-state.png' }).catch(() => {}); await writeFile('verification/phase1/browser-live-input-results.json', JSON.stringify(result, null, 2)); await browser.close(); }
