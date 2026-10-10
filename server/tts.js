import { ApiError } from './transcription.js';
import { createVoiceRegistry, isRegisteredTtsAvatar, normalizeTtsAvatarId } from './voiceRegistry.js';
import { getAvatarVoiceProfile } from '../src/avatarVoiceProfiles.js';
import { VOICE_PRESETS } from '../src/voicePresets.js';

export const MAX_TTS_BYTES = 32 * 1024;
export const MAX_TTS_TEXT = 6000;
export const MAX_TTS_AUDIO = 10 * 1024 * 1024;
export const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
export const TTS_FORMAT = 'mp3_44100_128';

export function validateTtsRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['text', 'avatarId', 'rate', 'presetId'].includes(key))) throw new ApiError(400, 'Expected text and an allowlisted avatarId.');
  if (!isRegisteredTtsAvatar(body.avatarId)) throw new ApiError(400, 'Unknown character voice.');
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_TTS_TEXT) throw new ApiError(400, 'Speech text must contain 1–6,000 characters.');
  if (body.rate !== undefined && (typeof body.rate !== 'number' || !Number.isFinite(body.rate) || body.rate < 0.75 || body.rate > 1.2)) throw new ApiError(400, 'Speech rate must be between 0.75 and 1.20.');
  if (body.presetId !== undefined && !VOICE_PRESETS.some(p => p.id === body.presetId)) throw new ApiError(400, 'Unknown voice tone preset.');
  const avatarId = normalizeTtsAvatarId(body.avatarId);
  const profile = getAvatarVoiceProfile(avatarId);
  return { text: body.text.trim(), avatarId, rate: body.rate ?? profile.rate, presetId: body.presetId ?? profile.preset };
}

async function providerFailure(response) {
  const status = response.status;
  let code;
  // Read only a bounded error envelope; never expose arbitrary upstream text.
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 16 * 1024) break; chunks.push(Buffer.from(chunk)); }
    code = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.detail?.status;
  } catch { /* use a safe status-based message */ }
  const quota = status === 429 || code === 'quota_exceeded';
  const error = new ApiError(quota ? 429 : [401, 402, 403].includes(status) ? 503 : 502,
    quota ? 'ElevenLabs quota or rate limit reached. Try again later.' : status === 402 ? 'ElevenLabs requires an account plan or billing update for this assigned voice.' : code === 'missing_permissions' ? 'The ElevenLabs key needs Text to Speech, Voices Read and Models Read permissions.' : status === 401 || status === 403 ? 'ElevenLabs denied access. Check the backend key permissions, voice access and account plan.' : status === 404 ? 'The assigned ElevenLabs voice or model is unavailable to this account.' : 'ElevenLabs could not synthesize speech. Check model and voice access or try again later.');
  error.providerStatus = status;
  if (code === 'missing_permissions') error.code = code;
  return error;
}

export const isMp3 = bytes => bytes.length > 3 && (bytes.subarray(0, 3).toString('ascii') === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);

export function createTtsService({ apiKey = process.env.ELEVENLABS_API_KEY, model = process.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL, fallback = process.env.ELEVENLABS_FALLBACK || 'none', airaVoiceId, zeroRetention = process.env.ELEVENLABS_ZERO_RETENTION === 'true', fetchImpl = fetch, now = Date.now } = {}) {
  const registry = createVoiceRegistry({ airaVoiceId });
  fallback = fallback === 'browser' ? 'browser' : 'none';
  let cache = null, expires = 0, loading = null;
  const synthesized = new Set();
  const synthesisErrors = new Map();
  const baseline = () => ({ configured: Boolean(apiKey), provider: 'ElevenLabs', model, outputFormat: TTS_FORMAT, fallback,
    avatars: Object.fromEntries(Object.entries(registry).map(([id, config]) => [id, { ...config, name: null, available: false, synthesisVerified: synthesized.has(id), error: config.configurationPending ? 'Aira uses her existing browser voice. ElevenLabs configuration pending: set AIRA_VOICE_ID in the backend .env.' : apiKey ? 'Voice metadata has not been verified.' : 'Set ELEVENLABS_API_KEY in the backend .env and restart the server.' }])) });
  async function providerJson(path) {
    let response;
    try { response = await fetchImpl(`https://api.elevenlabs.io/v1/${path}`, { headers: { 'xi-api-key': apiKey }, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw new ApiError(502, 'The backend could not reach ElevenLabs for voice verification.'); }
    if (!response.ok) throw await providerFailure(response);
    try { return await response.json(); } catch { throw new ApiError(502, 'ElevenLabs returned unreadable voice metadata.'); }
  }
  async function refresh() {
    const result = baseline();
    if (!apiKey) return result;
    try {
      if (!/^[a-zA-Z0-9_]+$/.test(model)) throw new ApiError(503, 'ELEVENLABS_TTS_MODEL is invalid.');
      let models;
      try { models = await providerJson('models'); }
      catch (error) {
        if (error.code !== 'missing_permissions') throw error;
        // A TTS-scoped key can synthesize even if catalog reads are restricted.
        // Do not invent catalog metadata or bypass any synthesis permission.
        result.modelVerified = false; result.metadataRestricted = true;
        result.maxTextLength = MAX_TTS_TEXT;
        result.metadataError = error.message;
      }
      if (!result.metadataRestricted) {
        const selected = Array.isArray(models) && models.find(item => item.model_id === model && item.can_do_text_to_speech === true);
        if (!selected) throw new ApiError(503, 'The configured ElevenLabs model does not support text-to-speech or is unavailable.');
        result.modelVerified = true;
        result.maxTextLength = Math.min(MAX_TTS_TEXT, selected.maximum_text_length_per_request || MAX_TTS_TEXT);
        result.supportsStyle = Boolean(selected.can_use_style);
      }
      await Promise.all(Object.entries(registry).filter(([, config]) => config.voiceId).map(async ([id, config]) => {
        try {
          const voice = await providerJson(`voices/${config.voiceId}`);
          if (voice.voice_id !== config.voiceId) throw new ApiError(502, 'ElevenLabs returned a different voice identity.');
          const selected = Array.isArray(models) && models.find(item => item.model_id === model);
          if (voice.category === 'professional' && selected?.serves_pro_voices === false) throw new ApiError(503, 'The selected synthesis model cannot serve this professional voice.');
          if (voice.voice_verification?.requires_verification && !voice.voice_verification.is_verified) throw new ApiError(503, 'The assigned voice requires account verification before synthesis.');
          if (['blocked', 'disallowed'].includes(voice.sharing?.review_status)) throw new ApiError(503, 'The assigned voice is restricted by ElevenLabs.');
          result.avatars[id] = { ...config, name: typeof voice.name === 'string' ? voice.name.slice(0, 200) : null, metadataVerified: true, available: true, synthesisVerified: synthesized.has(id), category: voice.category,
            description: typeof voice.description === 'string' ? voice.description.slice(0, 500) : '', labels: Object.fromEntries(Object.entries(voice.labels || {}).filter(([key, value]) => ['gender', 'age', 'accent', 'language', 'use_case', 'descriptive'].includes(key) && typeof value === 'string').map(([key, value]) => [key, value.slice(0, 100)])),
            highQualityModels: Array.isArray(voice.high_quality_base_model_ids) ? voice.high_quality_base_model_ids.filter(item => typeof item === 'string') : [], availableForTiers: Array.isArray(voice.available_for_tiers) ? voice.available_for_tiers : [], error: '' };
        } catch (error) {
          const avatar = result.avatars[id];
          avatar.error = error instanceof ApiError ? error.message : 'Voice verification failed.'; avatar.errorStatus = error instanceof ApiError ? error.status : 503;
          if (Number.isInteger(error.providerStatus)) avatar.providerStatus = error.providerStatus;
          if (error.code === 'missing_permissions') {
            avatar.metadataRestricted = true; avatar.metadataVerified = false; avatar.metadataError = avatar.error;
            if (synthesized.has(id)) { avatar.available = true; avatar.error = ''; }
          }
        }
      }));
    } catch (error) { for (const avatar of Object.values(result.avatars).filter(avatar => avatar.voiceId)) { avatar.error = error instanceof ApiError ? error.message : 'ElevenLabs verification failed.'; avatar.errorStatus = error instanceof ApiError ? error.status : 503; if (Number.isInteger(error.providerStatus)) avatar.providerStatus = error.providerStatus; } }
    for (const [id, error] of synthesisErrors) Object.assign(result.avatars[id], { available: false, error: error.message, errorStatus: error.status, synthesisError: true });
    return result;
  }
  async function status() {
    if (cache && now() < expires) return cache;
    if (!loading) loading = refresh().then(result => { cache = result; expires = now() + (Object.values(result.avatars).some(avatar => avatar.voiceId && !avatar.available) ? 15_000 : 300_000); return result; }).finally(() => { loading = null; });
    return loading;
  }
  async function synthesize(body, { signal } = {}) {
    const input = validateTtsRequest(body);
    if (!registry[input.avatarId].voiceId) throw new ApiError(503, 'Aira\u2019s ElevenLabs voice is pending. Configure AIRA_VOICE_ID in the backend .env; her existing browser voice remains available.');
    if (!apiKey) throw new ApiError(503, 'ElevenLabs is not configured. Set ELEVENLABS_API_KEY in the backend .env and restart the server.');
    const verified = await status();
    if (signal?.aborted) throw new ApiError(504, 'Speech synthesis was cancelled.');
    const assignment = verified.avatars[input.avatarId];
    if (!assignment.available && !assignment.metadataRestricted) throw new ApiError(assignment.errorStatus || 503, assignment.error);
    if (input.text.length > verified.maxTextLength) throw new ApiError(400, `The selected synthesis model accepts at most ${verified.maxTextLength} characters.`);
    const calm = ['calm', 'gentle'].includes(input.presetId);
    const settings = { stability: calm ? 0.7 : input.presetId === 'playful' ? 0.35 : 0.5, similarity_boost: 0.75, speed: input.rate };
    if (verified.supportsStyle) settings.style = input.presetId === 'playful' ? 0.25 : 0.1;
    let response;
    try {
      response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${assignment.voiceId}?output_format=${TTS_FORMAT}${zeroRetention ? '&enable_logging=false' : ''}`, { method: 'POST', redirect: 'error', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text: input.text, model_id: model, voice_settings: settings }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) });
    } catch { throw new ApiError(signal?.aborted ? 504 : 502, signal?.aborted ? 'Speech synthesis was cancelled or timed out.' : 'The backend could not reach ElevenLabs.'); }
    if (!response.ok) {
      const error = await providerFailure(response);
      synthesisErrors.set(input.avatarId, error);
      assignment.available = false; assignment.error = error.message; assignment.errorStatus = error.status; assignment.synthesisError = true;
      throw error;
    }
    if (!response.headers?.get('content-type')?.toLowerCase().startsWith('audio/mpeg')) throw new ApiError(502, 'ElevenLabs did not return MP3 audio.');
    if (Number(response.headers.get('content-length')) > MAX_TTS_AUDIO) throw new ApiError(502, 'Generated speech audio is too large.');
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.body) { size += chunk.length; if (size > MAX_TTS_AUDIO) throw new ApiError(502, 'Generated speech audio is too large.'); chunks.push(Buffer.from(chunk)); }
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, 'Speech audio download was interrupted.'); }
    const audio = Buffer.concat(chunks);
    if (!isMp3(audio)) throw new ApiError(502, 'ElevenLabs returned invalid or empty MP3 audio.');
    synthesized.add(input.avatarId);
    synthesisErrors.delete(input.avatarId);
    assignment.synthesisVerified = true; assignment.available = true; assignment.error = ''; assignment.synthesisError = false;
    return { audio, voiceId: assignment.voiceId, voiceName: assignment.name, model, format: TTS_FORMAT };
  }
  return { status, synthesize, fallback };
}
