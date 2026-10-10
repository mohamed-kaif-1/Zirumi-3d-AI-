/**
 * Natural Feminine Voice Tone Presets for ZIRUMI.
 * Models a friendly, youthful virtual companion (mid-to-late teens)
 * across 6 distinct emotional/speaking styles.
 */
export const VOICE_PRESETS = [
  {
    id: 'sweet',
    name: 'Sweet',
    tagline: 'Warm & affectionate',
    pitch: 1.08,
    rate: 0.96,
    expression: { happy: 0.22, neutral: 0.05, blinkRate: 1.0 },
    sample: "Hi there! I'm here. It's so lovely to chat with you today!",
  },
  {
    id: 'playful',
    name: 'Playful',
    tagline: 'Cute & cheerful',
    pitch: 1.16,
    rate: 1.05,
    expression: { happy: 0.35, neutral: 0.0, blinkRate: 1.2 },
    sample: "Hey hey! What fun things are we getting into right now?",
  },
  {
    id: 'calm',
    name: 'Calm',
    tagline: 'Soft & peaceful',
    pitch: 1.02,
    rate: 0.90,
    expression: { happy: 0.10, neutral: 0.25, blinkRate: 0.8 },
    sample: "Take a deep breath. I'm right here whenever you need me.",
  },
  {
    id: 'excited',
    name: 'Excited',
    tagline: 'Bright & energetic',
    pitch: 1.12,
    rate: 1.08,
    expression: { happy: 0.40, neutral: 0.0, blinkRate: 1.25 },
    sample: "Oh wow, that is so cool! Tell me everything about it!",
  },
  {
    id: 'gentle',
    name: 'Gentle',
    tagline: 'Soft-spoken & polite',
    pitch: 1.06,
    rate: 0.92,
    expression: { happy: 0.15, neutral: 0.15, blinkRate: 0.9 },
    sample: "Hello... I'm listening closely, whenever you're ready.",
  },
  {
    id: 'best_friend',
    name: 'Best Friend',
    tagline: 'Natural & casual',
    pitch: 1.05,
    rate: 1.00,
    expression: { happy: 0.25, neutral: 0.10, blinkRate: 1.0 },
    sample: "Hey! What's on your mind? I'm all ears!",
  },
];

export const DEFAULT_PRESET_ID = 'sweet';

/**
 * Keywords for detecting naturally feminine or youthful voices across platforms.
 */
export const FEMALE_VOICE_HINTS = [
  'female', 'woman', 'girl', 'zira', 'hazel', 'susan', 'eva',
  'aria', 'jenny', 'emma', 'amy', 'joanna', 'salli', 'kimberly',
  'kendra', 'ivy', 'olivia', 'samantha', 'victoria', 'fiona',
  'veena', 'moira', 'tessa', 'karen', 'lee', 'nicky', 'ava',
  'allison', 'isha', 'priya', 'lekha', 'heera', 'raveena',
  'aditi', 'divya', 'neerja', 'meera', 'yuna', 'seo-yeon',
  'zhiyu', 'xiaoxiao', 'trinoids',
];

export function getPresetById(id) {
  return VOICE_PRESETS.find((p) => p.id === id) || VOICE_PRESETS[0];
}
