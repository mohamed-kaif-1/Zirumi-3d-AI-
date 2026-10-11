import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { Vector3 } from 'three';
import { prepareAvatar, disposeAvatarScene } from '../src/avatarModel.js';
import { AvatarAnimationController } from '../src/AvatarAnimationController.js';
import { CHARACTER_PERSONALITIES } from '../src/characterPersonalities.js';
import { GESTURES } from '../src/animation/GestureLibrary.js';
import { POSTURES } from '../src/animation/PostureController.js';
import { FACE_EXPRESSIONS } from '../src/animation/FacialExpressionController.js';
import { VISEMES } from '../src/animation/SpeechLipSyncController.js';

export async function verifyEngine(id, url) {
  const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));
  const vrm = prepareAvatar((await loader.loadAsync(url)).userData.vrm);
  const c = new AvatarAnimationController(); c.avatarPersonality = CHARACTER_PERSONALITIES[id]; c.setVRM(vrm);
  const bones = [...Object.values(c.bones), ...c.fingers.map(f => f.bone)].filter(Boolean);
  const rest = bones.map(b => b.position.toArray());
  const feet = ['leftFoot', 'rightFoot'].map(name => c.bones[name]?.getWorldPosition(new Vector3()));
  const costs = [], gestures = [], postures = [], faces = []; let t = 0, penetration = 0, footDrift = 0;
  const step = () => {
    const start = performance.now(); c.update(1 / 60, t += 1 / 60); costs.push(performance.now() - start);
    c.collision.update();
    for (const side of ['left', 'right']) penetration = Math.max(penetration, c.collision.armPenetration(side));
    for (const [i, name] of ['leftFoot', 'rightFoot'].entries()) if (feet[i]) footDrift = Math.max(footDrift, feet[i].distanceTo(c.bones[name].getWorldPosition(new Vector3())));
    if (bones.some(b => b.quaternion.toArray().some(v => !Number.isFinite(v)))) throw new Error('Non-finite quaternion');
  };
  for (let i = 0; i < 90; i++) step();
  for (const g of Object.values(GESTURES)) {
    c.resetPose(); c.triggerGesture(g.id, true); let motion = 0;
    for (let i = 0; i < Math.ceil((g.duration + .7) * 60); i++) {
      step(); for (const side of ['left', 'right']) motion = Math.max(motion, c.currentTargets[side].distanceTo(c.restTargets[side]));
    }
    gestures.push({ id: g.id, motion, completed: c.activeGestureKey === null });
  }
  for (const name of Object.keys(POSTURES)) { c.posture.preview = name; for (let i = 0; i < 75; i++) step(); postures.push({ name, selected: c.posture.id === name }); }
  c.posture.preview = null;
  for (const name of Object.keys(FACE_EXPRESSIONS)) {
    c.face.preview = name; for (let i = 0; i < 60; i++) step();
    faces.push({ name, weights: { ...c.face.weights }, supportedFallback: Object.keys(FACE_EXPRESSIONS[name]).filter(key => c.supportedExpressions.has(key)) });
  }
  c.face.preview = null; c.setConversationState('SPEAKING'); c.setSpeechAmplitude(.8);
  const user = c.restTargets.right.clone().add(new Vector3(-.03, .12, .15)); c.startDrag('right', user); c.triggerGesture('PRESENT_BOTH');
  for (let i = 0; i < 90; i++) step();
  const ikPriority = c.rightArmState === 'DRAGGING' && c.desiredTargets.right.distanceTo(user) < .00001;
  c.beginBoundary(id); const boundaryPriority = c.activeGestureKey === null && !c.triggerGesture('FRIENDLY_WAVE', true) && !c.startDrag('left', user);
  c.boundary = null; c.vrm.scene.position.copy(c.sceneRestPosition); c.resetPose(); c.setConversationState('IDLE');
  for (let i = 0; i < 90; i++) step();
  const sorted = costs.toSorted((a, b) => a - b);
  const report = { rig: c.rigInfo, gestures, postures, faces, ikPriority, boundaryPriority, penetration, footDrift, fixedTranslations: bones.every((b, i) => b.position.toArray().every((v, j) => v === rest[i][j])), mouthClosed: VISEMES.every(name => (vrm.expressionManager.getValue(name) || 0) < .001), updateMs: { mean: costs.reduce((a, b) => a + b, 0) / costs.length, p95: sorted[Math.floor(sorted.length * .95)] }, frames: costs.length };
  disposeAvatarScene(vrm.scene); c.setVRM(null); return report;
}
