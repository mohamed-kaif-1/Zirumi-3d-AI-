import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { Vector3, Box3 } from 'three';
import { prepareAvatar, disposeAvatarScene } from '../src/avatarModel.js';
import { AvatarAnimationController } from '../src/AvatarAnimationController.js';

export async function auditMotion(url) {
  const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));
  const vrm = prepareAvatar((await loader.loadAsync(url)).userData.vrm);
  const c = new AvatarAnimationController(); c.setVRM(vrm);
  const rest = Object.fromEntries(Object.entries(c.bones).filter(([, b]) => b).map(([n, b]) => [n, b.position.toArray()]));
  let time = 0, worstPenetration = 0, worstReach = 0; const costs = [], ikCosts = [];
  const solver = c.solveArms.bind(c); c.solveArms = () => { const start = performance.now(); solver(); ikCosts.push(performance.now() - start); };
  const step = () => { const start = performance.now(); c.update(1 / 60, time += 1 / 60); costs.push(performance.now() - start); };
  for (let i = 0; i < 180; i++) step();
  const poses = [];
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? 1 : -1;
    for (const [name, target] of [['reachable', c.restTargets[side].clone().add(new Vector3(sign * .04, .1, .16))], ['torso', new Vector3(0, 1.15, 0)], ['head', new Vector3(0, 1.55, 0)], ['unreachable', new Vector3(sign * 3, 2.5, 2)], ['crossBody', new Vector3(-sign * .3, 1.15, -.2)]]) {
      c.startDrag(side, target);
      for (let i = 0; i < 100; i++) {
        step(); c.collision.update(); worstPenetration = Math.max(worstPenetration, c.collision.armPenetration(side));
      }
      const chain = c.chains[side], origin = chain.upperArm.getWorldPosition(new Vector3()), wrist = chain.hand.getWorldPosition(new Vector3());
      const reach = origin.distanceTo(wrist), max = (chain.lowerArm.position.length() + chain.hand.position.length()) * Math.abs(chain.upperArm.getWorldScale(new Vector3()).x);
      worstReach = Math.max(worstReach, reach - max);
      poses.push({ side, name, requested: target.toArray(), wrist: wrist.toArray(), error: wrist.distanceTo(target), reach, maxReach: max, penetration: c.collision.armPenetration(side) });
      c.endDrag(side); c.resetPose(); for (let i = 0; i < 60; i++) step();
    }
  }
  let maxHeadShake = 0, minHeadShake = 0;
  c.beginBoundary(); for (let i = 0; i < 210; i++) { step(); maxHeadShake = Math.max(maxHeadShake, c.currentHeadRot.yaw); minHeadShake = Math.min(minHeadShake, c.currentHeadRot.yaw); }
  const unchangedTranslations = Object.entries(rest).every(([n, p]) => c.bones[n].position.toArray().every((v, i) => Math.abs(v - p[i]) < 1e-10));
  const percentile = (samples, fraction) => samples.toSorted((a, b) => a - b)[Math.floor(samples.length * fraction)];
  const bounds = new Box3().setFromObject(vrm.scene);
  const result = { url, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, normalizedBonePositions: Object.fromEntries(Object.entries(c.bones).filter(([, b]) => b).map(([n, b]) => [n, b.getWorldPosition(new Vector3()).toArray()])), expressions: c.rigInfo.expressionNames, poses, worstPenetration, worstReach, unchangedTranslations, maxHeadShake, minHeadShake, returnedToIdle: c.boundary === null, animationMs: { mean: costs.reduce((s, v) => s + v, 0) / costs.length, p95: percentile(costs, .95) }, ikCollisionMs: { mean: ikCosts.reduce((s, v) => s + v, 0) / ikCosts.length, p95: percentile(ikCosts, .95) } };
  disposeAvatarScene(vrm.scene); return result;
}
