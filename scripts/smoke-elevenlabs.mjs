// Explicit live provider verification; --synthesize uses ElevenLabs character quota.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { ELEVENLABS_VOICES } from '../src/elevenLabsVoices.js';
import { getAvatarVoiceProfile } from '../src/avatarVoiceProfiles.js';
import { isMp3 } from '../server/tts.js';

const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const statusResponse = await fetch(`${base}/api/tts/status`, { signal: AbortSignal.timeout(30_000) });
assert.equal(statusResponse.status, 200);
const metadata = await statusResponse.json();
const results = { date: new Date().toISOString(), metadata, synthesis: [], liveSynthesisVerified: false };
await mkdir('verification/female-avatars', { recursive: true });
const report = () => writeFile('verification/female-avatars/elevenlabs-results.json', JSON.stringify(results, null, 2));
await report();
if (!metadata.configured) {
  console.log('NOT VERIFIED: ELEVENLABS_API_KEY is missing. Exact mappings are configured; live voice metadata and synthesis require the server key.');
  exitMissing();
} else {
  for (const [id, config] of Object.entries(ELEVENLABS_VOICES)) {
    const voice = metadata.avatars[id];
    assert.equal(voice.voiceId, config.voiceId);
    console.log(JSON.stringify({ avatarId: id, voiceId: voice.voiceId, name: voice.name, available: voice.available, labels: voice.labels, highQualityModels: voice.highQualityModels, model: metadata.model, error: voice.error }));
    assert.equal(voice.available, true, voice.error);
    if (process.argv.includes('--synthesize')) {
      const response = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId: id, text: getAvatarVoiceProfile(id).sample }), signal: AbortSignal.timeout(50_000) });
      if (!response.ok) throw new Error((await response.json()).error);
      const audio = Buffer.from(await response.arrayBuffer());
      assert.equal(response.headers.get('x-echo-voice-id'), config.voiceId);
      assert.equal(response.headers.get('content-type'), 'audio/mpeg');
      assert.ok(isMp3(audio));
      results.synthesis.push({ avatarId: id, voiceId: config.voiceId, name: voice.name, bytes: audio.length, format: metadata.outputFormat, model: metadata.model, live: true });
      await report();
    }
  }
  results.liveSynthesisVerified = results.synthesis.length === 3;
  await report();
  console.log(results.liveSynthesisVerified ? 'PASS real ElevenLabs synthesis for all three exact voices. Audio was not stored.' : 'Metadata verified. Run with --synthesize for real TTS verification.');
}
function exitMissing() { process.exitCode = 2; }
