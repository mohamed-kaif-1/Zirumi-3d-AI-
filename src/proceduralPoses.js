import * as THREE from 'three';

/**
 * Procedural pose definitions, breathing curves, blinking scheduler,
 * and speech gesture targets for human-like humanoid animation.
 */

export const REST_POSE = {
  leftHand: new THREE.Vector3(0.24, 0.88, -0.02),
  rightHand: new THREE.Vector3(-0.24, 0.88, -0.02),
  leftPole: new THREE.Vector3(0.25, 1.05, -0.35),
  rightPole: new THREE.Vector3(-0.25, 1.05, -0.35),
};

export const GESTURE_TARGETS = {
  // Friendly greeting wave (Right arm)
  GREETING: {
    arm: 'right',
    target: new THREE.Vector3(-0.25, 1.30, 0.28),
    pole: new THREE.Vector3(-0.35, 1.15, -0.15),
    waveAmp: 0.15,
    duration: 2.8,
  },
  // Explaining with right hand forward
  EXPLAIN_RIGHT: {
    arm: 'right',
    target: new THREE.Vector3(-0.20, 1.12, 0.32),
    pole: new THREE.Vector3(-0.28, 1.05, -0.20),
    waveAmp: 0.04,
    duration: 3.2,
  },
  // Explaining with left hand forward
  EXPLAIN_LEFT: {
    arm: 'left',
    target: new THREE.Vector3(0.20, 1.12, 0.32),
    pole: new THREE.Vector3(0.28, 1.05, -0.20),
    waveAmp: 0.04,
    duration: 3.2,
  },
  // Explaining with both hands open
  EXPLAIN_BOTH: {
    arm: 'both',
    leftTarget: new THREE.Vector3(0.22, 1.10, 0.30),
    leftPole: new THREE.Vector3(0.30, 1.02, -0.20),
    rightTarget: new THREE.Vector3(-0.22, 1.10, 0.30),
    rightPole: new THREE.Vector3(-0.30, 1.02, -0.20),
    waveAmp: 0.03,
    duration: 3.6,
  },
};

/**
 * Natural breathing procedural calculation.
 * Period ~ 3.8s (approx 16 breaths per minute).
 */
export function getBreathingOffset(time) {
  const breathFreq = (2 * Math.PI) / 3.8;
  const phase = (time * breathFreq) % (2 * Math.PI);
  // Asymmetric breath: slightly faster inhale, slower exhale
  const val = Math.sin(phase - 0.3 * Math.sin(phase));
  return {
    chestPitch: val * 0.012, // subtle chest forward/backward rotation in radians
    chestY: val * 0.003,     // subtle vertical chest lift (3mm)
  };
}

/**
 * Irregular, natural human blinking scheduler.
 */
export class BlinkController {
  constructor() {
    this.blinkTimeRemaining = 0;
    this.blinkDuration = 0.16;
    this.timeUntilNextBlink = 3.0;
    this.currentWeight = 0;
  }

  update(delta) {
    if (this.blinkTimeRemaining > 0) {
      this.blinkTimeRemaining -= delta;
      const progress = 1 - Math.max(0, this.blinkTimeRemaining / this.blinkDuration);
      // Quick close (0 -> 0.4), slower open (0.4 -> 1.0)
      if (progress < 0.4) {
        this.currentWeight = progress / 0.4;
      } else {
        this.currentWeight = 1 - (progress - 0.4) / 0.6;
      }
      this.currentWeight = Math.max(0, Math.min(1, this.currentWeight));
    } else {
      this.currentWeight = 0;
      this.timeUntilNextBlink -= delta;
      if (this.timeUntilNextBlink <= 0) {
        this.blinkTimeRemaining = this.blinkDuration;
        // Natural irregular interval: 2.5 to 5.5 seconds between blinks
        this.timeUntilNextBlink = 2.5 + Math.random() * 3.0;
      }
    }
    return this.currentWeight;
  }
}

/**
 * Head micro-movement and conversational nod generator.
 */
export function getHeadRotations(conversationState, time, speechPulse = 0) {
  let pitch = 0;
  let yaw = 0;
  let roll = 0;

  if (conversationState === 'SPEAKING') {
    // Conversational rhythm: primary rhythmic nod + boundary pulse accent
    const baseNod = Math.sin(time * 4.2) * 0.032 + Math.sin(time * 2.1) * 0.018;
    pitch = baseNod + speechPulse * 0.04;
    yaw = Math.sin(time * 1.5) * 0.038;
    roll = Math.sin(time * 2.7) * 0.022;
  } else if (conversationState === 'THINKING') {
    // Subtle head tilt while considering response
    pitch = -0.035;
    yaw = 0.065;
    roll = 0.045;
  } else if (conversationState === 'LISTENING') {
    // Attentive forward orientation with gentle micro-sway
    pitch = 0.02;
    yaw = Math.sin(time * 0.8) * 0.015;
    roll = Math.sin(time * 1.2) * 0.01;
  } else {
    // Subtle alive micro-motion during idle
    pitch = Math.sin(time * 0.5) * 0.008;
    yaw = Math.sin(time * 0.3) * 0.012;
    roll = Math.sin(time * 0.4) * 0.008;
  }

  return { pitch, yaw, roll };
}
