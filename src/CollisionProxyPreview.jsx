import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
export default function CollisionProxyPreview({ controller }) {
  const group = useRef(), axis = useRef(new Vector3(0, 1, 0)), direction = useRef(new Vector3());
  useFrame(() => {
    if (!group.current) return;
    group.current.visible = controller.showCollisions; if (!controller.showCollisions) return;
    for (let i = 0; i < 16; i++) {
      const proxy = controller.collision?.colliders[i], object = group.current.children[i];
      object.visible = Boolean(proxy); if (!proxy) continue;
      direction.current.subVectors(proxy.end, proxy.start); const length = direction.current.length();
      object.position.copy(proxy.start).lerp(proxy.end, .5);
      object.children[0].scale.set(proxy.radius, Math.max(.001, length), proxy.radius);
      object.quaternion.setFromUnitVectors(axis.current, length > .0001 ? direction.current.normalize() : axis.current);
      object.children[1].position.y = length / 2; object.children[2].position.y = -length / 2;
      object.children[1].scale.setScalar(proxy.radius); object.children[2].scale.setScalar(proxy.radius);
    }
  });
  return <group ref={group} visible={false}>{Array.from({ length: 16 }, (_, i) => <group key={i}>
    <mesh><cylinderGeometry args={[1, 1, 1, 12]} /><meshBasicMaterial color="#67efcf" wireframe transparent opacity={.4} depthTest={false} /></mesh>
    {[0, 1].map(j => <mesh key={j}><sphereGeometry args={[1, 12, 8]} /><meshBasicMaterial color="#67efcf" wireframe transparent opacity={.4} depthTest={false} /></mesh>)}
  </group>)}</group>;
}
