import { ApiError } from '../errors.js';
import { validateAudio, AUDIO_TYPES, MAX_AUDIO_BYTES } from '../transcription.js';
import { speechRequest, readProviderJson } from './speechHttp.js';

export function createDeepgramProvider({ apiKey = '', model = 'nova-3', fetchImpl, now = Date.now } = {}) {
  if (!/^nova-3(?:-general)?$/.test(model)) throw new ApiError(503, 'Phase 1 Deepgram transcription requires a Nova-3 model.');
  let modelVerified = false;
  return {
    status: () => ({ configured: Boolean(apiKey.trim()), provider: 'Deepgram', model, modelVerified, language: 'en', mode: 'prerecorded', prefersServer: true, audioTypes: AUDIO_TYPES, maxAudioBytes: MAX_AUDIO_BYTES }),
    async transcribe(audio, mimeType, { signal } = {}) {
      const type = validateAudio(audio, mimeType);
      const started = now();
      const url = new URL('https://api.deepgram.com/v1/listen');
      url.search = new URLSearchParams({ model, language: 'en', smart_format: 'true', punctuate: 'true' }).toString();
      const result = await speechRequest(url.href, { provider: 'Deepgram', apiKey, headers: { Authorization: `Token ${apiKey.trim()}`, 'Content-Type': type }, body: audio, signal, fetchImpl, consume: readProviderJson });
      const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      if (typeof transcript !== 'string' || transcript.length > 20_000) throw new ApiError(502, 'Deepgram returned an invalid final transcript.');
      modelVerified = true;
      return { transcript: transcript.trim(), metadata: { provider: 'Deepgram', model, language: 'en', mode: 'prerecorded', latencyMs: Math.max(0, now() - started), ...(Number.isFinite(result.metadata?.duration) && result.metadata.duration >= 0 ? { durationSeconds: result.metadata.duration } : {}) } };
    },
  };
}
