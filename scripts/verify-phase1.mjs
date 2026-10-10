// Explicit opt-in live check; no audio or full provider envelopes are saved.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readProviderConfig } from '../server/providerConfig.js';
import { createDeepgramProvider } from '../server/services/deepgram.js';
import { createCartesiaProvider } from '../server/services/cartesia.js';
import { createGroqModelRegistry } from '../server/services/groq.js';
import { generateReplyDetailed } from '../server/chat.js';
import { CHARACTER_PERSONALITIES } from '../src/characterPersonalities.js';
const config = readProviderConfig();
const result = { date: new Date().toISOString(), phase: 1, status: 'PHASE PARTIALLY COMPLETE', ready: false, billingBalance: 'Unknown; verify account credits before using --synthesize. No automatic retries.', prerequisites: { deepgram: Boolean(config.deepgramApiKey), groq: Boolean(process.env.GROQ_API_KEY), cartesia: Boolean(config.cartesiaApiKey), voiceAssignments: Object.values(config.cartesiaVoices).filter(Boolean).length }, live: {}, blockers: [] };
for (const [key, value] of Object.entries(result.prerequisites)) if (!value || key === 'voiceAssignments' && value !== 4) result.blockers.push(key);
try {
  if (result.blockers.length) throw new Error(`Missing Phase 1 configuration: ${result.blockers.join(', ')}.`);
  const cartesia = createCartesiaProvider({ apiKey: config.cartesiaApiKey, model: config.cartesiaModel, version: config.cartesiaVersion, voices: config.cartesiaVoices });
  const catalog = await cartesia.status();
  result.catalog = catalog;
  if (Object.values(catalog.avatars).some(voice => !voice.available)) throw new Error('At least one Cartesia voice failed account/catalog verification.');
  const browser = JSON.parse(await readFile('verification/phase1/browser-live-speech-results.json', 'utf8').catch(() => '{}'));
  const browserVerified = browser.passed === true && browser.mockedProviderResponses === false && browser.speechToSpeech?.passed === true && browser.speechToSpeech?.liveDeepgram && browser.speechToSpeech?.liveGroq && browser.speechToSpeech?.liveCartesia && browser.previews?.length === 4 && browser.previews.every(v => v.status === 200 && v.voiceId === config.cartesiaVoices[v.avatarId]) && Date.now() - Date.parse(browser.date) < 3_600_000;
  if (!process.argv.includes('--synthesize')) {
    if (!browserVerified) throw new Error('Catalog checked without consuming synthesis credits. A recent real browser speech-to-speech check is still required.');
    result.live.browser = { verified: true, evidence: 'browser-live-speech-results.json', physicalMicrophoneVerified: browser.physicalMicrophoneVerified, voiceQualityHumanReviewed: browser.voiceQualityHumanReviewed };
    result.status = 'PHASE PASSED'; result.ready = true;
  } else {
  const file = process.argv.find((arg, i) => i > 1 && arg !== '--synthesize');
  if (!file) throw new Error('A short recorded WAV/WebM/Ogg path is required.');
  const audio = await readFile(file), mimeType = file.endsWith('.wav') ? 'audio/wav' : file.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm';
  const transcription = await createDeepgramProvider({ apiKey: config.deepgramApiKey, model: config.deepgramModel }).transcribe(audio, mimeType);
  if (!transcription.transcript) throw new Error('The recorded sample contained no recognized speech.');
  result.live.deepgram = transcription.metadata;
  const groq = { apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b' };
  await createGroqModelRegistry(groq).verify(groq.model);
  const reply = await generateReplyDetailed({ avatarId: 'sky', message: transcription.transcript, history: [] }, groq);
  result.live.groq = reply.metadata;
  result.live.cartesia = [];
  for (const [id, character] of Object.entries(CHARACTER_PERSONALITIES)) {
    const synthesis = await cartesia.synthesize({ avatarId: id, text: id === 'sky' ? reply.reply : character.sample });
    result.live.cartesia.push({ avatarId: id, voiceId: synthesis.voiceId, audioBytes: synthesis.audio.length, ...synthesis.metadata });
  }
  result.backendSpeechToSpeech = true;
  if (browserVerified) { result.status = 'PHASE PASSED'; result.ready = true; }
  else result.blockers.push('A real browser speech-to-speech playback check is still required.');
  }
} catch (error) { result.error = error.message; }
await mkdir('verification/phase1', { recursive: true }); await writeFile('verification/phase1/provider-gate.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ready ? 0 : 1;
