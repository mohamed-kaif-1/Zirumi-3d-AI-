// Real provider requests and actual audio/VRM playback; a virtual microphone
// supplies a short spoken fixture. No provider audio is written to disk.
import { createRequire } from 'node:module';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const language = process.argv[2];
const speechOnly = process.argv[3] === 'speech-only';
assert.ok(['ta-IN', 'hi-IN', 'en-IN'].includes(language));
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(process.env.TEMP, language === 'en-IN' ? 'zirumi-phase1-live-input.wav' : 'zirumi-phase3-' + language + '.wav')}`] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['microphone'] });
const page = await context.newPage();
const result = { date: new Date().toISOString(), mockedProviderResponses: false, audioSaved: false, virtualMicrophone: true, physicalMicrophoneVerified: false, voiceQualityHumanReviewed: false, language, previews: [], requests: [], errors: [], passed: false };
page.on('pageerror', error => result.errors.push(error.message));
page.on('request', request => { if (/\/api\/(transcribe|chat|tts)$/.test(request.url())) result.requests.push({ endpoint: request.url().split('/').at(-1) }); });
await page.addInitScript(() => {
  localStorage.setItem('echo_selected_avatar', 'sky');
  window.__audio = []; window.__levels = []; window.__ended = 0; window.__streams = [];
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (...args) => capture(...args).then(stream => { window.__streams.push(stream); return stream; });
  const OriginalAudio = window.Audio;
  window.Audio = function(url) { const audio = new OriginalAudio(url); audio.addEventListener('ended', () => window.__ended++); window.__audio.push(audio); return audio; };
  const analyse = AnalyserNode.prototype.getByteTimeDomainData;
  AnalyserNode.prototype.getByteTimeDomainData = function(buffer) { analyse.call(this, buffer); window.__levels.push(Math.sqrt(buffer.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / buffer.length)); };
});
async function select(name) {
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  const button = page.getByRole('button', { name: `Select ${name} avatar`, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.waitForFunction(n => document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed') === 'true', name, { timeout: 90000 });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
}
async function beforeAudio() { return page.evaluate(() => ({ ended: window.__ended, mouth: window.__mouth.length, levels: window.__levels.length })); }
async function completeAudio(before) {
  await page.getByText('Speaking', { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('button', { name: 'Start speaking', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
  await page.waitForFunction(n => window.__ended > n, before.ended, { timeout: 60000 });
  await page.getByText('Ready', { exact: true }).waitFor();
  const measured = await page.evaluate(before => ({ peakRms: Math.max(0, ...window.__levels.slice(before.levels)), peakMouth: Math.max(0, ...window.__mouth.slice(before.mouth).map(m => m.mouth)), closedInSilence: window.__mouth.slice(before.mouth).some(m => m.level === 0 && m.mouth < 0.02) }), before);
  result.lastAudioMeasurement = measured;
  assert.ok(measured.peakRms > 0.01); assert.ok(measured.peakMouth > 0.1);
  return measured;
}
try {
  const status = await (await page.request.get(`${base}/api/tts/status?language=${language}`)).json();
  assert.equal(status.provider, 'Sarvam'); assert.equal(status.distinctAssignments, 4); assert.ok(Object.values(status.avatars).every(v => v.available));
  await page.goto(base); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.locator('#conversation-language').selectOption(language);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/AvatarAnimationController.js'))?.name;
    const { AvatarAnimationController } = await import(url), update = AvatarAnimationController.prototype.updateExpressions;
    window.__mouth = [];
    AvatarAnimationController.prototype.updateExpressions = function(delta, time) { update.call(this, delta, time); if (this.audioSpeechAmplitude !== null) window.__mouth.push({ level: this.audioSpeechAmplitude, mouth: this.vrm?.expressionManager?.getValue('aa') || 0 }); };
  });
  if (speechOnly) {
    const previous = JSON.parse(await readFile('verification/phase3/' + language + '-first-attempt.json', 'utf8'));
    assert.equal(previous.previews.length, 4); assert.ok(previous.previews.every(p => p.status === 200 && p.peakMouth > 0.1));
    result.previews = previous.previews; result.previousPreviewEvidence = language + '-first-attempt.json'; result.cachedPreviewStopPassed = previous.cachedPreviewStopPassed;
  }
  for (const [id, name] of speechOnly ? [] : [['sky', 'Luna'], ['default', 'Aira'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    await select(name); const before = await beforeAudio(); const started = Date.now();
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/tts'), { timeout: 60000 });
    await page.getByRole('button', { name: `Preview ${name} voice`, exact: true }).click();
    const response = await responsePromise; const responseMs = Date.now() - started; assert.equal(response.status(), 200);
    const headers = response.headers(); assert.equal(headers['x-zirumi-tts-provider'], 'Sarvam'); assert.equal(headers['x-echo-voice-id'], status.avatars[id].voiceId);
    const measured = await completeAudio(before);
    result.previews.push({ avatarId: id, voiceName: status.avatars[id].name, voiceId: status.avatars[id].voiceId, status: response.status(), mimeType: headers['content-type'], responseMs, previewTotalMs: Date.now() - started, ...measured });
    console.log(`PASS real ${name} synthesis, playback and RMS mouth animation.`);
  }
  assert.equal(await page.locator('.message').count(), 0);
  if (!speechOnly) {
  const count = result.requests.length;
  await page.getByRole('button', { name: 'Preview Zyra voice', exact: true }).click(); await page.getByText('Speaking', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop Speaking', exact: true }).click();
  assert.equal(result.requests.length, count); assert.equal(await page.evaluate(() => window.__audio.filter(a => !a.paused && !a.ended).length), 0);
  result.cachedPreviewStopPassed = true;
  }
  await select('Luna'); const before = await beforeAudio();
  const sttPromise = page.waitForResponse(r => r.url().endsWith('/api/transcribe'), { timeout: 60000 });
  const chatPromise = page.waitForResponse(r => r.url().endsWith('/api/chat'), { timeout: 60000 });
  const ttsPromise = page.waitForResponse(r => r.url().endsWith('/api/tts'), { timeout: 60000 });
  await page.getByRole('button', { name: 'Start speaking', exact: true }).click();
  await page.locator('.stage-status').filter({ hasText: 'Listening' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(6000); await page.getByRole('button', { name: 'Stop listening', exact: true }).press('Enter');
  const stt = await sttPromise; const transcription = await stt.json(); assert.equal(stt.status(), 200); assert.equal(transcription.metadata.provider, 'Sarvam');
  const chat = await chatPromise; assert.equal(chat.status(), 200);
  const tts = await ttsPromise; assert.equal(tts.status(), 200); assert.equal(tts.headers()['x-zirumi-tts-provider'], 'Sarvam');
  const measured = await completeAudio(before);
  assert.equal(await page.locator('.message-user').count(), 1); assert.equal(await page.locator('.message-assistant').count(), 1);
  assert.equal(result.requests.filter(r => r.endpoint === 'transcribe').length, 1); assert.equal(result.requests.filter(r => r.endpoint === 'chat').length, 1); assert.equal(result.requests.filter(r => r.endpoint === 'tts').length, speechOnly ? 1 : 5);
  result.speechToSpeech = { passed: true, liveSarvamTranscription: true, liveGroq: true, liveSarvamSpeech: true, avatarId: 'sky', transcriptionMetadata: transcription.metadata, microphoneReleased: true, singleTranscriptTurn: true, ...measured };
  result.reply = await page.locator('.message-assistant p').innerText();
  await page.screenshot({ path: 'verification/phase3/' + language + '-speech-to-speech.png' });
  assert.deepEqual(result.errors, []); result.passed = true;
  console.log('PASS real Sarvam -> Groq -> Sarvam browser conversation, microphone exclusion, single submission and actual avatar playback.');
} catch (error) { result.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally { await page.screenshot({ path: 'verification/phase3/' + language + '-last-state.png' }).catch(() => {}); await writeFile('verification/phase3/' + language + '-browser-live.json', JSON.stringify(result, null, 2)); await browser.close(); }
