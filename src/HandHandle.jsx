import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const _vHandWorld = new THREE.Vector3();
const _vIntersection = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _dragPlane = new THREE.Plane();

/**
 * 3D Draggable Hand Handle with visual hover, drag, and reach limit feedback.
 * Synchronized with camera drag plane and OrbitControls.
 */
export default function HandHandle({
  side = 'left',
  controller,
  orbitControlsRef,
  isAtReachLimit = false,
  enabled = true,
  interactionMode = false,
}) {
  const groupRef = useRef();
  const ringRef = useRef();
  const { camera, raycaster, pointer } = useThree();

  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const captureRef = useRef(null);
  useEffect(() => () => {
    const capture = captureRef.current;
    try { capture?.target.releasePointerCapture(capture.id); } catch { /* Capture may already have ended. */ }
    document.body.style.cursor = 'default';
    if (orbitControlsRef.current) orbitControlsRef.current.enabled = !interactionMode;
  }, [orbitControlsRef, interactionMode]);

  const boneName = side === 'left' ? 'leftHand' : 'rightHand';

  useFrame(({ clock }) => {
    if (!groupRef.current || !controller) return;
    if (dragging && (!enabled || controller.boundary || controller[side + 'ArmState'] !== 'DRAGGING')) {
      const capture = captureRef.current; captureRef.current = null;
      try { capture?.target.releasePointerCapture(capture.id); } catch { /* Already released. */ }
      setDragging(false); setHovered(false); document.body.style.cursor = 'default';
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = !interactionMode;
    }

    {
      // Follow the actual hand bone world position
      const handBone = controller.bones?.[boneName];
      if (handBone) {
        handBone.getWorldPosition(_vHandWorld);
        groupRef.current.position.copy(_vHandWorld);
      } else {
        // Fallback to controller target if bone not yet initialized
        const target = controller.currentTargets?.[side];
        if (target) groupRef.current.position.copy(target);
      }
    }

    // Orient halo ring towards camera
    if (ringRef.current) {
      ringRef.current.quaternion.copy(camera.quaternion);
      if (hovered || dragging) {
        const pulse = 1.0 + Math.sin(clock.elapsedTime * 8) * 0.15;
        ringRef.current.scale.set(pulse, pulse, pulse);
      } else {
        ringRef.current.scale.set(1, 1, 1);
      }
    }
  });

  if (!enabled || !controller?.hasHumanoid || controller.collision?.calibrated === false) return null;

  // Determine indicator color
  let color = '#00f0ff'; // Sleek cyan
  let opacity = 0.5;
  if (isAtReachLimit) {
    color = '#f59e0b'; // Amber warning
    opacity = 0.95;
  } else if (dragging) {
    color = '#38bdf8'; // Active bright cyan
    opacity = 1.0;
  } else if (hovered) {
    color = '#22d3ee'; // Hovered cyan
    opacity = 0.85;
  }

  function handlePointerOver(e) {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = 'grab';
  }

  function handlePointerOut() {
    setHovered(false);
    if (!dragging) {
      document.body.style.cursor = 'default';
    }
  }

  function handlePointerDown(e) {
    e.stopPropagation();
    if (e.button !== 0 || e.isPrimary === false || controller.boundary || !controller.startDrag(side, groupRef.current.position)) return;
    try {
      e.target.setPointerCapture(e.pointerId);
      captureRef.current = { target: e.target, id: e.pointerId };
    } catch {
      // Ignored for environments without setPointerCapture support
    }

    setDragging(true);
    document.body.style.cursor = 'grabbing';

    // Disable OrbitControls while dragging the avatar's hand
    if (orbitControlsRef.current) {
      orbitControlsRef.current.enabled = false;
    }

    // Create drag plane facing the camera through the current hand position
    camera.getWorldDirection(_camDir).negate();
    if (groupRef.current) {
      _dragPlane.setFromNormalAndCoplanarPoint(_camDir, groupRef.current.position);
    }
  }

  function handlePointerMove(e) {
    if (!dragging) return;
    e.stopPropagation();

    // Raycast pointer onto the camera drag plane
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(_dragPlane, _vIntersection);
    if (hit) {
      controller.updateDrag(side, _vIntersection);
    }
  }

  function handlePointerUp(e) {
    if (!dragging) return;
    e.stopPropagation();

    try {
      e.target.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored for environments without releasePointerCapture support
    }

    setDragging(false);
    captureRef.current = null;
    document.body.style.cursor = hovered ? 'grab' : 'default';

    // Re-enable OrbitControls after dragging ends
    if (orbitControlsRef.current) {
      orbitControlsRef.current.enabled = !interactionMode;
    }

    controller.endDrag(side);
  }

  return (
    <group ref={groupRef}>
      {/* Invisible larger hit target for smooth mouse & touch grabbing */}
      <mesh
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Holographic camera-facing halo ring */}
      <group ref={ringRef}>
        <mesh>
          <ringGeometry args={[0.038, 0.052, 32]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh>
          <circleGeometry args={[0.018, 16]} />
          <meshBasicMaterial color={color} transparent opacity={opacity * 0.8} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}
