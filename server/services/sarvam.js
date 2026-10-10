import { ApiError } from '../errors.js';
import { validateAudio, MAX_AUDIO_BYTES } from '../transcription.js';
import { validateTtsRequest, MAX_TTS_AUDIO } from '../tts.js';
import { validateLanguage, validateReplyLanguage } from '../languages.js';
import { CHARACTER_PERSONALITIES } from '../../src/characterPersonalities.js';
import { speechRequest, readProviderJson } from './speechHttp.js';
import { normalizeGeneratedWav, validateGeneratedWav } from './cartesia.js';

// Official catalog snapshot checked 2026-10-10. Tamil v4 offers male personas;
// this explicit v3 route preserves feminine voices, with no model fallback.
const CATALOG = {
  'ta-IN': { model: 'bulbul:v3', voices: { default: 'roopa', sky: 'ritu', nova: 'kavitha', ember: 'neha' } },
  'hi-IN': { model: 'bulbul:v4-flash', voices: { default: 'roopa_hi_companion', sky: 'ritu_hi_social_lively', nova: 'kavya_hi_conversational', ember: 'shreya_hi_conversational' } },
  'en-IN': { model: 'bulbul:v4-flash', voices: { default: 'aparna_en_companion', sky: 'ritu_en_reels', nova: 'ishita_en_customer', ember: 'sanchita_en_social' } },
};
export function createSarvamProvider({ apiKey = '', sttModel = 'saaras:v4', models = {}, voices = {}, fetchImpl, now = Date.now } = {}) {
  if (!['saaras:v3', 'saaras:v4'].includes(sttModel)) throw new ApiError(503, 'Configure a documented Sarvam Saaras v3 or v4 transcription model.');
  const routes = Object.fromEntries(Object.entries(CATALOG).map(([language, catalog]) => {
    const model = models[language] || catalog.model;
    const available = model === 'bulbul:v3' ? CATALOG['ta-IN'].voices : catalog.voices;
    const route = { model, voices: { ...available, ...voices[language] } };
    if (!['bulbul:v3', 'bulbul:v4-flash'].includes(model) || language === 'ta-IN' && model !== 'bulbul:v3' || Object.values(route.voices).some(voice => !Object.values(available).includes(voice)) || new Set(Object.values(route.voices)).size !== 4) throw new ApiError(503, 'Sarvam language voices must match this documented model/catalog and be distinct.');
    return [language, route];
  }));
  const verified = new Set();
  function route(language) { validateLanguage(language); if (!routes[language]) throw new ApiError(400, 'Sarvam requires explicitly selected Tamil, Hindi or Indian English.'); return routes[language]; }
  const request = (url, body, signal, consume = readProviderJson) => speechRequest('https://api.sarvam.ai' + url, { provider: 'Sarvam', apiKey, headers: { 'api-subscription-key': apiKey.trim(), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body), signal, fetchImpl, consume });
  return {
    transcriptionStatus(language) { route(language); return { provider: 'Sarvam', configured: Boolean(apiKey.trim()), model: sttModel, language, mode: 'prerecorded', prefersServer: true, maxAudioBytes: MAX_AUDIO_BYTES, maxRecordingSeconds: 30 }; },
    status(language) {
      const selected = route(language);
      return { provider: 'Sarvam', configured: Boolean(apiKey.trim()), language, model: selected.model, modelVerified: [...verified].some(id => id.startsWith(language + ':')), mode: 'request-response', fallback: 'none', catalogSource: 'official documentation; account access requires synthesis', distinctAssignments: 4, continuityNotice: 'Indian-language voices differ from the English Cartesia voices. Tamil explicitly uses Bulbul v3 feminine voices.', avatars: Object.fromEntries(Object.entries(CHARACTER_PERSONALITIES).map(([id, character]) => [id, { provider: 'sarvam', displayName: character.name, name: selected.voices[id], voiceId: selected.voices[id], available: Boolean(apiKey.trim()), synthesisVerified: verified.has(language + ':' + id), configurationPending: !apiKey.trim(), error: apiKey.trim() ? '' : 'Sarvam is not configured. Add SARVAM_API_KEY to the backend .env.' }])) };
    },
    async transcribe(audio, mimeType, language, { signal } = {}) {
      route(language); const started = now(), type = validateAudio(audio, mimeType);
      const form = new FormData(); form.append('file', new Blob([audio], { type }), type.includes('wav') ? 'recording.wav' : type.includes('ogg') ? 'recording.ogg' : 'recording.webm'); form.append('model', sttModel); form.append('language_code', language); if (sttModel === 'saaras:v3') form.append('mode', 'transcribe');
      const data = await request('/speech-to-text', form, signal);
      if (!data || typeof data.transcript !== 'string' || data.transcript.length > 4000) throw new ApiError(502, 'Sarvam returned an invalid or oversized transcript.');
      const transcript = data.transcript.trim();
      if (transcript && data.language_code !== language) throw new ApiError(422, 'Sarvam detected a different language. Select the spoken language and try again; no English transcription was substituted.');
      return { transcript, metadata: { provider: 'Sarvam', model: sttModel, language, mode: 'prerecorded', latencyMs: now() - started } };
    },
    async synthesize(body, { signal } = {}) {
      const input = validateTtsRequest(body), language = input.language || 'en', selected = route(language), started = now();
      if (input.text.length > 2500) throw new ApiError(413, 'Sarvam speech supports at most 2,500 characters. Ask for a shorter response.');
      validateReplyLanguage(input.text, language);
      const data = await request('/text-to-speech', { text: input.text, language_code: language, model: selected.model, speaker: selected.voices[input.avatarId], pace: input.rate, temperature: input.avatarId === 'sky' || input.avatarId === 'ember' ? 0.7 : 0.5, speech_sample_rate: 44100, output_audio_codec: 'wav' }, signal, res => readProviderJson(res, Math.ceil(MAX_TTS_AUDIO * 4 / 3) + 4096));
      if (!data || !Array.isArray(data.audios) || data.audios.length !== 1 || typeof data.audios[0] !== 'string' || data.audios[0].length > Math.ceil(MAX_TTS_AUDIO * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audios[0]) || data.audios[0].length % 4) throw new ApiError(502, 'Sarvam returned invalid speech audio.');
      const decoded = Buffer.from(data.audios[0], 'base64');
      if (decoded.length > MAX_TTS_AUDIO) throw new ApiError(502, 'Sarvam returned oversized speech audio.');
      let audio;
      try { audio = normalizeGeneratedWav(decoded); validateGeneratedWav(audio); } catch { throw new ApiError(502, 'Sarvam returned invalid PCM WAV audio.'); }
      verified.add(language + ':' + input.avatarId);
      return { audio, mimeType: 'audio/wav', voiceId: selected.voices[input.avatarId], model: selected.model, metadata: { provider: 'Sarvam', language, model: selected.model, latencyMs: now() - started } };
    },
  };
}
