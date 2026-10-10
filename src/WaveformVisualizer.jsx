import { useEffect, useRef } from 'react';

// Real RMS where available; a lifecycle indicator for browser speech otherwise.
export default function WaveformVisualizer({ state, audioLevel = 0, subscribeSpeechAmplitude, color = '#B9A1F8', reducedMotion = false }) {
  const canvasRef = useRef(null);
  const levels = useRef({ speech: null, mic: 0 });
  useEffect(() => { levels.current.mic = audioLevel; }, [audioLevel]);
  useEffect(() => subscribeSpeechAmplitude?.(value => { levels.current.speech = value; }), [subscribeSpeechAmplitude]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    let frame, phase = 0;
    const active = ['LISTENING', 'SPEAKING', 'THINKING', 'TRANSCRIBING'].includes(state);
    const render = () => {
      if (!reducedMotion) phase += 0.09;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const measured = state === 'SPEAKING' && levels.current.speech !== null;
      const amplitude = state === 'SPEAKING' ? measured ? levels.current.speech : 0.35 : state === 'LISTENING' ? levels.current.mic || 0.16 : active ? 0.14 : 0;
      ctx.fillStyle = color;
      ctx.globalAlpha = active ? 0.8 : 0.25;
      for (let i = 0; i < 19; i++) {
        const shape = measured || reducedMotion ? 0.3 + Math.sin(i * 1.7) ** 2 * 0.7 : 0.3 + Math.sin(phase + i * 0.6) ** 2 * 0.7;
        const height = 2 + Math.min(1, amplitude) * 20 * shape;
        ctx.beginPath(); ctx.roundRect(i * 4.4, (24 - height) / 2, 2.3, height, 1.1); ctx.fill();
      }
      if (active) frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [state, color, reducedMotion]);
  return <span className="waveform-container" aria-hidden="true"><canvas ref={canvasRef} width={84} height={24} /></span>;
}
