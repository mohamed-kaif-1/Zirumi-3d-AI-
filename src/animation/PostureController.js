import { Euler, Quaternion } from 'three';
export const POSTURES = Object.freeze({
  relaxed: [0, 0, .008], attentive: [.025, 0, 0], thoughtful: [-.015, .025, .012], confident: [-.02, 0, 0],
  friendly: [0, -.012, .018], curious: [.038, .018, 0], composed: [-.008, 0, 0], energetic: [-.014, -.018, .008],
  empathetic: [.026, -.012, -.014], surprised: [-.035, 0, 0],
});
export function postureFor(tag, state, personality) {
  if (state === 'LISTENING') return 'attentive';
  if (state === 'THINKING') return 'thoughtful';
  if (state !== 'SPEAKING') return personality === 'composed' ? 'composed' : 'relaxed';
  return ({ empathetic: 'empathetic', thoughtful: 'thoughtful', question: 'curious', confident: 'confident', excited: 'energetic', greeting: 'friendly' })[tag] || (personality === 'composed' ? 'composed' : 'confident');
}
export class PostureController {
  constructor() { this.id = 'relaxed'; this.preview = null; this.euler = new Euler(); this.quat = new Quaternion(); this.current = [0, 0, 0]; this.rest = {}; }
  bind(bones) { this.preview = null; this.current.fill(0); this.rest = Object.fromEntries(['spine', 'chest'].filter(name => bones[name]).map(name => [name, bones[name].quaternion.clone()])); }
  update(bones, delta, time, id, enabled) {
    this.id = this.preview || id; const target = POSTURES[this.id] || POSTURES.relaxed;
    const alpha = 1 - Math.exp(-2.8 * delta);
    for (let i = 0; i < 3; i++) this.current[i] += ((enabled ? target[i] : 0) - this.current[i]) * alpha;
    // Keep pelvis, roots, leg rotations and all translations unchanged. Upper
    // body balance cues give weight-shift impressions without sliding feet.
    for (const name of ['spine', 'chest']) {
      if (!bones[name] || !this.rest[name]) continue;
      const share = name === 'spine' ? .6 : .4;
      this.euler.set(this.current[0] * share + (enabled ? Math.sin(time * 1.6) * .004 : 0), this.current[1] * share, this.current[2] * share + (enabled ? Math.sin(time * .43) * .002 : 0));
      this.quat.setFromEuler(this.euler); bones[name].quaternion.copy(this.rest[name]).multiply(this.quat);
    }
  }
}
