// Ephemeral MP3/WAV playback. Cancelling releases the request, audio, graph and URL.
export function createAudioSpeechPlayer({ env = globalThis, onState, onAmplitude, onFailure, onPlayback = () => {} }) {
  let active = null, sequence = 0;
  // Only fixed character samples are cached, in memory, never conversation audio.
  const previews = new Map();
  const boundaries = new Map();
  const rememberPreview = (key, blob) => {
    previews.delete(key); previews.set(key, blob);
    while (previews.size > 4 || [...previews.values()].reduce((sum, value) => sum + value.size, 0) > 16 * 1024 * 1024) previews.delete(previews.keys().next().value);
  };
  const supported = Boolean(env.Audio && env.fetch && env.URL?.createObjectURL);
  function cleanup() {
    if (!active) return;
    const old = active; active = null;
    old.abort.abort();
    env.clearTimeout(old.timer);
    if (old.frame !== null) env.cancelAnimationFrame?.(old.frame);
    if (old.audio) {
    old.audio.onplaying = old.audio.onended = old.audio.onerror = old.audio.onwaiting = old.audio.onpause = null;
      old.audio.pause(); old.audio.removeAttribute?.('src'); old.audio.load?.();
    }
    old.source?.disconnect(); old.analyser?.disconnect();
    old.context?.close().catch(() => {});
    if (old.url) env.URL.revokeObjectURL(old.url);
    onAmplitude(0);
    onPlayback(null);
  }
  function cancel() { sequence++; cleanup(); }
  function play(text, { avatarId, rate, presetId, volume, preview = false, boundary = false, voiceIdentity = '', provider = 'elevenlabs', language = 'en' }) {
    cancel();
    const job = { id: ++sequence, abort: new AbortController(), audio: null, url: null, frame: null, timer: null };
    active = job;
    const current = () => active === job;
    const fail = message => { if (current()) { cleanup(); onFailure(message); } };
    onAmplitude(0);
    onState({ status: 'starting', error: '', playbackEngine: provider, audioAnalysis: false });
    job.timer = env.setTimeout(() => fail('Speech preparation timed out. Try Preview again.'), boundary ? 15_000 : 50_000);
    (async () => {
      if (!supported) throw new Error('Audio speech playback is unavailable in this browser.');
      const cacheKey = JSON.stringify([provider, language, avatarId, voiceIdentity, text, Math.min(1.2, rate), presetId]);
      let blob = boundary ? boundaries.get(cacheKey) : preview ? previews.get(cacheKey) : null;
      let alignment = blob?.zirumiAlignment || null;
      if (!blob) {
        const response = await env.fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.zirumi.speech+json' }, body: JSON.stringify({ text, avatarId, rate: Math.min(1.2, rate), presetId, ...(language !== 'en' ? { language } : {}) }), signal: job.abort.signal });
        if (!current()) return;
        if (!response.ok) { let result; try { result = await response.json(); } catch { /* safe local error below */ } throw new Error(result?.error || 'Speech request failed.'); }
        if (/application\/json/i.test(response.headers.get('content-type') || '')) {
          if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) throw new Error('Speech response is oversized.');
          const data = await response.json();
          if (typeof data.audio !== 'string' || data.audio.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data.audio) || !/^audio\/(?:mpeg|wav)$/u.test(data.mimeType)) throw new Error('Speech response is invalid.');
          const decoded = (env.atob || globalThis.atob)(data.audio);
          blob = new Blob([Uint8Array.from(decoded, char => char.charCodeAt(0))], { type: data.mimeType });
          alignment = data.alignment; blob.zirumiAlignment = alignment;
        } else {
          if (!/^audio\/(?:mpeg|wav|wave|x-wav)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('The speech server did not return supported MP3 or WAV audio.');
          blob = await response.blob();
        }
      }
      if (!current()) return;
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('The speech server returned empty or oversized audio.');
      if (preview) rememberPreview(cacheKey, blob);
      if (boundary) {
        boundaries.delete(cacheKey); boundaries.set(cacheKey, blob);
        while (boundaries.size > 12 || [...boundaries.values()].reduce((sum, b) => sum + b.size, 0) > 4 * 1024 * 1024) boundaries.delete(boundaries.keys().next().value);
      }
      job.url = env.URL.createObjectURL(blob);
      job.audio = new env.Audio(job.url);
      job.audio.volume = volume;
      job.state = 'buffering';
      const playback = { text, alignment, provider, language, avatarId, pause: () => { if (current()) job.audio.pause(); }, resume: () => current() ? job.audio.play() : Promise.resolve(), read: () => ({ state: current() ? job.state : 'stopped', position: job.audio?.currentTime || 0, duration: job.audio?.duration || 0, rate: job.audio?.playbackRate || 1 }) };
      onPlayback(playback);
      const Context = env.AudioContext || env.webkitAudioContext;
      if (Context) {
        job.context = new Context();
        job.analyser = job.context.createAnalyser();
        job.analyser.fftSize = 512;
        job.source = job.context.createMediaElementSource(job.audio);
        job.source.connect(job.analyser); job.analyser.connect(job.context.destination);
        await job.context.resume();
        if (!current()) return;
      }
      const samples = job.analyser ? new Uint8Array(job.analyser.fftSize) : null;
      const analyse = () => {
        if (!current()) return;
        if (samples && job.state === 'playing') {
          job.analyser.getByteTimeDomainData(samples);
          let squared = 0;
          for (const sample of samples) squared += ((sample - 128) / 128) ** 2;
          onAmplitude(Math.min(1, Math.sqrt(squared / samples.length) * 4));
        }
        job.frame = env.requestAnimationFrame?.(analyse) ?? null;
      };
      job.audio.onplaying = () => {
        if (!current()) return;
        job.state = 'playing';
        env.clearTimeout(job.timer);
        job.timer = env.setTimeout(() => fail('Audio playback did not finish. Try Preview or Play reply again.'), Math.min(600_000, Math.max(30_000, text.length * 120 / rate)));
        onState({ status: 'speaking', audioAnalysis: Boolean(samples), analysisNotice: samples ? '' : 'Audio analysis is unavailable; speaking state works, but amplitude mouth animation is disabled.' });
        if (job.frame !== null) env.cancelAnimationFrame?.(job.frame);
        analyse();
      };
      job.audio.onwaiting = () => {
        if (!current()) return;
        job.state = 'buffering';
        if (job.frame !== null) env.cancelAnimationFrame?.(job.frame);
        job.frame = null;
        onAmplitude(0); onState({ status: 'starting' });
        env.clearTimeout(job.timer); job.timer = env.setTimeout(() => fail('Speech audio stalled. Try Preview again.'), 10_000);
      };
      job.audio.onended = () => { if (current()) { cleanup(); onState({ status: 'idle', previewAvatarId: null }); } };
      // At natural completion browsers queue pause before ended. Let ended own
      // cleanup so unloading the source cannot suppress its completion event.
      job.audio.onpause = () => { if (current() && !job.audio.ended) { job.state = 'paused'; onAmplitude(0); env.clearTimeout(job.timer); onState({ status: 'paused' }); } };
      job.audio.onerror = () => fail('The browser could not decode or play the speech audio.');
      env.clearTimeout(job.timer); job.timer = env.setTimeout(() => fail('Audio playback did not start. Click Preview or Play reply to try again.'), 10_000);
      await job.audio.play();
    })().catch(error => { if (current()) fail(error.name === 'NotAllowedError' ? 'Audio playback was blocked. Click Preview or Play reply to hear it.' : error.message || 'Speech audio could not start.'); });
    return true;
  }
  return { supported, play, cancel, pause() { active?.audio?.pause(); }, resume() { return active?.audio?.play(); }, dispose() { cancel(); previews.clear(); boundaries.clear(); } };
}
