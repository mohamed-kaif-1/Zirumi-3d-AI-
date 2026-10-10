# Phase 1 configuration

Use this existing app directory: `echo-avatar-day1/Zirumi`. Secrets belong only
in its ignored backend `.env`. Preserve the existing Groq and ElevenLabs keys.
Restart `npm run server` after environment changes. Run `npm run dev` separately.

The primary configuration for a new installation is:

```env
DEFAULT_STT_PROVIDER=deepgram
DEFAULT_LLM_PROVIDER=groq
DEFAULT_TTS_PROVIDER=cartesia
DEFAULT_LANGUAGE=en
DEEPGRAM_API_KEY=
DEEPGRAM_STT_MODEL=nova-3
CARTESIA_API_KEY=
CARTESIA_TTS_MODEL=sonic-3.6
CARTESIA_API_VERSION=2026-08-14
CARTESIA_VOICE_AIRA=
CARTESIA_VOICE_LUNA=
CARTESIA_VOICE_MIRA=
CARTESIA_VOICE_ZYRA=
GROQ_API_KEY=
GROQ_CHAT_MODEL=openai/gpt-oss-20b
```

The local installation now selects `DEFAULT_TTS_PROVIDER=cartesia` after real
catalog/synthesis/browser verification. ElevenLabs remains an explicit migration
setting rather than a silent runtime fallback.
For legacy transcription set `DEFAULT_STT_PROVIDER=groq`. Either speech service
can also be explicitly set to `browser`; installed browser voices may be shared.
Cartesia never automatically substitutes ElevenLabs or browser speech. The legacy
ElevenLabs `ELEVENLABS_FALLBACK=browser` setting, if deliberately enabled, affects
replies only and shows a notice; previews always verify their assigned provider.

Automatic microphone mode uses the backend route. Browser recognition and
Recorded speech remain explicit choices under Settings. Deepgram currently
receives a complete recording after Stop; this is not live WebSocket recognition.
Cartesia audio is fully buffered before playback; it is not streamed playback.

Use a valid Cartesia key to inspect account-accessible voices without synthesis:

```powershell
node --env-file-if-exists=.env scripts/inspect-cartesia-voices.mjs
```

Choose four different actual catalog UUIDs matching the characters' styles.
Do not copy ElevenLabs IDs. Metadata checks require active, public or owned
private, feminine, native-English voices. Catalog visibility does not establish
billing permission or audible quality: synthesis and listening checks are required.
The CLI inspects at most five catalog pages and does not autoassign voices.

Before consuming credits, check your Deepgram/Cartesia account balances and model
access. No claim is made that these providers are free. Checks do not retry billed
requests automatically. The smallest recorded representative sentence is enough.

```powershell
npm test
npm run lint
npm run build
# Configuration/catalog gate; no speech synthesis:
node --env-file-if-exists=.env scripts/verify-phase1.mjs
# Opt-in real backend checks; one recording, one Groq reply and four TTS samples:
node --env-file-if-exists=.env scripts/verify-phase1.mjs --synthesize "C:\path\short-spoken.wav"
```

The gate can accept a recent unmocked `browser-phase1-live.mjs` result matching
the configured four voices. Human voice-quality review and physical microphone
checks remain separate. It does not save generated audio or private transcripts.
Separate development browser harnesses require the
existing Playwright installation and Chromium fixture setup:

```powershell
# Synthetic HTTP responses and WAV tones, actual audio/VRM animation:
node scripts/browser-phase1.mjs
# Real Deepgram + Groq with a virtual microphone; output disabled:
node scripts/browser-phase1-input.mjs
```

Check `/api/providers/status`, `/api/transcription/status`, `/api/chat/status`
and `/api/tts/status`. Configured keys, verified metadata and successful synthesis
are separate states. `X-Zirumi-Request-Id` correlates safe request logs; logs omit
keys, prompts, transcripts and audio. Speech deadlines are 45 seconds, catalog
reads 15 seconds; frontend Stop aborts pending work and stale responses cannot play.

Official contracts checked for this adapter:
[Deepgram prerecorded audio](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded),
[Cartesia bytes](https://docs.cartesia.ai/api-reference/tts/bytes),
[Cartesia voice metadata](https://docs.cartesia.ai/api-reference/voices/get),
[Cartesia catalog](https://docs.cartesia.ai/api-reference/voices/list),
[Sonic models](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest).

Mem0/Sarvam variables in `.env.example` reserve future configuration only.
There is no persistent-memory or Indian-language integration in Phase 1.
