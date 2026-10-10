import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import InteractionToolbar from './InteractionToolbar.jsx';
import WaveformVisualizer from './WaveformVisualizer.jsx';
import VoiceSelector from './VoiceSelector.jsx';
import AvatarSelector from './AvatarSelector.jsx';
import { getAvatarVoiceProfile } from './avatarVoiceProfiles.js';
import { AVATAR_REGISTRY, DEFAULT_AVATAR_ID, getAvatarById } from './avatarRegistry.js';
import useConversation from './useConversation.js';
import ConversationPanel from './ConversationPanel.jsx';
import Dialog from './Dialog.jsx';
import { LANGUAGES } from './languages.js';
import { boundaryPhrase } from './boundaryBehavior.js';
import Icon from './Icon.jsx';
import useReducedMotion from './useReducedMotion.js';
import defaultAvatarUrl from '../AvatarSample_W.vrm?url';

export default function App() {
  const [selectedAvatarId, setSelectedAvatarId] = useState(() => {
    try {
      const saved = localStorage.getItem('echo_selected_avatar');
      if (saved && AVATAR_REGISTRY.some((a) => a.id === saved)) {
        return saved;
      }
    } catch {
      // ignore
    }
    return DEFAULT_AVATAR_ID;
  });

  const currentAvatar = selectedAvatarId === 'custom' ? { id: 'custom', name: 'Custom Avatar' } : getAvatarById(selectedAvatarId);
  const [modelUrl, setModelUrl] = useState(() => currentAvatar.id === DEFAULT_AVATAR_ID ? defaultAvatarUrl : currentAvatar.modelUrl);
  const requestedAvatarRef = useRef(selectedAvatarId);
  const requestedModelRef = useRef(modelUrl);
  const [modelRevision, setModelRevision] = useState(0);
  const [isAvatarSelectorOpen, setIsAvatarSelectorOpen] = useState(false);
  const closeAvatarSelector = useCallback(() => { pendingPreviewRef.current = null; echoRef.current.stopSpeaking(); setIsAvatarSelectorOpen(false); }, []);
  const [avatarLoadingId, setAvatarLoadingId] = useState(null);
  const [modelStatus, setModelStatus] = useState('Loading avatar...');
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const avatarRef = useRef(null);
  const pendingPreviewRef = useRef(null);
  const pendingVoiceEditorRef = useRef(null);
  const [voiceEditorOpen, setVoiceEditorOpen] = useState(false);

  // Avatar Interaction & IK states
  const [enableHandInteraction, setEnableHandInteraction] = useState(true);
  const [interactionMode, setInteractionMode] = useState(false);
  const [boundaryNotice, setBoundaryNotice] = useState(null);
  const [holdPose, setHoldPose] = useState(false);
  const [enableSpeakingGestures, setEnableSpeakingGestures] = useState(true);
  const [enableIdleAnimation, setEnableIdleAnimation] = useState(true);
  const [cameraView, setCameraView] = useState('upper');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rigInfo, setRigInfo] = useState({ compatible: false, description: 'Inspecting VRM rig...' });
  const [reachLimit, setReachLimit] = useState({ left: false, right: false });

  const [voiceMode, setVoiceMode] = useState('auto');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const inputRef = useRef(null);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const reducedMotion = useReducedMotion();
  const character = getAvatarVoiceProfile(selectedAvatarId);
  const motionProfile = useMemo(() => reducedMotion ? { ...character, motion: 0 } : character, [character, reducedMotion]);
  const modelProblem = /failed|invalid|not a valid|Please select/i.test(modelStatus);
  const echo = useConversation(selectedAvatarId);
  const echoRef = useRef(echo);
  echoRef.current = echo;
  const handleBoundary = useCallback(() => {
    const current = echoRef.current;
    setBoundaryNotice({ avatarId: current.avatarId, language: current.language, text: boundaryPhrase(current.language) });
    current.respondToBoundary();
  }, []);
  const closeVoiceEditor = value => { if (!value) echo.stopSpeaking(); setVoiceEditorOpen(value); };
  const { voice, speech, messages, state } = echo;
  const voicePresetId = speech.presetId || getAvatarVoiceProfile(selectedAvatarId).preset;
  const isPlayingSample = Boolean(speech.previewAvatarId);
  const { status, liveText } = voice;
  const error = echo.error || voice.error || speech.error;
  const listening = status === 'listening';
  const starting = status === 'starting';
  const processing = status === 'processing';
  const thinking = state === 'THINKING';
  const playing = speech.status === 'speaking' || speech.status === 'starting';
  const captureBusy = listening || starting || processing;
  const busy = captureBusy || thinking || playing;
  const stateLabel = { IDLE: 'Ready', LISTENING: 'Listening...', TRANSCRIBING: 'Transcribing...', THINKING: 'Thinking...', SPEAKING: 'Speaking', ERROR: 'Ready to try again' }[state];
  const connectionLabel = { unchecked: 'Connecting', configured: 'Ready to connect', connected: 'Connected', setup: 'Connection unavailable', offline: 'Offline', error: 'Connection interrupted' }[echo.connection];

  useEffect(() => {
    return () => {
      if (modelUrl?.startsWith('blob:')) URL.revokeObjectURL(modelUrl);
    };
  }, [modelUrl]);

  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function openLanguageSettings() {
    echo.stopSpeaking(); setVoiceEditorOpen(false); setSettingsOpen(true);
  }

  function toggleMic() {
    if (listening || starting) echo.stopListening();
    else if (!busy) echo.startListening(voiceMode);
  }

  function handleSelectPreset(presetId) {
    echo.selectPreset(presetId);
  }

  function handleSelectAvatar(avatarId) {
    const target = getAvatarById(avatarId);
    if (!target) return;
    echo.beginAvatarSwitch();
    if (pendingPreviewRef.current !== avatarId) pendingPreviewRef.current = null;
    if (pendingVoiceEditorRef.current !== avatarId) pendingVoiceEditorRef.current = null;
    requestedAvatarRef.current = avatarId;
    setAvatarLoadingId(avatarId);
    setModelRevision((value) => value + 1);
    const url = target.id === DEFAULT_AVATAR_ID ? defaultAvatarUrl : target.modelUrl;
    requestedModelRef.current = url;
    setModelUrl(url);
  }

  const handleAvatarLoadingChange = useCallback((isLoading, url) => {
    if (url !== requestedModelRef.current) return;
    setAvatarLoadingId(isLoading ? requestedAvatarRef.current : null);
    if (!isLoading) {
      echoRef.current.cancelAvatarSwitch();
      pendingPreviewRef.current = null;
      pendingVoiceEditorRef.current = null;
    }
  }, []);

  const handleAvatarLoaded = useCallback((url) => {
    if (url !== requestedModelRef.current) return;
    const id = requestedAvatarRef.current;
    setSelectedAvatarId(id);
    if (echoRef.current.avatarId !== (id === 'custom' ? 'default' : id) || echoRef.current.avatarSwitching) echoRef.current.finishAvatarSwitch(id);
    if (pendingPreviewRef.current === id) {
      pendingPreviewRef.current = null;
      echoRef.current.previewVoice(id);
    }
    if (pendingVoiceEditorRef.current === id) {
      pendingVoiceEditorRef.current = null;
      setIsAvatarSelectorOpen(false);
      setVoiceEditorOpen(true);
    }
    if (id !== 'custom') {
      try { localStorage.setItem('echo_selected_avatar', id); } catch { /* storage unavailable */ }
    }
  }, []);

  function handlePreviewSample() {
    if (isPlayingSample) {
      echo.stopSpeaking();
      return;
    }
    echo.previewVoice();
  }

  function previewAvatarVoice(id) {
    if (captureBusy || thinking) return;
    if (id === selectedAvatarId && !avatarLoadingId) { handlePreviewSample(); return; }
    pendingPreviewRef.current = id;
    handleSelectAvatar(id);
  }

  function changeAvatarVoice(id) {
    pendingPreviewRef.current = null;
    echo.stopSpeaking();
    if (id === selectedAvatarId && !avatarLoadingId) {
      setIsAvatarSelectorOpen(false); setVoiceEditorOpen(true);
    } else { pendingVoiceEditorRef.current = id; handleSelectAvatar(id); }
  }

  function sendTyped(event) {
    event.preventDefault();
    if (!captureBusy && !thinking && draft.trim()) {
      setChatExpanded(true);
      echo.submit(draft);
      setDraft('');
    }
  }

  function importVrm(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.vrm')) {
      setModelStatus('Please select a .vrm file');
      return;
    }
    requestedAvatarRef.current = 'custom';
    echo.beginAvatarSwitch();
    pendingPreviewRef.current = pendingVoiceEditorRef.current = null;
    setAvatarLoadingId('custom');
    const url = URL.createObjectURL(file);
    requestedModelRef.current = url;
    setModelUrl(url);
    event.target.value = '';
  }

  return (
    <div className={`app-shell ${isFullscreen ? 'has-fullscreen' : ''}`} style={{ '--accent': character.accent, '--accent-rgb': character.accentRgb }}>
      <div id="zirumi-content">
        <a className="skip-link" href="#conversation-input">Skip to conversation</a>
        <header className="topbar">
          <div className="branding"><img className="logo" src="/zirumi-icon.svg" alt="" /><div><h1 className="brand-title">ZIRUMI</h1><span className="brand-tagline">Your World. Your Companion.</span></div></div>
          <nav className="header-nav" aria-label="Main navigation"><span className="studio-label"><span className="presence-dot" />Companion studio</span><button type="button" className="characters-button" onClick={() => setIsAvatarSelectorOpen(true)}><Icon name="sparkle" size={16} />Characters</button><button type="button" className="main-settings-button" aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}><Icon name="settings" size={17} /><span>Settings</span></button></nav>
        </header>
        <main className={`layout ${isFullscreen ? 'fullscreen-avatar' : ''}`}>
          <section className={`avatar-panel ${avatarLoadingId ? 'stage-loading' : ''}`} aria-label="3D avatar scene">
            <div className="stage-aura" aria-hidden="true" />
            <div className="stage-orbit" aria-hidden="true" />
            <header className="stage-heading"><div><span className="eyebrow">YOUR COMPANION</span><h2>{currentAvatar.name}<span className="character-presence" /></h2><p>{character.description}</p></div><div className={`stage-status state-${state.toLowerCase()}`} role="status"><span className="status-dot" />{avatarLoadingId ? 'Connecting…' : starting ? 'Starting microphone…' : speech.status === 'starting' ? 'Preparing voice…' : stateLabel}</div></header>
            <div className="avatar-canvas" style={{ animationName: `reveal-${selectedAvatarId}` }}>
              <Avatar ref={avatarRef} avatarId={selectedAvatarId} interactionMode={interactionMode && !avatarLoadingId} onBoundary={handleBoundary} boundarySpeechActive={speech.boundaryActive} modelUrl={modelUrl} modelRevision={modelRevision} onModelStatus={setModelStatus} onLoadingChange={handleAvatarLoadingChange} onModelLoaded={handleAvatarLoaded} conversationState={state} subscribeSpeechBoundary={echo.subscribeSpeechBoundary} subscribeSpeechAmplitude={echo.subscribeSpeechAmplitude} enableHandInteraction={enableHandInteraction} holdPose={holdPose} enableSpeakingGestures={enableSpeakingGestures && !reducedMotion} enableIdleAnimation={enableIdleAnimation && !reducedMotion} cameraView={cameraView} voicePreset={voicePresetId} avatarPersonality={motionProfile} onRigStatusChange={setRigInfo} onReachLimitChange={setReachLimit} />
            </div>
            <div className="stage-bottom">
              <button type="button" className={`character-interact-button ${interactionMode ? 'active' : ''}`} aria-label="Character interaction" aria-pressed={interactionMode} disabled={!rigInfo.compatible || rigInfo.colliderCalibrated === false || Boolean(avatarLoadingId)} onClick={() => setInteractionMode(value => !value)}><Icon name="hand" size={15} />{interactionMode ? 'Interacting · Back to view' : 'Interact'}</button>
              {boundaryNotice?.avatarId === echo.avatarId && boundaryNotice?.language === echo.language && <p className="boundary-notice" role="status">{boundaryNotice.text}</p>}
              <InteractionToolbar enableHandInteraction={enableHandInteraction} onToggleHandInteraction={() => setEnableHandInteraction(prev => !prev)} holdPose={holdPose} onToggleHoldPose={() => setHoldPose(prev => !prev)} onResetPose={() => avatarRef.current?.resetPose()} enableSpeakingGestures={enableSpeakingGestures} onToggleSpeakingGestures={() => setEnableSpeakingGestures(prev => !prev)} enableIdleAnimation={enableIdleAnimation} onToggleIdleAnimation={() => setEnableIdleAnimation(prev => !prev)} cameraView={cameraView} onToggleCameraView={() => setCameraView(prev => prev === 'upper' ? 'full' : 'upper')} isFullscreen={isFullscreen} onToggleFullscreen={() => setIsFullscreen(prev => !prev)} rigInfo={rigInfo} reachLimit={reachLimit} />
              <div className="stage-caption"><span>{interactionMode ? 'Click to interact · Drag hands to pose' : enableHandInteraction && rigInfo.compatible ? 'Drag hands to pose · Interact enables touch' : 'Drag to rotate · Scroll to zoom'}</span><WaveformVisualizer state={state} audioLevel={voice.level} subscribeSpeechAmplitude={echo.subscribeSpeechAmplitude} color={character.accent} reducedMotion={reducedMotion} /></div>
            </div>
            <div className="scene-accessory"><input ref={fileRef} type="file" accept=".vrm" onChange={importVrm} hidden aria-label="Import VRM avatar" /><button type="button" className="icon-button" onClick={() => fileRef.current?.click()} aria-label="Import .vrm" title="Import a custom .vrm model"><Icon name="upload" size={16} /></button></div>
            <span className="model-status sr-only" role="status">{modelStatus}</span>
            {modelProblem && <div className="model-error" role="alert"><span>Character couldn’t load. Try again or choose another.</span><button type="button" className="text-button" onClick={() => requestedAvatarRef.current === 'custom' ? fileRef.current?.click() : handleSelectAvatar(requestedAvatarRef.current)}>Retry</button></div>}
          </section>
          <ConversationPanel onOpenLanguageSettings={openLanguageSettings} character={character} currentAvatar={currentAvatar} messages={messages} scrollRef={scrollRef} echo={echo} liveText={liveText} thinking={thinking} processing={processing} captureBusy={captureBusy} playing={playing} starting={starting} listening={listening} error={error} draft={draft} setDraft={setDraft} sendTyped={sendTyped} toggleMic={toggleMic} chatExpanded={chatExpanded} setChatExpanded={setChatExpanded} inputRef={inputRef} reducedMotion={reducedMotion} voiceControls={<VoiceSelector onOpenLanguageSettings={openLanguageSettings} selectedPresetId={voicePresetId} onSelectPreset={handleSelectPreset} voices={speech.voices} selectedVoiceId={speech.selectedVoice} selectedVoiceKey={speech.selectedVoiceKey} onSelectVoice={echo.selectVoice} isPlayingSample={isPlayingSample} onPreviewSample={handlePreviewSample} enabled={speech.enabled} onToggleEnabled={echo.setVoiceEnabled} supported={speech.supported} isOpen={voiceEditorOpen} onOpenChange={closeVoiceEditor} avatarName={currentAvatar.name} profile={speech.profiles?.[speech.avatarId]} pitch={speech.pitch} rate={speech.rate} volume={speech.volume} onPitchChange={echo.setPitch} onRateChange={echo.setRate} onVolumeChange={echo.setVolume} onResetVoice={echo.resetVoice} previewDisabled={captureBusy || thinking || Boolean(avatarLoadingId)} />} />
        </main>
        <footer className="app-footer"><span>{LANGUAGES[echo.language || 'en'].label} · Speak. Connect. Interact.</span><span className="session-status" title={connectionLabel}><span className={`connection-dot connection-${echo.connection}`} />{connectionLabel}<span className="footer-divider" />Session memory</span></footer>
      </div>
      <AvatarSelector isOpen={isAvatarSelectorOpen} onClose={closeAvatarSelector} currentAvatarId={selectedAvatarId} onSelectAvatar={handleSelectAvatar} loadingAvatarId={avatarLoadingId} voiceProfiles={speech.profiles} onPreviewVoice={previewAvatarVoice} onChangeVoice={changeAvatarVoice} previewAvatarId={speech.previewAvatarId} previewDisabled={captureBusy || thinking || !speech.supported} />
      {settingsOpen && <Dialog title="Your space, your way." eyebrow="SETTINGS" onClose={closeSettings} className="settings-dialog" style={{ '--accent': character.accent, '--accent-rgb': character.accentRgb }}><div className="preferences-content">
        <section className="conversation-language-settings" aria-labelledby="conversation-language-heading">
          <h3 id="conversation-language-heading">Conversation Language</h3>
          <label className="sr-only" htmlFor="conversation-language">Conversation Language</label>
          <select id="conversation-language" aria-describedby="conversation-language-help" value={echo.language || 'en'} onChange={event => { echo.setLanguage(event.target.value); if (event.target.value !== 'en') setVoiceMode('auto'); }} disabled={busy || echo.avatarSwitching}>
            {Object.entries(LANGUAGES).map(([code, item]) => <option key={code} value={code}>{item.label} — {code}</option>)}
          </select>
          <p id="conversation-language-help">Changes chat, microphone recognition, greetings and spoken replies. Your choice is saved for your next visit.</p>
          <p className="language-routing-note">{echo.language && echo.language !== 'en' ? 'Sarvam recognition and voice in your selected language. Browser fallback voices are not used.' : 'Deepgram recognition and Cartesia voice. Browser fallback is a separate voice setting.'}</p>
        </section>
        <label className="preference-row"><span>Hand interaction<small>Drag hands to pose your companion.</small></span><input type="checkbox" checked={enableHandInteraction} onChange={event => setEnableHandInteraction(event.target.checked)} disabled={!rigInfo.compatible} /></label>
        <label className="preference-row"><span>Speaking gestures<small>Subtle movement during conversation.</small></span><input type="checkbox" checked={enableSpeakingGestures} onChange={event => setEnableSpeakingGestures(event.target.checked)} /></label>
        <label className="preference-row"><span>Idle motion<small>Gentle breathing and natural blinking.</small></span><input type="checkbox" checked={enableIdleAnimation} onChange={event => setEnableIdleAnimation(event.target.checked)} /></label>
        <label className="input-method-label" htmlFor="voice-input-method">Speech recognition</label><select id="voice-input-method" value={voiceMode} onChange={event => setVoiceMode(event.target.value)} disabled={busy}><option value="auto">Automatic</option><option value="native" disabled={echo.language && echo.language !== 'en'}>Browser recognition</option><option value="server">Recorded speech</option></select>
        {reducedMotion && <p className="voice-engine-note">Your reduced-motion preference is active.</p>}
        <div className="privacy-note"><Icon name="shield" size={18} /><div><strong>A conversation on your terms.</strong><p>The microphone starts only when you choose it. Messages go to Groq. Recorded speech uses {voice.provider || 'the configured transcription service'}; spoken replies use {speech.tts?.provider || 'the configured voice service'}. Browser recognition uses your browser’s speech service. Session history clears on refresh.</p><small>Microphone permission: {voice.permission === 'granted' ? 'Allowed' : voice.permission === 'denied' ? 'Blocked — check browser permissions' : 'Not yet granted'}</small></div></div>
      </div></Dialog>}
    </div>
  );
}
