import { ELEVENLABS_VOICES } from '../src/elevenLabsVoices.js';
import { ApiError } from './errors.js';

// Only the server resolves configurable identities. Existing "default" is Aira's
// persisted ID; "original" is an accepted compatibility alias for the brief.
export const normalizeTtsAvatarId = id => id === 'original' ? 'default' : id;
export const isRegisteredTtsAvatar = id => typeof id === 'string' && ['default', 'sky', 'nova', 'ember'].includes(normalizeTtsAvatarId(id));

export function createVoiceRegistry({ airaVoiceId = process.env.AIRA_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || null } = {}) {
  if (airaVoiceId && (typeof airaVoiceId !== 'string' || !/^[a-zA-Z0-9]{20}$/.test(airaVoiceId))) throw new ApiError(503, 'AIRA_VOICE_ID must be a valid ElevenLabs voice identity.');
  return Object.freeze({
    default: Object.freeze({ displayName: 'Aira', intendedStyle: 'Sweet, friendly and caring', voiceId: airaVoiceId, provider: airaVoiceId ? 'elevenlabs' : 'browser', configurationPending: !airaVoiceId }),
    ...Object.fromEntries(Object.entries(ELEVENLABS_VOICES).map(([id, voice]) => [id, Object.freeze({ ...voice, provider: 'elevenlabs', configurationPending: false })])),
  });
}
