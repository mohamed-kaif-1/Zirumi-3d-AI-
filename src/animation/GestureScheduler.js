import { GESTURES } from './GestureLibrary.js';
const RULES = [
  ['empathetic', /sorry|happened|understand|feel|கவலை|மன்னி|माफ़|दुख/iu],
  ['count', /\b(?:three|two|four|steps|first|second|third)\b|மூன்று|படிகள்|तीन|पहला/iu],
  ['greeting', /\b(?:hello|hi|hey|welcome|meet you)\b|வணக்கம்|नमस्ते/iu],
  ['excited', /exciting|amazing|great news|let's do|fantastic|அருமை|शानदार/iu],
  ['thoughtful', /interesting|think|consider|technical|சிந்தி|विचार/iu],
  ['encourage', /you can|try|together|you've got|முடியும்|कर सकते/iu],
  ['agree', /absolutely|agree|yes|சரி|हाँ/iu],
  ['question', /question|perhaps|why|how|\?|ஏன்|क्यों/iu],
  ['direction', /over there|look at|this option/iu],
  ['confident', /ready|confident|plan|build/iu],
  ['emphasis', /important|remember|must|முக்கிய|ज़रूरी/iu],
];
export function analyzePhrase(text) { return RULES.find(([, pattern]) => pattern.test(text))?.[0] || 'explain'; }
export class GestureScheduler {
  constructor(random = Math.random) { this.random = random; this.reset(); }
  reset() { this.last = null; this.lastStart = -Infinity; this.cues = []; this.cursor = 0; this.lastPosition = 0; }
  prepare(text, alignment) {
    this.reset();
    const phrases = String(text || '').match(/[^.!?。]+[.!?。]?/gu) || [];
    this.cues = phrases.map((phrase, i) => {
      // Match exact provider words in order. No invented word/phoneme timings.
      const token = phrase.trim().split(/\s+/u)[0]?.replace(/[.!?,]/gu, '').toLowerCase();
      const words = alignment?.words || [];
      const index = words.findIndex((word, j) => j >= (this.wordCursor || 0) && word.word.replace(/[.!?,]/gu, '').toLowerCase() === token);
      if (index >= 0) this.wordCursor = index + 1;
      return { tag: analyzePhrase(phrase), time: i === 0 ? 0 : index >= 0 ? words[index].start : null };
    }); this.wordCursor = 0;
  }
  select(tag, personality, blocked = []) {
    let candidates = Object.values(GESTURES).filter(g => g.tag === tag && g.id !== this.last && (g.arm === 'both' ? blocked.length < 2 : !blocked.includes(g.arm)));
    if (!candidates.length) candidates = Object.values(GESTURES).filter(g => g.tag === 'explain' && g.id !== this.last && (g.arm === 'both' ? blocked.length < 2 : !blocked.includes(g.arm)));
    if (!candidates.length) return null;
    const total = candidates.reduce((n, g) => n + (g.personalityWeights[personality] || 1), 0);
    let roll = this.random() * total;
    const selected = candidates.find(g => (roll -= g.personalityWeights[personality] || 1) <= 0) || candidates[0];
    this.last = selected.id; return selected.id;
  }
  next(position, personality, cooldown = 5, blocked = [], voiced = true, pause = false) {
    if (position < this.lastPosition) { this.cursor = 0; this.lastStart = -Infinity; }
    this.lastPosition = position;
    if (!voiced || position - this.lastStart < cooldown) return null;
    while (this.cursor < this.cues.length) {
      const cue = this.cues[this.cursor];
      if (cue.time === null && !pause || cue.time !== null && position < cue.time) return null;
      this.cursor++; const id = this.select(cue.tag, personality, blocked);
      if (id) { this.lastStart = position; return id; }
    }
    return null;
  }
}
