import { createVoiceController } from './voiceController.js';
import { createSpeechController } from './speechController.js';
import { avatarVoiceId } from './avatarVoiceProfiles.js';
import { LANGUAGES } from './languages.js';

export const CONVERSATION_STATES = ['IDLE', 'LISTENING', 'TRANSCRIBING', 'THINKING', 'SPEAKING', 'ERROR'];

// Only complete user/assistant pairs enter AI memory. Failed/cancelled
// user bubbles remain visible, but never become successful conversation turns.
export function recentHistory(messages) {
  const pairs = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const user = messages[i], assistant = messages[i + 1];
    if (user.role === 'user' && user.status === 'complete' && assistant.role === 'assistant' && assistant.turnId === user.turnId) {
      pairs.push([{ role: 'user', content: user.text }, { role: 'assistant', content: assistant.text }]);
      i++;
    }
  }
  const selected = pairs.slice(-6);
  while (selected.flat().reduce((sum, message) => sum + message.content.length, 0) > 24_000) selected.shift();
  return selected.flat();
}

export function createConversationController({ env = globalThis, onChange, initialAvatarId = 'default' }) {
  let disposed = false, request = null, sequence = 0, resetting = false;
  let voiceEpoch = 0;
  let snapshot = { language: 'en', state: 'IDLE', messages: [], error: '', memoryNotice: '', connection: 'unchecked', model: '', voice: null, speech: null, avatarId: avatarVoiceId(initialAvatarId), avatarSwitching: false };
  const publish = (patch = {}) => {
    snapshot = { ...snapshot, ...patch };
    if (!disposed && !resetting) onChange(snapshot);
  };
  const isCapturing = () => ['starting', 'listening', 'processing'].includes(snapshot.voice?.status);
  const isPlaying = () => ['starting', 'speaking'].includes(snapshot.speech?.status);
  function refreshState() {
    let state = 'IDLE';
    if (snapshot.voice?.status === 'listening') state = 'LISTENING';
    else if (snapshot.voice?.status === 'processing') state = 'TRANSCRIBING';
    else if (request) state = 'THINKING';
    else if (snapshot.speech?.status === 'speaking') state = 'SPEAKING';
    else if (snapshot.error || snapshot.voice?.error || snapshot.speech?.error) state = 'ERROR';
    publish({ state });
  }
  const speaker = createSpeechController({ env, initialAvatarId, onChange: (speech) => { snapshot = { ...snapshot, speech }; refreshState(); } });
  const microphone = createVoiceController({ env, onChange: (voice) => { snapshot = { ...snapshot, voice }; refreshState(); }, onTranscript: (text) => submit(text, 'voice') });
  snapshot = { ...snapshot, voice: microphone.getSnapshot(), speech: speaker.getSnapshot() };
  let healthAbort = null;
  let healthVersion = 0;

  async function checkConnection() {
    speaker.checkTts();
    healthAbort?.abort();
    const currentHealth = new AbortController();
    healthAbort = currentHealth;
    const version = ++healthVersion;
    const timer = env.setTimeout(() => currentHealth.abort(), 8000);
    try {
      const response = await env.fetch('/api/chat/status' + (snapshot.language === 'en' ? '' : '?language=' + snapshot.language), { signal: currentHealth.signal });
      const data = await response.json();
      if (!disposed && version === healthVersion) publish({ connection: response.ok && data.configured ? 'configured' : 'setup', model: typeof data.model === 'string' ? data.model : '' });
    } catch { if (!disposed && version === healthVersion) publish({ connection: 'offline' }); }
    finally { env.clearTimeout(timer); }
  }

  function markTurn(turnId, status) {
    snapshot = { ...snapshot, messages: snapshot.messages.map((message) => message.turnId === turnId && message.role === 'user' ? { ...message, status } : message) };
  }

  async function submit(rawText, source = 'typed', retryTurn = null) {
    // The voice controller delivers its final transcript before its completed
    // state callback. Only that internal final callback bypasses capture state.
    if (disposed || request || (source !== 'voice' && isCapturing())) return false;
    const text = rawText.trim();
    if (!text || text.length > 4000) { publish({ error: 'Please enter between 1 and 4,000 characters.' }); refreshState(); return false; }
    const history = recentHistory(snapshot.messages);
    speaker.cancel();
    microphone.reset();
    healthVersion++;
    const turnId = retryTurn?.turnId ?? ++sequence;
    const avatarId = retryTurn?.avatarId || snapshot.avatarId;
    const current = { turnId, abort: new AbortController(), timer: null, voiceEpoch, avatarId };
    request = current; // Lock before any fetch or React update.
    const messages = retryTurn ? snapshot.messages.map(message => message.id === retryTurn.id ? { ...message, status: 'pending' } : message) : [...snapshot.messages, { id: `user-${turnId}`, turnId, role: 'user', text, avatarId, status: 'pending' }];
    publish({ messages, error: '', state: 'THINKING' });
    current.timer = env.setTimeout(() => cancelRequest('ZIRUMI took too long to reply. Please try again.'), 50_000);
    try {
      const response = await env.fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history, avatarId, ...(snapshot.language !== 'en' ? { language: snapshot.language } : {}) }), signal: current.abort.signal });
      let result;
      try { result = await response.json(); } catch { throw new Error('The AI server returned an unreadable response. Check that the backend is running.'); }
      if (!response.ok) throw new Error(result.error || 'ZIRUMI could not answer. Please try again.');
      if (typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 6000) throw new Error('ZIRUMI returned an invalid reply. Please try again.');
      if (disposed || request !== current) return false;
      env.clearTimeout(current.timer);
      request = null;
      markTurn(turnId, 'complete');
      publish({ messages: [...snapshot.messages, { id: `assistant-${turnId}`, turnId, role: 'assistant', text: result.reply.trim(), status: 'complete', avatarId: current.avatarId }], connection: 'connected', error: '', memoryNotice: typeof result.memoryNotice === 'string' ? result.memoryNotice : '', state: 'IDLE' });
      if (current.voiceEpoch === voiceEpoch && current.avatarId === snapshot.avatarId && !snapshot.avatarSwitching) speaker.speak(result.reply.trim());
      refreshState();
      return true;
    } catch (error) {
      if (disposed || request !== current) return false;
      env.clearTimeout(current.timer);
      request = null;
      markTurn(turnId, 'failed');
      publish({ error: error.message === 'Failed to fetch' ? 'Could not reach the AI server. Check your connection and try again.' : error.message, connection: 'error' });
      refreshState();
      return false;
    }
  }

  function cancelRequest(error = '') {
    const current = request;
    if (current) {
      request = null;
      env.clearTimeout(current.timer);
      current.abort.abort();
      markTurn(current.turnId, error ? 'failed' : 'cancelled');
    }
    publish({ error });
    refreshState();
  }
  function interrupt() {
    cancelRequest();
    microphone.cancel();
    speaker.cancel();
    refreshState();
  }
  return {
    setLanguage(value) {
      if (!Object.hasOwn(LANGUAGES, value) || value === snapshot.language) return;
      interrupt(); voiceEpoch++; publish({ language: value, error: '', memoryNotice: '' });
      speaker.setLanguage(value); microphone.setLanguage(value); checkConnection();
    },
    submit, checkConnection, cancelRequest, interrupt, getSnapshot: () => snapshot,
    retry() {
      const failed = snapshot.messages.at(-1);
      return failed?.role === 'user' && failed.status === 'failed' ? submit(failed.text, 'typed', failed) : Promise.resolve(false);
    },
    startListening(mode) {
      if (disposed || request || isPlaying() || isCapturing()) return false;
      publish({ error: '' });
      speaker.cancel();
      microphone.start(mode);
      return true;
    },
    stopListening: () => microphone.stop(),
    cancelRecording: () => microphone.cancel(),
    setPermission: (permission) => microphone.setPermission(permission),
    stopSpeaking: () => speaker.cancel(),
    setVoiceEnabled: (enabled) => speaker.setEnabled(enabled),
    selectVoice: (id) => speaker.selectVoice(id),
    setRate: (rate) => speaker.setRate(rate),
    setPitch: (pitch) => speaker.setPitch(pitch),
    setVolume: (volume) => speaker.setVolume(volume),
    selectPreset: (id) => speaker.selectPreset(id),
    resetVoice: () => speaker.resetVoice(),
    beginAvatarSwitch() { voiceEpoch++; speaker.cancel(); publish({ avatarSwitching: true }); refreshState(); },
    finishAvatarSwitch(id) { speaker.setAvatar(id); publish({ avatarId: avatarVoiceId(id), avatarSwitching: false }); refreshState(); },
    cancelAvatarSwitch() { publish({ avatarSwitching: false }); refreshState(); },
    previewVoice(id = snapshot.avatarId) {
      if (disposed || request || isCapturing() || snapshot.avatarSwitching) return false;
      return speaker.preview(id);
    },
    setLangFilter: (lang) => speaker.setLangFilter(lang),
    playReply(id) {
      if (disposed || request || isCapturing() || snapshot.avatarSwitching) return false;
      const message = snapshot.messages.find((message) => message.id === id && message.role === 'assistant');
      return message ? speaker.speak(message.text, { manual: true }) : false;
    },
    clear() {
      resetting = true;
      interrupt();
      microphone.reset();
      snapshot = { ...snapshot, messages: [], error: '', memoryNotice: '', state: 'IDLE' };
      resetting = false;
      publish();
    },
    subscribeSpeechBoundary: (fn) => speaker.subscribeBoundary(fn),
    subscribeSpeechAmplitude: (fn) => speaker.subscribeAmplitude(fn),
    dispose() {
      disposed = true;
      healthAbort?.abort();
      cancelRequest();
      microphone.dispose();
      speaker.dispose();
    },
  };
}
