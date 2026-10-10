import { ApiError } from './errors.js';
import { DEFAULT_STT_MODEL, groqJson, safeUsage, validateGroqModel } from './services/groq.js';
export { ApiError, DEFAULT_STT_MODEL };
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/wav'];

function validWav(audio) {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' || audio.readUInt32LE(4) + 8 !== audio.length) return false;
  let format = false, samples = false;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString('ascii', offset, offset + 4), length = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > audio.length) return false;
    if (id === 'fmt ') {
      if (length < 16) return false;
      const codec = audio.readUInt16LE(start), channels = audio.readUInt16LE(start + 2), rate = audio.readUInt32LE(start + 4), align = audio.readUInt16LE(start + 12), bits = audio.readUInt16LE(start + 14);
      if (![1, 3].includes(codec) || channels < 1 || channels > 8 || rate < 8000 || rate > 192000 || ![8, 16, 24, 32, 64].includes(bits) || align !== channels * bits / 8) return false;
      format = true;
    }
    if (id === 'data') samples = length > 0;
    offset = start + length + length % 2;
  }
  return format && samples;
}

export function validateAudio(audio, type) {
  const mime = type?.split(';')[0].trim().toLowerCase();
  if (!AUDIO_TYPES.includes(mime)) throw new ApiError(415, 'Only WebM, Ogg or WAV audio is supported.');
  if (!audio.length) throw new ApiError(400, 'The audio upload is empty.');
  if (audio.length > MAX_AUDIO_BYTES) throw new ApiError(413, 'Audio must be at most 5 MB.');
  const valid = mime === 'audio/webm'
    ? audio.length >= 4 && audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : mime === 'audio/ogg' ? audio.length >= 4 && audio.subarray(0, 4).toString('ascii') === 'OggS' : validWav(audio);
  if (!valid) throw new ApiError(415, 'Uploaded data does not match its WebM/Ogg/WAV content type.');
  return mime;
}

export async function transcribeAudioDetailed(audio, type, { model = DEFAULT_STT_MODEL, language, now = Date.now, ...options } = {}) {
  const mimeType = validateAudio(audio, type);
  validateGroqModel(model);
  if (language !== undefined && !/^[a-z]{2}$/.test(language)) throw new ApiError(503, 'The configured transcription language must be a two-letter language code.');
  const started = now();
  const form = new FormData();
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (language) form.append('language', language);
  // File is last. fetch supplies the multipart boundary, never a manual header.
  form.append('file', new Blob([audio], { type: mimeType }), mimeType === 'audio/webm' ? 'recording.webm' : mimeType === 'audio/ogg' ? 'recording.ogg' : 'recording.wav');
  const data = await groqJson('audio/transcriptions', { ...options, body: form, kind: 'transcription' });
  if (typeof data?.text !== 'string') throw new ApiError(502, 'Groq returned an unrecognized transcription format. Please try again.');
  if (data.text.length > 20_000) throw new ApiError(502, 'The transcription response exceeded the allowed length.');
  // Whisper verbose no-speech scores supplement the browser's silence gate.
  const silent = Array.isArray(data.segments) && data.segments.length > 0 && data.segments.every(segment => Number.isFinite(segment.no_speech_prob) && segment.no_speech_prob >= 0.6);
  const transcript = silent ? '' : data.text.trim();
  const metadata = { provider: 'Groq', model, latencyMs: Math.max(0, now() - started), usage: safeUsage(data.usage) };
  if (Number.isFinite(data.duration) && data.duration >= 0) metadata.durationSeconds = data.duration;
  return { transcript, metadata };
}
export async function transcribeAudio(audio, type, options) { return (await transcribeAudioDetailed(audio, type, options)).transcript; }
