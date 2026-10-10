export const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const ERROR_TEXT = {
  network: 'The browser speech service could not be reached. This is a service/network failure, not proof of denied microphone access.',
  'service-not-allowed': 'This browser does not allow its native speech service.',
  'not-allowed': 'Microphone access was denied. Allow the microphone in site settings and check Windows microphone privacy settings.',
  'audio-capture': 'No working microphone was found. Check your input device and whether another app is using it.',
  'no-speech': 'No speech was detected. Tap to speak and try again.',
  aborted: 'Listening was interrupted. Tap to speak to start a new session.',
  'language-not-supported': 'The browser speech service does not support English (India).',
};

// The controller owns resources synchronously; React state is only a view of them.
export function createVoiceController({ env = globalThis, onChange, onTranscript }) {
  const Recognition = env.SpeechRecognition || env.webkitSpeechRecognition;
  let snapshot = { status: 'idle', permission: 'unknown', engine: Recognition ? 'native' : 'server', liveText: '', error: '', notice: '', level: 0 };
  let session = null;
  let language = 'en';
  const healthUrl = () => '/api/transcription/status' + (language === 'en' ? '' : '?language=' + language);
  let nativeUnavailable = !Recognition;
  let disposed = false;
  const update = (patch) => {
    snapshot = { ...snapshot, ...patch };
    if (!disposed) onChange(snapshot);
  };
  const active = (s) => !disposed && session === s;
  function release(s) {
    for (const timer of s.timers) env.clearTimeout(timer);
    s.timers.clear();
    if (s.frame) env.cancelAnimationFrame(s.frame);
    s.source?.disconnect();
    s.context?.close().catch(() => {});
    s.context = null;
    s.stream?.getTracks().forEach((track) => track.stop());
    s.stream = null;
    update({ level: 0 });
  }
  function detachRecognition(s) {
    if (!s.recognition) return;
    for (const name of ['onstart', 'onaudiostart', 'onresult', 'onerror', 'onend']) s.recognition[name] = null;
  }
  function finish(s, text = '', error = '') {
    if (session !== s) return;
    release(s);
    detachRecognition(s);
    session = null;
    const clean = text.trim();
    if (clean && !disposed) onTranscript(clean);
    update({ status: clean ? 'completed' : 'idle', liveText: '', error, permission: snapshot.permission === 'requesting' ? 'unknown' : snapshot.permission, ...(snapshot.engine === 'server' ? { notice: '' } : {}) });
  }
  function timer(s, callback, ms) {
    const id = env.setTimeout(() => { s.timers.delete(id); if (active(s)) callback(); }, ms);
    s.timers.add(id);
    return id;
  }
  function started(s) {
    env.clearTimeout(s.startupTimer);
    s.timers.delete(s.startupTimer);
  }
  const finalText = (s) => [...s.finals.values()].join(' ');
  function native(s) {
    const recognition = new Recognition();
    s.recognition = recognition;
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (active(s) && !s.stopping) { started(s); update({ status: 'listening' }); }
    };
    recognition.onaudiostart = () => { if (active(s)) update({ permission: 'granted' }); };
    recognition.onresult = (event) => {
      if (!active(s)) return;
      let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) s.finals.set(i, result[0].transcript.trim());
        else interim += result[0].transcript;
      }
      update({ liveText: [finalText(s), interim].filter(Boolean).join(' ') });
    };
    recognition.onerror = ({ error }) => {
      if (!active(s)) return;
      if (error === 'aborted' && s.stopping) { finish(s, finalText(s)); return; }
      const serviceFailure = ['network', 'service-not-allowed', 'language-not-supported'].includes(error);
      if (serviceFailure) {
        nativeUnavailable = true;
        update({ notice: 'Server recording is selected for your next attempt. Tap to speak and repeat your sentence; audio is sent to the configured transcription service after you stop.' });
      }
      if (error === 'not-allowed') update({ permission: 'denied' });
      // Detach before abort: a late onend must never reset a newer session.
      detachRecognition(s);
      try { recognition.abort(); } catch { /* Already ended. */ }
      finish(s, finalText(s), ERROR_TEXT[error] || `Speech recognition failed (${error}). Try again or use typed input.`);
    };
    recognition.onend = () => finish(s, finalText(s), s.stopping || s.finals.size ? '' : ERROR_TEXT['no-speech']);
    recognition.start();
    timer(s, () => stop(), 60_000);
  }
  function meter(s) {
    const AudioContext = env.AudioContext || env.webkitAudioContext;
    if (!AudioContext || !env.requestAnimationFrame) return;
    try {
      s.context = new AudioContext();
      s.context.resume().catch(() => {});
      s.source = s.context.createMediaStreamSource(s.stream);
      const analyser = s.context.createAnalyser();
      analyser.fftSize = 256;
      s.source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!active(s) || !s.stream) return;
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / data.length);
        if (s.context.state === 'running') {
          s.meterObserved = true;
          if (rms >= 0.003) s.voicedFrames = (s.voicedFrames || 0) + 1;
        }
        update({ level: Math.min(1, rms * 5) });
        s.frame = env.requestAnimationFrame(tick);
      };
      tick();
    } catch { /* Meter is optional; recording still works. */ }
  }
  async function record(s) {
    if (!env.isSecureContext || !env.navigator?.mediaDevices?.getUserMedia || !env.MediaRecorder) {
      throw new Error('Recording requires microphone/MediaRecorder support and HTTPS or localhost. You can still type below.');
    }
    const mimeType = RECORDING_TYPES.find((type) => env.MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This browser cannot record a supported WebM or Ogg audio format. Use Chrome, Edge, Brave, or typed input.');
    const health = await env.fetch(healthUrl(), { signal: s.abort.signal });
    if (!health.ok) throw new Error('The transcription backend is unavailable. Start npm run server, or type below.');
    const config = await health.json();
    if (!config.configured) throw new Error(`${config.provider || 'Server'} transcription is not configured in the backend. Configure its API key and restart the server. Typed input remains available.`);
    if (config.mode === 'browser') throw new Error('Browser recognition is configured. Choose Browser recognition or Automatic in settings.');
    if (!active(s)) return;
    update({ provider: config.provider || 'Server', model: config.model, recognitionMode: config.mode || 'prerecorded' });
    if (!active(s)) return;
    update({ permission: 'requesting' });
    const stream = await env.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    // A permission dialog can finish after Stop or unmount. Release that late stream.
    if (!active(s)) { stream.getTracks().forEach((track) => track.stop()); return; }
    s.stream = stream;
    update({ permission: 'granted' });
    const recorder = new env.MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
    s.recorder = recorder;
    s.chunks = [];
    s.bytes = 0;
    recorder.ondataavailable = ({ data }) => {
      if (!active(s) || !data.size) return;
      s.bytes += data.size;
      if (s.bytes > MAX_AUDIO_BYTES) {
        cancel('Recording exceeded 5 MB. Try a shorter sentence.');
      } else s.chunks.push(data);
    };
    recorder.onerror = () => cancel('The audio recorder failed. Check the input device and try again.');
    recorder.onstop = async () => {
      if (!active(s) || s.uploaded) return;
      s.uploaded = true;
      release(s);
      update({ status: 'processing', notice: '' });
      const audio = new Blob(s.chunks, { type: recorder.mimeType || mimeType });
      s.chunks = [];
      if (!audio.size) { finish(s, '', 'No audio was recorded. Tap to speak and try again.'); return; }
      if (s.meterObserved && (s.voicedFrames || 0) < 3) { finish(s, '', 'No spoken words were detected. Try again or type below.'); return; }
      timer(s, () => cancel('Transcription timed out. Try a shorter recording.'), 50_000);
      try {
        const response = await env.fetch('/api/transcribe', {
          method: 'POST', headers: { 'Content-Type': audio.type, ...(language !== 'en' ? { 'X-Zirumi-Language': language } : {}) }, body: audio, signal: s.abort.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The transcription provider failed. Try again or type below.');
        if (typeof result.transcript !== 'string') throw new Error('The transcription server returned an invalid response.');
        finish(s, result.transcript, result.transcript.trim() ? '' : 'No spoken words were detected. Try again or type below.');
      } catch (error) { if (active(s)) finish(s, '', error.message); }
    };
    recorder.start(250);
    started(s);
    update({ status: 'listening', notice: `Recording for ${config.provider || 'server'} transcription. Stop listening to convert your speech; maximum ${config.maxRecordingSeconds || 45} seconds.` });
    meter(s);
    timer(s, () => stop(), (config.maxRecordingSeconds || 45) * 1000);
  }
  async function start(mode = 'auto') {
    if (disposed || session) return;
    const s = { timers: new Set(), abort: new AbortController(), finals: new Map(), stopping: false };
    session = s; // Lock before any async work or native onstart event.
    let engine = language !== 'en' ? 'server' : mode === 'native' && Recognition ? 'native' : mode === 'server' || nativeUnavailable ? 'server' : 'native';
    update({ status: 'starting', engine, liveText: '', error: '', notice: '' });
    s.startupTimer = timer(s, () => cancel('Microphone startup timed out. Check site permissions and try again.'), 30_000);
    try {
      if (mode === 'native' && language !== 'en') throw new Error('Choose Automatic or Recorded speech for this language. Sarvam handles the selected Indian language.');
      if (mode === 'native' && !Recognition) throw new Error('Browser speech recognition is unavailable. Choose Recorded speech or use typed input.');
      if (mode === 'auto' && env.fetch && !nativeUnavailable) {
        // Backend routing decides Automatic. Explicit Browser remains available.
        const response = await env.fetch(healthUrl(), { signal: s.abort.signal });
        if (!response.ok) throw new Error('The transcription backend is unavailable. Choose Browser recognition in settings or use typed input.');
        const config = await response.json();
        if (!active(s)) return;
        if (config.prefersServer) engine = 'server';
        update({ engine });
      }
      if (engine === 'native') native(s);
      else await record(s);
    } catch (error) {
      if (!active(s)) return;
      const denied = ['NotAllowedError', 'SecurityError'].includes(error.name);
      const unavailable = ['NotFoundError', 'NotReadableError'].includes(error.name);
      if (denied) update({ permission: 'denied' });
      detachRecognition(s);
      try { s.recognition?.abort(); } catch { /* Already ended. */ }
      finish(s, '', denied ? ERROR_TEXT['not-allowed'] : unavailable ? ERROR_TEXT['audio-capture'] : error.message);
    }
  }
  function stop() {
    const s = session;
    if (!s || s.stopping) return;
    s.stopping = true;
    if (snapshot.status === 'starting') { cancel(); return; }
    if (s.recorder) {
      update({ status: 'processing' });
      if (s.recorder.state !== 'inactive') s.recorder.stop();
      release(s); // Do not keep the microphone alive during upload.
    } else if (s.recognition) {
      update({ status: 'processing' });
      try { s.recognition.stop(); } catch { cancel(); return; }
      timer(s, () => {
        detachRecognition(s);
        try { s.recognition.abort(); } catch { /* Already stopped. */ }
        finish(s, finalText(s));
      }, 1500);
    } else cancel();
  }
  function cancel(error = '') {
    const s = session;
    if (!s) return;
    s.abort.abort();
    detachRecognition(s);
    try { s.recognition?.abort(); } catch { /* Already stopped. */ }
    if (s.recorder) {
      s.recorder.onstop = s.recorder.ondataavailable = s.recorder.onerror = null;
      if (s.recorder.state !== 'inactive') s.recorder.stop();
    }
    finish(s, '', error);
  }
  return {
    setLanguage(value) { cancel(); language = value; update({ language, provider: value === 'en' ? null : 'Sarvam', model: null, error: '', notice: '' }); },
    start, stop, cancel, getSnapshot: () => snapshot,
    reset() { cancel(); update({ status: 'idle', error: '', notice: '', liveText: '', level: 0 }); },
    setPermission: (permission) => update({ permission }),
    dispose() { disposed = true; cancel(); },
  };
}
