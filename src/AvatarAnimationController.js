import * as THREE from 'three';
import { TwoBoneIKSolver } from './twoBoneIKSolver.js';
import { BodyCollision } from './bodyCollision.js';
import { BOUNDARY_PROFILES } from './boundaryBehavior.js';
import { REST_POSE, GESTURE_TARGETS, getBreathingOffset, BlinkController, getHeadRotations } from './proceduralPoses.js';

/**
 * Unified Avatar Animation Controller.
 * Manages skeletal Inverse Kinematics, priority blending, speech visemes,
 * conversational gestures, and natural idle breathing & blinking.
 */
export class AvatarAnimationController {
  constructor(options = {}) {
    this.ikSolver = new TwoBoneIKSolver();
    this.blinkController = new BlinkController();

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
    this.safeTargets = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    this.candidate = new THREE.Vector3();
  }

  /**
   * Bind a loaded VRM model to the controller.
   * Performs full humanoid compatibility inspection.
   */
  setVRM(vrm) {
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
    this.spineRestPosition = this.bones.spine?.position.clone();

    this.hasHumanoid = hasLeftArm && hasRightArm;
    this.rigInfo = {
      compatible: this.hasHumanoid,
      hasArms: hasLeftArm && hasRightArm,
      hasHead,
      hasExpressions,
      expressionNames,
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
    this.gestureTargets = Object.fromEntries(Object.entries(GESTURE_TARGETS).map(([key, gesture]) => {
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
      this.chooseSpeakingGesture();
    } else if (state !== 'SPEAKING') {
      this.activeGestureKey = null;
    }
  }

  /**
   * Trigger boundary pulse from speech synthesis boundary event.
   */
  onSpeechBoundary(event) {
    this.speechPulse = 1.0;
    // Occasionally cycle or emphasize gestures on sentence/word pauses
    if (event.name === 'sentence' || (event.name === 'word' && Math.random() < 0.2)) {
      if (this.conversationState === 'SPEAKING' && this.gestureTimer > (this.avatarPersonality?.gestureInterval ?? 4)) {
        this.chooseSpeakingGesture();
      }
    }
  }

  setSpeechAmplitude(value) {
    this.audioSpeechAmplitude = value === null ? null : Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    if (this.audioSpeechAmplitude !== null) this.speechPulse = this.audioSpeechAmplitude;
    if (this.conversationState === 'SPEAKING' && this.gestureTimer > (this.avatarPersonality?.gestureInterval ?? 4) && this.audioSpeechAmplitude > 0.12) this.chooseSpeakingGesture();
  }

  /**
   * Select a conversational hand gesture based on speech state.
   */
  chooseSpeakingGesture() {
    if (!this.enableSpeakingGestures) {
      this.activeGestureKey = null;
      return;
    }

    // Weight towards friendly explain gestures
    if (this.avatarPersonality?.personality === 'composed') {
      this.activeGestureKey = 'EXPLAIN_RIGHT';
      this.gestureTimer = 0;
      return;
    }
    const rand = Math.random();
    if (this.timeSpeaking < 1.0 && rand < 0.35) {
      this.activeGestureKey = 'GREETING';
    } else if (rand < 0.6) {
      this.activeGestureKey = 'EXPLAIN_RIGHT';
    } else if (rand < 0.85) {
      this.activeGestureKey = 'EXPLAIN_LEFT';
    } else {
      this.activeGestureKey = 'EXPLAIN_BOTH';
    }
    this.gestureTimer = 0;
  }

  /**
   * Main per-frame update loop called from Three.js render loop.
   * 
   * @param {number} delta - Frame delta time in seconds
   * @param {number} elapsedTime - Total elapsed time in seconds
   */
  update(delta, elapsedTime) {
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

    // 1. Update Speech Gestures & Arm Targets according to Priority System
    this.updateArmTargets(delta, elapsedTime);

    // 3. Update Spine Breathing (Idle layer)
    this.updateBreathing(elapsedTime);
    this.vrm?.scene.updateMatrixWorld(true);
    // Solve against the current frame's skeleton, after breathing.
    if (this.hasHumanoid) this.solveArms();

    // 4. Update Head & Neck Procedural Motion
    this.updateHead(delta, elapsedTime);
    if (this.vrm?.lookAt && !this.boundary) this.vrm.lookAt.lookAt(this.eyeTarget);

    // 5. Update Facial Expressions (Visemes & Blinking)
    this.updateExpressions(delta, elapsedTime);

    // 6. Update VRM humanoid internals
    if (this.vrm) {
      this.vrm.update(delta);
    }
  }

  /**
   * Priority-driven target determination for Left & Right arms.
   * Priority: Dragging > Held Pose > Speech Gesture > Idle Rest
   */
  updateArmTargets(delta, elapsedTime) {
    const isSpeaking = !this.boundary && this.conversationState === 'SPEAKING' && this.enableSpeakingGestures;
    if (isSpeaking) {
      this.timeSpeaking += delta;
      this.gestureTimer += delta;
    }

    const gesture = isSpeaking && this.activeGestureKey ? this.gestureTargets[this.activeGestureKey] : null;

    // LEFT ARM
    if (this.leftArmState === 'DRAGGING') {
      // Priority 1: User dragging actively sets desiredTargets.left
    } else if (this.leftArmState === 'HELD' && this.userPosedTargets.left) {
      // Priority 2: User held pose
      this.desiredTargets.left.copy(this.userPosedTargets.left);
      this.poleVectors.left.copy(this.restPoles.left);
    } else if (gesture && (gesture.arm === 'left' || gesture.arm === 'both')) {
      // Priority 3: Speech gesture
      const target = gesture.arm === 'both' ? gesture.leftTarget : gesture.target;
      const pole = gesture.arm === 'both' ? gesture.leftPole : gesture.pole;
      const wave = Math.sin(elapsedTime * 3.5) * gesture.waveAmp * (this.avatarPersonality?.motion || 1);
      this.desiredTargets.left.copy(this.restTargets.left).lerp(target, this.avatarPersonality?.motion || 1);
      this.desiredTargets.left.y += wave;
      this.poleVectors.left.copy(pole);
    } else {
      // Priority 4: Natural resting pose
      this.desiredTargets.left.copy(this.restTargets.left);
      this.poleVectors.left.copy(this.restPoles.left);
    }

    // RIGHT ARM
    if (this.rightArmState === 'DRAGGING') {
      // Priority 1: User dragging actively sets desiredTargets.right
    } else if (this.rightArmState === 'HELD' && this.userPosedTargets.right) {
      // Priority 2: User held pose
      this.desiredTargets.right.copy(this.userPosedTargets.right);
      this.poleVectors.right.copy(this.restPoles.right);
    } else if (gesture && (gesture.arm === 'right' || gesture.arm === 'both')) {
      // Priority 3: Speech gesture
      const target = gesture.arm === 'both' ? gesture.rightTarget : gesture.target;
      const pole = gesture.arm === 'both' ? gesture.rightPole : gesture.pole;
      const wave = Math.sin(elapsedTime * 3.5) * gesture.waveAmp * (this.avatarPersonality?.motion || 1);
      this.desiredTargets.right.copy(this.restTargets.right).lerp(target, this.avatarPersonality?.motion || 1);
      this.desiredTargets.right.y += wave;
      this.poleVectors.right.copy(pole);
    } else {
      // Priority 4: Natural resting pose
      this.desiredTargets.right.copy(this.restTargets.right);
      this.poleVectors.right.copy(this.restPoles.right);
    }

    // Smooth exponential damping toward desired targets (prevents rubber/jelly snapping)
    this.collision?.update();
    for (const side of ['left', 'right']) if (this.collision) this.collision.constrainTarget(side, this.desiredTargets[side], this.safeTargets[side]);
    const dampingRate = this.leftArmState === 'DRAGGING' ? 16 : 7;
    const alphaLeft = 1 - Math.exp(-dampingRate * delta);
    this.currentTargets.left.lerp(this.collision ? this.safeTargets.left : this.desiredTargets.left, alphaLeft);

    const dampingRateRight = this.rightArmState === 'DRAGGING' ? 16 : 7;
    const alphaRight = 1 - Math.exp(-dampingRateRight * delta);
    this.currentTargets.right.lerp(this.collision ? this.safeTargets.right : this.desiredTargets.right, alphaRight);
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
      this.onReachLimitChange(side, !result?.reached || this.safeTargets[side].distanceTo(this.currentTargets[side]) > .025 || this[side + 'ArmState'] === 'DRAGGING' && this.safeTargets[side].distanceTo(this.desiredTargets[side]) > .06);
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
  updateExpressions(delta, elapsedTime) {
    const em = this.vrm?.expressionManager;
    if (!em) return;
    const setExpression = (name, value) => {
      if (!em.expressions || this.supportedExpressions.has(name)) em.setValue(name, value);
    };

    // 1. Blinking
    const blinkWeight = this.enableIdleAnimation ? this.blinkController.update(delta) : 0;
    setExpression('blink', blinkWeight);

    // 2. Speech Visemes (Smooth cadence & boundary pulse)
    if (this.conversationState === 'SPEAKING') {
      // Natural syllable cadence: multi-harmonic oscillation modulated by boundary pulse
      if (this.audioSpeechAmplitude !== null) {
        this.targetMouthOpen = this.audioSpeechAmplitude;
      } else {
        const cadence = Math.abs(Math.sin(elapsedTime * 9.0)) * 0.5 + Math.abs(Math.sin(elapsedTime * 4.5)) * 0.3;
        this.targetMouthOpen = 0.15 + (cadence + this.speechPulse * 0.35) * 0.65;
      }
      this.targetMouthOpen = Math.min(1.0, this.targetMouthOpen);
    } else {
      this.targetMouthOpen = 0;
    }

    // Smooth mouth open/close interpolation (prevents instant snapping)
    const mouthAlpha = 1 - Math.exp(-22 * delta);
    this.currentMouthOpen += (this.targetMouthOpen - this.currentMouthOpen) * mouthAlpha;
    setExpression('aa', this.currentMouthOpen);

    // Subtle complementary mouth shapes and tone-linked facial expression
    const preset = this.activeVoicePreset;
    let happyLevel = this.avatarPersonality?.smile ?? 0.18;
    let relaxedLevel = 0.05;

    if (preset === 'playful') {
      happyLevel = 0.32;
    } else if (preset === 'excited') {
      happyLevel = 0.40;
    } else if (preset === 'calm') {
      happyLevel = 0.10;
      relaxedLevel = 0.20;
    } else if (preset === 'gentle') {
      happyLevel = 0.14;
      relaxedLevel = 0.12;
    } else if (preset === 'best_friend') {
      happyLevel = 0.24;
    }

    if (this.conversationState === 'SPEAKING') {
      setExpression('oh', this.currentMouthOpen * 0.25);
      setExpression('ih', this.currentMouthOpen * 0.15);
      setExpression('happy', happyLevel);
      setExpression('neutral', 0);
      setExpression('relaxed', relaxedLevel);
    } else if (this.conversationState === 'THINKING') {
      setExpression('oh', 0);
      setExpression('ih', 0);
      setExpression('happy', 0);
      setExpression('neutral', 0.25);
      setExpression('relaxed', 0.1);
    } else {
      setExpression('oh', 0);
      setExpression('ih', 0);
      setExpression('happy', Math.min(happyLevel * 0.5, 0.15));
      setExpression('neutral', relaxedLevel);
      setExpression('relaxed', relaxedLevel);
    }
    const firm = this.boundary ? this.boundary.profile.expression : 0;
    if (this.boundary) { setExpression('happy', 0); setExpression('relaxed', 0); }
    setExpression('angry', firm);

    // vrm.update() applies expressions once per frame.
  }
}
