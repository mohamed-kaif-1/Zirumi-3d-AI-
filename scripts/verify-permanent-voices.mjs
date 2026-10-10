// Live account verification, never a mocked synthesis claim. No credentials or
// raw provider errors are written. --synthesize spends character quota if ready.
import { mkdir, writeFile } from 'node:fs/promises';
import { createVoiceRegistry } from '../server/voiceRegistry.js';
import { getAvatarVoiceProfile } from '../src/avatarVoiceProfiles.js';
import { isMp3 } from '../server/tts.js';

const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const registry = createVoiceRegistry();
const key = process.env.ELEVENLABS_API_KEY;
const directory = 'verification/permanent-voices';
await mkdir(directory, { recursive: true });
const metadata = await (await fetch(`${base}/api/tts/status`, { signal: AbortSignal.timeout(30000) })).json();
const report = { date: '2026-10-10', url: base, provider: 'ElevenLabs', metadata, voices: [], liveSynthesisVerified: false, audibleDistinctnessVerified: false };
for (const [avatarId, voice] of Object.entries(registry)) {
  const result = { avatarId, character: voice.displayName, configuredVoiceId: voice.voiceId, pending: voice.configurationPending, metadataVerified: false, synthesisVerified: false };
  if (voice.voiceId && key) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/voices/${voice.voiceId}`, { headers: { 'xi-api-key': key }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      result.providerStatus = response.status;
      if (response.ok) {
        const data = await response.json();
        result.metadataVerified = data.voice_id === voice.voiceId;
        result.actualName = typeof data.name === 'string' ? data.name.slice(0, 200) : null;
        result.category = typeof data.category === 'string' ? data.category : null;
      } else {
        const data = await response.json().catch(() => null);
        result.error = 'The account did not grant access to the exact assigned voice.';
        if (data?.detail?.status === 'missing_permissions') result.permissionError = 'voices_read';
      }
    } catch { result.error = 'The provider could not verify this voice.'; }
  }
  if (process.argv.includes('--synthesize')) {
    try {
      const response = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId, text: getAvatarVoiceProfile(avatarId).sample }), signal: AbortSignal.timeout(50000) });
      result.ttsStatus = response.status;
      if (response.ok) {
        const audio = Buffer.from(await response.arrayBuffer());
        result.synthesisVerified = response.headers.get('x-echo-voice-id') === voice.voiceId && response.headers.get('content-type') === 'audio/mpeg' && isMp3(audio);
        result.audioBytes = audio.length;
        // Audio stays ephemeral; no proprietary samples are published or stored.
      } else { const data = await response.json(); result.synthesisError = data.error; }
    } catch { result.synthesisError = 'Live synthesis request failed or timed out.'; }
    // Diagnose provider synthesis independently when metadata gating blocks the
    // app route. This never bypasses the production route's allowlist/guards.
    if (!result.synthesisVerified && voice.voiceId && key) {
      try {
        const direct = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text: getAvatarVoiceProfile(avatarId).sample, model_id: metadata.model }), redirect: 'error', signal: AbortSignal.timeout(45000) });
        result.directProviderSynthesisStatus = direct.status;
        if (direct.ok) {
          const bytes = Buffer.from(await direct.arrayBuffer()); result.directProviderSynthesisVerified = direct.headers.get('content-type')?.startsWith('audio/mpeg') && isMp3(bytes); result.directAudioBytes = bytes.length;
        } else {
          const data = await direct.json().catch(() => null);
          const codes = ['missing_permissions', 'invalid_api_key', 'quota_exceeded', 'paid_plan_required', 'payment_required', 'subscription_required', 'voice_not_found'];
          result.directProviderReason = codes.includes(data?.detail?.status) ? data.detail.status : 'unspecified_provider_rejection';
        }
      } catch { result.directProviderSynthesisVerified = false; }
    }
  }
  report.voices.push(result);
  console.log(JSON.stringify(result));
}
const available = report.voices.filter(v => v.configuredVoiceId);
report.liveSynthesisVerified = available.length > 0 && available.every(v => v.synthesisVerified);
report.allFourElevenLabsVerified = report.voices.length === 4 && report.voices.every(v => v.synthesisVerified);
await writeFile(`${directory}/live-elevenlabs-results.json`, JSON.stringify(report, null, 2));
if (!report.allFourElevenLabsVerified) { process.exitCode = 2; console.log('INCOMPLETE: see per-character live results. No audible distinctness claim.'); }
