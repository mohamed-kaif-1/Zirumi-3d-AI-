import { useEffect, useMemo, useRef, useState } from 'react';
import { createConversationController } from './conversationController.js';

const initial = { language: 'en', state: 'IDLE', messages: [], error: '', connection: 'unchecked', model: '', voice: { status: 'idle', permission: 'unknown', engine: 'native', error: '', liveText: '', notice: '', level: 0 }, speech: { supported: true, enabled: true, status: 'idle', selectedVoice: '', voices: [], error: '' } };

export default function useConversation(initialAvatarId = 'default') {
  const controller = useRef(null);
  const subscriptions = useRef({ subscribeSpeechBoundary: new Set(), subscribeSpeechAmplitude: new Set() });
  const initialAvatar = useRef(initialAvatarId);
  const [conversation, setConversation] = useState(initial);
  useEffect(() => {
    const instance = createConversationController({ onChange: setConversation, initialAvatarId: initialAvatar.current });
    controller.current = instance;
    // Child effects can subscribe before this parent effect creates the owner.
    // Attach those queued listeners, including on StrictMode owner recreation.
    for (const [method, listeners] of Object.entries(subscriptions.current)) {
      for (const entry of listeners) entry.unsubscribe = instance[method](entry.callback);
    }
    setConversation(instance.getSnapshot());
    instance.checkConnection();
    let permission, disposed = false;
    const onPermission = () => instance.setPermission(permission.state);
    navigator.permissions?.query({ name: 'microphone' }).then((result) => {
      if (disposed) return;
      permission = result;
      onPermission();
      permission.addEventListener('change', onPermission);
    }).catch(() => {});
    const onPageHide = () => instance.interrupt();
    const onVisibility = () => { if (document.hidden) instance.interrupt(); };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      permission?.removeEventListener('change', onPermission);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const listeners of Object.values(subscriptions.current)) {
        for (const entry of listeners) { entry.unsubscribe?.(); entry.unsubscribe = null; }
      }
      instance.dispose();
      controller.current = null;
    };
  }, []);
  const methods = useMemo(() => {
    const names = ['setLanguage', 'submit', 'retry', 'startListening', 'stopListening', 'cancelRecording', 'cancelRequest', 'stopSpeaking', 'setVoiceEnabled', 'selectVoice', 'selectPreset', 'resetVoice', 'previewVoice', 'beginAvatarSwitch', 'finishAvatarSwitch', 'cancelAvatarSwitch', 'setRate', 'setPitch', 'setVolume', 'setLangFilter', 'playReply', 'clear'];
    const api = Object.fromEntries(names.map(method => [method, (...args) => controller.current?.[method](...args)]));
    for (const [method, listeners] of Object.entries(subscriptions.current)) {
      api[method] = callback => {
        const entry = { callback, unsubscribe: controller.current?.[method](callback) };
        listeners.add(entry);
        return () => { entry.unsubscribe?.(); listeners.delete(entry); };
      };
    }
    return api;
  }, []);
  return { ...conversation, ...methods };
}
