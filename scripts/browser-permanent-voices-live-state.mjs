// Real production UI and backend: no network fixtures or fabricated speech events.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:4173';
const directory = 'verification/permanent-voices/production';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], ttsRequests = [], ttsResponses = [];
const result = { url: base, mockedNetwork: false, errors, ttsRequests, ttsResponses, selected: [] };
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().endsWith('/api/tts')) ttsRequests.push(request.postDataJSON()); });
page.on('response', response => { if (response.url().endsWith('/api/tts')) ttsResponses.push({ status: response.status() }); });
await page.addInitScript(() => {
  window.__nativeEvents = [];
  window.__cloudEvents = []; window.__cloudAudio = [];
  const OriginalAudio = window.Audio;
  window.Audio = function(url) {
    const audio = new OriginalAudio(url); window.__cloudAudio.push(audio);
    for (const type of ['playing', 'ended', 'pause', 'error']) audio.addEventListener(type, () => window.__cloudEvents.push({ type, time: audio.currentTime }));
    return audio;
  };
  const original = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = utterance => {
    for (const name of ['start', 'end', 'error']) utterance.addEventListener(name, event => window.__nativeEvents.push({ type: name, voice: utterance.voice?.name, error: event.error }));
    return original(utterance);
  };
});
try {
  await page.goto(base);
  await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  const metadata = await (await page.request.get(`${base}/api/tts/status`)).json(); result.metadata = metadata;
  if (metadata.avatars.default.configurationPending) {
    await page.getByRole('button', { name: 'Preview Aira voice', exact: true }).click();
    await page.waitForFunction(() => window.__nativeEvents.some(event => ['end', 'error'].includes(event.type)), null, { timeout: 20000 }).catch(() => {});
    result.airaNativeEvents = await page.evaluate(() => window.__nativeEvents);
    result.airaBrowserPlaybackVerified = result.airaNativeEvents.some(event => event.type === 'start') && result.airaNativeEvents.some(event => event.type === 'end');
    assert.equal(ttsRequests.length, 0, 'Pending Aira retains her existing browser voice');
    const stop = page.getByRole('button', { name: 'Stop Speaking', exact: true });
    if (await stop.count()) await stop.click();
  }
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.avatar-modal').getAnimations().every(animation => animation.playState === 'finished'));
  const galleryText = await page.locator('.avatar-grid').innerText(); result.readinessVisible = galleryText;
  for (const voice of Object.values(metadata.avatars)) if (voice.voiceId) assert.ok(!galleryText.includes(voice.voiceId));
  await page.screenshot({ path: `${directory}/gallery.png` });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  for (const [avatarId, name] of [['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    await page.getByRole('button', { name: 'Characters', exact: true }).click();
    await page.getByRole('button', { name: `Select ${name} avatar`, exact: true }).click();
    await page.waitForFunction(name => document.querySelector(`[aria-label="Select ${name} avatar"]`)?.getAttribute('aria-pressed') === 'true', name, { timeout: 90000 });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    const before = ttsResponses.length;
    await page.getByRole('button', { name: `Preview ${name} voice`, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.stage-status')?.textContent.includes('Ready to try again') || document.querySelector('.stage-status')?.textContent.trim() === 'Ready', null, { timeout: 50000 });
    const request = ttsRequests.at(-1);
    assert.equal(request.avatarId, avatarId); assert.ok(!Object.hasOwn(request, 'voiceId'));
    result.selected.push({ avatarId, ttsStatus: ttsResponses.at(-1)?.status, handled: ttsResponses.length > before });
    await page.screenshot({ path: `${directory}/${avatarId}-preview.png` });
  }
  result.cloudPreviewsDidNotUseBrowserFallback = (await page.evaluate(() => window.__nativeEvents.length)) === result.airaNativeEvents?.length;
  assert.ok(result.cloudPreviewsDidNotUseBrowserFallback);
  // Prove the actual typed Groq -> selected voice -> playback path and memory.
  assert.equal(await page.locator('.message').count(), 0, 'Previews never create conversation turns'); result.previewHistoryUntouched = true;
  const before = await page.evaluate(() => window.__cloudEvents.length);
  const chatResponse = page.waitForResponse(response => response.url().endsWith('/api/chat'));
  await page.getByRole('textbox', { name: 'Message ZIRUMI' }).fill('My name is Cedar. Please remember my name and greet me in one short sentence.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const response = await chatResponse; const chat = await response.json();
  assert.equal(response.status(), 200); assert.equal(chat.metadata.provider, 'Groq');
  await page.waitForFunction(n => window.__cloudEvents.slice(n).some(event => event.type === 'playing'), before, { timeout: 50000 });
  assert.equal(await page.getByRole('button', { name: 'Start speaking', exact: true }).isDisabled(), true);
  await page.waitForFunction(n => window.__cloudEvents.slice(n).some(event => event.type === 'ended'), before, { timeout: 50000 });
  assert.equal(ttsRequests.at(-1).avatarId, 'ember'); assert.equal(ttsRequests.at(-1).text, chat.reply);
  result.liveTypedGroqToElevenLabsPlayback = true; result.typedReply = chat;
  await page.screenshot({ path: `${directory}/zyra-live-conversation.png` });
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Select Mira avatar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Select Mira avatar"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 90000 });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const recallResponse = page.waitForResponse(response => response.url().endsWith('/api/chat'));
  await page.getByRole('textbox', { name: 'Message ZIRUMI' }).fill('What is my name? Reply in one short sentence.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const recall = await (await recallResponse).json(); assert.match(recall.reply, /Cedar/i);
  assert.equal(await page.locator('.message-assistant').count(), 2);
  result.memoryPreservedAcrossSwitch = true; result.recallReply = recall;
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.avatar-modal').getAnimations().every(animation => animation.playState === 'finished'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${directory}/mobile-gallery.png` });
  result.mobileNoOverflow = true;
  assert.deepEqual(errors, []); result.passed = true;
  console.log(JSON.stringify({ passed: true, selected: result.selected, airaBrowserPlaybackVerified: result.airaBrowserPlaybackVerified, cloudPreviewsDidNotUseBrowserFallback: true, liveTypedGroqToElevenLabsPlayback: result.liveTypedGroqToElevenLabsPlayback, memoryPreservedAcrossSwitch: result.memoryPreservedAcrossSwitch, errors }));
} catch (error) { result.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally { await writeFile(`${directory}/browser-results.json`, JSON.stringify(result, null, 2)); await browser.close(); }
