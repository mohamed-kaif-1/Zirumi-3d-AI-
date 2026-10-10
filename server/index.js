import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ApiError, DEFAULT_STT_MODEL, MAX_AUDIO_BYTES, AUDIO_TYPES, validateAudio, transcribeAudioDetailed } from './transcription.js';
import { DEFAULT_CHAT_MODEL, MAX_CHAT_BYTES, generateReplyDetailed, validateChatRequest } from './chat.js';
import { createTtsService, MAX_TTS_BYTES, validateTtsRequest } from './tts.js';
import { DEFAULT_GROQ_BASE_URL, createGroqModelRegistry } from './services/groq.js';
import { readProviderConfig } from './providerConfig.js';
import { createDeepgramProvider } from './services/deepgram.js';
import { createCartesiaProvider } from './services/cartesia.js';

export function createTranscriptionServer({ apiKey = process.env.GROQ_API_KEY, baseUrl = process.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL, model = process.env.GROQ_STT_MODEL || DEFAULT_STT_MODEL, chatModel = process.env.GROQ_CHAT_MODEL || DEFAULT_CHAT_MODEL, language = process.env.GROQ_STT_LANGUAGE || undefined, fetchImpl, elevenLabsApiKey = process.env.ELEVENLABS_API_KEY, airaVoiceId, ttsModel, ttsFallback, sttProvider = 'groq', ttsProvider = 'elevenlabs', deepgramApiKey = '', deepgramModel = 'nova-3', cartesiaApiKey = '', cartesiaModel = 'sonic-3.6', cartesiaVersion = '2026-08-14', cartesiaVoices = {}, now = Date.now, logger = record => console.info(JSON.stringify(record)), allowedOrigins: configuredOrigins = process.env.ZIRUMI_ALLOWED_ORIGINS } = {}) {
  if (!['groq', 'deepgram', 'browser'].includes(sttProvider) || !['elevenlabs', 'cartesia', 'browser'].includes(ttsProvider)) throw new ApiError(503, 'Unsupported speech provider configuration.');
  let inFlight = 0;
  const tts = ttsProvider === 'cartesia' ? createCartesiaProvider({ apiKey: cartesiaApiKey, model: cartesiaModel, version: cartesiaVersion, voices: cartesiaVoices, fetchImpl, now }) : ttsProvider === 'browser' ? {
    status: async () => ({ provider: 'Browser', configured: true, fallback: 'none', avatars: Object.fromEntries(['default', 'sky', 'nova', 'ember'].map(id => [id, { provider: 'browser', voiceId: null }])) }),
    synthesize: async () => { throw new ApiError(503, 'Browser speech is explicitly selected. Use the browser playback controls.'); },
  } : createTtsService({ apiKey: elevenLabsApiKey, airaVoiceId, model: ttsModel, fallback: ttsFallback, fetchImpl, now });
  const deepgram = sttProvider === 'deepgram' ? createDeepgramProvider({ apiKey: deepgramApiKey, model: deepgramModel, fetchImpl, now }) : null;
  const groqOptions = { apiKey, baseUrl, fetchImpl, now };
  const models = createGroqModelRegistry(groqOptions);
  const windows = { chat: { start: now(), count: 0, limit: 16 }, transcription: { start: now(), count: 0, limit: 10 }, speech: { start: now(), count: 0, limit: 10 } };
  const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173']);
  for (const origin of (configuredOrigins || '').split(',').map(value => value.trim()).filter(Boolean)) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('ZIRUMI_ALLOWED_ORIGINS must contain exact HTTPS origins.');
    allowedOrigins.add(origin);
  }
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('X-Zirumi-Request-Id', requestId);
    const send = (status, body) => {
      if (!response.destroyed) response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(body));
    };
    // Loopback only, plus origin/host checks. No permissive CORS or public key-bearing endpoint.
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(request.headers.host || '') || (request.headers.origin && !allowedOrigins.has(request.headers.origin))) {
      send(403, { error: 'This endpoint only accepts local ZIRUMI requests.' }); return;
    }
    if (request.url === '/api/transcription/status' && request.method === 'GET') {
      send(200, deepgram ? deepgram.status() : sttProvider === 'browser' ? { configured: true, provider: 'Browser', prefersServer: false, mode: 'browser' } : { configured: Boolean(apiKey?.trim()), provider: 'Groq', model, modelVerified: models.isVerified(model), prefersServer: true, mode: 'prerecorded', audioTypes: AUDIO_TYPES, maxAudioBytes: MAX_AUDIO_BYTES }); return;
    }
    if (request.url === '/api/providers/status' && request.method === 'GET') {
      send(200, { phase: 1, language: 'en', stt: sttProvider, llm: 'groq', tts: ttsProvider, streamingTranscription: false, streamingPlayback: false, persistentMemory: false, automaticFallback: false }); return;
    }
    if (request.url === '/api/chat/status' && request.method === 'GET') {
      send(200, { configured: Boolean(apiKey?.trim()), provider: 'Groq', model: chatModel, modelVerified: models.isVerified(chatModel) }); return;
    }
    if (request.url === '/api/tts/status' && request.method === 'GET') {
      try { send(200, await tts.status()); } catch { send(503, { error: 'Speech provider verification is unavailable.' }); }
      return;
    }
    const isChat = request.url === '/api/chat';
    const isTts = request.url === '/api/tts';
    if ((!isChat && !isTts && request.url !== '/api/transcribe') || request.method !== 'POST') { send(404, { error: 'Endpoint not found.' }); return; }
    const kind = isTts ? 'speech' : isChat ? 'chat' : 'transcription';
    const provider = isTts ? ttsProvider === 'cartesia' ? 'Cartesia' : ttsProvider === 'browser' ? 'Browser' : 'ElevenLabs' : isChat || sttProvider === 'groq' ? 'Groq' : sttProvider === 'deepgram' ? 'Deepgram' : 'Browser';
    const window = windows[kind];
    if (now() - window.start >= 60_000) { window.start = now(); window.count = 0; }
    if (++window.count > window.limit) { response.setHeader('Retry-After', String(Math.max(1, Math.ceil((60_000 - (now() - window.start)) / 1000)))); send(429, { error: `${isTts ? 'Speech' : isChat ? 'Conversation' : 'Transcription'} request limit reached. Wait a minute before trying again.` }); return; }
    if (inFlight >= 2) { send(429, { error: 'The AI server is busy. Please try again shortly.' }); return; }
    const abort = new AbortController();
    const onClose = () => { if (!response.writableEnded) abort.abort(); };
    response.on('close', onClose);
    const timeout = setTimeout(() => abort.abort(), 45_000);
    const started = now();
    inFlight += 1;
    try {
      if ((isChat || !isTts && sttProvider === 'groq') && !apiKey?.trim()) throw Object.assign(new ApiError(503, 'Groq is not connected. Configure GROQ_API_KEY in the backend .env and restart the server.'), { errorCode: 'missing_credentials' });
      const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
      if (isChat || isTts ? type !== 'application/json' : !AUDIO_TYPES.includes(type)) throw new ApiError(415, isChat || isTts ? 'Chat and TTS requests must use application/json.' : 'Only WebM, Ogg or WAV audio is supported.');
      const maxBytes = isTts ? MAX_TTS_BYTES : isChat ? MAX_CHAT_BYTES : MAX_AUDIO_BYTES;
      const sizeError = isTts ? 'Speech request must be at most 32 KB.' : isChat ? 'Chat request is too large.' : 'Audio must be at most 5 MB.';
      const length = Number(request.headers['content-length']);
      if (length > maxBytes) throw new ApiError(413, sizeError);
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) throw new ApiError(413, sizeError);
        chunks.push(chunk);
      }
      const audio = Buffer.concat(chunks);
      if (isTts) {
        let body;
        try { body = JSON.parse(audio.toString('utf8')); } catch { throw new ApiError(400, 'Speech request contains invalid JSON.'); }
        const result = await tts.synthesize(validateTtsRequest(body), { signal: abort.signal });
        logger({ event: 'ai_request', requestId, kind, provider, model: result.model, status: 200, latencyMs: Math.max(0, now() - started) });
        if (!response.destroyed) response.writeHead(200, { 'Content-Type': result.mimeType || 'audio/mpeg', 'Content-Length': result.audio.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Echo-Voice-Id': result.voiceId, 'X-Echo-Tts-Model': result.model, 'X-Zirumi-Tts-Provider': provider }).end(result.audio);
        return;
      }
      if (isChat) {
        let body;
        try { body = JSON.parse(audio.toString('utf8')); } catch { throw new ApiError(400, 'Chat request contains invalid JSON.'); }
        const input = validateChatRequest(body);
        await models.verify(chatModel, { signal: abort.signal });
        const result = await generateReplyDetailed(input, { ...groqOptions, model: chatModel, signal: abort.signal });
        logger({ event: 'ai_request', requestId, kind, status: 200, endpoint: `${DEFAULT_GROQ_BASE_URL}/chat/completions`, ...result.metadata });
        send(200, result); return;
      }
      const mimeType = validateAudio(audio, request.headers['content-type']);
      if (sttProvider === 'browser') throw new ApiError(503, 'Browser recognition is explicitly selected. Choose browser recognition in settings.');
      if (!deepgram) await models.verify(model, { signal: abort.signal });
      const result = deepgram ? await deepgram.transcribe(audio, mimeType, { signal: abort.signal }) : await transcribeAudioDetailed(audio, mimeType, { ...groqOptions, model, language, signal: abort.signal });
      logger({ event: 'ai_request', requestId, kind, status: 200, endpoint: deepgram ? 'https://api.deepgram.com/v1/listen' : `${DEFAULT_GROQ_BASE_URL}/audio/transcriptions`, ...result.metadata });
      send(200, result);
    } catch (error) {
      logger({ event: 'ai_request', requestId, provider, kind, model: isTts ? ttsProvider === 'cartesia' ? cartesiaModel : ttsModel || 'eleven_multilingual_v2' : isChat ? chatModel : deepgram ? deepgramModel : model, endpoint: error.endpoint || (isTts ? ttsProvider === 'cartesia' ? 'https://api.cartesia.ai/tts/bytes' : 'https://api.elevenlabs.io/v1/text-to-speech' : deepgram && !isChat ? 'https://api.deepgram.com/v1/listen' : isChat ? `${DEFAULT_GROQ_BASE_URL}/chat/completions` : `${DEFAULT_GROQ_BASE_URL}/audio/transcriptions`), errorCode: error.errorCode || error.networkCode || (error instanceof ApiError ? `http_${error.status}` : 'internal_error'), status: error instanceof ApiError ? error.status : 500, ...(Number.isInteger(error.providerStatus) ? { providerStatus: error.providerStatus } : {}), latencyMs: Math.max(0, now() - started), cancelled: abort.signal.aborted });
      if (error.status === 429 && Number.isInteger(error.retryAfter)) response.setHeader('Retry-After', String(error.retryAfter));
      send(error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : 'The AI request failed. Please try again.' });
    } finally {
      clearTimeout(timeout);
      response.removeListener('close', onClose);
      inFlight -= 1;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.TRANSCRIPTION_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TRANSCRIPTION_PORT must be a valid port.');
  const providers = readProviderConfig();
  const server = createTranscriptionServer(providers);
  server.requestTimeout = 50_000;
  server.headersTimeout = 10_000;
  server.listen(port, '127.0.0.1', () => {
    console.log(`ZIRUMI backend: http://127.0.0.1:${port}`);
    console.log(`Providers: STT=${providers.sttProvider}, conversation=groq, TTS=${providers.ttsProvider}; no automatic provider substitution.`);
  });
}
