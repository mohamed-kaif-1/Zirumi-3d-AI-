import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TwoBoneIKSolver } from '../src/twoBoneIKSolver.js';

function createArmChain(side = 'left') {
  const root = new THREE.Object3D();
  const parent = new THREE.Object3D();
  const upperArm = new THREE.Object3D();
  const lowerArm = new THREE.Object3D();
  const hand = new THREE.Object3D();

  const isLeft = side === 'left';
  const sign = isLeft ? 1 : -1;

  parent.position.set(sign * 0.2, 1.4, 0);
  upperArm.position.set(0, 0, 0);
  lowerArm.position.set(sign * 0.25, 0, 0);
  hand.position.set(sign * 0.25, 0, 0);

  root.add(parent);
  parent.add(upperArm);
  upperArm.add(lowerArm);
  lowerArm.add(hand);

  root.updateMatrixWorld(true);

  return { root, parent, upperArm, lowerArm, hand, side };
}

test('IK solver reaches within mathematical epsilon for reachable target (left arm)', () => {
  const chain = createArmChain('left');
  const solver = new TwoBoneIKSolver();

  const target = new THREE.Vector3(0.35, 1.25, 0.3);
  const pole = new THREE.Vector3(0.2, 1.0, -0.6);

  const result = solver.solve(chain, target, pole);
  chain.root.updateMatrixWorld(true);

  const solvedHandPos = new THREE.Vector3();
  chain.hand.getWorldPosition(solvedHandPos);

  const distToTarget = solvedHandPos.distanceTo(result.clampedTarget);
  assert.ok(distToTarget < 1e-6, `Solved hand should match clamped target, got error ${distToTarget}`);
  assert.equal(result.reached, true);
});

test('IK solver reaches within mathematical epsilon for reachable target (right arm)', () => {
  const chain = createArmChain('right');
  const solver = new TwoBoneIKSolver();

  const target = new THREE.Vector3(-0.35, 1.25, 0.3);
  const pole = new THREE.Vector3(-0.2, 1.0, -0.6);

  const result = solver.solve(chain, target, pole);
  chain.root.updateMatrixWorld(true);

  const solvedHandPos = new THREE.Vector3();
  chain.hand.getWorldPosition(solvedHandPos);

  const distToTarget = solvedHandPos.distanceTo(result.clampedTarget);
  assert.ok(distToTarget < 1e-6, `Solved hand should match clamped target, got error ${distToTarget}`);
  assert.equal(result.reached, true);
});

test('IK solver clamps target beyond max reach and never stretches bones', () => {
  const chain = createArmChain('left');
  const solver = new TwoBoneIKSolver();

  // Target far away (1.5 units)
  const target = new THREE.Vector3(1.5, 1.4, 0);
  const pole = new THREE.Vector3(0.2, 1.0, -0.5);

  const result = solver.solve(chain, target, pole);
  chain.root.updateMatrixWorld(true);

  // Bone lengths must remain exactly 0.25
  assert.equal(chain.lowerArm.position.x, 0.25);
  assert.equal(chain.hand.position.x, 0.25);

  const pShoulder = new THREE.Vector3();
  chain.upperArm.getWorldPosition(pShoulder);
  const pHand = new THREE.Vector3();
  chain.hand.getWorldPosition(pHand);

  const actualReach = pShoulder.distanceTo(pHand);
  assert.ok(actualReach <= result.maxReach + 1e-4, 'Arm should never stretch beyond max reach');
  assert.ok(result.distance > result.maxReach);
});

test('IK solver handles target directly at shoulder safely without NaN', () => {
  const chain = createArmChain('left');
  const solver = new TwoBoneIKSolver();

  const shoulderPos = new THREE.Vector3();
  chain.upperArm.getWorldPosition(shoulderPos);

  // Target coincident with shoulder
  const result = solver.solve(chain, shoulderPos, new THREE.Vector3(0.2, 1.0, -0.5));
  chain.root.updateMatrixWorld(true);

  assert.ok(!Number.isNaN(chain.upperArm.quaternion.x));
  assert.ok(!Number.isNaN(chain.lowerArm.quaternion.x));
  assert.ok(result.clampedTarget.length() > 0);
});

test('Elbow bend angle respects human anatomical limit (never bends backwards or > 146 deg)', () => {
  const chain = createArmChain('left');
  const solver = new TwoBoneIKSolver({ maxElbowAngle: 2.55 });

  // Pull hand very close to shoulder to force maximum bend
  const target = new THREE.Vector3(0.2, 1.45, 0.05);
  const pole = new THREE.Vector3(0.2, 1.0, -0.5);

  solver.solve(chain, target, pole);

  chain.root.updateMatrixWorld(true);
  const upper = chain.upperArm.getWorldPosition(new THREE.Vector3());
  const elbow = chain.lowerArm.getWorldPosition(new THREE.Vector3());
  const wrist = chain.hand.getWorldPosition(new THREE.Vector3());
  const bend = elbow.clone().sub(upper).angleTo(wrist.clone().sub(elbow));
  assert.ok(bend <= 2.55 + 1e-4, 'Geometric elbow bend respects the limit in any bone frame');
  assert.ok(elbow.z < upper.z, 'Elbow bends toward the anatomical pole');
});

test('IK handles reversed, angled bone directions and scaled rotated model roots without stretching', () => {
  for (const side of ['left', 'right']) {
    const chain = createArmChain(side);
    const sign = side === 'left' ? -1 : 1;
    chain.lowerArm.position.set(sign * 0.278, -0.013, -0.025);
    chain.hand.position.set(sign * 0.240, 0.013, -0.069);
    chain.root.rotation.y = Math.PI;
    chain.root.scale.setScalar(0.914);
    chain.root.updateMatrixWorld(true);
    const restUpper = chain.lowerArm.position.clone();
    const restLower = chain.hand.position.clone();
    const origin = chain.upperArm.getWorldPosition(new THREE.Vector3());
    const target = origin.clone().add(new THREE.Vector3(sign * 0.08, -0.35, 0.10));
    const result = new TwoBoneIKSolver().solve(chain, target, origin.clone().add(new THREE.Vector3(0, -0.2, -0.3)));
    const actual = chain.hand.getWorldPosition(new THREE.Vector3());
    assert.ok(actual.distanceTo(result.clampedTarget) < 1e-6);
    assert.deepEqual(chain.lowerArm.position, restUpper);
    assert.deepEqual(chain.hand.position, restLower);
  }
});
