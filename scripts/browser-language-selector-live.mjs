// Real browser/provider verification. Only the final error case is explicitly mocked.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { LANGUAGES, LANGUAGE_STORAGE_KEY } from '../src/languages.js';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const language = process.argv[2]; assert.ok(['ta-IN', 'hi-IN'].includes(language));
const output = 'verification/language-selector'; await mkdir(output, { recursive: true });
const base = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(process.env.TEMP, 'zirumi-phase3-' + language + '.wav')}`] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['microphone'] });
const page = await context.newPage();
const result = { date: new Date().toISOString(), language, normalProviderResponsesMocked: false, physicalMicrophoneVerified: false, virtualMicrophone: true, syntheticFixture: true, previews: [], requests: [], errors: [], passed: false };
page.on('pageerror', e => result.errors.push(e.message));
page.on('request', r => { if (r.method() === 'POST' && /\/api\/(tts|chat|transcribe)$/.test(r.url())) { const body = r.url().endsWith('/api/transcribe') ? {} : r.postDataJSON(); result.requests.push({ endpoint: r.url().split('/').at(-1), language: body.language || r.headers()['x-zirumi-language'] || 'en', avatarId: body.avatarId }); } });
await page.addInitScript(() => {
  localStorage.setItem('echo_selected_avatar', 'sky'); window.__ended = 0; window.__levels = []; window.__streams = [];
  const Audio = window.Audio; window.Audio = function(url) { const a = new Audio(url); a.addEventListener('ended', () => window.__ended++); return a; };
  const measure = AnalyserNode.prototype.getByteTimeDomainData;
  AnalyserNode.prototype.getByteTimeDomainData = function(buffer) { measure.call(this, buffer); window.__levels.push(Math.sqrt(buffer.reduce((s, n) => s + ((n - 128) / 128) ** 2, 0) / buffer.length)); };
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (...args) => capture(...args).then(s => { window.__streams.push(s); return s; });
});
async function choose(locale, shortcut = false) {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole('button', { name: shortcut ? /^Conversation Language:/ : 'Open settings', exact: !shortcut }).click();
  await page.getByRole('heading', { name: 'Conversation Language', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Conversation Language', exact: true }).selectOption(locale);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_STORAGE_KEY), locale);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, 'language changes must not reload');
}
async function select(name) {
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  const b = page.getByRole('button', { name: `Select ${name} avatar`, exact: true }); if (await b.getAttribute('aria-pressed') !== 'true') await b.click();
  await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name, { timeout: 90000 });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
}
const beforeAudio = () => page.evaluate(() => ({ ended: window.__ended, levels: window.__levels.length, mouth: window.__mouth.length }));
async function completeAudio(before) {
  await page.getByText('Speaking', { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('button', { name: 'Start speaking', exact: true }).isDisabled(), true);
  await page.waitForFunction(n => window.__ended > n, before.ended, { timeout: 60000 });
  await page.getByText('Ready', { exact: true }).waitFor();
  const measured = await page.evaluate(b => ({ peakRms: Math.max(0, ...window.__levels.slice(b.levels)), peakMouth: Math.max(0, ...window.__mouth.slice(b.mouth)), tracksReleased: window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }), before);
  result.lastMeasurement = measured; assert.ok(measured.peakRms > 0.01); assert.ok(measured.peakMouth > 0.1); assert.equal(measured.tracksReleased, true); return measured;
}
try {
  await page.goto(base); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  result.browserFallbackPresent = await page.locator('#base-voice-select').count() > 0;
  if (result.browserFallbackPresent) await page.getByText('Browser fallback:', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Conversation Language', exact: true }).click();
  await page.getByRole('heading', { name: 'Conversation Language', exact: true }).waitFor();
  result.voiceSettingsShortcut = true;
  assert.deepEqual(await page.locator('#conversation-language option').evaluateAll(options => options.map(o => o.value)), ['en', 'ta-IN', 'hi-IN', 'en-IN']);
  result.options = await page.locator('#conversation-language option').allTextContents();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  for (const locale of ['ta-IN', 'hi-IN', 'en-IN', 'en']) { await choose(locale, true); await page.getByRole('button', { name: `Conversation Language: ${LANGUAGES[locale].shortLabel}`, exact: true }).waitFor(); }
  await choose(language, true);
  const savedVoices = await page.evaluate(() => localStorage.getItem('echo_avatar_voice_settings_v1'));
  await page.reload(); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: `Conversation Language: ${LANGUAGES[language].shortLabel}`, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click(); assert.equal(await page.locator('#conversation-language').inputValue(), language); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  result.persistedAfterRefresh = true;
  await page.evaluate(async () => { const entry = performance.getEntriesByType('resource').find(e => e.name.includes('/src/AvatarAnimationController.js')); const { AvatarAnimationController } = await import(entry.name); const original = AvatarAnimationController.prototype.updateExpressions; window.__mouth = []; AvatarAnimationController.prototype.updateExpressions = function(delta, time) { original.call(this, delta, time); if (this.audioSpeechAmplitude !== null) window.__mouth.push(this.vrm?.expressionManager?.getValue('aa') || 0); }; });
  const status = await (await page.request.get(`${base}/api/tts/status?language=${language}`)).json(); assert.equal(status.provider, 'Sarvam'); assert.equal(status.configured, true);
  for (const [id, name] of [['sky', 'Luna'], ['default', 'Aira'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    await select(name); await choose(language === 'ta-IN' ? 'hi-IN' : 'ta-IN', true); await choose(language, true); await page.locator('.conversation-empty h2').filter({ hasText: LANGUAGES[language].sample[id] }).waitFor();
    const before = await beforeAudio(); const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/tts'), { timeout: 60000 });
    await page.getByRole('button', { name: `Preview ${name} voice`, exact: true }).click(); const response = await responsePromise;
    assert.equal(response.status(), 200); assert.equal(response.headers()['x-zirumi-tts-provider'], 'Sarvam'); assert.equal(response.headers()['x-echo-voice-id'], status.avatars[id].voiceId);
    result.previews.push({ avatarId: id, speaker: status.avatars[id].voiceId, ...await completeAudio(before) }); console.log('PASS ' + language + ' ' + name + ' native greeting, Sarvam preview and mouth animation.');
  }
  await select(language === 'ta-IN' ? 'Luna' : 'Aira'); const before = await beforeAudio();
  const sttPromise = page.waitForResponse(r => r.url().endsWith('/api/transcribe'), { timeout: 60000 });
  const chatPromise = page.waitForResponse(r => r.url().endsWith('/api/chat'), { timeout: 60000 });
  const ttsPromise = page.waitForResponse(r => r.url().endsWith('/api/tts'), { timeout: 60000 });
  await page.getByRole('button', { name: 'Start speaking', exact: true }).click(); await page.locator('.stage-status').filter({ hasText: 'Listening' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(5000); await page.getByRole('button', { name: 'Stop listening', exact: true }).press('Enter');
  const stt = await sttPromise, transcription = await stt.json(); assert.equal(stt.status(), 200); assert.equal(transcription.metadata.provider, 'Sarvam'); assert.equal(transcription.metadata.language, language);
  const chat = await chatPromise, reply = await chat.json(); assert.equal(chat.status(), 200); assert.match(reply.reply, language === 'ta-IN' ? /\p{Script=Tamil}/u : /\p{Script=Devanagari}/u);
  const tts = await ttsPromise; assert.equal(tts.status(), 200); assert.equal(tts.headers()['x-zirumi-tts-provider'], 'Sarvam');
  result.speechToSpeech = { transcription: transcription.metadata, reply: reply.reply, conversation: reply.metadata, ...await completeAudio(before) };
  assert.equal(await page.locator('.message-user').count(), 1); assert.equal(await page.locator('.message-assistant').count(), 1);
  assert.equal(result.requests.filter(r => r.endpoint === 'transcribe').length, 1); assert.ok(result.requests.every(r => r.language === language));
  await choose('en', true); assert.equal(await page.locator('.message').count(), 2); await choose(language, true); assert.equal(await page.locator('.message').count(), 2); result.historyPreserved = true;
  assert.equal(await page.evaluate(() => localStorage.getItem('echo_avatar_voice_settings_v1')), savedVoices); result.characterVoicePreferencesUnchanged = true;
  await page.screenshot({ path: `${output}/${language}-conversation.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Conversation Language:/ }).click();
  const selectBox = await page.locator('#conversation-language').boundingBox(); assert.ok(selectBox.y >= 0 && selectBox.y + selectBox.height <= 844 && selectBox.x >= 0 && selectBox.x + selectBox.width <= 391);
  await page.waitForFunction(() => [...document.querySelectorAll('.avatar-modal-overlay, .avatar-modal')].every(e => getComputedStyle(e).opacity === '1' && !e.getAnimations().some(a => a.playState === 'running')));
  await page.screenshot({ path: `${output}/${language}-mobile-settings.png` }); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const micBox = await page.getByRole('button', { name: 'Start speaking', exact: true }).boundingBox(); assert.ok(micBox.y + micBox.height <= 844); result.mobileDiscoverable = true;
  // Explicit error-only fixture: verifies visibility and absence of English playback, without consuming another credit.
  await page.setViewportSize({ width: 1440, height: 1000 }); const errorPage = page;
  await errorPage.addInitScript(({ key, language }) => { localStorage.setItem(key, language); window.__browserSpeechCalls = 0; speechSynthesis.speak = () => window.__browserSpeechCalls++; }, { key: LANGUAGE_STORAGE_KEY, language });
  await errorPage.route('**/api/tts', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Sarvam could not find the configured voice or model.' }) }));
  await errorPage.goto(base); await errorPage.getByText(/Avatar ready/).waitFor({ timeout: 90000 }); await errorPage.getByRole('button', { name: /Preview .+ voice/ }).click(); await errorPage.getByText('Sarvam could not find the configured voice or model.', { exact: true }).waitFor();
  assert.equal(await errorPage.evaluate(() => window.__browserSpeechCalls), 0); result.errorVisibility = 'mocked missing-speaker response only; no English fallback';
  assert.deepEqual(result.errors, []); result.passed = true; console.log('PASS ' + language + ' persisted language, real microphone -> Sarvam -> Groq -> Sarvam, history, mobile and separate fallback settings.');
} catch (e) { result.failure = e.message; process.exitCode = 1; console.error(e.message); }
finally { await page.screenshot({ path: `${output}/${language}-last-state.png` }).catch(() => {}); await writeFile(`${output}/${language}-live.json`, JSON.stringify(result, null, 2)); await browser.close(); }
