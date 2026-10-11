import React, { useEffect, useState } from 'react';
import { GESTURES } from './animation/GestureLibrary.js';
import { POSTURES } from './animation/PostureController.js';
import { FACE_EXPRESSIONS } from './animation/FacialExpressionController.js';
export default function AnimationDebugPanel({ controller, avatarId, onTestSpeech }) {
  const [data, setData] = useState({});
  useEffect(() => {
    const tick = () => {
      const playback = controller.lipSync.playback, clock = playback?.read();
      setData({ avatar: avatarId, posture: controller.posture.id, gesture: controller.activeGestureKey || 'none', priority: controller.boundary ? 100 : controller.activeGestureKey ? 20 : 0, blend: controller.gestureBlend.toFixed(2), face: controller.face.id, audio: clock?.state || 'stopped', seconds: (clock?.position || 0).toFixed(3), phoneme: controller.lipSync.phoneme || 'unavailable', viseme: controller.lipSync.viseme, weights: Object.fromEntries(Object.entries(controller.lipSync.weights).map(([name, weight]) => [name, +weight.toFixed(3)])), provider: playback?.provider || 'none', language: playback?.language || 'none', alignment: controller.lipSync.mode, offsetMs: Math.round(controller.lipSync.offset * 1000), IK: { left: controller.leftArmState, right: controller.rightArmState }, fps: Math.round(controller.diagnostics.fps), updateMs: +controller.diagnostics.updateMs.toFixed(2), fingers: controller.fingers.length, expressions: controller.rigInfo.expressionNames });
    }; tick(); const timer = setInterval(tick, 250); return () => clearInterval(timer);
  }, [controller, avatarId]);
  return <details className="animation-debug" open><summary>Animation diagnostics · development</summary>
    <pre aria-label="Animation metrics">{JSON.stringify(data, null, 2)}</pre>
    <label>Gesture<select aria-label="Preview gesture" defaultValue="" onChange={event => controller.triggerGesture(event.target.value, true)}><option value="" disabled>Select gesture</option>{Object.values(GESTURES).map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
    <label>Posture<select aria-label="Preview posture" defaultValue="" onChange={event => { controller.posture.preview = event.target.value; }}><option value="">Automatic</option>{Object.keys(POSTURES).map(id => <option key={id}>{id}</option>)}</select></label>
    <label>Expression<select aria-label="Preview expression" defaultValue="" onChange={event => { controller.face.preview = event.target.value; }}><option value="">Automatic</option>{Object.keys(FACE_EXPRESSIONS).map(id => <option key={id}>{id}</option>)}</select></label>
    <label>Timing offset (ms)<input aria-label="Lip-sync timing offset" type="number" min="-250" max="250" step="10" defaultValue="0" onChange={event => { controller.lipSync.offset = Math.max(-.25, Math.min(.25, Number(event.target.value) / 1000 || 0)); }} /></label>
    <label><input type="checkbox" onChange={event => { controller.showCollisions = event.target.checked; }} />Collision proxies</label>
    <button type="button" onClick={onTestSpeech}>Play lip-sync test sentence</button>
    <button type="button" onClick={() => controller.lipSync.playback?.pause()}>Pause test speech</button><button type="button" onClick={() => controller.lipSync.playback?.resume()?.catch(() => {})}>Resume test speech</button>
    <button type="button" onClick={() => controller.resetPose()}>Reset to neutral</button>
  </details>;
}
