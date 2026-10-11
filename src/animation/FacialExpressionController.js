import { VRMExpression } from '@pixiv/three-vrm';
export const FACE_EXPRESSIONS = Object.freeze({
  happy: { happy: .45 }, gentleSmile: { happy: .18, relaxed: .10 }, excited: { happy: .5, surprised: .15 }, curious: { surprised: .13, relaxed: .06 },
  surprised: { surprised: .4 }, thoughtful: { relaxed: .12 }, concerned: { sad: .22 }, confused: { sad: .1, surprised: .1 },
  calm: { relaxed: .25, happy: .06 }, confident: { happy: .18 }, empathetic: { sad: .13, relaxed: .12 }, serious: { angry: .12 },
  listening: { relaxed: .1 }, mildDisagreement: { angry: .12, sad: .06 }, neutral: {},
});
export function faceFor(tag, state) {
  if (state === 'THINKING') return 'thoughtful'; if (state === 'LISTENING') return 'listening'; if (state !== 'SPEAKING') return 'gentleSmile';
  return ({ greeting: 'happy', empathetic: 'empathetic', excited: 'excited', question: 'curious', thoughtful: 'thoughtful', agree: 'confident', encourage: 'gentleSmile', confident: 'confident' })[tag] || 'calm';
}
export class FacialExpressionController {
  constructor() { this.id = 'neutral'; this.preview = null; this.weights = {}; this.masked = {}; this.names = {}; }
  bind(manager) {
    this.preview = null; this.weights = {}; this.masked = {}; this.names = {};
    if (!manager?.expressions) return;
    const mouth = new Set();
    for (const expression of manager.expressions) if (['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkLeft', 'blinkRight'].includes(expression.expressionName)) {
      for (const bind of expression.binds) for (const mesh of bind.primitives || []) mouth.add(mesh.uuid + ':' + bind.index);
    }
    for (const name of ['happy', 'sad', 'angry', 'relaxed', 'surprised']) {
      const original = manager.getExpression(name) || manager.expressions.find(expression => expression.expressionName.toLowerCase() === name); if (!original) continue;
      this.names[name] = original.expressionName;
      // Mask mouth binds, including smile targets, instead of allowing an
      // emotion's overrideMouth rule to suppress speech. Originals are preserved.
      const face = new VRMExpression('__zirumi_face_' + name);
      for (const bind of original.binds) {
        const safe = bind.primitives?.length && bind.primitives.every(mesh => {
          const morphName = Object.keys(mesh.morphTargetDictionary || {}).find(key => mesh.morphTargetDictionary[key] === bind.index) || '';
          return !mouth.has(mesh.uuid + ':' + bind.index) && !/MTH|mouth|lip|jaw|smile/iu.test(morphName);
        });
        if (safe) face.addBind(bind);
      }
      manager.registerExpression(face); this.masked[name] = face.expressionName;
    }
  }
  update(manager, supported, delta, id, speaking, intensity = 1, boundary = 0) {
    if (!manager) return;
    this.id = boundary ? 'mildDisagreement' : this.preview || id;
    const targets = FACE_EXPRESSIONS[this.id] || FACE_EXPRESSIONS.neutral;
    const alpha = 1 - Math.exp(-5 * delta);
    for (const name of ['happy', 'sad', 'angry', 'relaxed', 'surprised', 'neutral']) {
      let target = (targets[name] || 0) * Math.min(1, intensity);
      if (boundary) target = name === 'angry' ? boundary : 0;
      this.weights[name] = (this.weights[name] || 0) + (target - (this.weights[name] || 0)) * alpha;
      const actualName = this.names[name] || name;
      if (!supported.has(actualName)) continue;
      manager.setValue(actualName, speaking && this.masked[name] ? 0 : this.weights[name]);
      if (this.masked[name]) manager.setValue(this.masked[name], speaking ? this.weights[name] : 0);
    }
  }
}
