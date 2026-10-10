# ZIRUMI

Your World. Your Companion. React/Vite and Three.js companion studio with four
female VRM characters, session conversation memory, voice input, speech output,
natural animation and interactive hand IK.

**Groq handles conversation.** English uses real Deepgram prerecorded speech
recognition and Cartesia WAV output. Tamil, Hindi and Indian English use Sarvam
speech recognition and synthesis, selected explicitly in Settings. All four
characters have distinct documented voices. Optional Mem0 memory stores only
preferences approved in Memory controls, scoped to an opaque backend identity.
Providers never change silently after an error. Legacy ElevenLabs, Groq Whisper
and browser speech remain available through explicit English configuration.

See [PHASE1_REPORT.md](PHASE1_REPORT.md), [PHASE2_REPORT.md](PHASE2_REPORT.md),
[PHASE3_REPORT.md](PHASE3_REPORT.md), [MODEL_QUALITY_REPORT.md](MODEL_QUALITY_REPORT.md),
and [AVATAR_MOTION_REPORT.md](AVATAR_MOTION_REPORT.md) for audits and verification.
Setup: [PHASE1_SETUP.md](PHASE1_SETUP.md), [PHASE2_SETUP.md](PHASE2_SETUP.md), and
[PHASE3_SETUP.md](PHASE3_SETUP.md). Public hosting requirements remain in
[DEPLOYMENT.md](DEPLOYMENT.md). Earlier migration reports are historical.

Choose **Settings → Conversation Language** for English, Tamil (தமிழ்), Hindi
(हिन्दी) or Indian English. The choice is saved for your next visit. The
**Language: …** conversation button and the link in **Voice settings** open the
same control; **Browser fallback** is a separate voice preference. See
[LANGUAGE_SELECTOR_FIX_REPORT.md](LANGUAGE_SELECTOR_FIX_REPORT.md) for the
discoverability repair and fresh Tamil/Hindi browser verification.

## Run on Windows

Use Node.js 22.12+ in the existing nested application directory:

```powershell
cd "C:\Users\moham\OneDrive - ELCOT\Projects\3d Avatar\echo-avatar-day1\Zirumi"
npm install
# Only for a new setup. Preserve any existing configured .env.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run server
```

In another terminal in the same directory, run `npm run dev`. Open
http://127.0.0.1:5173. For a production preview, keep the backend running, run
`npm run build` and `npm run preview`, and open http://127.0.0.1:4173.
Vite proxies the existing `/api` routes to the loopback backend. A static build
alone does not host the API.

## Characters

| Character | Stable ID | Personality | Cartesia assignment |
| --- | --- | --- | --- |
| Aira | `default` (`original` API alias) | Sweet, friendly, caring | `CARTESIA_VOICE_AIRA` |
| Luna | `sky` | Cute, playful, youthful | `CARTESIA_VOICE_LUNA` |
| Mira | `nova` | Calm, elegant, intelligent | `CARTESIA_VOICE_MIRA` |
| Zyra | `ember` | Energetic, confident, futuristic | `CARTESIA_VOICE_ZYRA` |

All four English Cartesia assignments passed real synthesis and browser playback. Exact legacy ElevenLabs
identities remain in `server/voiceRegistry.js`; select that provider explicitly
to retain its existing voices. Aira retains browser speech on that legacy route
until `AIRA_VOICE_ID` is configured.

The real original ID is `default`. Model binaries, paths, voice IDs and existing
`echo_selected_avatar` / `echo_avatar_voice_settings_v1` storage keys stay stable.
The previous avatar remains visible until a new model loads successfully.
Failed and stale loads cannot replace the current selection. Switching preserves
completed conversation history and restores each character's saved voice settings.
Imported VRMs remain local to the page session and use Aira's profile.

Model sources and terms are in [asset attribution](public/models/ATTRIBUTION.md).
The original model retains its restrictive embedded terms; the three added
models are CC0. Self-hosted Manrope and Outfit include their OFL notices in
`public/fonts/`. The migration does not change model assets, meshes or bones.

## Server environment

| Variable | Default / purpose |
| --- | --- |
| `GROQ_API_KEY` | Required backend-only Groq credential |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1`; only the official HTTPS origin is accepted |
| `GROQ_CHAT_MODEL` | `openai/gpt-oss-20b`; verified against account models before generation |
| `GROQ_STT_MODEL` | `whisper-large-v3-turbo`; verified before transcription |
| `GROQ_STT_LANGUAGE` | Optional ISO two-letter hint; unset detects language automatically |
| `TRANSCRIPTION_PORT` | Existing backend port `3001` |
| `ELEVENLABS_API_KEY` | Backend-only credential for the three exact assigned voices |
| `AIRA_VOICE_ID` | Optional exact ElevenLabs identity for Aira; absent keeps her existing browser voice |
| `ELEVENLABS_TTS_MODEL` | `eleven_multilingual_v2` |
| `ELEVENLABS_FALLBACK` | `none` by default; `browser` permits visible reply fallback only, never cloud preview fallback |
| `ELEVENLABS_ZERO_RETENTION` | `false`; enable only for authorized enterprise accounts |
| `ZIRUMI_ALLOWED_ORIGINS` | Optional exact HTTPS origins for a secured deployment proxy |
| `DEFAULT_STT_PROVIDER` / `DEFAULT_TTS_PROVIDER` | New-install `deepgram` / `cartesia`; explicit legacy/browser switches |
| `DEEPGRAM_API_KEY` / `DEEPGRAM_STT_MODEL` | Server-only credential / `nova-3` |
| `CARTESIA_API_KEY` / `CARTESIA_TTS_MODEL` | Server-only credential / `sonic-3.6` |
| `CARTESIA_API_VERSION` | Pinned REST contract `2026-08-14` |
| `CARTESIA_VOICE_AIRA/LUNA/MIRA/ZYRA` | Four distinct verified catalog UUIDs; no fabricated defaults |
| `MEM0_API_KEY` | Optional hosted memory; every browser must explicitly opt in |
| `SARVAM_API_KEY` / `SARVAM_STT_MODEL` | Server-only Indian-language speech / `saaras:v4` |
| `SARVAM_TTS_MODEL_TA/HI/EN` | Explicit `bulbul:v3` / `bulbul:v4-flash` / `bulbul:v4-flash` |
| `GROQ_CHAT_MODEL_TA/HI/EN` | Optional explicit per-language alternative models |

Keep credentials in the ignored backend `.env` or deployment secret store.
Never use a `VITE_` prefix. Node reads `.env` at startup; process environment
values take precedence. Restart the backend after changing keys or model settings.
No Gemini/Google or xAI key is required. Undici is a backend-only HTTP transport
dependency for bounded DNS caching. It is absent from the frontend bundle.

## Conversation and audio pipeline

1. Typed input and final native/recorded transcripts use one conversation owner.
   Interim text is never submitted. Requests lock before asynchronous work.
2. Browser-native recognition remains an explicit choice. Automatic mode follows
   the configured backend route using `getUserMedia`/`MediaRecorder`.
   Recorded WebM/Opus or Ogg is posted to `/api/transcribe` after Stop.
3. The server validates MIME, container signature and the 5 MB limit, then sends
   raw container bytes to Deepgram or, when explicitly selected, multipart audio
   to Groq's `/audio/transcriptions` endpoint. Credentials stay server-side. Empty results never
   become chat messages. The running audio meter rejects measured silence before
   upload when available; Whisper no-speech scores supplement this check.
4. `/api/chat` validates the selected ID and at most six completed user/assistant
   pairs, then calls `/chat/completions` with chronological roles and a
   server-controlled character instruction, explicit native-language request and at
   most three relevant consented Mem0 facts. Failed, pending and cancelled turns
   never enter memory. Clear aborts work and resets context. No server conversation
   store or provider-side response chain is used.
5. The reply enters the existing speech/animation pipeline. `/api/tts` resolves
   configured Cartesia UUIDs, selected Sarvam speakers or legacy ElevenLabs IDs on the server. An explicit
   browser route also remains available. Actual MP3/WAV playing/ended events control speech state and Web
   Audio amplitude drives the mouth; browser speech uses its existing lifecycle.
6. Stop, new speech, switching and unmount clean up audio and invalidate stale
   callbacks. Microphone tracks end before upload, AI generation and playback.
   Recording never restarts automatically after a reply.

Chat success returns `{ reply, metadata }`; transcription returns
`{ transcript, metadata }`. Existing frontend text fields remain compatible.
Metadata contains only provider, configured model, latency, numeric usage and
audio duration when available. Errors return a non-2xx status and safe `error`
text. Raw provider responses, reasoning, credentials and account details do not
reach the browser or logs.

The server retains loopback binding, exact host/origin checks and no permissive
CORS. Limits are 16 chat, 10 transcription and 10 TTS POST attempts/minute,
shared two-request AI concurrency, and 45-second provider deadlines. Provider
discovery is cached for five minutes. Calls are not retried automatically. Chat
caps output at 2,048 tokens and asks for concise spoken answers; GPT-OSS uses low
reasoning effort. Web/X search and paid tools are not enabled.

## Verification

```powershell
npm test
npm run lint
npm run build
# Live Groq models, four introductions, Kaif recall and invalid-key handling:
npm run test:live
# Optional known spoken WebM/Ogg fixture for live STT too:
node --env-file=.env scripts/smoke-groq.mjs C:\path\spoken.webm
# Independent live ElevenLabs verification; synthesis consumes account quota:
node scripts/smoke-elevenlabs.mjs --synthesize
```

Browser verification scripts use the existing separate Playwright installation
under `%TEMP%/echo-browser-verification` and Chromium under
`%LOCALAPPDATA%/ms-playwright/chromium-1243`; they add no production dependency.
`browser-zirumi.mjs --live` uses actual Groq chat. Without `--live`, chat is a
declared fixture. `browser-zirumi-microphone.mjs` uses actual capture/recording
with a synthesized WAV virtual microphone and live Groq by default; this does
not prove physical microphone hardware. `browser-elevenlabs.mjs` uses a
synthetic MP3 unless `--live` is supplied; fixture lip-sync proves playback and
animation plumbing, not ElevenLabs synthesis or voice quality.

Provider references: [Groq chat](https://console.groq.com/docs/text-chat),
[Groq transcription](https://console.groq.com/docs/speech-to-text),
[Groq models](https://console.groq.com/docs/models),
[Groq data handling](https://console.groq.com/docs/your-data), and
[ElevenLabs setup](ELEVENLABS_SETUP.md).
