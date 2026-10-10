// Public identities only. Provider credentials belong exclusively to the server.
export const ELEVENLABS_VOICES = Object.freeze({
  sky: Object.freeze({ voiceId: 'tnSpp4vdxKPjI9w0GnoV', displayName: 'Luna', intendedStyle: 'Cute, playful and youthful' }),
  nova: Object.freeze({ voiceId: 'kPzsL2i3teMYv0FxEYQ6', displayName: 'Mira', intendedStyle: 'Soft, calm and elegant' }),
  ember: Object.freeze({ voiceId: 'hpp4J3VqNfWAUOO0d1Us', displayName: 'Zyra', intendedStyle: 'Energetic, confident and expressive' }),
});

export const isElevenLabsAvatar = id => Object.hasOwn(ELEVENLABS_VOICES, id);
