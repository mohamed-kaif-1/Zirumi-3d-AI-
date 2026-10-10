import { ApiError } from './errors.js';

// Selection is explicit and server-owned. A failure never changes providers.
export function readProviderConfig(env = process.env) {
  const sttProvider = env.DEFAULT_STT_PROVIDER || 'deepgram';
  const ttsProvider = env.DEFAULT_TTS_PROVIDER || 'cartesia';
  if (!['deepgram', 'groq', 'browser'].includes(sttProvider)) throw new ApiError(503, 'DEFAULT_STT_PROVIDER must be deepgram, groq or browser.');
  if (!['cartesia', 'elevenlabs', 'browser'].includes(ttsProvider)) throw new ApiError(503, 'DEFAULT_TTS_PROVIDER must be cartesia, elevenlabs or browser.');
  if ((env.DEFAULT_LLM_PROVIDER || 'groq') !== 'groq') throw new ApiError(503, 'Phase 1 supports Groq conversation only.');
  if ((env.DEFAULT_LANGUAGE || 'en') !== 'en') throw new ApiError(503, 'Phase 1 supports English only.');
  return { sttProvider, ttsProvider, deepgramApiKey: env.DEEPGRAM_API_KEY || '', deepgramModel: env.DEEPGRAM_STT_MODEL || 'nova-3', cartesiaApiKey: env.CARTESIA_API_KEY || '', cartesiaModel: env.CARTESIA_TTS_MODEL || 'sonic-3.6', cartesiaVersion: env.CARTESIA_API_VERSION || '2026-08-14', cartesiaVoices: { default: env.CARTESIA_VOICE_AIRA || '', sky: env.CARTESIA_VOICE_LUNA || '', nova: env.CARTESIA_VOICE_MIRA || '', ember: env.CARTESIA_VOICE_ZYRA || '' } };
}
