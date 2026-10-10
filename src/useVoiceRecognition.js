import { useEffect, useRef, useState } from 'react';
import { createVoiceController } from './voiceController.js';

export default function useVoiceRecognition(onTranscript) {
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const controller = useRef(null);
  const [voice, setVoice] = useState({ status: 'idle', permission: 'unknown', engine: 'native', liveText: '', error: '', notice: '', level: 0 });
  useEffect(() => {
    const instance = createVoiceController({ onChange: setVoice, onTranscript: (text) => callback.current(text) });
    controller.current = instance;
    setVoice(instance.getSnapshot());
    let permission;
    let cancelled = false;
    const onPermission = () => instance.setPermission(permission.state);
    navigator.permissions?.query({ name: 'microphone' }).then((result) => {
      if (cancelled) return;
      permission = result;
      onPermission();
      permission.addEventListener('change', onPermission);
    }).catch(() => {});
    const onPageHide = () => instance.cancel();
    const onVisibility = () => { if (document.hidden) instance.cancel(); };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      permission?.removeEventListener('change', onPermission);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      instance.dispose();
      controller.current = null;
    };
  }, []);
  return { ...voice, start: (mode) => controller.current?.start(mode), stop: () => controller.current?.stop(), cancel: () => controller.current?.cancel() };
}
