import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { prepareAvatar, disposeAvatarScene } from './avatarModel.js';
import { AvatarAnimationController } from './AvatarAnimationController.js';
import HandHandle from './HandHandle.jsx';
import CharacterInteraction from './CharacterInteraction.jsx';
import { mouthOpenForState } from './avatarAnimation.js';
import AnimationDebugPanel from './AnimationDebugPanel.jsx';
import CollisionProxyPreview from './CollisionProxyPreview.jsx';

// Recognized 3D demo avatar fallback before importing a VRM.
function PlaceholderAvatar({ conversationState }) {
  const body = useRef();
  const mouth = useRef();
  useFrame(({ clock }) => {
    if (body.current) {
      body.current.position.y = Math.sin(clock.elapsedTime * 1.4) * 0.03;
      body.current.rotation.y = Math.sin(clock.elapsedTime * 0.55) * 0.07;
    }
    if (mouth.current) mouth.current.scale.y = 0.4 + mouthOpenForState(conversationState, clock.elapsedTime);
  });

  return (
    <group ref={body}>
      {/* Legs */}
      {[-0.16, 0.16].map((x) => (
        <mesh key={x} position={[x, 0.4, 0]} castShadow>
          <capsuleGeometry args={[0.1, 0.48, 8, 16]} />
          <meshStandardMaterial color="#1a2744" roughness={0.7} />
        </mesh>
      ))}
      {/* Torso */}
      <mesh position={[0, 1.02, 0]} castShadow>
        <capsuleGeometry args={[0.36, 0.42, 8, 24]} />
        <meshStandardMaterial color="#6d8fff" metalness={0.3} roughness={0.38} />
      </mesh>
      {/* Arms */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.47, 0.96, 0]} rotation={[0, 0, side * 0.18]} castShadow>
          <capsuleGeometry args={[0.105, 0.5, 8, 16]} />
          <meshStandardMaterial color="#344b89" roughness={0.5} />
        </mesh>
      ))}
      {/* Neck */}
      <mesh position={[0, 1.54, 0]}>
        <cylinderGeometry args={[0.105, 0.105, 0.18, 16]} />
        <meshStandardMaterial color="#f4c8ac" />
      </mesh>
      {/* Head and hair */}
      <mesh position={[0, 1.86, 0]} castShadow>
        <sphereGeometry args={[0.31, 32, 32]} />
        <meshStandardMaterial color="#f4c8ac" roughness={0.75} />
      </mesh>
      <mesh position={[0, 2.03, -0.045]} scale={[1.03, 0.65, 1]} castShadow>
        <sphereGeometry args={[0.315, 32, 32]} />
        <meshStandardMaterial color="#152039" roughness={0.75} />
      </mesh>
      {/* Face points toward the camera (+Z). */}
      {[-0.12, 0.12].map((x) => (
        <mesh key={x} position={[x, 1.89, 0.283]}>
          <sphereGeometry args={[0.025, 12, 12]} />
          <meshStandardMaterial color="#1a2030" />
        </mesh>
      ))}
      <mesh ref={mouth} position={[0, 1.74, 0.3]} scale={[1, 0.4, 1]}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshStandardMaterial color="#ad686b" />
      </mesh>
    </group>
  );
}

function Character({
  modelUrl,
  modelRevision,
  onModelStatus,
  onLoadingChange,
  onModelLoaded,
  conversationState,
  controller,
  orbitControlsRef,
  reachLimit,
  enableHandInteraction,
  interactionMode,
}) {
  const mount = useRef(null);
  const [hasVrm, setHasVrm] = useState(false);
  const currentVrmRef = useRef(null);
  const currentUrlRef = useRef(null);
  const requestIdRef = useRef(0);
  const callbacks = useRef({ onModelStatus, onLoadingChange, onModelLoaded });
  callbacks.current = { onModelStatus, onLoadingChange, onModelLoaded };
  const [rigVersion, setRigVersion] = useState(0);

  useEffect(() => {
    const currentRequestId = ++requestIdRef.current;
    let cancelled = false;
    const status = (value) => callbacks.current.onModelStatus?.(value);
    const loading = (value) => callbacks.current.onLoadingChange?.(value, modelUrl);

    if (currentVrmRef.current && currentUrlRef.current === modelUrl) {
      callbacks.current.onModelLoaded?.(modelUrl);
      loading(false);
      status(`Avatar ready · ${controller.rigInfo.description}`);
      return () => { cancelled = true; };
    }

    if (!modelUrl) {
      if (currentVrmRef.current) {
        mount.current?.remove(currentVrmRef.current.scene);
        disposeAvatarScene(currentVrmRef.current.scene);
        currentVrmRef.current = null;
      }
      setHasVrm(false);
      controller.setVRM(null);
      onLoadingChange?.(false);
      onModelStatus?.('Demo avatar ready — import a .vrm for full IK body control');
      return;
    }

    loading(true);
    status('Loading VRM avatar...');
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      modelUrl,
      (gltf) => {
        const vrm = gltf.userData.vrm;
        // Ignore stale requests if a newer model was selected while this one was downloading
        if (cancelled || requestIdRef.current !== currentRequestId) {
          disposeAvatarScene(vrm?.scene || gltf.scene);
          return;
        }

        if (!vrm) {
          disposeAvatarScene(gltf.scene);
          loading(false);
          status('File is not a valid VRM. Preserving current avatar.');
          return;
        }

        try { prepareAvatar(vrm); } catch {
          disposeAvatarScene(vrm.scene);
          loading(false);
          status('VRM has invalid dimensions. Preserving current avatar.');
          return;
        }
        vrm.scene.traverse((object) => {
          object.frustumCulled = false;
        });

        // Cleanly dispose and unmount previous VRM
        if (currentVrmRef.current) {
          mount.current?.remove(currentVrmRef.current.scene);
          disposeAvatarScene(currentVrmRef.current.scene);
        }

        currentVrmRef.current = vrm;
        currentUrlRef.current = modelUrl;
        mount.current?.add(vrm.scene);
        controller.setVRM(vrm);
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = true;
        setRigVersion((value) => value + 1);
        setHasVrm(true);
        callbacks.current.onModelLoaded?.(modelUrl);
        loading(false);
        status(`Avatar ready · ${controller.rigInfo.description}`);
      },
      undefined,
      (error) => {
        if (!cancelled && requestIdRef.current === currentRequestId) {
          console.error('VRM import failed:', error);
          loading(false);
          status('VRM load failed. Preserving current avatar. Select another avatar or retry.');
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [modelUrl, modelRevision, controller, orbitControlsRef]);

  // Clean disposal on complete unmount of Character
  useEffect(() => {
    return () => {
      if (currentVrmRef.current) {
        mount.current?.remove(currentVrmRef.current.scene);
        disposeAvatarScene(currentVrmRef.current.scene);
        currentVrmRef.current = null;
      }
      controller.setVRM(null);
    };
  }, [controller]);

  useFrame(({ clock }, delta) => {
    // Single unified frame update: runs IK, priority blending, breathing, blinking, and speech
    controller.update(delta, clock.elapsedTime);
  });

  return (
    <>
      <group ref={mount}>
        {!hasVrm && <PlaceholderAvatar conversationState={conversationState} />}
      </group>

      {/* 3D Interactive Hand Handles for direct IK manipulation */}
      {hasVrm && (
        <>
          <HandHandle
            key={`left-${rigVersion}`}
            side="left"
            controller={controller}
            orbitControlsRef={orbitControlsRef}
            isAtReachLimit={reachLimit.left}
            enabled={enableHandInteraction}
            interactionMode={interactionMode}
          />
          <HandHandle
            key={`right-${rigVersion}`}
            side="right"
            controller={controller}
            orbitControlsRef={orbitControlsRef}
            isAtReachLimit={reachLimit.right}
            enabled={enableHandInteraction}
            interactionMode={interactionMode}
          />
        </>
      )}
    </>
  );
}

const Avatar = forwardRef(function Avatar(
  {
    modelUrl,
    modelRevision,
    onModelStatus,
    onLoadingChange,
    onModelLoaded,
    conversationState = 'IDLE',
    subscribeSpeechBoundary,
    subscribeSpeechAmplitude,
    subscribeSpeechPlayback,
    onTestSpeech,
    enableHandInteraction = true,
    holdPose = false,
    enableSpeakingGestures = true,
    enableIdleAnimation = true,
    cameraView = 'upper',
    voicePreset = 'sweet',
    avatarPersonality,
    interactionMode = false,
    avatarId = 'default',
    onBoundary,
    boundarySpeechActive = false,
    onRigStatusChange = () => {},
    onReachLimitChange = () => {},
  },
  ref,
) {
  const orbitControlsRef = useRef(null);
  const [reachLimit, setReachLimit] = useState({ left: false, right: false });

  // Central animation controller instance
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = new AvatarAnimationController({
      enableHandInteraction,
      holdPose,
      enableSpeakingGestures,
      enableIdleAnimation,
      voicePreset,
      onStatusChange: onRigStatusChange,
      onReachLimitChange: (side, isAtLimit) => {
        setReachLimit((prev) => {
          if (prev[side] === isAtLimit) return prev;
          const next = { ...prev, [side]: isAtLimit };
          onReachLimitChange(next);
          return next;
        });
      },
    });
  }
  const controller = controllerRef.current;
  const diagnosticsEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get('animationDebug') === '1';

  // Sync props to controller
  useEffect(() => {
    controller.enableHandInteraction = enableHandInteraction;
    controller.holdPose = holdPose;
    controller.enableSpeakingGestures = enableSpeakingGestures;
    controller.enableIdleAnimation = enableIdleAnimation;
    controller.activeVoicePreset = voicePreset;
    controller.avatarPersonality = avatarPersonality;
  }, [controller, enableHandInteraction, holdPose, enableSpeakingGestures, enableIdleAnimation, voicePreset, avatarPersonality]);
  useEffect(() => { controller.boundarySpeechActive = boundarySpeechActive; }, [controller, boundarySpeechActive]);
  useEffect(() => { if (orbitControlsRef.current) orbitControlsRef.current.enabled = !interactionMode; }, [interactionMode]);

  // Adjust camera and OrbitControls target when cameraView switches
  useEffect(() => {
    if (!orbitControlsRef.current) return;
    const controls = orbitControlsRef.current;
    if (cameraView === 'full') {
      controls.target.set(0, 0.95, 0);
      controls.object.position.set(0, 1.15, 3.8);
      controls.minDistance = 2.0;
      controls.maxDistance = 6.5;
    } else {
      // Default: upper-body framing for clear facial expressions and gestures
      controls.target.set(0, 1.25, 0);
      controls.object.position.set(0, 1.42, 2.3);
      controls.minDistance = 1.4;
      controls.maxDistance = 4.5;
    }
    controls.update();
  }, [cameraView]);

  // Sync conversation state
  useEffect(() => {
    controller.setConversationState(conversationState);
  }, [controller, conversationState]);

  // Subscribe to speech boundary events
  useEffect(() => {
    if (!subscribeSpeechBoundary) return;
    const unsubscribe = subscribeSpeechBoundary((event) => {
      controller.onSpeechBoundary(event);
    });
    return () => {
      unsubscribe?.();
    };
  }, [controller, subscribeSpeechBoundary]);

  useEffect(() => {
    return subscribeSpeechAmplitude?.(value => controller.setSpeechAmplitude(value));
  }, [controller, subscribeSpeechAmplitude]);
  useEffect(() => subscribeSpeechPlayback?.(playback => controller.setSpeechPlayback(playback)), [controller, subscribeSpeechPlayback]);

  // Expose resetPose method to parent component
  useImperativeHandle(
    ref,
    () => ({
      resetPose() {
        controller.resetPose();
      },
    }),
    [controller],
  );

  return (
    <><Canvas camera={{ position: [0, 1.42, 2.3], fov: 36 }} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.65} />
      <hemisphereLight args={['#f1eaff', '#333048', 0.8]} />
      <directionalLight intensity={1.5} color="#fff2e8" position={[2.5, 5, 3]} />
      <directionalLight intensity={0.55} color="#bacdff" position={[-3, 2, 2]} />
      <directionalLight intensity={0.9} color="#dac9ff" position={[-1, 2.4, -2]} />

      <Character
        modelUrl={modelUrl}
        modelRevision={modelRevision}
        onModelStatus={onModelStatus}
        onLoadingChange={onLoadingChange}
        onModelLoaded={onModelLoaded}
        conversationState={conversationState}
        controller={controller}
        orbitControlsRef={orbitControlsRef}
        reachLimit={reachLimit}
        enableHandInteraction={enableHandInteraction}
        interactionMode={interactionMode}
      />

      <OrbitControls
        ref={orbitControlsRef}
        enabled={!interactionMode}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={1.4}
        maxDistance={5.5}
        minPolarAngle={0.5}
        maxPolarAngle={1.8}
        target={[0, 1.25, 0]}
      />
      <CharacterInteraction controller={controller} enabled={interactionMode} avatarId={avatarId} onBoundary={onBoundary} orbitControlsRef={orbitControlsRef} />
      {diagnosticsEnabled && <CollisionProxyPreview controller={controller} />}
    </Canvas>{diagnosticsEnabled && <AnimationDebugPanel controller={controller} avatarId={avatarId} onTestSpeech={onTestSpeech} />}</>
  );
});

export default Avatar;
