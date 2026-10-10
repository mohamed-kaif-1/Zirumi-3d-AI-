import { Vector3, MathUtils } from 'three';

const sides = ['left', 'right'];
/** Skeleton-attached conservative proxies, not mesh geometry or physics bodies. */
export class BodyCollision {
  constructor(bones, headTop = 1.65) {
    this.bones = bones;
    this.tmp = new Vector3(); this.closest = new Vector3(); this.delta = new Vector3();
    this.a = new Vector3(); this.b = new Vector3(); this.point = new Vector3();
    this.d1 = new Vector3(); this.d2 = new Vector3(); this.r = new Vector3();
    this.center = new Vector3(); this.colliders = [];
    const left = bones.leftUpperArm?.getWorldPosition(new Vector3());
    const right = bones.rightUpperArm?.getWorldPosition(new Vector3());
    this.calibrated = Boolean(left && right && left.distanceTo(right) > .01);
    this.width = MathUtils.clamp(left && right ? left.distanceTo(right) : .3, .23, .4);
    const w = this.width;
    const add = (name, from, to, radius, region, offset = 0) => {
      if (!bones[from] || !bones[to]) return;
      this.colliders.push({ name, from, to, radius, region, offset, start: new Vector3(), end: new Vector3() });
    };
    add('torso', 'hips', bones.neck ? 'neck' : bones.chest ? 'chest' : 'spine', w * .40, 'body');
    const headY = bones.head?.getWorldPosition(this.tmp).y || headTop - .2;
    const headRadius = MathUtils.clamp((headTop - headY) * .58, .09, .17);
    add('head', 'head', 'head', headRadius, 'head', headRadius * .65);
    add('neck', 'neck', 'head', w * .18, 'safe');
    add('pelvis', 'hips', 'hips', w * .36, 'private', -.025);
    add('chestBoundary', bones.chest ? 'chest' : 'spine', bones.neck ? 'neck' : 'spine', w * .40, 'private');
    for (const side of sides) {
      add(side + 'Shoulder', side + 'Shoulder', side + 'UpperArm', w * .20, 'safe');
      add(side + 'UpperArm', side + 'UpperArm', side + 'LowerArm', w * .075, 'safe');
      add(side + 'Forearm', side + 'LowerArm', side + 'Hand', w * .065, 'safe');
      add(side + 'Hand', side + 'Hand', side + 'Hand', w * .12, 'safe');
      add(side + 'Thigh', side + 'UpperLeg', side + 'LowerLeg', w * .14, 'body');
    }
    this.update();
    this.sideObstacles = Object.fromEntries(sides.map(side => [side, this.colliders.filter(c => c.name !== 'chestBoundary' && ![side + 'Shoulder', side + 'UpperArm', side + 'Forearm', side + 'Hand'].includes(c.name))]));
    this.armSegments = Object.fromEntries(sides.map(side => [side, [
      { from: bones[side + 'UpperArm'], to: bones[side + 'LowerArm'], radius: w * .075, skip: .35 },
      { from: bones[side + 'LowerArm'], to: bones[side + 'Hand'], radius: w * .065, skip: 0 },
      { from: bones[side + 'Hand'], to: bones[side + 'Hand'], radius: w * .12, skip: 0 },
    ]]));
  }
  update() {
    this.bones.hips?.getWorldPosition(this.center);
    for (const c of this.colliders) {
      this.bones[c.from].getWorldPosition(c.start); this.bones[c.to].getWorldPosition(c.end);
      if (c.name === 'chestBoundary') { c.end.lerp(c.start, .25); c.start.lerp(c.end, .25); }
      if (c.name === 'torso') c.end.lerp(c.start, .20);
      c.start.y += c.offset; c.end.y += c.offset;
    }
  }
  distance(point, c) {
    this.delta.subVectors(c.end, c.start);
    const denominator = this.delta.lengthSq();
    const t = denominator ? MathUtils.clamp(this.tmp.subVectors(point, c.start).dot(this.delta) / denominator, 0, 1) : 0;
    this.closest.copy(c.start).addScaledVector(this.delta, t);
    return point.distanceTo(this.closest);
  }
  obstacles(side) {
    // Connected shoulder/arm/hand segments are excluded; the other arm remains solid.
    return this.sideObstacles[side];
  }
  constrainTarget(side, target, out) {
    out.copy(target); const sign = side === 'left' ? 1 : -1;
    if (!this.calibrated) return out;
    // Keep unsupported across-body/behind-back reaches out of the interaction envelope.
    out.x = this.center.x + sign * Math.max(sign * (out.x - this.center.x), this.width * .34);
    out.z = Math.max(out.z, this.center.z - this.width * .2);
    for (let pass = 0; pass < 3; pass++) for (const c of this.obstacles(side)) {
      const radius = c.radius + this.width * .12, distance = this.distance(out, c);
      if (distance < radius) {
        this.tmp.subVectors(out, this.closest);
        if (this.tmp.lengthSq() < 1e-8) this.tmp.set(sign, 0, .3);
        out.copy(this.closest).addScaledVector(this.tmp.normalize(), radius + .003);
      }
    }
    return out;
  }
  armPenetration(side) {
    if (!this.calibrated) return 0;
    const upper = this.bones[side + 'UpperArm'], lower = this.bones[side + 'LowerArm'], hand = this.bones[side + 'Hand'];
    if (!upper || !lower || !hand) return 0;
    let worst = 0;
    const obstacles = this.obstacles(side);
    for (const { from, to, radius, skip } of this.armSegments[side]) {
      from.getWorldPosition(this.a); to.getWorldPosition(this.b);
      this.a.lerp(this.b, skip);
      for (const c of obstacles) worst = Math.max(worst, c.radius + radius + .004 - this.segmentDistance(this.a, this.b, c.start, c.end));
    }
    return worst;
  }
  segmentDistance(a0, a1, b0, b1) {
    this.d1.subVectors(a1, a0); this.d2.subVectors(b1, b0); this.r.subVectors(a0, b0);
    const a = this.d1.lengthSq(), e = this.d2.lengthSq(), f = this.d2.dot(this.r);
    let s = 0, t = 0;
    if (a < 1e-12 && e < 1e-12) return a0.distanceTo(b0);
    if (a < 1e-12) t = MathUtils.clamp(f / e, 0, 1);
    else {
      const c = this.d1.dot(this.r);
      if (e < 1e-12) s = MathUtils.clamp(-c / a, 0, 1);
      else {
        const b = this.d1.dot(this.d2), denominator = a * e - b * b;
        if (denominator > 1e-12) s = MathUtils.clamp((b * f - c * e) / denominator, 0, 1);
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = MathUtils.clamp(-c / a, 0, 1); }
        else if (t > 1) { t = 1; s = MathUtils.clamp((b - c) / a, 0, 1); }
      }
    }
    this.r.addScaledVector(this.d1, s).addScaledVector(this.d2, -t);
    return this.r.length();
  }
  classifySurface(point) {
    // Only called after a deliberate click hits the actual visible, skinned mesh.
    // Shoulder padding includes the clothing surface, not just the bone centre.
    for (const c of this.colliders) if (c.name.endsWith('Shoulder') && point.y >= c.end.y - this.width * .32 && point.y <= c.end.y + this.width * .28 && Math.abs(point.x - c.end.x) < this.width * .27 && Math.abs(point.z - c.end.z) < this.width * .8) return 'safe';
    let safeDistance = Infinity;
    for (const c of this.colliders) if (c.region === 'safe' || c.region === 'head') safeDistance = Math.min(safeDistance, this.distance(point, c) - c.radius);
    if (safeDistance < this.width * .08) return 'safe';
    for (const c of this.colliders) if (c.region === 'private') {
      if (this.distance(point, c) < c.radius + this.width * .22) return 'private';
      if (c.name === 'pelvis' && Math.abs(point.x - c.start.x) < this.width * .45 && Math.abs(point.y - c.start.y) < this.width * .43 && Math.abs(point.z - c.start.z) < this.width * .9) return 'private';
    }
    return 'neutral';
  }
}
