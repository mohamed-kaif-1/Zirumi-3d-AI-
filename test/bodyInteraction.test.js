import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, Vector3, Quaternion } from 'three';
import { BodyCollision } from '../src/bodyCollision.js';
import { DeliberateInteraction, boundaryPhrase } from '../src/boundaryBehavior.js';
import { AvatarAnimationController } from '../src/AvatarAnimationController.js';

function rig() {
  const scene = new Object3D(), bones = {}, expressions = {};
  const add = (name, parent, position) => { const b = new Object3D(); b.position.fromArray(position); parent.add(b); bones[name] = b; return b; };
  const hips = add('hips', scene, [0, .85, 0]);
  const spine = add('spine', hips, [0, .15, 0]); const chest = add('chest', spine, [0, .22, 0]);
  const neck = add('neck', chest, [0, .16, 0]); add('head', neck, [0, .07, 0]);
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? 1 : -1, shoulder = add(side + 'Shoulder', chest, [s * .1, .07, 0]);
    const upper = add(side + 'UpperArm', shoulder, [s * .07, 0, 0]);
    const lower = add(side + 'LowerArm', upper, [s * .25, 0, 0]); add(side + 'Hand', lower, [s * .23, 0, 0]);
    const thigh = add(side + 'UpperLeg', hips, [s * .08, -.05, 0]); const knee = add(side + 'LowerLeg', thigh, [0, -.36, 0]); add(side + 'Foot', knee, [0, -.36, .025]);
  }
  scene.updateMatrixWorld(true);
  return { scene, bones, humanoid: { getNormalizedBoneNode: n => bones[n] }, expressionManager: { setValue: (n, v) => { expressions[n] = v; }, getValue: n => expressions[n] || 0 }, update() { scene.updateMatrixWorld(true); } };
}
test('body proxies follow skeleton and classify real surface points without exposing geometry', () => {
  const r = rig(), c = new BodyCollision(r.bones);
  const chest = r.bones.chest.getWorldPosition(new Vector3()).add(new Vector3(0, 0, .14));
  assert.equal(c.classifySurface(chest), 'private');
  assert.equal(c.classifySurface(r.bones.hips.getWorldPosition(new Vector3()).add(new Vector3(0, 0, -.1))), 'private');
  assert.equal(c.classifySurface(r.bones.leftHand.getWorldPosition(new Vector3())), 'safe');
  assert.equal(c.classifySurface(r.bones.leftUpperArm.getWorldPosition(new Vector3()).add(new Vector3(0, .015, .04))), 'safe');
  assert.equal(c.classifySurface(r.bones.leftUpperArm.getWorldPosition(new Vector3()).add(new Vector3(-.03, -.025, .14))), 'safe', 'clothing over a shoulder is not a private-zone selection');
  assert.equal(c.classifySurface(r.bones.head.getWorldPosition(new Vector3()).add(new Vector3(0, .08, 0))), 'safe');
  const old = c.colliders.find(p => p.name === 'pelvis').start.clone();
  r.scene.position.x = 1; r.scene.updateMatrixWorld(true); c.update();
  assert.ok(Math.abs(c.colliders.find(p => p.name === 'pelvis').start.x - old.x - 1) < 1e-8);
});
test('safe targets stay out of torso/head and reject across-body and behind-back reaches', () => {
  const r = rig(), c = new BodyCollision(r.bones), out = new Vector3();
  for (const side of ['left', 'right']) for (const target of [new Vector3(0, 1.16, 0), new Vector3(0, 1.55, 0), new Vector3(0, .83, -.5)]) {
    c.constrainTarget(side, target, out);
    for (const p of c.obstacles(side)) assert.ok(c.distance(out, p) + 1e-6 >= p.radius + c.width * .12, p.name);
  }
});
test('exact capsule segment checks catch mid-segment intersections and handle degenerate/parallel segments', () => {
  const c = new BodyCollision(rig().bones), v = (...p) => new Vector3(...p);
  assert.ok(c.segmentDistance(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 0), v(0, 1, 0)) < 1e-8);
  assert.equal(c.segmentDistance(v(0, 0, 0), v(0, 0, 0), v(0, 1, 0), v(1, 1, 0)), 1);
  assert.equal(c.segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0, 2, 0), v(1, 2, 0)), 2);
});
test('deliberate interaction excludes hover, camera mode, movement, secondary buttons, scroll cancellation and repeats', () => {
  const p = new DeliberateInteraction(), event = { pointerId: 1, clientX: 10, clientY: 10, button: 0, isPrimary: true };
  p.begin(event, 0); assert.equal(p.finish(event, 50, 'private'), false);
  p.enabled = true; assert.equal(p.finish(event, 50, 'private'), false);
  p.begin(event, 0); assert.equal(p.finish({ ...event, clientX: 20 }, 50, 'private'), false);
  p.begin({ ...event, button: 2 }, 0); assert.equal(p.finish(event, 50, 'private'), false);
  p.begin(event, 0); p.cancel(); assert.equal(p.finish(event, 50, 'private'), false);
  p.begin(event, 0); assert.equal(p.finish(event, 50, 'safe'), false);
  p.begin(event, 0); assert.equal(p.finish(event, 50, 'private'), true);
  p.begin(event, 100); assert.equal(p.finish(event, 150, 'private'), false);
  p.begin(event, 7000); assert.equal(p.finish(event, 7050, 'private'), true);
});
test('all characters cancel drag, shake head locally, retain bone lengths and recover even without TTS', () => {
  for (const id of ['default', 'sky', 'nova', 'ember']) {
    const r = rig(), c = new AvatarAnimationController({ holdPose: true }); c.setVRM(r);
    const translations = Object.fromEntries(Object.entries(r.bones).map(([n, b]) => [n, b.position.clone()]));
    for (let i = 0; i < 90; i++) c.update(1 / 60, i / 60);
    c.setConversationState('SPEAKING'); c.startDrag('left', new Vector3(1, 2, 0));
    assert.equal(c.beginBoundary(id), true); assert.equal(c.beginBoundary(id), false); assert.equal(c.startDrag('right', new Vector3()), false);
    assert.equal(c.leftArmState, 'REST'); let positive = false, negative = false;
    const begin = c.elapsedTime;
    for (let i = 0; i < 210; i++) {
      c.update(1 / 60, begin + i / 60);
      positive ||= c.currentHeadRot.yaw > .01; negative ||= c.currentHeadRot.yaw < -.01;
      assert.ok(r.bones.head.quaternion.angleTo(new Quaternion()) < .35);
      for (const [n, b] of Object.entries(r.bones)) assert.deepEqual(b.position, translations[n]);
    }
    assert.equal(positive && negative, true); assert.equal(c.boundary, null); assert.equal(r.scene.position.z, 0);
  }
});
test('collision constrained poses preserve lengths and boundary priority blocks held and speech gestures', () => {
  const r = rig(), c = new AvatarAnimationController(); c.setVRM(r);
  let now = 0;
  for (const target of [new Vector3(0, 1.2, 0), new Vector3(0, 1.6, 0), new Vector3(2, 2, 2), new Vector3(.2, 1, .2)]) {
    c.startDrag('left', target);
    for (let i = 0; i < 90; i++) { c.update(1 / 60, now += 1 / 60); c.collision.update(); assert.ok(c.collision.armPenetration('left') <= .002); }
    assert.ok(Math.abs(r.bones.leftLowerArm.position.length() - .25) < 1e-8);
  }
  c.boundarySpeechActive = true; c.beginBoundary('nova'); const begin = now;
  c.setConversationState('SPEAKING'); c.activeGestureKey = 'GREETING';
  for (let i = 0; i < 200; i++) c.update(1 / 60, begin + i / 60);
  assert.equal(c.animationState, 'BOUNDARY_RESPONSE');
  c.boundarySpeechActive = false;
  for (let i = 200; i < 260; i++) c.update(1 / 60, begin + i / 60);
  assert.equal(c.boundary, null);
  c.beginBoundary(); c.setVRM(rig()); assert.equal(c.boundary, null); assert.equal(c.leftArmState, 'REST');
});
test('fixed refusal phrases use native scripts and both English locales share the English text', () => {
  assert.match(boundaryPhrase('ta-IN'), /\p{Script=Tamil}/u); assert.match(boundaryPhrase('hi-IN'), /\p{Script=Devanagari}/u);
  assert.equal(boundaryPhrase('en'), boundaryPhrase('en-IN'));
});
test('a slow rendering frame cannot skip the complete head shake', () => {
  const c = new AvatarAnimationController(); c.setVRM(rig()); c.beginBoundary('sky');
  c.update(2, 2); assert.equal(c.animationState, 'BOUNDARY_RESPONSE'); assert.ok(c.boundary.age <= .05);
  let positive = false, negative = false;
  for (let i = 0; i < 70; i++) { c.update(.05, 2 + i * .5); positive ||= c.currentHeadRot.yaw > .01; negative ||= c.currentHeadRot.yaw < -.01; }
  assert.equal(positive && negative, true); assert.equal(c.boundary, null);
});
