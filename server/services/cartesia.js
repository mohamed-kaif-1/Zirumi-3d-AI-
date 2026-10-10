import { ApiError } from '../errors.js';
import { validateTtsRequest, MAX_TTS_AUDIO } from '../tts.js';
import { CHARACTER_PERSONALITIES } from '../../src/characterPersonalities.js';
import { speechRequest, readProviderBytes, readProviderJson } from './speechHttp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMOTION = { default: 'content', sky: 'happy', nova: 'calm', ember: 'confident' };
export function createCartesiaProvider({ apiKey = '', model = 'sonic-3.6', version = '2026-08-14', voices = {}, fetchImpl, now = Date.now } = {}) {
  if (!/^sonic-(?:3(?:\.5|\.6)?(?:-\d{4}-\d{2}-\d{2})?|latest)$/.test(model)) throw new ApiError(503, 'Configure a documented Sonic 3 model for Cartesia.');
  if (version !== '2026-08-14') throw new ApiError(503, 'This Cartesia adapter requires CARTESIA_API_VERSION=2026-08-14.');
  const registry = Object.fromEntries(Object.entries(CHARACTER_PERSONALITIES).map(([id, character]) => [id, { displayName: character.name, provider: 'cartesia', voiceId: voices[id]?.trim().toLowerCase() || null }]));
  const assigned = Object.values(registry).map(v => v.voiceId).filter(Boolean);
  if (assigned.some(id => !UUID.test(id))) throw new ApiError(503, 'Cartesia voice assignments must be catalog UUIDs; ElevenLabs IDs are incompatible.');
  if (new Set(assigned).size !== assigned.length) throw new ApiError(503, 'Each Cartesia character requires a distinct voice ID.');
  const verified = new Map(), synthesized = new Set(), synthesisErrors = new Map();
  let cache, expires = 0, loading;
  const headers = { Authorization: `Bearer ${apiKey.trim()}`, 'Cartesia-Version': version };
  async function voiceMetadata(id) {
    const data = await speechRequest(`https://api.cartesia.ai/voices/${id}`, { provider: 'Cartesia', apiKey, headers, fetchImpl, timeoutMs: 15_000, consume: readProviderJson });
    const english = typeof data?.language === 'string' && /^en(?:-|$)/i.test(data.language) || Array.isArray(data?.accents) && data.accents.some(a => /^en(?:-|$)/i.test(a.locale || '') && a.is_native === true);
    if (data?.id !== id || data.status !== 'active' || !['public', 'private'].includes(data.access) || data.access === 'private' && data.is_owner !== true || data.gender !== 'feminine' || !english) throw new ApiError(503, 'The assigned Cartesia voice must be active, accessible, feminine and native English.');
    return { name: typeof data.name === 'string' ? data.name.slice(0, 200) : null, language: 'en', gender: data.gender, access: data.access, metadataVerified: true };
  }
  async function refresh() {
    const avatars = {};
    await Promise.all(Object.entries(registry).map(async ([id, config]) => {
      const avatar = { ...config, name: null, available: false, metadataVerified: false, synthesisVerified: synthesized.has(id), configurationPending: !config.voiceId, error: '' };
      if (!apiKey.trim()) avatar.error = 'Cartesia is not configured. Add CARTESIA_API_KEY to the backend .env.';
      else if (!config.voiceId) avatar.error = `Assign a verified Cartesia voice for ${config.displayName} in the backend .env.`;
      else try { const meta = await voiceMetadata(config.voiceId); verified.set(id, meta); Object.assign(avatar, meta, { available: true }); }
      catch (error) { verified.delete(id); avatar.error = error instanceof ApiError ? error.message : 'Cartesia voice verification failed.'; }
      const failure = synthesisErrors.get(id);
      if (failure) Object.assign(avatar, { available: false, synthesisError: true, error: failure.message });
      avatars[id] = avatar;
    }));
    return { provider: 'Cartesia', configured: Boolean(apiKey.trim()), model, apiVersion: version, modelVerified: synthesized.size > 0, outputFormat: 'wav_pcm_s16le_44100', language: 'en', mode: 'request-response', fallback: 'none', distinctAssignments: assigned.length, avatars };
  }
  async function status() {
    if (cache && now() < expires) return cache;
    if (!loading) loading = refresh().then(result => { cache = result; expires = now() + (Object.values(result.avatars).every(a => a.available) ? 300_000 : 15_000); return result; }).finally(() => { loading = null; });
    return loading;
  }
  async function synthesize(body, { signal } = {}) {
    const input = validateTtsRequest(body), started = now();
    if (signal?.aborted) throw new ApiError(504, 'Cartesia speech synthesis was cancelled.');
    const config = registry[input.avatarId];
    if (!apiKey.trim()) throw new ApiError(503, 'Cartesia is not configured. Add CARTESIA_API_KEY to the backend .env and restart the server.');
    if (!config.voiceId) throw new ApiError(503, `Assign a verified Cartesia voice for ${config.displayName} in the backend .env.`);
    await status();
    if (signal?.aborted) throw new ApiError(504, 'Cartesia speech synthesis was cancelled.');
    if (!verified.has(input.avatarId)) throw new ApiError(503, cache.avatars[input.avatarId].error || 'Cartesia voice verification failed.');
    try {
      const audio = await speechRequest('https://api.cartesia.ai/tts/bytes', { provider: 'Cartesia', apiKey, headers: { ...headers, 'Content-Type': 'application/json', Accept: 'audio/wav' }, body: JSON.stringify({ model_id: model, transcript: input.text, voice: config.voiceId, locale: 'en', output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 }, generation_config: { speed: input.rate, volume: 1, emotion: ['calm', 'gentle'].includes(input.presetId) ? 'calm' : EMOTION[input.avatarId] } }), fetchImpl, signal, consume: async response => {
        if (!/^audio\/(?:wav|wave|x-wav)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new ApiError(502, 'Cartesia did not return WAV audio.');
        const bytes = normalizeGeneratedWav(await readProviderBytes(response, MAX_TTS_AUDIO));
        validateGeneratedWav(bytes);
        return bytes;
      } });
      synthesized.add(input.avatarId); synthesisErrors.delete(input.avatarId);
      Object.assign(cache.avatars[input.avatarId], { synthesisVerified: true, available: true, synthesisError: false, error: '' }); cache.modelVerified = true;
      return { audio, mimeType: 'audio/wav', voiceId: config.voiceId, model, metadata: { provider: 'Cartesia', model, latencyMs: Math.max(0, now() - started) } };
    } catch (error) { synthesisErrors.set(input.avatarId, error); Object.assign(cache.avatars[input.avatarId], { available: false, synthesisError: true, error: error instanceof ApiError ? error.message : 'Cartesia speech failed.' }); throw error; }
  }
  return { status, synthesize };
}

// The bytes endpoint can stream WAV with unknown RIFF/data lengths. After the
// bounded response completes, repair only these sentinel fields before playback.
export function normalizeGeneratedWav(bytes) {
  if (bytes.length < 46 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) !== 0xffffffff) return bytes;
  const output = Buffer.from(bytes);
  let offset = 12;
  while (offset + 8 <= output.length) {
    const type = output.toString('ascii', offset, offset + 4), size = output.readUInt32LE(offset + 4), start = offset + 8;
    if (type === 'data' && size === 0xffffffff) {
      const remaining = output.length - start;
      if (remaining < 2 || remaining % 2) throw new ApiError(502, 'Cartesia returned incomplete PCM audio.');
      output.writeUInt32LE(remaining, offset + 4);
      offset = output.length;
      break;
    }
    if (start + size > output.length) throw new ApiError(502, 'Cartesia returned truncated WAV audio.');
    offset = start + size + size % 2;
  }
  if (offset !== output.length) throw new ApiError(502, 'Cartesia returned truncated WAV audio.');
  output.writeUInt32LE(output.length - 8, 4);
  validateGeneratedWav(output);
  return output;
}

// Validate provider audio independently of the smaller microphone upload limit.
export function validateGeneratedWav(bytes) {
  if (bytes.length < 46 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new ApiError(502, 'Cartesia returned invalid WAV audio.');
  let offset = 12, format = false, data = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw new ApiError(502, 'Cartesia returned truncated WAV audio.');
    if (type === 'fmt ') { if (size < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 || bytes.readUInt32LE(start + 4) !== 44100 || bytes.readUInt16LE(start + 14) !== 16 || bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt32LE(start + 8) !== 88200) throw new ApiError(502, 'Cartesia returned an unexpected WAV encoding.'); format = true; }
    if (type === 'data') { if (size < 2 || size % 2) throw new ApiError(502, 'Cartesia returned empty or invalid PCM audio.'); data = true; }
    offset = start + size + size % 2;
  }
  if (!format || !data || offset !== bytes.length) throw new ApiError(502, 'Cartesia returned incomplete WAV audio.');
}
