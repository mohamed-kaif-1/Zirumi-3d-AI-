import { AVATAR_REGISTRY } from './avatarRegistry.js';
import { getCharacterPersonality } from './characterPersonalities.js';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';

export default function AvatarSelector({ isOpen, onClose, currentAvatarId, onSelectAvatar, loadingAvatarId = null, voiceProfiles = {}, onPreviewVoice, onChangeVoice, previewAvatarId, previewDisabled = false }) {
  if (!isOpen) return null;
  return <Dialog title="Find your companion." eyebrow="CHARACTERS" onClose={onClose} className="characters-dialog">
    <div className="avatar-grid">
      {AVATAR_REGISTRY.map((avatar, index) => {
        const selected = avatar.id === currentAvatarId;
        const loading = avatar.id === loadingAvatarId;
        const voice = voiceProfiles[avatar.id];
        const character = getCharacterPersonality(avatar.id);
        return <article key={avatar.id} className={`avatar-card ${selected ? 'selected' : ''} ${loading ? 'loading' : ''}`} style={{ '--accent': character.accent, '--accent-rgb': character.accentRgb }}>
          <button type="button" className="avatar-select-surface" aria-label={`Select ${avatar.name} avatar`} aria-pressed={selected} aria-busy={loading} disabled={loading} onClick={() => { if (!selected || loadingAvatarId) onSelectAvatar(avatar.id); }}>
            <div className="avatar-thumb-wrapper">
              <span className="character-number">0{index + 1}</span>
              <img src={avatar.thumbnailUrl} alt={`${avatar.name}, rendered from her 3D model`} className="avatar-thumb" />
              {loading && <div className="avatar-card-loading-overlay"><span className="spinner" /><span>Connecting…</span></div>}
              {selected && !loading && <span className="avatar-selected-badge"><Icon name="check" size={13} /> Selected</span>}
            </div>
            <div className="avatar-card-info"><h3>{avatar.name}</h3><p>{character.description}</p></div>
          </button>
          <div className="avatar-voice-controls">
            <div className="avatar-base-voice">{voice?.voiceName || 'Checking voice…'}</div>
            <span className="avatar-provider-status" role="status">{['elevenlabs', 'cartesia'].includes(voice?.provider) ? voice.metadata?.playbackError ? 'Preview failed' : voice.metadata?.synthesisError ? 'Voice unavailable' : voice.metadata?.synthesisVerified && !voice.metadata?.error ? 'Voice ready' : voice.metadata?.metadataRestricted ? 'Preview to check voice' : voice.metadata?.error ? 'Voice unavailable' : voice.metadata?.available ? 'Voice verified' : 'Checking voice…' : 'Browser voice'}</span>
            <div className="avatar-voice-buttons">
              <button type="button" aria-label={`Play ${avatar.name} voice sample`} aria-pressed={previewAvatarId === avatar.id} onClick={() => onPreviewVoice(avatar.id)} disabled={loading || previewDisabled}><Icon name={previewAvatarId === avatar.id ? 'stop' : 'volume'} size={15} /><span>{previewAvatarId === avatar.id ? 'Stop' : 'Preview'}</span></button>
              <button className="icon-button" type="button" aria-label={`Change ${avatar.name} voice`} title="Voice settings" onClick={() => onChangeVoice(avatar.id)} disabled={loading}><Icon name="settings" size={16} /></button>
            </div>
          </div>
        </article>;
      })}
    </div>
    <footer className="selector-footer"><span>One conversation. Four ways to connect.</span><a href="/models/ATTRIBUTION.md" target="_blank" rel="noreferrer">Character credits <Icon name="arrow" size={13} /></a></footer>
  </Dialog>;
}
