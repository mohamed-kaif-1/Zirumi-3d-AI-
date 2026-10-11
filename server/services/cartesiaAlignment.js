import { ApiError } from '../errors.js';
import { MAX_TTS_AUDIO } from '../tts.js';
import { readProviderBytes } from './speechHttp.js';
import { validateAlignment } from '../../src/animation/AudioAlignmentService.js';

export function pcmToWav(pcm, sampleRate = 44100) {
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_TTS_AUDIO - 44) throw new ApiError(502, 'Cartesia returned invalid PCM audio.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export async function readCartesiaAlignment(response) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new ApiError(502, 'Cartesia did not return speech timing events.');
  // Bounded stream collection preserves PCM ordering; timestamps are relative
  // to that same generated audio. No second synthesis or text timing estimates.
  const bytes = await readProviderBytes(response, Math.ceil(MAX_TTS_AUDIO * 1.5) + 2 * 1024 * 1024);
  const chunks = [], phonemes = [], words = []; let completed = false, size = 0;
  for (const frame of bytes.toString('utf8').split(/\r?\n\r?\n/u)) {
    const payload = frame.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload || payload === '[DONE]') continue;
    let event; try { event = JSON.parse(payload); } catch { throw new ApiError(502, 'Cartesia returned invalid speech timing events.'); }
    if (event.type === 'error' || event.status_code >= 400) throw new ApiError(502, 'Cartesia speech timing synthesis failed.');
    if (event.type === 'chunk') {
      if (typeof event.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(event.data) || event.data.length % 4) throw new ApiError(502, 'Cartesia returned invalid speech chunks.');
      const chunk = Buffer.from(event.data, 'base64'); size += chunk.length;
      if (size > MAX_TTS_AUDIO - 44) throw new ApiError(502, 'Cartesia returned oversized speech audio.'); chunks.push(chunk);
    }
    for (const [field, collection, label] of [['phoneme_timestamps', phonemes, 'phoneme'], ['word_timestamps', words, 'word']]) {
      const timing = event[field]; if (!timing) continue;
      const labels = timing[label === 'phoneme' ? 'phonemes' : 'words'];
      if (!Array.isArray(labels) || !Array.isArray(timing.start) || !Array.isArray(timing.end) || labels.length !== timing.start.length || labels.length !== timing.end.length || collection.length + labels.length > 20000) throw new ApiError(502, 'Cartesia returned invalid alignment arrays.');
      labels.forEach((sound, i) => collection.push({ [label]: sound, start: timing.start[i], end: timing.end[i] }));
    }
    if (event.type === 'done') completed = true;
  }
  if (!completed) throw new ApiError(502, 'Cartesia speech timing stream was incomplete.');
  const pcm = Buffer.concat(chunks), audio = pcmToWav(pcm);
  const alignment = validateAlignment({ source: 'provider', phonemes, words }, pcm.length / 88200);
  return { audio, alignment };
}
