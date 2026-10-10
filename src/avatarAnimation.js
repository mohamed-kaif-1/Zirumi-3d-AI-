// Day 2 procedural movement. Day 3 can replace this with phoneme/audio timing.
export function mouthOpenForState(state, seconds) {
  return state === 'SPEAKING' ? 0.15 + 0.65 * Math.abs(Math.sin(seconds * 10)) : 0;
}
