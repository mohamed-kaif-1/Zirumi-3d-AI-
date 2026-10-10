import { useCallback } from 'react';
import { VOICE_PRESETS, getPresetById } from './voicePresets.js';
import { VOICE_LIMITS } from './avatarVoiceProfiles.js';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';

export default function VoiceSelector({ selectedPresetId, onSelectPreset, voices = [], selectedVoiceId, selectedVoiceKey, onSelectVoice, isPlayingSample, onPreviewSample, enabled, onToggleEnabled, supported, isOpen = false, onOpenChange, avatarName = 'Aira', profile, pitch = 1, rate = 1, volume = 1, onPitchChange, onRateChange, onVolumeChange, onResetVoice, previewDisabled = false }) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const provider = ['elevenlabs', 'cartesia', 'sarvam'].includes(profile?.provider);
  const providerName = profile?.provider === 'sarvam' ? 'Sarvam' : profile?.provider === 'cartesia' ? 'Cartesia' : 'ElevenLabs';
  const currentPreset = getPresetById(selectedPresetId);
  return <div className="voice-selector-widget">
    <div className="voice-selector-bar">
      <button type="button" className="voice-state-button" onClick={() => onToggleEnabled(!enabled)} aria-label={enabled ? 'Disable voice replies' : 'Enable voice replies'} aria-pressed={enabled} disabled={!supported}><Icon name={enabled ? 'volume' : 'mute'} size={15} /><span>Voice {enabled ? 'on' : 'off'}</span></button>
      <div className="voice-bar-actions"><button type="button" className={`voice-preview-btn ${isPlayingSample ? 'playing' : ''}`} onClick={onPreviewSample} disabled={!supported || previewDisabled} aria-label={`Preview ${avatarName} voice`}><Icon name={isPlayingSample ? 'stop' : 'play'} size={13} /><span>{isPlayingSample ? 'Stop' : 'Preview'}</span></button><button type="button" className="voice-preset-trigger" onClick={() => onOpenChange(true)} aria-label="Voice settings" aria-expanded={isOpen} title="Voice settings"><Icon name="settings" size={15} /><span>Voice settings</span><span className="vp-name sr-only">{currentPreset.name}</span></button></div>
    </div>
    {isOpen && <Dialog title={`${avatarName}’s voice`} eyebrow="MAKE IT YOURS" onClose={close} className="voice-dialog" style={{ '--accent': profile?.profile?.accent, '--accent-rgb': profile?.profile?.accentRgb }}>
      <div className="voice-dialog-content">
        <div className="assigned-voice"><span className="assigned-voice-icon"><Icon name="volume" size={22} /></span><div><small>{provider ? `Assigned ${providerName} voice` : 'Browser voice'}</small><strong>{profile?.voiceName || 'Browser default'}</strong></div></div>
        {provider && profile.metadata?.error && <p className="voice-fallback-notice" role="status">This character’s voice is unavailable. Try again after checking voice access.</p>}
        {!provider && <p className="voice-fallback-notice" role="status">Browser speech is active for this character.</p>}
        <div className="settings-section-label">Tone</div>
        <div className="presets-grid">{VOICE_PRESETS.map(preset => <button key={preset.id} type="button" className={`preset-card ${preset.id === selectedPresetId ? 'active' : ''}`} aria-pressed={preset.id === selectedPresetId} onClick={() => onSelectPreset(preset.id)}><span className="pc-top"><span>{preset.name}</span>{preset.id === selectedPresetId && <Icon name="check" size={14} />}</span><small>{preset.tagline}</small></button>)}</div>
        {voices.length > 0 && profile?.provider !== 'sarvam' && <div className="vsp-base-voice"><label htmlFor="base-voice-select">{provider ? 'Browser fallback:' : 'Base Voice:'}</label><select id="base-voice-select" value={profile?.automatic ? '' : selectedVoiceKey || selectedVoiceId || ''} onChange={event => onSelectVoice(event.target.value)}><option value="">Automatic — {profile?.browserVoiceName || 'Browser default'}</option>{voices.map(v => <option key={v.key || v.id} value={v.key || v.id}>{v.name} ({v.lang})</option>)}</select></div>}
        <div className="voice-adjustments">{[
          ...(provider ? [] : [['Pitch', pitch, VOICE_LIMITS.pitch, onPitchChange]]),
          ['Speaking rate', Math.min(provider ? 1.2 : 1.25, rate), [0.75, provider ? 1.2 : 1.25], onRateChange],
          ['Volume', volume, VOICE_LIMITS.volume, onVolumeChange],
        ].map(([label, value, bounds, onChange]) => <label key={label} className="voice-range"><span>{label}<output>{label === 'Volume' ? `${Math.round(value * 100)}%` : `${value.toFixed(2)}×`}</output></span><input type="range" aria-label={`${avatarName} ${label.toLowerCase()}`} min={bounds[0]} max={bounds[1]} step="0.01" value={value} onChange={event => onChange(Number(event.target.value))} disabled={!supported} /></label>)}</div>
        <div className="voice-settings-actions"><button type="button" className="primary-button voice-preview-btn" onClick={onPreviewSample} disabled={!supported || previewDisabled}><Icon name={isPlayingSample ? 'stop' : 'play'} size={14} />{isPlayingSample ? 'Stop Preview' : 'Preview Voice'}</button><button type="button" className="text-button" onClick={onResetVoice}>Reset to Default Voice</button></div>
        <p className="voice-engine-note">{profile?.provider === 'sarvam' ? 'Sarvam voices vary by language. Tamil uses Bulbul v3 feminine voices; Hindi and Indian English use v4 Flash. Errors do not switch to English.' : provider ? 'The assigned voice stays with this character. Browser selection changes fallback only.' : 'Voice quality depends on your browser and installed voices.'}</p>
      </div>
    </Dialog>}
  </div>;
}
