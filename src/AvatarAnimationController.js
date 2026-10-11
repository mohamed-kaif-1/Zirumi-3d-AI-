import * as THREE from 'three';
import { TwoBoneIKSolver } from './twoBoneIKSolver.js';
import { BodyCollision } from './bodyCollision.js';
import { BOUNDARY_PROFILES } from './boundaryBehavior.js';
import { REST_POSE, GESTURE_TARGETS, getBreathingOffset, BlinkController, getHeadRotations } from './proceduralPoses.js';
import { GESTURES, gestureWeight } from './animation/GestureLibrary.js';
import { GestureScheduler, analyzePhrase } from './animation/GestureScheduler.js';
import { PostureController, postureFor } from './animation/PostureController.js';
import { FacialExpressionController, faceFor } from './animation/FacialExpressionController.js';
import { SpeechLipSyncController, VISEMES } from './animation/SpeechLipSyncController.js';

/**
 * Unified Avatar Animation Controller.
 * Manages skeletal Inverse Kinematics, priority blending, speech visemes,
 * conversational gestures, and natural idle breathing & blinking.
 */
export class AvatarAnimationController {
  constructor(options = {}) {
    this.ikSolver = new TwoBoneIKSolver();
    this.blinkController = new BlinkController();
    this.scheduler = new GestureScheduler(); this.posture = new PostureController();
    this.face = new FacialExpressionController(); this.lipSync = new SpeechLipSyncController();
    this.visemeMapping = options.visemeMapping || {};
    this.gestureAge = 0; this.gestureBlend = 0; this.manualGesture = false; this.semanticTag = 'explain';
    this.fingers = []; this.wrists = {}; this.silenceAge = 0; this.hadPause = false;
    this.diagnostics = { fps: 0, updateMs: 0 }; this.showCollisions = false;

    // User interaction configuration
    this.enableHandInteraction = options.enableHandInteraction ?? true;
    this.holdPose = options.holdPose ?? false;
    this.enableSpeakingGestures = options.enableSpeakingGestures ?? true;
    this.enableIdleAnimation = options.enableIdleAnimation ?? true;

    // Callbacks for UI feedback
    this.onStatusChange = options.onStatusChange ?? (() => {});
    this.onReachLimitChange = options.onReachLimitChange ?? (() => {});

    // Active state tracking
    this.vrm = null;
    this.conversationState = 'IDLE';
    this.activeVoicePreset = options.voicePreset || 'sweet';
    this.speechPulse = 0;
    this.audioSpeechAmplitude = null;
    this.timeSpeaking = 0;
    this.activeGestureKey = null;
    this.gestureTimer = 0;

    // Rig compatibility
    this.hasHumanoid = false;
    this.bones = {};
    this.rigInfo = {
      compatible: false,
      hasArms: false,
      hasHead: false,
      hasExpressions: false,
      description: 'No rig loaded',
    };

    // Arm state: 'REST' | 'GESTURE' | 'HELD' | 'DRAGGING'
    this.leftArmState = 'REST';
    this.rightArmState = 'REST';

    // Target tracking vectors (world / model coordinates)
    this.currentTargets = {
      left: REST_POSE.leftHand.clone(),
      right: REST_POSE.rightHand.clone(),
    };
    this.desiredTargets = {
      left: REST_POSE.leftHand.clone(),
      right: REST_POSE.rightHand.clone(),
    };
    this.userPosedTargets = {
      left: null,
      right: null,
    };
    this.restTargets = { left: REST_POSE.leftHand.clone(), right: REST_POSE.rightHand.clone() };
    this.restPoles = { left: REST_POSE.leftPole.clone(), right: REST_POSE.rightPole.clone() };
    this.gestureTargets = GESTURE_TARGETS;
    this.poleVectors = {
      left: REST_POSE.leftPole.clone(),
      right: REST_POSE.rightPole.clone(),
    };

    // Mouth animation smoothing
    this.currentMouthOpen = 0;
    this.targetMouthOpen = 0;

    // Head rotation smoothing
    this.currentHeadRot = { pitch: 0, yaw: 0, roll: 0 };

    // Reusable math objects for 60 FPS zero-allocation loop
    this._vTmp1 = new THREE.Vector3();
    this._vTmp2 = new THREE.Vector3();
    this._qTmp = new THREE.Quaternion();
    this._eulerTmp = new THREE.Euler(0, 0, 0, 'YXZ');
    this.boundary = null;
    this.elapsedTime = 0;
    this.animationState = 'IDLE';
    this.eyeTarget = new THREE.Vector3(0, 1.45, 2.3);
    this.gazeCameraTarget = new THREE.Vector3(0, 1.45, 2.3);
    this.safeTargets = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    this.candidate = new THREE.Vector3();
  }

  /**
   * Bind a loaded VRM model to the controller.
   * Performs full humanoid compatibility inspection.
   */
  setVRM(vrm) {
    this.audioSpeechAmplitude = 0;
    this.lipSync.bind(null); this.scheduler.reset(); this.manualGesture = false;
    this.fingers = []; this.wrists = {}; this.gestureAge = 0;
    if (this.vrm && this.sceneRestPosition) this.vrm.scene.position.copy(this.sceneRestPosition);
    this.boundary = null; this.collision = null; this.chains = {};
    this.ikSolver = new TwoBoneIKSolver();
    this.blinkController = new BlinkController();
    this.currentMouthOpen = 0;
    this.targetMouthOpen = 0;
    this.currentHeadRot = { pitch: 0, yaw: 0, roll: 0 };
    this.speechPulse = 0;
    this.activeGestureKey = null;
    this.resetPose();
    this.vrm = vrm;
    this.supportedExpressions = new Set();
    if (!vrm || !vrm.humanoid) {
      this.hasHumanoid = false;
      this.bones = {};
      this.rigInfo = {
        compatible: false,
        hasArms: false,
        hasHead: false,
        hasExpressions: false,
        description: 'No humanoid rig detected. Procedural IK disabled.',
      };
      this.onStatusChange(this.rigInfo);
      return;
    }

    const humanoid = vrm.humanoid;
    const getBone = (name) => humanoid.getNormalizedBoneNode(name);

    this.bones = {
      hips: getBone('hips'),
      spine: getBone('spine'),
      chest: getBone('chest') || getBone('upperChest'),
      neck: getBone('neck'),
      head: getBone('head'),
      leftUpperLeg: getBone('leftUpperLeg'), leftLowerLeg: getBone('leftLowerLeg'), leftFoot: getBone('leftFoot'),
      rightUpperLeg: getBone('rightUpperLeg'), rightLowerLeg: getBone('rightLowerLeg'), rightFoot: getBone('rightFoot'),
      leftShoulder: getBone('leftShoulder'),
      leftUpperArm: getBone('leftUpperArm'),
      leftLowerArm: getBone('leftLowerArm'),
      leftHand: getBone('leftHand'),
      rightShoulder: getBone('rightShoulder'),
      rightUpperArm: getBone('rightUpperArm'),
      rightLowerArm: getBone('rightLowerArm'),
      rightHand: getBone('rightHand'),
    };

    const hasLeftArm = Boolean(this.bones.leftUpperArm && this.bones.leftLowerArm && this.bones.leftHand);
    const hasRightArm = Boolean(this.bones.rightUpperArm && this.bones.rightLowerArm && this.bones.rightHand);
    const hasHead = Boolean(this.bones.head);
    const hasExpressions = Boolean(vrm.expressionManager);
    const expressionNames = vrm.expressionManager?.expressions?.map((expression) => expression.expressionName) || [];
    this.supportedExpressions = new Set(expressionNames);
    // Mock/legacy managers without introspection retain the standard presets.
    if (!vrm.expressionManager?.expressions) this.supportedExpressions = new Set([...VISEMES, 'blink', 'happy', 'angry', 'sad', 'relaxed', 'neutral', 'surprised']);
    this.posture.bind(this.bones); this.face.bind(vrm.expressionManager);
    for (const side of ['left', 'right']) {
      const hand = this.bones[side + 'Hand']; if (hand) this.wrists[side] = hand.quaternion.clone();
      for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) for (const segment of finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal']) {
        const name = side + finger + segment, bone = getBone(name);
        if (bone) this.fingers.push({ name, side, finger, bone, rest: bone.quaternion.clone(), curl: 0 });
      }
    }
    this.spineRestPosition = this.bones.spine?.position.clone();

    this.hasHumanoid = hasLeftArm && hasRightArm;
    this.rigInfo = {
      compatible: this.hasHumanoid,
      hasArms: hasLeftArm && hasRightArm,
      hasHead,
      hasExpressions,
      expressionNames,
      boneCapabilities: Object.fromEntries(Object.entries(this.bones).map(([name, node]) => [name, Boolean(node)])),
      fingerBones: this.fingers.map(finger => finger.name),
      hasLookAt: Boolean(vrm.lookAt),
      hasBlink: expressionNames.includes('blink'),
      hasMouth: expressionNames.includes('aa'),
      description: this.hasHumanoid
        ? `Hand IK ready · ${expressionNames.includes('blink') ? 'blink' : 'no blink'} · ${expressionNames.includes('aa') ? 'speech mouth' : 'no speech mouth'}`
        : 'Incomplete Humanoid Bones. Some IK features may be disabled.',
    };

    // Calculate natural rest positions relative to shoulder positions
    vrm.scene.updateMatrixWorld(true);
    const anchors = {};
    const proportions = {};
    for (const side of ['left', 'right']) {
      const upper = this.bones[`${side}UpperArm`];
      const lower = this.bones[`${side}LowerArm`];
      const hand = this.bones[`${side}Hand`];
      if (!upper || !lower || !hand) continue;
      const anchor = upper.getWorldPosition(new THREE.Vector3());
      const scale = upper.getWorldScale(new THREE.Vector3()).x;
      const length = (lower.position.length() + hand.position.length()) * Math.abs(scale);
      const sign = side === 'left' ? 1 : -1;
      this.restTargets[side].copy(anchor).add(new THREE.Vector3(sign * 0.14, -1, 0.08).normalize().multiplyScalar(length * 0.90));
      this.restPoles[side].copy(anchor).add(new THREE.Vector3(sign * 0.15, -0.2, -0.35).multiplyScalar(length / 0.5));
      anchors[side] = anchor;
      proportions[side] = length / 0.5;
    }
    const adapt = (vector, side) => {
      if (!anchors[side]) return vector.clone();
      const baseline = new THREE.Vector3(side === 'left' ? 0.2 : -0.2, 1.4, 0);
      return vector.clone().sub(baseline).multiplyScalar(proportions[side]).add(anchors[side]);
    };
    this.gestureTargets = Object.fromEntries(Object.entries({ ...GESTURE_TARGETS, ...GESTURES }).map(([key, gesture]) => {
      const result = { ...gesture };
      for (const field of ['target', 'pole', 'leftTarget', 'leftPole', 'rightTarget', 'rightPole']) {
        if (gesture[field]) result[field] = adapt(gesture[field], field.startsWith('left') ? 'left' : field.startsWith('right') ? 'right' : gesture.arm);
      }
      return [key, result];
    }));
    this.resetPose();
    this.currentTargets.left.copy(this.desiredTargets.left);
    this.currentTargets.right.copy(this.desiredTargets.right);
    this.sceneRestPosition = vrm.scene.position.clone();
    const headTop = new THREE.Box3().setFromObject(vrm.scene).max.y;
    this.collision = new BodyCollision(this.bones, Number.isFinite(headTop) ? headTop : 1.65);
    this.rigInfo.colliderCalibrated = this.collision.calibrated;
    for (const side of ['left', 'right']) {
      const upperArm = this.bones[side + 'UpperArm'], lowerArm = this.bones[side + 'LowerArm'], hand = this.bones[side + 'Hand'], shoulder = this.bones[side + 'Shoulder'];
      if (!upperArm || !lowerArm || !hand) continue;
      this.chains[side] = { side, upperArm, lowerArm, hand, shoulder, shoulderRest: shoulder?.quaternion.clone(), safeRotations: [upperArm.quaternion.clone(), lowerArm.quaternion.clone(), shoulder?.quaternion.clone()], hasSafePose: true };
    }
    if (this.conversationState === 'SPEAKING') this.chooseSpeakingGesture();
    this.onStatusChange(this.rigInfo);
  }

  /**
   * Reset all posed arms smoothly back to resting pose.
   */
  resetPose() {
    this.activeGestureKey = null; this.manualGesture = false;
    this.posture.preview = null; this.face.preview = null;
    this.userPosedTargets.left = null;
    this.userPosedTargets.right = null;
    this.leftArmState = 'REST';
    this.rightArmState = 'REST';
    this.desiredTargets.left.copy(this.restTargets.left);
    this.desiredTargets.right.copy(this.restTargets.right);
    this.poleVectors.left.copy(this.restPoles.left);
    this.poleVectors.right.copy(this.restPoles.right);
    this.onReachLimitChange('left', false);
    this.onReachLimitChange('right', false);
  }

  /**
   * Handle user beginning to drag an arm hand.
   */
  startDrag(side, worldPos) {
    if (!this.enableHandInteraction || !this.hasHumanoid || this.boundary) return false;
    if (side === 'left') {
      this.leftArmState = 'DRAGGING';
      this.desiredTargets.left.copy(worldPos);
    } else {
      this.rightArmState = 'DRAGGING';
      this.desiredTargets.right.copy(worldPos);
    }
    return true;
  }

  /**
   * Handle user moving the dragged hand.
   */
  updateDrag(side, worldPos) {
    if (!this.enableHandInteraction || !this.hasHumanoid || this.boundary) return;
    if (side === 'left' && this.leftArmState === 'DRAGGING') {
      this.desiredTargets.left.copy(worldPos);
    } else if (side === 'right' && this.rightArmState === 'DRAGGING') {
      this.desiredTargets.right.copy(worldPos);
    }
  }

  /**
   * Handle user releasing the dragged hand.
   */
  endDrag(side) {
    if (this.boundary) return;
    if (side === 'left') {
      if (this.holdPose) {
        this.leftArmState = 'HELD';
        this.userPosedTargets.left = this.currentTargets.left.clone();
      } else {
        this.leftArmState = 'REST';
        this.userPosedTargets.left = null;
      }
    } else {
      if (this.holdPose) {
        this.rightArmState = 'HELD';
        this.userPosedTargets.right = this.currentTargets.right.clone();
      } else {
        this.rightArmState = 'REST';
        this.userPosedTargets.right = null;
      }
    }
  }

  /**
   * Notify controller of conversation state changes (IDLE, LISTENING, THINKING, SPEAKING).
   */
  setConversationState(state) {
    const prevState = this.conversationState;
    this.conversationState = state;

    if (state === 'SPEAKING' && prevState !== 'SPEAKING') {
      this.timeSpeaking = 0;
      if (!this.lipSync.playback) this.chooseSpeakingGesture();
    } else if (state !== 'SPEAKING') {
      this.activeGestureKey = null;
    }
  }

  /**
   * Trigger boundary pulse from speech synthesis boundary event.
   */
  onSpeechBoundary(event) {
    this.speechPulse = 1.0;
    if (event.name === 'sentence' && !this.lipSync.playback && this.gestureTimer > (this.avatarPersonality?.gestureInterval ?? 5)) this.chooseSpeakingGesture();
  }

  setSpeechAmplitude(value) {
    this.audioSpeechAmplitude = value === null ? null : Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    if (this.audioSpeechAmplitude !== null) this.speechPulse = this.audioSpeechAmplitude;
  }

  /**
   * Select a conversational hand gesture based on speech state.
   */
  chooseSpeakingGesture() {
    if (!this.enableSpeakingGestures || this.boundary) return;
    const key = this.scheduler.select(this.semanticTag, this.avatarPersonality?.personality);
    if (key) this.triggerGesture(key);
  }

  setSpeechPlayback(playback) {
    this.lipSync.bind(playback); this.activeGestureKey = null;
    this.silenceAge = 0; this.hadPause = false;
    this.semanticTag = analyzePhrase(playback?.text || '');
    this.scheduler.prepare(playback?.text, this.lipSync.alignment);
  }

  triggerGesture(id, manual = false) {
    if (!GESTURES[id] || this.boundary || !manual && !this.enableSpeakingGestures) return false;
    this.activeGestureKey = id; this.gestureAge = 0; this.gestureTimer = 0; this.manualGesture = manual;
    this.gestureVariation = .94 + Math.random() * .12;
    this.gestureStartPosition = this.lipSync.playback?.read().position ?? null;
    this.semanticTag = GESTURES[id].tag; return true;
  }

  updateGesture(delta) {
    const playback = this.lipSync.playback?.read();
    const active = this.conversationState === 'SPEAKING' && (!playback || playback.state === 'playing');
    if (this.boundary) { this.activeGestureKey = null; this.manualGesture = false; }
    if (this.activeGestureKey) {
      if (active || this.manualGesture) {
        if (!this.manualGesture && playback && this.gestureStartPosition !== null) this.gestureAge = Math.max(0, playback.position - this.gestureStartPosition);
        else this.gestureAge += delta;
      }
      const gesture = GESTURES[this.activeGestureKey];
      if (gesture) {
        const duration = gesture.duration * (this.gestureVariation || 1);
        this.gestureBlend = gestureWeight(gesture, this.gestureAge, duration);
        if (this.gestureAge >= duration) { this.activeGestureKey = null; this.manualGesture = false; }
      } else this.gestureBlend = 1;
    } else this.gestureBlend = 0;
    if (!active || !playback || !this.enableSpeakingGestures || this.activeGestureKey) return;
    if ((this.audioSpeechAmplitude || 0) < .04) { this.silenceAge += delta; if (this.silenceAge > .16) this.hadPause = true; } else this.silenceAge = 0;
    const blocked = ['left', 'right'].filter(side => ['DRAGGING', 'HELD'].includes(this[side + 'ArmState']));
    const key = this.scheduler.next(playback.position, this.avatarPersonality?.personality, this.avatarPersonality?.gestureInterval ?? 5, blocked, (this.audioSpeechAmplitude || 0) > .06 || this.lipSync.alignment?.phonemes?.length > 0, this.hadPause);
    if (key) { this.triggerGesture(key); this.hadPause = false; }
  }

  /**
   * Main per-frame update loop called from Three.js render loop.
   * 
   * @param {number} delta - Frame delta time in seconds
   * @param {number} elapsedTime - Total elapsed time in seconds
   */
  update(delta, elapsedTime) {
    const updateStart = performance.now();
    const frameDuration = delta;
    delta = Math.min(Math.max(delta, 0), .05); // A hidden tab cannot jump through a constrained pose.
    this.frameDelta = delta;
    this.elapsedTime = elapsedTime;
    if (this.boundary) {
      const age = this.boundary.age += delta;
      if (age >= this.boundary.profile.duration) {
        if (!this.boundarySpeechActive || age >= 16) this.boundary.returnStart ??= age;
        this.animationState = this.boundary.returnStart === undefined ? 'BOUNDARY_RESPONSE' : 'RETURN_TO_IDLE';
        if (this.boundary.returnStart !== undefined && age - this.boundary.returnStart >= .8) {
          this.boundary = null;
          this.vrm?.scene.position.copy(this.sceneRestPosition);
        }
      } else this.animationState = 'BOUNDARY_RESPONSE';
    }
    if (!this.boundary) this.animationState = this.leftArmState === 'DRAGGING' || this.rightArmState === 'DRAGGING' ? 'USER_INTERACTION' : this.activeGestureKey && this.conversationState === 'SPEAKING' ? 'GESTURING' : ['LISTENING', 'THINKING', 'SPEAKING'].includes(this.conversationState) ? this.conversationState : 'IDLE';
    if (this.speechPulse > 0) {
      this.speechPulse = Math.max(0, this.speechPulse - delta * 4.0);
    }

    this.updateGesture(delta);
    // 1. Update Speech Gestures & Arm Targets according to Priority System
    this.updateArmTargets(delta, elapsedTime);

    // 3. Update Spine Breathing (Idle layer)
    this.updateBreathing(elapsedTime);
    if (!this.boundary) this.posture.update(this.bones, delta, elapsedTime, postureFor(this.semanticTag, this.conversationState, this.avatarPersonality?.personality), this.enableIdleAnimation);
    this.vrm?.scene.updateMatrixWorld(true);
    // Solve against the current frame's skeleton, after breathing.
    if (this.hasHumanoid) this.solveArms();
    this.updateHands(delta);

    // 4. Update Head & Neck Procedural Motion
    this.updateHead(delta, elapsedTime);
    if (this.vrm?.lookAt && !this.boundary) {
      const eyeContact = Math.sin(elapsedTime * .19) > .88 && this.conversationState !== 'LISTENING';
      this._vTmp1.copy(this.gazeCameraTarget); this._vTmp1.x += eyeContact ? .22 : 0; this._vTmp1.y += Math.sin(elapsedTime * .27) * .015;
      this.eyeTarget.lerp(this._vTmp1, 1 - Math.exp(-3 * delta)); this.vrm.lookAt.lookAt(this.eyeTarget);
    }

    // 5. Update Facial Expressions (Visemes & Blinking)
    this.updateExpressions(delta, elapsedTime);

    // 6. Update VRM humanoid internals
    if (this.vrm) {
      this.vrm.update(delta);
    }
    this.diagnostics.fps += ((frameDuration > 0 ? 1 / frameDuration : 0) - this.diagnostics.fps) * .05;
    this.diagnostics.updateMs += (performance.now() - updateStart - this.diagnostics.updateMs) * .05;
  }

  /**
   * Priority-driven target determination for Left & Right arms.
   * Priority: Dragging > Held Pose > Speech Gesture > Idle Rest
   */
  updateArmTargets(delta, elapsedTime) {
    const speaking = !this.boundary && (this.manualGesture || this.conversationState === 'SPEAKING' && this.enableSpeakingGestures);
    if (speaking) { this.timeSpeaking += delta; this.gestureTimer += delta; }
    const gesture = speaking && this.activeGestureKey ? this.gestureTargets[this.activeGestureKey] : null;
    for (const side of ['left', 'right']) {
      const state = this[side + 'ArmState'];
      if (state === 'DRAGGING') continue;
      if (state === 'HELD' && this.userPosedTargets[side]) { this.desiredTargets[side].copy(this.userPosedTargets[side]); this.poleVectors[side].copy(this.restPoles[side]); continue; }
      this.desiredTargets[side].copy(this.restTargets[side]); this.poleVectors[side].copy(this.restPoles[side]);
      if (!gesture || gesture.arm !== side && gesture.arm !== 'both') continue;
      const target = gesture.arm === 'both' ? gesture[side + 'Target'] : gesture.target;
      const pole = gesture.arm === 'both' ? gesture[side + 'Pole'] : gesture.pole;
      const blend = this.gestureBlend * Math.min(1, .8 + .2 * (this.avatarPersonality?.motion ?? .7)) * (this.gestureVariation || 1);
      this.desiredTargets[side].lerp(target, Math.min(1, blend)); this.poleVectors[side].copy(pole);
      if (gesture.path === 'wave') this.desiredTargets[side].x += Math.sin(this.gestureAge * 9) * .025 * blend;
      if (gesture.path === 'sweep') this.desiredTargets[side].x += (side === 'left' ? 1 : -1) * Math.sin(this.gestureAge * 1.8) * .018 * blend;
      if (gesture.path === 'beat') this.desiredTargets[side].y += Math.sin(this.gestureAge * 4) * .018 * blend;
      if (gesture.waveAmp) this.desiredTargets[side].y += Math.sin(elapsedTime * 3.5) * gesture.waveAmp * blend;
    }
    this.collision?.update();
    for (const side of ['left', 'right']) {
      if (this.collision) this.collision.constrainTarget(side, this.desiredTargets[side], this.safeTargets[side]);
      const alpha = 1 - Math.exp(-(this[side + 'ArmState'] === 'DRAGGING' ? 16 : 9) * delta);
      this.currentTargets[side].lerp(this.collision ? this.safeTargets[side] : this.desiredTargets[side], alpha);
    }
  }

  updateHands(delta) {
    const gesture = GESTURES[this.activeGestureKey];
    for (const side of ['left', 'right']) {
      const hand = this.bones[side + 'Hand']; if (!hand || !this.wrists[side]) continue;
      if (['DRAGGING', 'HELD'].includes(this[side + 'ArmState'])) continue;
      const owned = !this.boundary && gesture && (gesture.arm === side || gesture.arm === 'both');
      const weight = owned ? this.gestureBlend : 0;
      this._eulerTmp.set(weight * (gesture?.fingers === 'open' ? -.45 : -.12), 0, weight * (gesture?.path === 'wave' ? Math.sin(this.gestureAge * 9) * .16 : .05));
      this._qTmp.setFromEuler(this._eulerTmp).premultiply(this.wrists[side]); hand.quaternion.slerp(this._qTmp, 1 - Math.exp(-10 * delta));
    }
    for (const finger of this.fingers) {
      if (['DRAGGING', 'HELD'].includes(this[finger.side + 'ArmState'])) continue;
      const owned = !this.boundary && gesture && (gesture.arm === finger.side || gesture.arm === 'both');
      let curl = .08;
      if (owned) {
        curl = gesture.fingers === 'open' ? .02 : gesture.fingers === 'soft' ? .32 : .55;
        if (gesture.fingers === 'point' && finger.finger === 'Index') curl = .02;
        if (gesture.fingers === 'count') {
          const count = Math.min(3, 1 + Math.floor(Math.max(0, this.gestureAge - .7) / .65));
          const index = ['Index', 'Middle', 'Ring'].indexOf(finger.finger); if (index >= 0 && index < count) curl = .02;
        }
        curl = .08 + (curl - .08) * this.gestureBlend;
      }
      if (finger.finger === 'Thumb') curl *= .35;
      finger.curl += (curl - finger.curl) * (1 - Math.exp(-10 * delta));
      this._eulerTmp.set(0, 0, (finger.side === 'left' ? -1 : 1) * finger.curl);
      this._qTmp.setFromEuler(this._eulerTmp); finger.bone.quaternion.copy(finger.rest).multiply(this._qTmp);
    }
  }

  /**
   * Executes 2-bone analytical IK solver on both arms.
   */
  solveArms() {
    if (!this.collision) return;
    this.collision.update();
    for (const side of ['left', 'right']) {
      const chain = this.chains[side]; if (!chain) continue;
      this.collision.constrainTarget(side, this.currentTargets[side], this.safeTargets[side]);
      let result, accepted = false;
      // Reject unsafe solved segments, then retreat toward the calibrated rest pose.
      // Never change joint translations, scales or skin weights to reach a target.
      for (let attempt = 0; attempt < 7; attempt++) {
        this.candidate.copy(this.safeTargets[side]).lerp(this.restTargets[side], attempt / 6);
        result = this.ikSolver.solve(chain, this.candidate, this.poleVectors[side]);
        if (this.collision.armPenetration(side) <= .001) { accepted = true; break; }
      }
      if (accepted) {
        const keep = Math.exp(-14 * (this.frameDelta || 1 / 60));
        chain.upperArm.quaternion.slerp(chain.safeRotations[0], keep); chain.lowerArm.quaternion.slerp(chain.safeRotations[1], keep);
        if (chain.shoulder) chain.shoulder.quaternion.slerp(chain.safeRotations[2], keep);
        chain.upperArm.updateWorldMatrix(true, true);
        if (this.collision.armPenetration(side) > .001) accepted = false;
      }
      if (accepted) {
        chain.safeRotations[0].copy(chain.upperArm.quaternion); chain.safeRotations[1].copy(chain.lowerArm.quaternion); chain.safeRotations[2]?.copy(chain.shoulder.quaternion);
        chain.hasSafePose = true;
      } else if (chain.hasSafePose) {
        chain.upperArm.quaternion.copy(chain.safeRotations[0]); chain.lowerArm.quaternion.copy(chain.safeRotations[1]);
        if (chain.shoulder) chain.shoulder.quaternion.copy(chain.safeRotations[2]);
        chain.upperArm.updateWorldMatrix(true, true);
      }
      chain.hand.getWorldPosition(this.safeTargets[side]);
      this.onReachLimitChange(side, ['DRAGGING', 'HELD'].includes(this[side + 'ArmState']) && (!result?.reached || this.safeTargets[side].distanceTo(this.currentTargets[side]) > .025 || this.safeTargets[side].distanceTo(this.desiredTargets[side]) > .06));
      this.collision.update();
    }
  }

  beginBoundary(avatarId = 'default') {
    if (!this.vrm || this.boundary) return false;
    this.resetPose(); this.activeGestureKey = null;
    this.boundary = { start: this.elapsedTime, age: 0, profile: BOUNDARY_PROFILES[avatarId] || BOUNDARY_PROFILES.default };
    this.animationState = 'BOUNDARY_RESPONSE';
    return true;
  }

  /**
   * Applies subtle chest expansion for natural breathing.
   */
  updateBreathing(elapsedTime) {
    if (!this.bones.spine) return;

    const { chestPitch } = getBreathingOffset(elapsedTime);
    this.bones.spine.rotation.x = this.enableIdleAnimation ? chestPitch : 0;
    // Breathing rotates joints; it never alters bone rest translations.
    if (this.spineRestPosition) this.bones.spine.position.copy(this.spineRestPosition);
    if (this.boundary && this.sceneRestPosition) {
      const age = this.boundary.age;
      const envelope = this.boundary.returnStart === undefined ? Math.min(1, age / .4) : Math.max(0, 1 - (age - this.boundary.returnStart) / .8);
      this.vrm.scene.position.z = this.sceneRestPosition.z - .045 * envelope;
    }
  }

  /**
   * Applies natural head nods, listening orientation, and subtle tilts.
   */
  updateHead(delta, elapsedTime) {
    if (!this.bones.head) return;

    const targetRot = getHeadRotations(this.conversationState, elapsedTime, this.speechPulse);
    const motion = this.avatarPersonality?.motion ?? 1;
    targetRot.pitch *= motion; targetRot.yaw *= motion; targetRot.roll *= motion;
    if (this.boundary) {
      const { profile, age } = this.boundary;
      const progress = Math.min(1, age / profile.duration);
      targetRot.pitch = .012; targetRot.roll = 0;
      targetRot.yaw = Math.sin(age * Math.PI * 2 * profile.frequency) * profile.amplitude * Math.sin(Math.PI * progress);
    }
    targetRot.pitch = THREE.MathUtils.clamp(targetRot.pitch, -.22, .22);
    targetRot.yaw = THREE.MathUtils.clamp(targetRot.yaw, -.3, .3);
    targetRot.roll = THREE.MathUtils.clamp(targetRot.roll, -.12, .12);
    const alpha = 1 - Math.exp(-12 * delta);

    this.currentHeadRot.pitch += (targetRot.pitch - this.currentHeadRot.pitch) * alpha;
    this.currentHeadRot.yaw += (targetRot.yaw - this.currentHeadRot.yaw) * alpha;
    this.currentHeadRot.roll += (targetRot.roll - this.currentHeadRot.roll) * alpha;

    this._eulerTmp.set(this.currentHeadRot.pitch, this.currentHeadRot.yaw, this.currentHeadRot.roll, 'YXZ');
    this.bones.head.quaternion.setFromEuler(this._eulerTmp);

    if (this.bones.neck) {
      // Subtly distribute rotation across neck (30%)
      this._eulerTmp.set(this.currentHeadRot.pitch * 0.3, this.currentHeadRot.yaw * 0.3, this.currentHeadRot.roll * 0.3, 'YXZ');
      this.bones.neck.quaternion.setFromEuler(this._eulerTmp);
    }
  }

  /**
   * Updates VRM facial expression system: speech visemes, blinking, and subtle emotions.
   */
  updateExpressions(delta) {
    const em = this.vrm?.expressionManager; if (!em) return;
    const set = (name, value) => { if (this.supportedExpressions.has(name)) em.setValue(name, value); };
    const speaking = this.conversationState === 'SPEAKING';
    const weights = this.lipSync.update(delta, this.audioSpeechAmplitude || 0, speaking, this.supportedExpressions, this.visemeMapping);
    this.currentMouthOpen = weights.aa;
    for (const name in weights) set(name, weights[name]);
    const blink = this.enableIdleAnimation ? this.blinkController.update(delta) : 0;
    if (this.supportedExpressions.has('blink')) { set('blink', blink); set('blinkLeft', 0); set('blinkRight', 0); }
    else { set('blinkLeft', blink); set('blinkRight', blink); }
    // A paused/buffering audio session still owns mouth morphs, even though
    // conversation state has returned to idle and all viseme weights are zero.
    this.face.update(em, this.supportedExpressions, delta, faceFor(this.semanticTag, this.conversationState), speaking || Boolean(this.lipSync.playback), .65 + (this.avatarPersonality?.smile ?? .18), this.boundary?.profile.expression || 0);
  }
}
