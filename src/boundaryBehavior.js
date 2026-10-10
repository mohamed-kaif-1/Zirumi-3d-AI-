export const ANIMATION_STATES = Object.freeze(['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'GESTURING', 'USER_INTERACTION', 'BOUNDARY_RESPONSE', 'RETURN_TO_IDLE']);
export const BOUNDARY_PROFILES = Object.freeze({
  default: { amplitude: .12, frequency: 1.6, duration: 1.7, expression: .17 },
  sky: { amplitude: .15, frequency: 2, duration: 1.5, expression: .22 },
  nova: { amplitude: .10, frequency: 1.4, duration: 1.8, expression: .14 },
  ember: { amplitude: .16, frequency: 1.7, duration: 1.6, expression: .24 },
});
export function boundaryPhrase(language) {
  if (language === 'ta-IN') return 'வேண்டாம், தயவுசெய்து என் தனிப்பட்ட எல்லைகளை மதியுங்கள்.';
  if (language === 'hi-IN') return 'नहीं, कृपया मेरी व्यक्तिगत सीमाओं का सम्मान करें।';
  return 'No, please respect my boundaries.';
}
/** An explicit mode plus a stationary primary click is required. Hover/scroll/drag cannot refuse. */
export class DeliberateInteraction {
  constructor() { this.enabled = false; this.down = null; this.nextAllowed = 0; }
  begin(event, now) {
    this.down = this.enabled && event.button === 0 && event.isPrimary !== false ? { id: event.pointerId, x: event.clientX, y: event.clientY, time: now } : null;
  }
  cancel() { this.down = null; }
  finish(event, now, region) {
    const down = this.down; this.down = null;
    if (!this.enabled || !down || down.id !== event.pointerId || event.button !== 0 || now - down.time > 650 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || region !== 'private' || now < this.nextAllowed) return false;
    this.nextAllowed = now + 6500; return true;
  }
}
