import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AvatarAnimationController } from '../src/AvatarAnimationController.js';
import { getAvatarVoiceProfile } from '../src/avatarVoiceProfiles.js';

function createMockVRM() {
  const bones = {
    hips: new THREE.Object3D(),
    spine: new THREE.Object3D(),
    chest: new THREE.Object3D(),
    neck: new THREE.Object3D(),
    head: new THREE.Object3D(),
    leftShoulder: new THREE.Object3D(),
    leftUpperArm: new THREE.Object3D(),
    leftLowerArm: new THREE.Object3D(),
    leftHand: new THREE.Object3D(),
    rightShoulder: new THREE.Object3D(),
    rightUpperArm: new THREE.Object3D(),
    rightLowerArm: new THREE.Object3D(),
    rightHand: new THREE.Object3D(),
  };

  // Set rest offsets in normalized rig (+X for left, -X for right)
  bones.leftLowerArm.position.set(0.25, 0, 0);
  bones.leftHand.position.set(0.25, 0, 0);
  bones.rightLowerArm.position.set(-0.25, 0, 0);
  bones.rightHand.position.set(-0.25, 0, 0);

  const expressions = {};
  const expressionManager = {
    setValue(name, val) { expressions[name] = val; },
    getValue(name) { return expressions[name] || 0; },
    update() {},
  };

  const scene = new THREE.Object3D();
  const root = new THREE.Object3D();
  scene.add(root);
  root.add(bones.spine);
  bones.spine.add(bones.chest);
  bones.chest.add(bones.neck);
  bones.neck.add(bones.head);
  bones.chest.add(bones.leftShoulder);
  bones.leftShoulder.add(bones.leftUpperArm);
  bones.leftUpperArm.add(bones.leftLowerArm);
  bones.leftLowerArm.add(bones.leftHand);
  bones.chest.add(bones.rightShoulder);
  bones.rightShoulder.add(bones.rightUpperArm);
  bones.rightUpperArm.add(bones.rightLowerArm);
  bones.rightLowerArm.add(bones.rightHand);

  scene.updateMatrixWorld(true);

  return {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name) => bones[name] || null,
      update() {},
    },
    expressionManager,
    update() {},
    _bones: bones,
    _expressions: expressions,
  };
}

test('AvatarAnimationController detects valid VRM humanoid rig correctly', () => {
  let statusReported = null;
  const controller = new AvatarAnimationController({
    onStatusChange: (status) => { statusReported = status; },
  });

  const vrm = createMockVRM();
  controller.setVRM(vrm);

  assert.equal(controller.hasHumanoid, true);
  assert.equal(statusReported.compatible, true);
  assert.equal(statusReported.hasArms, true);
  assert.equal(statusReported.hasHead, true);
  assert.equal(statusReported.hasExpressions, true);
});

test('Priority hierarchy: User dragging overrides conversational gestures', () => {
  const controller = new AvatarAnimationController();
  const vrm = createMockVRM();
  controller.setVRM(vrm);

  // Set speaking state (triggers conversational gesture)
  controller.setConversationState('SPEAKING');
  controller.update(0.016, 1.0);

  // User starts dragging right hand to specific position
  const dragTarget = new THREE.Vector3(-0.45, 1.6, 0.4);
  controller.startDrag('right', dragTarget);

  assert.equal(controller.rightArmState, 'DRAGGING');
  assert.equal(controller.desiredTargets.right.x, dragTarget.x);
  assert.equal(controller.desiredTargets.right.y, dragTarget.y);
  assert.equal(controller.desiredTargets.right.z, dragTarget.z);

  // Update should preserve user drag target even while speaking
  controller.update(0.016, 1.05);
  assert.equal(controller.rightArmState, 'DRAGGING');
  assert.equal(controller.desiredTargets.right.x, dragTarget.x);
});

test('Priority hierarchy: Held pose preserves user position when holdPose is enabled', () => {
  const controller = new AvatarAnimationController({ holdPose: true });
  const vrm = createMockVRM();
  controller.setVRM(vrm);

  const dragTarget = new THREE.Vector3(0.3, 1.4, 0.2);
  controller.startDrag('left', dragTarget);
  // Advance frames so currentTarget catches up to dragTarget
  for (let i = 0; i < 30; i++) controller.update(0.016, i * 0.016);

  controller.endDrag('left');

  assert.equal(controller.leftArmState, 'HELD');
  assert.ok(controller.userPosedTargets.left !== null);

  // Even if speaking begins, held pose takes priority over gesture
  controller.setConversationState('SPEAKING');
  controller.update(0.016, 2.0);
  assert.equal(controller.leftArmState, 'HELD');
});

test('Reset pose restores arms to resting pose and clears held targets', () => {
  const controller = new AvatarAnimationController({ holdPose: true });
  const vrm = createMockVRM();
  controller.setVRM(vrm);

  controller.startDrag('left', new THREE.Vector3(0.5, 1.5, 0.5));
  controller.endDrag('left');
  assert.equal(controller.leftArmState, 'HELD');

  controller.resetPose();
  assert.equal(controller.leftArmState, 'REST');
  assert.equal(controller.userPosedTargets.left, null);
  assert.equal(controller.userPosedTargets.right, null);
});

test('Speaking with measured sound opens mouth smoothly and idle closes mouth', () => {
  const controller = new AvatarAnimationController();
  const vrm = createMockVRM();
  controller.setVRM(vrm);

  controller.setConversationState('SPEAKING');
  controller.onSpeechBoundary({ name: 'word' });
  controller.setSpeechAmplitude(.7);

  // Advance several frames
  for (let i = 0; i < 15; i++) controller.update(0.016, i * 0.016);
  assert.ok(vrm._expressions['aa'] > 0.1, `Mouth should be open while speaking, got ${vrm._expressions['aa']}`);

  // When speech ends, mouth smoothly closes
  controller.setConversationState('IDLE');
  for (let i = 0; i < 30; i++) controller.update(0.016, 1.0 + i * 0.016);
  assert.ok(vrm._expressions['aa'] < 0.05, `Mouth should close when idle, got ${vrm._expressions['aa']}`);
});

test('switching rigs clears held targets and old bone references while keeping speech state', () => {
  const controller = new AvatarAnimationController({ holdPose: true });
  const first = createMockVRM();
  controller.setVRM(first);
  controller.startDrag('left', new THREE.Vector3(0.3, 0.2, 0.1));
  controller.update(0.016, 0);
  controller.endDrag('left');
  controller.setConversationState('SPEAKING');
  const second = createMockVRM();
  controller.setVRM(second);
  assert.equal(controller.bones.leftHand, second._bones.leftHand);
  assert.notEqual(controller.bones.leftHand, first._bones.leftHand);
  assert.equal(controller.leftArmState, 'REST');
  assert.equal(controller.userPosedTargets.left, null);
  assert.equal(controller.conversationState, 'SPEAKING');
  controller.update(0.016, 1);
  assert.equal(second._expressions.aa, 0, 'a new rig must not inherit old speech motion');
  controller.setSpeechAmplitude(.6); controller.update(.016, 1.016);
  assert.ok(second._expressions.aa > 0);
});

test('breathing preserves the loaded spine rest translation', () => {
  const controller = new AvatarAnimationController();
  const vrm = createMockVRM();
  vrm._bones.spine.position.set(0, 0.16, -0.02);
  const rest = vrm._bones.spine.position.clone();
  controller.setVRM(vrm);
  for (let i = 0; i < 120; i++) controller.update(1 / 60, i / 60);
  assert.deepEqual(vrm._bones.spine.position, rest);
});

test('calm motion is restrained and personality changes preserve held hands and mouth lifecycle', () => {
  const measurements = {};
  for (const id of ['nova', 'ember']) {
    const controller = new AvatarAnimationController({ holdPose: true });
    const vrm = createMockVRM();
    controller.setVRM(vrm);
    controller.avatarPersonality = getAvatarVoiceProfile(id);
    controller.activeVoicePreset = controller.avatarPersonality.preset;
    controller.setConversationState('SPEAKING');
    controller.activeGestureKey = Object.keys(controller.gestureTargets).find(key => controller.gestureTargets[key].arm === 'right');
    controller.setSpeechAmplitude(.7);
    for (let i = 0; i < 10; i++) controller.update(1 / 60, 0.3 + i / 60);
    measurements[id] = {
      handMotion: controller.desiredTargets.right.distanceTo(controller.restTargets.right),
      headMotion: vrm._bones.head.quaternion.angleTo(new THREE.Quaternion()),
      happy: vrm._expressions.happy,
    };
    assert.ok(vrm._expressions.aa > 0.1);
    const target = controller.restTargets.right.clone().add(new THREE.Vector3(0.02, 0.03, 0.01));
    controller.startDrag('right', target);
    for (let i = 0; i < 30; i++) controller.update(1 / 60, 1 + i / 60);
    controller.endDrag('right');
    controller.avatarPersonality = getAvatarVoiceProfile(id === 'nova' ? 'ember' : 'nova');
    controller.update(1 / 60, 2);
    assert.ok(controller.desiredTargets.right.distanceTo(target) < 0.001);
    controller.setConversationState('IDLE');
    for (let i = 0; i < 60; i++) controller.update(1 / 60, 3 + i / 60);
    assert.ok(vrm._expressions.aa < 0.001);
  }
  assert.ok(measurements.nova.handMotion < measurements.ember.handMotion);
  assert.ok(measurements.nova.headMotion < measurements.ember.headMotion);
  assert.ok(measurements.nova.happy < measurements.ember.happy);
});

test('audio-driven mouth follows amplitude and silence without procedural oscillation', () => {
  const controller = new AvatarAnimationController();
  const vrm = createMockVRM(); controller.setVRM(vrm);
  controller.setConversationState('SPEAKING'); controller.setSpeechAmplitude(0);
  for (let i = 0; i < 30; i++) controller.update(1 / 60, i / 60);
  assert.equal(vrm._expressions.aa, 0);
  controller.setSpeechAmplitude(0.8);
  for (let i = 0; i < 30; i++) controller.update(1 / 60, 1 + i / 60);
  assert.ok(vrm._expressions.aa > 0.75);
  controller.setSpeechAmplitude(0);
  for (let i = 0; i < 30; i++) controller.update(1 / 60, 2 + i / 60);
  assert.ok(vrm._expressions.aa < 0.001);
  controller.setSpeechAmplitude(1); controller.setConversationState('IDLE');
  for (let i = 0; i < 30; i++) controller.update(1 / 60, 3 + i / 60);
  assert.ok(vrm._expressions.aa < 0.001);
});
test('diagnostics report real slow-frame FPS while arm interpolation remains bounded', () => {
  const c = new AvatarAnimationController(); c.setVRM(createMockVRM());
  for (let i = 0; i < 150; i++) c.update(.2, i * .2);
  assert.ok(Math.abs(c.diagnostics.fps - 5) < .01); assert.equal(c.frameDelta, .05);
});
test('speech gesture duration uses the audio position despite sparse rendering frames', () => {
  const c = new AvatarAnimationController(); c.setVRM(createMockVRM()); let position = .2;
  c.setSpeechPlayback({ text: 'Hello!', read: () => ({ position, state: 'playing' }) }); c.setConversationState('SPEAKING'); c.triggerGesture('FRIENDLY_WAVE');
  position = 1.2; c.update(.2, 1.2); assert.ok(Math.abs(c.gestureAge - 1) < .00001);
  position = 4; c.update(.2, 4); assert.equal(c.activeGestureKey, null);
});
