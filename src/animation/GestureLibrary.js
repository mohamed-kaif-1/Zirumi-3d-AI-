import { Vector3 } from 'three';
// Targets are meters in the normalized +Z-facing reference rig; calibrated to
// each loaded shoulder and arm length. Collision/IK always has the final say.
const definitions = [
  ['FRIENDLY_WAVE', 'Friendly wave', 'right', [-.34, 1.64, .23], null, 'greeting', 'open', 'wave', 2.8],
  ['OPEN_PALM', 'Open-palm explanation', 'right', [-.37, 1.15, .32], null, 'explain', 'open', 'sweep', 3.2],
  ['PRESENT_ONE', 'One-hand presentation', 'left', [.43, 1.24, .30], null, 'explain', 'open', 'sweep', 3],
  ['PRESENT_BOTH', 'Two-hand presentation', 'both', [.38, 1.22, .32], [-.38, 1.22, .32], 'explain', 'open', 'sweep', 3.4],
  ['GENTLE_POINT', 'Gentle pointing', 'right', [-.29, 1.31, .43], null, 'direction', 'point', 'reach', 2.7],
  ['COUNT_FINGERS', 'Counting on fingers', 'right', [-.32, 1.40, .30], null, 'count', 'count', 'hold', 3.6],
  ['THOUGHTFUL_CHIN', 'Thoughtful chin pose', 'right', [-.16, 1.47, .29], null, 'thoughtful', 'soft', 'hold', 3.6],
  ['SMALL_RAISE', 'Small hand raise', 'left', [.32, 1.48, .24], null, 'question', 'open', 'reach', 2.5],
  ['EMPHASIS', 'Expressive emphasis', 'right', [-.30, 1.28, .32], null, 'emphasis', 'soft', 'beat', 2.6],
  ['AGREEMENT', 'Agreement gesture', 'right', [-.26, 1.23, .28], null, 'agree', 'soft', 'beat', 2.6],
  ['QUESTIONING', 'Confused questioning', 'both', [.36, 1.29, .30], [-.36, 1.29, .30], 'question', 'open', 'sweep', 3.2],
  ['CELEBRATION', 'Excited celebration', 'both', [.36, 1.56, .23], [-.36, 1.56, .23], 'excited', 'soft', 'reach', 2.8],
  ['POLITE_GREETING', 'Polite greeting', 'both', [.20, 1.12, .32], [-.20, 1.12, .32], 'greeting', 'soft', 'hold', 3.1],
  ['ENCOURAGING', 'Encouraging gesture', 'right', [-.32, 1.30, .34], null, 'encourage', 'open', 'reach', 3],
  ['SHRUG', 'Small shrug', 'both', [.36, 1.34, .27], [-.36, 1.34, .27], 'question', 'open', 'hold', 2.9],
  ['HAND_CHEST', 'Hand to chest', 'right', [-.13, 1.22, .30], null, 'empathetic', 'soft', 'hold', 3.3],
  ['REASSURE', 'Calm reassuring gesture', 'left', [.29, 1.12, .38], null, 'empathetic', 'open', 'sweep', 3.8],
  ['OPEN_ARMS', 'Confident open arms', 'both', [.46, 1.27, .27], [-.46, 1.27, .27], 'confident', 'open', 'reach', 3.4],
];
export const GESTURES = Object.freeze(Object.fromEntries(definitions.map(([id, label, arm, a, b, tag, fingers, path, duration]) => [id, {
  id, label, arm, tag, fingers, path, duration, blendIn: .65, hold: duration - 1.4, blendOut: .75,
  states: ['SPEAKING', 'PREVIEW'], initialPose: 'calibrated-rest', priority: 20,
  ownership: arm === 'both' ? ['leftArm', 'rightArm'] : [arm + 'Arm'],
  constraints: ['reach', 'joint-limits', 'torso', 'head', 'pelvis'], interruption: 'release-to-rest; IK and boundary override',
  personalityWeights: { caring: ['empathetic', 'greeting', 'encourage'].includes(tag) ? 2 : .8, playful: tag === 'excited' ? 2 : 1, composed: ['explain', 'thoughtful', 'count'].includes(tag) ? 2 : .5, confident: ['confident', 'emphasis', 'excited'].includes(tag) ? 2 : 1 },
  ...(arm === 'both' ? { leftTarget: new Vector3(...a), rightTarget: new Vector3(...b), leftPole: new Vector3(.35, 1.05, -.3), rightPole: new Vector3(-.35, 1.05, -.3) } : { target: new Vector3(...a), pole: new Vector3(arm === 'left' ? .35 : -.35, 1.05, -.3) }),
}])));
export function gestureWeight(gesture, age, duration = gesture.duration) {
  const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  return smooth(age / gesture.blendIn) * smooth((duration - age) / gesture.blendOut);
}
