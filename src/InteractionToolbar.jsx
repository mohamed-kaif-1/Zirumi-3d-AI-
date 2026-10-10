import Icon from './Icon.jsx';

export default function InteractionToolbar({ enableHandInteraction, onToggleHandInteraction, holdPose, onToggleHoldPose, onResetPose, enableSpeakingGestures, onToggleSpeakingGestures, enableIdleAnimation, onToggleIdleAnimation, cameraView = 'upper', onToggleCameraView, isFullscreen = false, onToggleFullscreen, rigInfo, reachLimit }) {
  const controls = [
    { name: 'Hand interaction', icon: 'hand', active: enableHandInteraction, action: onToggleHandInteraction, title: enableHandInteraction ? 'Hand IK: Enabled' : 'Hand IK: Disabled', disabled: !rigInfo.compatible },
    { name: 'Hold pose', icon: 'lock', active: holdPose, action: onToggleHoldPose, title: holdPose ? 'Hold Pose: Enabled' : 'Hold Pose: Disabled', disabled: !enableHandInteraction || !rigInfo.compatible },
    { name: 'Reset Pose', icon: 'reset', action: onResetPose, title: 'Reset arm pose to neutral', disabled: !rigInfo.compatible },
    { name: 'Speaking gestures', icon: 'movement', active: enableSpeakingGestures, action: onToggleSpeakingGestures, title: enableSpeakingGestures ? 'Speaking gestures on' : 'Speaking gestures off' },
    { name: 'Idle motion', icon: 'moon', active: enableIdleAnimation, action: onToggleIdleAnimation, title: enableIdleAnimation ? 'Idle breathing & blinking on' : 'Idle animation off' },
    { name: 'Toggle camera framing', icon: 'camera', active: cameraView === 'full', action: onToggleCameraView, title: 'Toggle camera framing' },
    { name: 'Toggle Fullscreen', icon: 'expand', active: isFullscreen, action: onToggleFullscreen, title: 'Toggle Fullscreen' },
  ];
  return <div className="avatar-toolbar" role="toolbar" aria-label="Avatar interaction controls">
    <div className="toolbar-controls">{controls.map(control => <button key={control.name} type="button" className={`toolbar-btn ${control.active ? 'active' : ''}`} onClick={control.action} aria-label={control.name} aria-pressed={control.active} title={control.title} disabled={control.disabled}><Icon name={control.icon} size={18} /></button>)}</div>
    {(reachLimit.left || reachLimit.right) && <span className="reach-limit-pill" role="status">Reach Limit</span>}
  </div>;
}
