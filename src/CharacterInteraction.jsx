import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3, Sphere, Matrix4 } from 'three';
import { DeliberateInteraction } from './boundaryBehavior.js';

export default function CharacterInteraction({ controller, enabled, avatarId, onBoundary, orbitControlsRef }) {
  const { gl, camera } = useThree();
  const latest = useRef({ enabled, avatarId, onBoundary }); latest.current = { enabled, avatarId, onBoundary };
  useFrame(() => camera.getWorldPosition(controller.eyeTarget));
  useEffect(() => {
    const canvas = gl.domElement, policy = new DeliberateInteraction(), raycaster = new Raycaster(), pointer = new Vector2();
    const envelope = new Sphere(new Vector3(0, .9, 0), 1.9), inverse = new Matrix4();
    const privateBroadphase = new Sphere();
    const cancel = () => policy.cancel();
    const down = event => {
      policy.enabled = latest.current.enabled && !controller.boundary && controller.collision?.calibrated;
      policy.begin(event, performance.now());
    };
    const up = event => {
      const gestureEnd = performance.now();
      if (!policy.down || !controller.vrm || controller.boundary) { cancel(); return; }
      const bounds = canvas.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      controller.collision.update(); raycaster.setFromCamera(pointer, camera);
      let possiblePrivateHit = false;
      for (const c of controller.collision.colliders) if (c.region === 'private') {
        privateBroadphase.center.copy(c.start).lerp(c.end, .5);
        privateBroadphase.radius = c.name === 'pelvis' ? controller.collision.width * 1.12 : c.start.distanceTo(c.end) * .5 + c.radius + controller.collision.width * .25;
        if (raycaster.ray.intersectsSphere(privateBroadphase)) possiblePrivateHit = true;
      }
      if (!possiblePrivateHit) { policy.finish(event, gestureEnd, 'safe'); return; }
      // A conservative broadphase sphere avoids rescanning all skinned vertices for bounds.
      // The final ray test still uses the actual currently deformed mesh surface.
      envelope.center.copy(controller.collision.center); envelope.center.y = .9;
      controller.vrm.scene.traverse(o => { if (o.isSkinnedMesh) { o.boundingSphere ||= new Sphere(); o.boundingSphere.copy(envelope).applyMatrix4(inverse.copy(o.matrixWorld).invert()); o.boundingBox = null; } });
      const hit = raycaster.intersectObject(controller.vrm.scene, true).find(h => h.object.visible && (Array.isArray(h.object.material) ? h.object.material.some(m => m.visible && m.opacity > 0) : h.object.material?.visible && h.object.material.opacity > 0));
      const region = hit ? controller.collision?.classifySurface(hit.point) : 'neutral';
      if (policy.finish(event, gestureEnd, region) && controller.beginBoundary(latest.current.avatarId)) {
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = !latest.current.enabled;
        latest.current.onBoundary?.();
      }
    };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('wheel', cancel, { passive: true });
    canvas.addEventListener('pointerleave', cancel);
    return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('wheel', cancel); canvas.removeEventListener('pointerleave', cancel); };
  }, [gl, camera, controller, orbitControlsRef]);
  return null;
}
