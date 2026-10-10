import { VOICE_PRESETS, getPresetById } from './voicePresets.js';
import { CHARACTER_PERSONALITIES } from './characterPersonalities.js';

export const VOICE_SETTINGS_KEY = 'echo_avatar_voice_settings_v1';
export const AVATAR_VOICE_PROFILES = {
  default: { ...CHARACTER_PERSONALITIES.default, preset: 'best_friend', pitch: 1.05, rate: 1, volume: 1, preferredNames: ['david', 'daniel', 'guy', 'alex'], feminine: false },
  sky: { ...CHARACTER_PERSONALITIES.sky, preset: 'sweet', pitch: 1.1, rate: 0.96, volume: 1, preferredNames: ['zira', 'samantha', 'jenny', 'aria', 'salli'], feminine: true },
  nova: { ...CHARACTER_PERSONALITIES.nova, preset: 'calm', pitch: 1.02, rate: 0.92, volume: 1, preferredNames: ['hazel', 'susan', 'victoria', 'karen', 'emma', 'zira'], feminine: true },
  ember: { ...CHARACTER_PERSONALITIES.ember, preset: 'playful', pitch: 1.12, rate: 1.06, volume: 1, preferredNames: ['mark', 'andrew', 'ryan', 'guy', 'aria'], feminine: false },
};

export const avatarVoiceId = id => Object.hasOwn(AVATAR_VOICE_PROFILES, id) ? id : 'default';
export const getAvatarVoiceProfile = id => AVATAR_VOICE_PROFILES[avatarVoiceId(id)];
export const VOICE_LIMITS = { pitch: [0.85, 1.2], rate: [0.75, 1.25], volume: [0, 1] };
const bounded = (value, fallback, [min, max]) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function defaultVoiceSettings(id) {
  const profile = getAvatarVoiceProfile(id);
  return { presetId: profile.preset, pitch: profile.pitch, rate: profile.rate, volume: profile.volume, voice: null };
}

export function sanitizeVoiceSettings(id, input) {
  const defaults = defaultVoiceSettings(id);
  const source = input && typeof input === 'object' ? input : {};
  const voice = source.voice && typeof source.voice.voiceURI === 'string' && typeof source.voice.lang === 'string'
    ? { voiceURI: source.voice.voiceURI.slice(0, 500), name: typeof source.voice.name === 'string' ? source.voice.name.slice(0, 300) : '', lang: source.voice.lang.slice(0, 35) } : null;
  return { presetId: VOICE_PRESETS.some(p => p.id === source.presetId) ? source.presetId : defaults.presetId,
    pitch: bounded(source.pitch, defaults.pitch, VOICE_LIMITS.pitch), rate: bounded(source.rate, defaults.rate, VOICE_LIMITS.rate),
    volume: bounded(source.volume, defaults.volume, VOICE_LIMITS.volume), voice };
}

export function loadVoicePreferences(storage) {
  let source = {};
  try { const saved = JSON.parse(storage?.getItem(VOICE_SETTINGS_KEY) || '{}'); if (saved.version === 1) source = saved.avatars || {}; } catch { /* corrupt/unavailable storage falls back safely */ }
  return Object.fromEntries(Object.keys(AVATAR_VOICE_PROFILES).map(id => [id, sanitizeVoiceSettings(id, source[id])]));
}

export function saveVoicePreferences(storage, preferences) {
  const avatars = Object.fromEntries(Object.keys(AVATAR_VOICE_PROFILES).map(id => [id, sanitizeVoiceSettings(id, preferences[id])]));
  try { storage?.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ version: 1, avatars })); } catch { /* storage may be blocked */ }
}

export const voiceKey = voice => `${voice.voiceURI || voice.id}\u0000${voice.lang.toLowerCase()}`;
export const voiceOptionId = voice => JSON.stringify([voice.voiceURI || voice.id, voice.lang]);
export const voiceIdentity = voice => voice ? { voiceURI: voice.voiceURI || voice.id, name: voice.name, lang: voice.lang } : null;
const feminineNames = /zira|samantha|hazel|susan|victoria|karen|emma|aria|jenny|joanna|salli|amy|ava|fiona|tessa|moira|allison|heera|neerja/i;

export function resolveAvatarVoices(voices, preferences, language = 'en-US') {
  const unique = [...new Map(voices.filter(v => v.lang && (v.voiceURI || v.id)).map(v => [voiceKey(v), v])).values()];
  const english = unique.filter(v => v.lang.toLowerCase().startsWith('en'));
  const suitable = english.length ? english : unique.filter(v => v.lang.split('-')[0] === language.split('-')[0]);
  const available = suitable.length ? suitable : unique;
  const used = new Set();
  const resolved = {};
  // Reserve saved choices before allocating automatic identities.
  for (const id of Object.keys(AVATAR_VOICE_PROFILES)) {
    const saved = preferences[id]?.voice;
    const voice = saved && (unique.find(v => voiceKey(v) === voiceKey(saved)) || unique.find(v => v.name === saved.name && v.lang.toLowerCase() === saved.lang.toLowerCase()));
    if (voice) { resolved[id] = { voice, unavailable: false, automatic: false }; used.add(voice.voiceURI || voice.id); }
  }
  // Give feminine identities first choice; share a suitable voice if only one exists.
  for (const id of ['sky', 'nova', 'default', 'ember']) {
    if (resolved[id]) continue;
    const profile = getAvatarVoiceProfile(id);
    const feminine = available.filter(v => feminineNames.test(v.name));
    const pool = profile.feminine && feminine.length ? feminine : available;
    const ranked = [...pool].sort((a, b) => {
      const score = v => (profile.preferredNames.findIndex(name => v.name.toLowerCase().includes(name)) < 0 ? 0 : 100 - profile.preferredNames.findIndex(name => v.name.toLowerCase().includes(name))) + (v.lang.toLowerCase() === language.toLowerCase() ? 5 : 0);
      return score(b) - score(a) || voiceKey(a).localeCompare(voiceKey(b));
    });
    const voice = ranked.find(v => !used.has(v.voiceURI || v.id)) || ranked[0] || null;
    resolved[id] = { voice, unavailable: Boolean(preferences[id]?.voice), automatic: true };
    if (voice) used.add(voice.voiceURI || voice.id);
  }
  const distinctCount = new Set(Object.values(resolved).filter(r => r.voice).map(r => r.voice.voiceURI || r.voice.id)).size;
  for (const [id, result] of Object.entries(resolved)) {
    result.shared = Boolean(result.voice && Object.entries(resolved).some(([otherId, other]) => otherId !== id && other.voice && (other.voice.voiceURI || other.voice.id) === (result.voice.voiceURI || result.voice.id)));
    result.notice = !result.voice ? 'No named voices available; trying the browser default.' : result.unavailable ? 'Saved voice unavailable; using a fallback until it returns.' : result.shared ? 'Shared base voice on this device.' : '';
  }
  return { resolved, distinctCount, availableCount: unique.length };
}

export function settingsWithPreset(settings, presetId) {
  const preset = getPresetById(presetId);
  return { ...settings, presetId: preset.id, pitch: preset.pitch, rate: preset.rate };
}
