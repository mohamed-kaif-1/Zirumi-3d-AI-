import { phonemeToViseme, validateAlignment } from './AudioAlignmentService.js';
export const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];
export class SpeechLipSyncController {
  constructor() {
    this.weights = Object.fromEntries(VISEMES.map(name => [name, 0]));
    this.offset = 0; this.reset();
  }
  reset() { this.playback = null; this.index = 0; this.phoneme = null; this.viseme = 'closed'; this.mode = 'AUDIO-AMPLITUDE APPROXIMATION'; this.alignment = null; for (const name in this.weights) this.weights[name] = 0; }
  bind(playback) { this.reset(); this.playback = playback; this.alignment = validateAlignment(playback?.alignment); this.mode = this.alignment?.phonemes.length ? 'PHONEME-ALIGNED' : 'AUDIO-AMPLITUDE APPROXIMATION'; }
  update(delta, amplitude, enabled, supported, custom = {}) {
    const state = this.playback?.read();
    const playing = enabled && (!state || state.state === 'playing');
    const time = (state?.position || 0) + this.offset;
    const items = this.alignment?.phonemes || [];
    this.phoneme = null; this.viseme = 'closed';
    let level = 0;
    if (playing && items.length) {
      // Playback can seek or restart; never accumulate a separate animation clock.
      if (this.index >= items.length || time < items[this.index].start) this.index = 0;
      while (this.index < items.length && items[this.index].end <= time) this.index++;
      const item = items[this.index];
      if (item && time >= item.start && time < item.end) {
        this.phoneme = item.phoneme;
        this.viseme = phonemeToViseme(item.phoneme, custom);
        level = this.viseme === 'closed' ? 0 : this.viseme === 'consonant' ? .16 : .8;
      }
    } else if (playing) {
      // Real analyser envelope only. No synthetic vowel cycling or text timings.
      level = amplitude > .035 ? Math.min(.85, (amplitude - .035) * 1.12) : 0;
      this.viseme = level ? 'aa' : 'closed';
    }
    let shape = this.viseme === 'consonant' ? 'aa' : this.viseme;
    // Custom mouth targets can be declared in the per-rig mapping. Emotion and
    // eye presets cannot be reassigned as visemes and fight their layer owners.
    if (/^(?:happy|sad|angry|relaxed|surprised|neutral|blink.*|look.*)$/iu.test(shape)) shape = 'aa';
    if (!supported.has(shape) && shape !== 'closed') shape = supported.has('aa') ? 'aa' : 'closed';
    if (shape !== 'closed' && !Object.hasOwn(this.weights, shape)) this.weights[shape] = 0;
    const alpha = 1 - Math.exp(-(level ? 55 : 65) * delta);
    for (const name in this.weights) this.weights[name] += ((name === shape ? level : 0) - this.weights[name]) * alpha;
    return this.weights;
  }
}
