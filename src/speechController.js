import { avatarVoiceId, getAvatarVoiceProfile, loadVoicePreferences, saveVoicePreferences, sanitizeVoiceSettings, defaultVoiceSettings, resolveAvatarVoices, settingsWithPreset, voiceIdentity, voiceOptionId } from './avatarVoiceProfiles.js';

import { ELEVENLABS_VOICES, isElevenLabsAvatar } from './elevenLabsVoices.js';
import { createAudioSpeechPlayer } from './audioSpeechPlayer.js';
import { LANGUAGES } from './languages.js';

// One owner for reply and preview playback. Every cancellation invalidates callbacks.
export function createSpeechController({ env = globalThis, onChange, initialAvatarId = 'default' }) {
  const synth = env.speechSynthesis;
  const browserSupported = Boolean(synth && env.SpeechSynthesisUtterance);
  const supported = browserSupported || Boolean(env.Audio && env.fetch && env.URL?.createObjectURL);
  let storage;
  try { storage = env.localStorage; } catch { /* storage may be blocked */ }
  let preferences = loadVoicePreferences(storage);
  let installed = browserSupported ? synth.getVoices() : [];
  let disposed = false, active = null, nextId = 0;
  const globalBoundaryListeners = new Set();
  const amplitudeListeners = new Set();
  let ttsStatus = null;
  let language = 'en', metadataVersion = 0;
  const cloudProvider = id => language !== 'en' ? 'sarvam' : ttsStatus?.provider === 'Cartesia' ? 'cartesia' : ttsStatus?.provider === 'Browser' ? 'browser' : isElevenLabsAvatar(id) || Boolean(ttsStatus?.avatars?.[id]?.voiceId) ? 'elevenlabs' : 'browser';
  const usesCloud = id => cloudProvider(id) !== 'browser';
  const providerName = id => cloudProvider(id) === 'sarvam' ? 'Sarvam' : cloudProvider(id) === 'cartesia' ? 'Cartesia' : 'ElevenLabs';
  let fallbackReplay = null;
  let snapshot = { enabled: true, supported, status: 'idle', error: '', avatarId: avatarVoiceId(initialAvatarId), selectedVoice: '', selectedVoiceKey: '', voices: [], profiles: {}, previewAvatarId: null, rate: 1, pitch: 1, volume: 1, langFilter: 'all' };
  const update = patch => { snapshot = { ...snapshot, ...patch }; if (!disposed) onChange(snapshot); };

  function profileSnapshot() {
    const allocation = resolveAvatarVoices(installed, preferences, env.navigator?.language || 'en-US');
    const profiles = Object.fromEntries(Object.entries(allocation.resolved).map(([id, originalAssignment]) => {
      const fallbackVoice = env.Audio && isElevenLabsAvatar(id) && originalAssignment.automatic && installed.find(v => /zira|samantha|hazel|susan|victoria|karen|emma|aria|jenny|salli/i.test(v.name) && v.lang.toLowerCase().startsWith('en'));
      const assignment = fallbackVoice ? { ...originalAssignment, voice: fallbackVoice } : originalAssignment;
      return [id, {
      ...preferences[id], ...assignment, voice: voiceIdentity(assignment.voice), voiceName: usesCloud(id) ? `${providerName(id)} · ${ttsStatus?.avatars?.[id]?.name || 'Unverified'}` : assignment.voice?.name || 'Browser default', browserVoiceName: assignment.voice?.name || 'Browser default', voiceKey: assignment.voice ? voiceOptionId(assignment.voice) : '', profile: getAvatarVoiceProfile(id), provider: cloudProvider(id), providerVoiceId: ['cartesia', 'sarvam'].includes(cloudProvider(id)) ? ttsStatus?.avatars?.[id]?.voiceId || null : ttsStatus?.avatars?.[id]?.voiceId || ELEVENLABS_VOICES[id]?.voiceId,
      shared: usesCloud(id) ? false : assignment.shared,
      notice: usesCloud(id) ? ttsStatus?.avatars?.[id]?.error || (ttsStatus ? '' : 'Speech provider verification pending.') : assignment.notice,
      metadata: ttsStatus?.avatars?.[id],
    }]; }));
    const current = profiles[snapshot.avatarId];
    return { profiles, distinctVoices: allocation.distinctCount, availableVoices: allocation.availableCount, voiceNotice: current.notice, selectedVoice: current.voice?.voiceURI || '', selectedVoiceKey: current.voiceKey,
      presetId: current.presetId, pitch: current.pitch, rate: current.rate, volume: current.volume,
      voices: installed.map(v => ({ id: v.voiceURI, key: voiceOptionId(v), name: v.name, lang: v.lang, langCode: v.lang.split('-')[0].toLowerCase(), isLocal: v.localService ?? true, localService: v.localService, isDefault: v.default })),
    };
  }
  snapshot = { ...snapshot, ...profileSnapshot() };
  const emitAmplitude = value => { for (const listener of amplitudeListeners) listener(value); };
  const audioPlayer = createAudioSpeechPlayer({ env, onState: patch => {
    const id = fallbackReplay?.options.avatarId;
    if (patch.status === 'speaking' && ttsStatus?.avatars?.[id]) {
      ttsStatus.avatars[id] = { ...ttsStatus.avatars[id], available: true, synthesisVerified: true, playbackError: false, synthesisError: false, error: '' };
      update({ ...profileSnapshot(), ...patch });
    } else update(patch);
  }, onAmplitude: emitAmplitude,
    onFailure: message => {
      const replay = fallbackReplay; fallbackReplay = null;
      if (disposed || !replay) return;
      if (language === 'en' && !replay.options.preview && ttsStatus?.fallback === 'browser' && browserSupported) {
        speakBrowser(replay.text, { ...replay.options, manual: true });
        update({ notice: `${message} Using the configured browser fallback: ${snapshot.playbackVoice?.name || 'Browser default'}.` });
      } else {
        const id = replay.options.avatarId;
        if (ttsStatus?.avatars?.[id]) ttsStatus.avatars[id] = { ...ttsStatus.avatars[id], playbackError: true, error: message };
        update({ ...profileSnapshot(), status: 'error', error: message, previewAvatarId: null });
      }
    },
  });
  let metadataAbort = new AbortController();
  let metadataLoading = null;
  function checkTts() {
    if (!audioPlayer.supported) return Promise.resolve();
    if (metadataLoading) return metadataLoading;
    const promise = loadTts().finally(() => { if (metadataLoading === promise) metadataLoading = null; });
    metadataLoading = promise;
    return metadataLoading;
  }
  async function loadTts() {
    const version = metadataVersion;
    const deadline = new AbortController();
    const timer = env.setTimeout(() => deadline.abort(), 25_000);
    try {
      const response = await env.fetch('/api/tts/status' + (language === 'en' ? '' : '?language=' + language), { signal: AbortSignal.any([metadataAbort.signal, deadline.signal]) });
      const result = await response.json();
      if (!disposed && version === metadataVersion && response.ok && ['ElevenLabs', 'Cartesia', 'Browser', 'Sarvam'].includes(result.provider)) { ttsStatus = result; update({ ...profileSnapshot(), tts: result }); }
    } catch { if (!disposed && version === metadataVersion) update({ notice: 'Speech provider verification could not reach the backend.' }); }
    finally { env.clearTimeout(timer); }
  }

  function clearUtterance() {
    if (!active) return;
    env.clearTimeout(active.timer);
    const utterance = active.utterance;
    utterance.onstart = utterance.onend = utterance.onerror = utterance.onboundary = null;
    active = null;
  }
  function cancel() {
    nextId++;
    fallbackReplay = null;
    audioPlayer.cancel();
    clearUtterance();
    if (browserSupported) synth.cancel();
    update({ status: 'idle', error: '', notice: '', analysisNotice: '', previewAvatarId: null });
  }
  function speakBrowser(text, { manual = false, preview = false, avatarId = snapshot.avatarId } = {}) {
    if (disposed || (!snapshot.enabled && !manual) || typeof text !== 'string' || !text.trim()) return false;
    cancel();
    if (!browserSupported) { update({ status: 'error', error: 'Spoken replies are unavailable in this browser. Text replies remain available.' }); return false; }
    emitAmplitude(null);
    const id = ++nextId;
    const identity = snapshot.profiles[avatarVoiceId(avatarId)];
    const utterance = new env.SpeechSynthesisUtterance(text.trim());
    const language = env.navigator?.language || 'en-US';
    let voice = identity.voice && installed.find(v => v.voiceURI === identity.voice.voiceURI && v.lang.toLowerCase() === identity.voice.lang.toLowerCase());
    const filterCode = snapshot.langFilter !== 'all' ? snapshot.langFilter : null;
    if (filterCode && (!voice || !voice.lang.toLowerCase().startsWith(filterCode))) voice = installed.find(v => v.lang.toLowerCase().startsWith(filterCode));
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || (filterCode ? `${filterCode}-IN` : language);
    utterance.rate = identity.rate;
    utterance.pitch = identity.pitch;
    utterance.volume = identity.volume;
    const current = () => !disposed && active?.id === id;
    const fail = error => {
      if (!current()) return;
      clearUtterance(); synth.cancel(); update({ status: 'error', error, previewAvatarId: null });
    };
    active = { id, utterance, timer: null };
    utterance.onboundary = event => {
      if (!current()) return;
      for (const listener of globalBoundaryListeners) { try { listener(event); } catch (error) { console.error('Speech boundary error:', error); } }
    };
    utterance.onstart = () => {
      if (!current()) return;
      env.clearTimeout(active.timer);
      active.timer = env.setTimeout(() => fail('Voice playback did not finish. Use Play reply to try again.'), Math.min(600000, Math.max(20000, text.length * 100 / identity.rate)));
      update({ status: 'speaking', error: '' });
    };
    utterance.onend = () => { if (current()) { clearUtterance(); update({ status: 'idle', error: '', previewAvatarId: null }); } };
    utterance.onerror = ({ error }) => fail(error === 'not-allowed' ? 'Automatic voice playback was blocked. Click Play reply to hear it.' : `Voice playback failed (${error || 'unknown'}). Check your installed voices or try Preview.`);
    active.timer = env.setTimeout(() => fail('Voice playback did not start. Try Preview or check your installed voices.'), 8000);
    update({ status: 'starting', error: '', playbackEngine: 'browser', previewAvatarId: preview ? avatarVoiceId(avatarId) : null, playbackAvatarId: avatarVoiceId(avatarId), playbackVoice: voiceIdentity(voice) });
    try { synth.resume(); synth.speak(utterance); } catch { fail('Voice playback could not start. Try Preview again.'); }
    return true;
  }
  function speak(text, options = {}) {
    const avatarId = avatarVoiceId(options.avatarId || snapshot.avatarId);
    // Resolve server-only Aira configuration before choosing a playback engine.
    if (!ttsStatus && audioPlayer.supported) {
      if (disposed || (!snapshot.enabled && !options.manual) || typeof text !== 'string' || !text.trim()) return false;
      cancel(); const epoch = nextId;
      update({ status: 'starting', error: '', previewAvatarId: options.preview ? avatarId : null });
      checkTts().then(() => {
        if (disposed || nextId !== epoch) return;
        if (ttsStatus) speak(text, { ...options, avatarId });
        else update({ status: 'error', previewAvatarId: null, error: 'Voice configuration could not be verified. Check the backend and try again.' });
      });
      return true;
    }
    if (!usesCloud(avatarId)) return speakBrowser(text, options);
    if (disposed || (!snapshot.enabled && !options.manual) || typeof text !== 'string' || !text.trim()) return false;
    cancel();
    if (!audioPlayer.supported) { update({ status: 'error', error: `${providerName(avatarId)} audio playback is unavailable in this browser.`, previewAvatarId: null }); return false; }
    const identity = snapshot.profiles[avatarId];
    fallbackReplay = { text, options: { ...options, avatarId } };
    update({ previewAvatarId: options.preview ? avatarId : null, playbackAvatarId: avatarId, playbackVoice: { voiceURI: identity.providerVoiceId, name: ttsStatus?.avatars?.[avatarId]?.name || `${identity.profile.name} (unverified)`, lang: language } });
    return audioPlayer.play(text.trim(), { avatarId, rate: identity.rate, presetId: identity.presetId, volume: identity.volume, provider: identity.provider, language, preview: Boolean(options.preview), voiceIdentity: `${identity.provider}:${identity.providerVoiceId}:${ttsStatus?.model || ''}` });
  }
  function updateSettings(patch, id = snapshot.avatarId) {
    id = avatarVoiceId(id);
    if (id === snapshot.avatarId) cancel();
    preferences = { ...preferences, [id]: sanitizeVoiceSettings(id, { ...preferences[id], ...patch }) };
    saveVoicePreferences(storage, preferences);
    update(profileSnapshot());
  }
  const onVoices = () => { installed = synth.getVoices(); update(profileSnapshot()); };
  synth?.addEventListener('voiceschanged', onVoices);
  return {
    speak, cancel, getSnapshot: () => snapshot,
    checkTts,
    setLanguage(value) {
      if (!Object.hasOwn(LANGUAGES, value) || value === language) return;
      cancel(); metadataVersion++; metadataAbort.abort(); metadataAbort = new AbortController(); metadataLoading = null;
      language = value; ttsStatus = null; update({ ...profileSnapshot(), tts: null, language }); checkTts();
    },
    setAvatar(id) {
      cancel(); snapshot = { ...snapshot, avatarId: avatarVoiceId(id), langFilter: 'all' }; update(profileSnapshot());
    },
    preview(id = snapshot.avatarId) { checkTts(); return speak(LANGUAGES[language].sample?.[id] || getAvatarVoiceProfile(id).sample, { manual: true, preview: true, avatarId: id }); },
    setEnabled(enabled) { if (!enabled) cancel(); update({ enabled: Boolean(enabled) }); },
    selectVoice(id) {
      const voice = installed.find(v => voiceOptionId(v) === id || v.voiceURI === id);
      snapshot = { ...snapshot, langFilter: 'all' };
      updateSettings({ voice: voiceIdentity(voice) });
    },
    selectPreset(id) { updateSettings(settingsWithPreset(preferences[snapshot.avatarId], id)); },
    resetVoice() { updateSettings(defaultVoiceSettings(snapshot.avatarId)); },
    setRate(value) { updateSettings({ rate: Number(value) }); },
    setPitch(value) { updateSettings({ pitch: Number(value) }); },
    setVolume(value) { updateSettings({ volume: Number(value) }); },
    setLangFilter(lang) { cancel(); update({ langFilter: lang || 'all' }); },
    subscribeBoundary(fn) { globalBoundaryListeners.add(fn); return () => globalBoundaryListeners.delete(fn); },
    subscribeAmplitude(fn) { amplitudeListeners.add(fn); fn(['elevenlabs', 'cartesia', 'sarvam'].includes(snapshot.playbackEngine) ? 0 : null); return () => amplitudeListeners.delete(fn); },
    dispose() { disposed = true; metadataAbort.abort(); cancel(); audioPlayer.dispose(); synth?.removeEventListener('voiceschanged', onVoices); globalBoundaryListeners.clear(); amplitudeListeners.clear(); },
  };
}
