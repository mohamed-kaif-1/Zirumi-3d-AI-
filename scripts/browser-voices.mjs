import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification', 'runner.cjs'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: process.env.ECHO_CHROMIUM_PATH || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], playback = [];
const live = process.argv.includes('--live');
page.on('pageerror', error => errors.push(error.message));
await mkdir('verification/groq/native', { recursive: true });
// Observe native TTS calls and events. No speech API or voice list is simulated.
await page.addInitScript(() => {
  window.__voiceEvents = [];
  const originalSpeak = speechSynthesis.speak.bind(speechSynthesis);
  const originalCancel = speechSynthesis.cancel.bind(speechSynthesis);
  speechSynthesis.speak = utterance => {
    const identity = { text: utterance.text, voiceURI: utterance.voice?.voiceURI, name: utterance.voice?.name, lang: utterance.lang, pitch: utterance.pitch, rate: utterance.rate, volume: utterance.volume };
    window.__voiceEvents.push({ event: 'queued', ...identity });
    for (const type of ['start', 'end', 'error']) utterance.addEventListener(type, event => window.__voiceEvents.push({ event: type, error: event.error, ...identity }));
    return originalSpeak(utterance);
  };
  speechSynthesis.cancel = () => { window.__voiceEvents.push({ event: 'cancel' }); return originalCancel(); };
});
const select = async name => {
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  const button = page.getByRole('button', { name: `Select ${name} avatar`, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name, { timeout: 90000 });
  await page.getByRole('button', { name: 'Close dialog' }).click();
};
try {
  await page.goto(process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173');
  await page.getByText(/Avatar ready/).waitFor({ timeout: 60000 });
  const tts = await (await page.request.get(new URL('/api/tts/status', page.url()).href)).json();
  assert.equal(tts.fallback, 'browser', 'This script tests the explicitly configured native fallback');
  assert.ok(Object.values(tts.avatars).every(voice => !voice.available), 'For accessible ElevenLabs voices, use browser-elevenlabs.mjs --live instead of this native fallback check');
  const voices = await page.evaluate(() => speechSynthesis.getVoices().map(v => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang, localService: v.localService })));
  console.log('INSTALLED', JSON.stringify(voices));
  for (const [name, preset] of [['Aira', 'Best Friend'], ['Luna', 'Sweet'], ['Mira', 'Calm'], ['Zyra', 'Playful']]) {
    await select(name);
    assert.equal(await page.locator('.vp-name').innerText(), preset);
    const queuedBefore = await page.evaluate(() => window.__voiceEvents.filter(event => event.event === 'queued').length);
    await page.locator('.voice-preview-btn').first().click();
    await page.waitForFunction(n => window.__voiceEvents.filter(event => event.event === 'queued').length > n, queuedBefore);
    const queued = await page.evaluate(() => window.__voiceEvents.filter(event => event.event === 'queued').at(-1));
    const fallbackNotice = name === 'Aira' ? '' : await page.locator('.voice-notice').filter({ hasText: /Using the configured browser (?:voice|fallback)/i }).innerText();
    let started = false, completed = false, previewAttempts = 1;
    try {
      await page.getByText('Speaking', { exact: true }).waitFor({ timeout: 9000 });
      started = true;
      await page.screenshot({ path: `verification/groq/native/${name.replaceAll(' ', '-').toLowerCase()}-speaking.png` });
      await page.waitForFunction(text => window.__voiceEvents.some(event => event.event === 'end' && event.text === text), queued.text, { timeout: 25000 });
      completed = true;
      await page.getByText('Ready', { exact: true }).waitFor();
    } catch {
      if (await page.getByRole('button', { name: 'Stop Speaking', exact: true }).count()) await page.getByRole('button', { name: 'Stop Speaking', exact: true }).click();
    }
    if (!completed) {
      // One explicit user Preview retry; no automatic application/provider retry.
      previewAttempts = 2;
      await page.locator('.voice-preview-btn').first().click();
      await page.getByText('Speaking', { exact: true }).waitFor({ timeout: 9000 });
      started = true;
      await page.waitForFunction(text => window.__voiceEvents.some(event => event.event === 'end' && event.text === text), queued.text, { timeout: 25000 });
      completed = true;
      await page.getByText('Ready', { exact: true }).waitFor();
    }
    playback.push({ avatar: name, preset, ...queued, started, completed, previewAttempts, fallbackNotice });
    console.log('NATIVE PREVIEW', JSON.stringify(playback.at(-1)));
  }
  assert.ok(playback.every(result => result.started && result.completed), 'Every real native preview must start and finish');
  await select('Luna');
  await page.locator('.voice-preset-trigger').click();
  await page.locator('.preset-card').filter({ hasText: 'Gentle' }).click();
  const manual = voices.find(voice => voice.name.includes('Mark')) || voices[0];
  if (manual) await page.getByLabel(/Base Voice:|Browser fallback:/).selectOption(JSON.stringify([manual.voiceURI, manual.lang]));
  if (await page.getByLabel('Luna pitch', { exact: true }).count()) await page.getByLabel('Luna pitch', { exact: true }).press('ArrowLeft');
  await page.getByLabel('Luna speaking rate', { exact: true }).press('ArrowLeft');
  await page.getByLabel('Luna volume', { exact: true }).press('ArrowLeft');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('echo_avatar_voice_settings_v1')).avatars.sky);
  assert.equal(saved.presetId, 'gentle');
  if (manual) assert.equal(saved.voice.voiceURI, manual.voiceURI);
  await page.screenshot({ path: 'verification/groq/native/sky-settings.png' });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await select('Mira'); assert.equal(await page.locator('.vp-name').innerText(), 'Calm');
  await select('Luna'); assert.equal(await page.locator('.vp-name').innerText(), 'Gentle');
  await page.reload(); await page.getByText(/Avatar ready/).waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.vp-name').innerText(), 'Gentle');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('echo_avatar_voice_settings_v1')).avatars.sky), saved);
  await page.locator('.voice-preset-trigger').click();
  await page.getByRole('button', { name: 'Reset to Default Voice', exact: true }).click();
  assert.equal(await page.locator('.vp-name').innerText(), 'Sweet');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  console.log('PASS per-avatar controls, persistence and reset');
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Play Luna voice sample', exact: true }).click();
  await page.waitForFunction(() => window.__voiceEvents.some(event => event.event === 'queued' && event.text.includes("I'm Luna")));
  await page.getByRole('button', { name: 'Select Zyra avatar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Select Zyra avatar"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 90000 });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal(await page.evaluate(() => speechSynthesis.speaking), false);
  console.log('PASS switching cancels native preview');

  const requests = [];
  const replies = [];
  await page.route('**/api/chat', async route => {
    requests.push(route.request().postDataJSON());
    if (live) { await route.continue(); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: requests.length === 1 ? 'Hello Aster.' : 'Your name is Aster.' }) });
  });
  await page.getByLabel('Message ZIRUMI', { exact: true }).fill('My name is Aster.');
  await page.getByLabel('Message ZIRUMI', { exact: true }).press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.message-assistant').length === 1, null, { timeout: 50000 });
  replies.push(await page.locator('.message-assistant p').last().innerText());
  if (!live) assert.equal(replies[0], 'Hello Aster.');
  assert.equal(requests[0].avatarId, 'ember');
  await select('Mira');
  await page.getByLabel('Message ZIRUMI', { exact: true }).fill('What is my name?');
  await page.getByLabel('Message ZIRUMI', { exact: true }).press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.message-assistant').length === 2, null, { timeout: 50000 });
  replies.push(await page.locator('.message-assistant p').last().innerText());
  assert.match(replies[1], /Aster/i);
  assert.equal(requests[1].avatarId, 'nova');
  assert.equal(requests[1].history[0].content, 'My name is Aster.');
  assert.equal(requests[1].history.length, 2);
  const replyVoice = await page.evaluate(text => window.__voiceEvents.filter(event => event.event === 'queued' && event.text === text).at(-1), replies[1]);
  assert.ok(replyVoice);
  assert.equal(replyVoice.voiceURI, playback[2].voiceURI);
  if (live) {
    await page.getByText('Speaking', { exact: true }).waitFor({ timeout: 9000 });
    await page.screenshot({ path: 'verification/groq/native/live-reply-speaking.png' });
    await page.waitForFunction(text => window.__voiceEvents.some(event => event.event === 'end' && event.text === text), replies[1], { timeout: 35000 });
    await page.getByText('Ready', { exact: true }).waitFor();
    console.log('PASS real Groq browser replies, cross-avatar name recall and native speech completion');
  }
  await page.getByRole('button', { name: 'Stop Speaking', exact: true }).click().catch(() => {});
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.avatar-modal').getAnimations().every(animation => animation.playState === 'finished'));
  await page.screenshot({ path: 'verification/groq/native/gallery.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'verification/groq/native/mobile-gallery.png' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const events = await page.evaluate(() => window.__voiceEvents);
  const result = { url: page.url(), live, voices, playback, distinctBaseVoices: new Set(playback.map(item => item.voiceURI).filter(Boolean)).size, errors, requests, replies, replyVoice, events };
  await writeFile(`verification/groq/native/browser-${live ? 'live-' : ''}results.json`, JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  console.log('PASS conversation identity, preserved memory, reply voice, gallery and mobile');
} finally {
  await page.screenshot({ path: 'verification/groq/native/last-state.png' }).catch(() => {});
  await browser.close();
}
