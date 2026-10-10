const paths = {
  mic: ['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z', 'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6'],
  send: ['m12 19 0-14m-6 6 6-6 6 6'],
  arrow: ['M4 12h16m-6-6 6 6-6 6'],
  chevron: ['m7 10 5 5 5-5'],
  close: ['m6 6 12 12M6 18 18 6'],
  sparkle: ['m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z'],
  volume: ['M11 5 6 9H3v6h3l5 4Z', 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'],
  mute: ['M11 5 6 9H3v6h3l5 4Z', 'm16 9 6 6m0-6-6 6'],
  play: ['m9 5 11 7-11 7Z'],
  stop: ['M7 7h10v10H7Z'],
  settings: ['M4 7h16M4 17h16M9 4v6m6 4v6'],
  hand: ['M8 13V7a2 2 0 0 1 4 0v5-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v8c0 4-2 7-6 7h-1c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l3 3'],
  lock: ['M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z', 'M12 14v3'],
  reset: ['M4 10a8 8 0 1 1 1 8M4 4v6h6'],
  movement: ['M2 12c4-10 6 10 10 0s6 10 10 0'],
  moon: ['M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z'],
  camera: ['M3 6h12v12H3ZM15 10l6-4v12l-6-4'],
  expand: ['M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6'],
  copy: ['M9 9h12v12H9ZM15 9V3H3v12h6'],
  check: ['m5 12 4 4L19 6'],
  chat: ['M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z'],
  upload: ['M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  shield: ['M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7ZM8 12l3 3 5-6'],
};
export default function Icon({ name, size = 18, className = '' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{(paths[name] || paths.sparkle).map((d, i) => <path key={i} d={d} />)}</svg>;
}
