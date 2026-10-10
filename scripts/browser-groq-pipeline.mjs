// Real browser, real Groq and real ElevenLabs. Only the microphone input is a
// known synthesized WAV fixture; no provider responses or audio events are mocked.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const directory = 'verification/groq-free';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(process.env.TEMP, 'zirumi-microphone-sample.wav')}`] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['microphone'] });
const page = await context.newPage();
const result = { mockedProviderResponses: false, liveGroq: false, liveElevenLabs: false, physicalMicrophoneVerified: false, synthesizedVirtualMicrophone: true, requests: [], responses: [], errors: [] };
page.on('pageerror', error => result.errors.push(error.message));
page.on('request', request => {
  if (request.url().endsWith('/api/chat') || request.url().endsWith('/api/tts')) result.requests.push({ endpoint: request.url().split('/').at(-1), body: request.postDataJSON() });
});
await page.route('**/api/transcribe', async route => {
  result.requests.push({ endpoint: 'transcribe', bytes: route.request().postDataBuffer()?.length || 0 });
  await route.continue();
});
page.on('response', response => {
  if (/\/api\/(chat|tts|transcribe)$/.test(response.url())) result.responses.push({ endpoint: response.url().split('/').at(-1), status: response.status() });
});
await page.addInitScript(() => {
  localStorage.setItem('echo_selected_avatar', 'ember');
  window.__audioEvents = []; window.__streams = [];
  const Audio = window.Audio;
  window.Audio = function(url) {
    const audio = new Audio(url);
    for (const type of ['playing', 'ended', 'error']) audio.addEventListener(type, () => window.__audioEvents.push({ type, currentTime: audio.currentTime }));
    return audio;
  };
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (...args) => capture(...args).then(stream => { window.__streams.push(stream); return stream; });
});
try {
  await page.goto(base); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  assert.equal(await page.locator('.stage-heading h2').innerText(), 'Zyra');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/AvatarAnimationController.js'))?.name;
    if (!url) throw new Error('Loaded animation module was not found.');
    const { AvatarAnimationController } = await import(url);
    const update = AvatarAnimationController.prototype.updateExpressions;
    window.__mouth = [];
    AvatarAnimationController.prototype.updateExpressions = function(delta, time) {
      update.call(this, delta, time);
      if (this.audioSpeechAmplitude !== null) window.__mouth.push({ level: this.audioSpeechAmplitude, mouth: this.vrm?.expressionManager?.getValue('aa') || 0 });
    };
  });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByLabel('Speech recognition', { exact: true }).selectOption('server');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/chat'), { timeout: 60000 }).catch(() => null);
  await page.getByRole('button', { name: 'Start speaking', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.stage-status')?.textContent.includes('Listening') || document.querySelector('.error-message'), null, { timeout: 35000 });
  if (await page.locator('.error-message').count()) throw new Error(await page.locator('.error-message').innerText());
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Stop listening', exact: true }).press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.message-assistant').length > 0 || document.querySelector('.error-message'), null, { timeout: 60000 });
  if (await page.locator('.error-message').count()) throw new Error(await page.locator('.error-message').innerText());
  const response = await responsePromise;
  if (!response) throw new Error('No chat response followed the recording.');
  result.chat = await response.json(); assert.equal(response.status(), 200);
  assert.equal(result.chat.metadata.provider, 'Groq'); assert.equal(result.chat.metadata.model, 'openai/gpt-oss-20b');
  result.liveGroq = true;
  await page.waitForFunction(() => window.__audioEvents.some(e => e.type === 'playing') || document.querySelector('.error-message'), null, { timeout: 60000 });
  if (await page.locator('.error-message').count()) throw new Error(await page.locator('.error-message').innerText());
  assert.ok(await page.evaluate(() => window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
  assert.equal(await page.getByRole('button', { name: 'Start speaking', exact: true }).isDisabled(), true);
  await page.screenshot({ path: `${directory}/voice-pipeline-playing.png` });
  await page.waitForFunction(() => window.__audioEvents.some(e => e.type === 'ended'), null, { timeout: 60000 });
  assert.equal(await page.locator('.message-user').count(), 1); assert.equal(await page.locator('.message-assistant').count(), 1);
  result.transcript = await page.locator('.message-user p').innerText(); assert.match(result.transcript, /my name|remember/i);
  const tts = result.requests.filter(r => r.endpoint === 'tts');
  assert.equal(tts.length, 1); assert.equal(tts[0].body.avatarId, 'ember'); assert.equal(tts[0].body.text, result.chat.reply); assert.equal(tts[0].body.voiceId, undefined);
  assert.equal(result.requests.filter(r => r.endpoint === 'chat').length, 1); assert.equal(result.requests.filter(r => r.endpoint === 'transcribe').length, 1);
  result.animation = await page.evaluate(() => ({ peakMouth: Math.max(...window.__mouth.map(m => m.mouth)), peakAmplitude: Math.max(...window.__mouth.map(m => m.level)), closedInSilence: window.__mouth.some(m => m.level === 0 && m.mouth < 0.02), events: window.__audioEvents }));
  assert.ok(result.animation.peakMouth > 0.1); assert.ok(result.animation.peakAmplitude > 0.01); assert.ok(result.animation.closedInSilence);
  result.liveElevenLabs = true; result.microphoneReleasedBeforePlayback = true;
  await page.screenshot({ path: `${directory}/voice-pipeline-completed.png` });
  await page.getByRole('button', { name: 'Disable voice replies', exact: true }).click();
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Select Mira avatar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Select Mira avatar"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 90000 });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const recallPromise = page.waitForResponse(response => response.url().endsWith('/api/chat'));
  await page.getByRole('textbox', { name: 'Message ZIRUMI' }).fill('What is my name? Answer in one short sentence.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const recall = await recallPromise; assert.equal(recall.status(), 200); result.recall = await recall.json(); assert.match(result.recall.reply, /Aster/i);
  await page.waitForFunction(() => document.querySelectorAll('.message-assistant').length === 2);
  assert.equal(await page.locator('.message-user').count(), 2);
  result.memoryAfterCharacterSwitch = true;
  await page.screenshot({ path: `${directory}/memory-after-switch.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${directory}/mobile-chat.png` });
  assert.deepEqual(result.errors, []); result.passed = true;
  console.log(JSON.stringify({ passed: true, liveGroq: true, liveElevenLabs: true, transcript: result.transcript, animation: result.animation, memoryAfterCharacterSwitch: true, errors: result.errors }));
} catch (error) { result.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally {
  await page.screenshot({ path: `${directory}/last-state.png` }).catch(() => {});
  await writeFile(`${directory}/browser-pipeline-results.json`, JSON.stringify(result, null, 2));
  await browser.close();
}
