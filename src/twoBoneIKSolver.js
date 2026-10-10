import * as THREE from 'three';

const shoulderPosition = new THREE.Vector3();
const clampedTarget = new THREE.Vector3();
const direction = new THREE.Vector3();
const poleDirection = new THREE.Vector3();
const upperDirection = new THREE.Vector3();
const elbowPosition = new THREE.Vector3();
const lowerDirection = new THREE.Vector3();
const localDirection = new THREE.Vector3();
const restDirection = new THREE.Vector3();
const scale = new THREE.Vector3();
const parentRotation = new THREE.Quaternion();
const hingeAxis = new THREE.Vector3(0, 0, 1);

/** Rotation-only analytical IK. Local translations may point along any axis. */
export class TwoBoneIKSolver {
  constructor(options = {}) {
    this.maxReachFactor = options.maxReachFactor ?? 0.998;
    this.minDistance = options.minDistance ?? 0.04;
    this.maxElbowAngle = options.maxElbowAngle ?? (146 * Math.PI / 180);
  }

  solve(chain, targetWorld, poleWorld) {
    const { side, upperArm, lowerArm, hand, shoulder } = chain;
    if (!upperArm || !lowerArm || !hand) {
      return { reached: false, distance: 0, maxReach: 0, clampedTarget: targetWorld };
    }
    upperArm.getWorldScale(scale);
    const L1 = lowerArm.position.length() * Math.abs(scale.x);
    const L2 = hand.position.length() * Math.abs(scale.x);
    if (L1 < 1e-6 || L2 < 1e-6) return { reached: false, distance: 0, maxReach: 0, clampedTarget: targetWorld };
    const maxReach = (L1 + L2) * this.maxReachFactor;
    // Clamp distance BEFORE solving so joint limits and endpoint agree.
    const elbowMinimum = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(this.maxElbowAngle));
    const minReach = Math.min(maxReach, Math.max(elbowMinimum, Math.abs(L1 - L2) + this.minDistance));

    upperArm.getWorldPosition(shoulderPosition);
    if (shoulder) {
      const elevation = targetWorld.y - shoulderPosition.y;
      const lift = Math.min(0.2, Math.max(0, elevation - 0.05) * 0.25);
      shoulder.quaternion.setFromAxisAngle(hingeAxis, side === 'left' ? lift : -lift);
      if (chain.shoulderRest) shoulder.quaternion.premultiply(chain.shoulderRest);
      shoulder.updateWorldMatrix(true, true);
      upperArm.getWorldPosition(shoulderPosition);
    }
    direction.subVectors(targetWorld, shoulderPosition);
    const rawDistance = direction.length();
    if (rawDistance > 1e-6) direction.divideScalar(rawDistance);
    else direction.set(side === 'left' ? 1 : -1, 0, 0);
    const distance = THREE.MathUtils.clamp(rawDistance, minReach, maxReach);
    clampedTarget.copy(shoulderPosition).addScaledVector(direction, distance);

    poleDirection.subVectors(poleWorld, shoulderPosition);
    poleDirection.addScaledVector(direction, -poleDirection.dot(direction));
    if (poleDirection.lengthSq() < 1e-8) {
      poleDirection.set(Math.abs(direction.y) < 0.9 ? 0 : 1, Math.abs(direction.y) < 0.9 ? -1 : 0, 0);
      poleDirection.addScaledVector(direction, -poleDirection.dot(direction));
    }
    poleDirection.normalize();
    const cosAngle = THREE.MathUtils.clamp((L1 * L1 + distance * distance - L2 * L2) / (2 * L1 * distance), -1, 1);
    upperDirection.copy(direction).multiplyScalar(cosAngle).addScaledVector(poleDirection, Math.sqrt(1 - cosAngle * cosAngle));
    elbowPosition.copy(shoulderPosition).addScaledVector(upperDirection, L1);
    lowerDirection.subVectors(clampedTarget, elbowPosition).normalize();

    // Transform desired directions into each joint's actual local parent frame.
    if (upperArm.parent) upperArm.parent.getWorldQuaternion(parentRotation).invert();
    else parentRotation.identity();
    localDirection.copy(upperDirection).applyQuaternion(parentRotation).normalize();
    restDirection.copy(lowerArm.position).normalize();
    upperArm.quaternion.setFromUnitVectors(restDirection, localDirection);
    upperArm.updateWorldMatrix(true, true);

    upperArm.getWorldQuaternion(parentRotation).invert();
    localDirection.copy(lowerDirection).applyQuaternion(parentRotation).normalize();
    restDirection.copy(hand.position).normalize();
    lowerArm.quaternion.setFromUnitVectors(restDirection, localDirection);
    lowerArm.updateWorldMatrix(true, true);
    return {
      reached: rawDistance <= maxReach && rawDistance >= minReach,
      distance: rawDistance,
      maxReach,
      clampedTarget,
    };
  }
}
