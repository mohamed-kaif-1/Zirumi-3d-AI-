// Timing is accepted only from the audio provider or a separately validated aligner.
export function validateAlignment(input, duration = Infinity) {
  if (!input || !['provider', 'forced-alignment'].includes(input.source)) return null;
  const validate = (items, field) => {
    if (!Array.isArray(items) || items.length > 20000) return [];
    let previous = -1;
    return items.every(item => {
      const valid = item && typeof item[field] === 'string' && item[field].length <= 120 && Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= previous - .00001 && item.start >= 0 && item.end >= item.start && item.end <= duration + .08;
      previous = item?.end ?? Infinity;
      return valid;
    // Provider normalization may emit zero-duration tokens. They cannot drive
    // a visible interval; omit them without inventing a duration.
    }) ? items.filter(item => item.end > item.start).map(item => ({ [field]: item[field], start: item.start, end: item.end })) : [];
  };
  const phonemes = validate(input.phonemes, 'phoneme'), words = validate(input.words, 'word');
  return { source: input.source, phonemes, words, method: phonemes.length ? 'PHONEME-ALIGNED' : words.length ? 'WORD-TIMED APPROXIMATION' : 'AUDIO-AMPLITUDE APPROXIMATION' };
}

// IPA (Cartesia) and ARPAbet. Tamil/Hindi IPA may be supplied by an actual aligner;
// no English grapheme conversion is applied to Indic text.
const GROUPS = {
  aa: ['a', 'ɑ', 'ɐ', 'æ', 'ʌ', 'ə', 'ɒ', 'AA', 'AE', 'AH', 'AX'],
  ih: ['i', 'ɪ', 'ɨ', 'ɯ', 'ɩ', 'IY', 'IH'],
  ee: ['e', 'ɛ', 'ɜ', 'ɚ', 'ɝ', 'EY', 'EH', 'ER'],
  ou: ['u', 'ʊ', 'w', 'ʋ', 'UW', 'UH', 'W'],
  oh: ['o', 'ɔ', 'oʊ', 'əʊ', 'OW', 'AO'],
  closed: ['m', 'b', 'p', 'M', 'B', 'P', 'sil', 'sp', 'pau', '<SIL>', ''],
};
const MAP = new Map(Object.entries(GROUPS).flatMap(([shape, sounds]) => sounds.map(sound => [sound, shape])));
export function phonemeToViseme(phoneme, custom = {}) {
  const sound = String(phoneme ?? '').replace(/ˈ|ˌ|ː|ˑ|ʰ|ʲ|\u0303|\u032a/gu, '').replace(/[012]$/u, '');
  if (Object.hasOwn(custom, sound)) return custom[sound];
  if (MAP.has(sound)) return MAP.get(sound);
  // Diphthongs get their dominant vowel. Unsupported consonants are small aa;
  // five vowel morphs cannot reproduce teeth/tongue consonant articulation.
  if (/^[aeɑæ]?[ɪiʊu]$/u.test(sound)) return sound.endsWith('ʊ') ? 'oh' : 'aa';
  return 'consonant';
}
