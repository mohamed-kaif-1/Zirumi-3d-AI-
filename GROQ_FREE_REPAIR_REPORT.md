# ZIRUMI GroqCloud repair — 2026-10-10

The existing app uses GroqCloud for conversation and recorded transcription.
No xAI or Gemini credential is required. ElevenLabs and the four character
identities remain intact. Nothing was deployed publicly.

## Diagnosis

At the start of this request, the running backend was the interrupted xAI
migration: `/api/chat/status` reported `provider: "xAI Grok"`, `configured: false`
and `model: "grok-4.7"`. The local Groq credential existed, but chat did not use
it. Missing xAI credentials blocked that configuration. Chat now uses the
configured Groq credential and official GroqCloud API.

An independent network problem was also reproduced during real speech checks:
the backend logged `ENOTFOUND` with HTTP 502 for Groq transcription. Later
connections produced `UND_ERR_CONNECT_TIMEOUT` and `ECONNRESET`. DNS/TCP checks
and authenticated requests subsequently succeeded. These are intermittent
network failures, not evidence of an invalid Groq key, unavailable chat model
or a requirement to pay xAI. The historical screenshot has no detailed logs,
so its precise original failure cannot be established retrospectively.

Successful DNS results are now cached for 60 seconds and concurrent lookups
coalesce. Failed DNS results are not cached. The transport retains normal
HTTPS hostname/certificate checks and automatic address-family selection, with
IPv4-first ordering. It uses no hardcoded IP, DNS server change or automatic
provider-request retry. Model discovery has a 15-second deadline within the
45-second request budget. Persistent network outages remain external to the app.
Completed Groq HTTP connections close to avoid later uploads reusing sockets
that the upstream or local network has silently expired.

## Actual configuration

Backend `.env`:

`C:\Users\moham\OneDrive - ELCOT\Projects\3d Avatar\echo-avatar-day1\echo-avatar-day1\.env`

```dotenv
GROQ_API_KEY=<existing backend credential; never copy into frontend>
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_CHAT_MODEL=openai/gpt-oss-20b
GROQ_STT_MODEL=whisper-large-v3-turbo
```

The real account models endpoint returned HTTP 200 and listed both selected
models. The backend checks account discovery before generation/transcription.
An unavailable configured model fails explicitly; there is no silent substitution.
Groq publishes [free-plan limits](https://console.groq.com/docs/rate-limits) for
these models. The app does not alter account plan or select a paid service tier.
Account quotas and a working internet connection remain necessary.

| Purpose | Actual endpoint |
| --- | --- |
| Discovery | `GET https://api.groq.com/openai/v1/models` |
| Conversation | `POST https://api.groq.com/openai/v1/chat/completions` |
| Recorded speech | `POST https://api.groq.com/openai/v1/audio/transcriptions` |

The browser contracts remain `/api/chat` and `/api/transcribe`, proxied by Vite
to `127.0.0.1:3001` for both development and production preview. Groq REST
requests use server-only Bearer credentials and bounded JSON/multipart parsing.

## Changes

- `server/chat.js`: restored Groq generation, four server-controlled personality
  instructions, ordered memory and GPT-OSS low reasoning without returning
  hidden reasoning; default model is now GPT-OSS 20B.
- `server/index.js`: uses Groq credentials for both AI routes; reports accurate
  health state and sanitized provider/endpoint/model/status/code/duration logs.
  Numeric provider Retry-After headers propagate safely. Cancellation, request
  limits, input size limits and loopback/origin restrictions remain enforced.
- `server/services/groq.js`: distinguishes credentials, model access, rate limits,
  invalid audio/request, DNS, TLS, socket failure and timeout. Only recognized
  error codes are retained; raw provider messages and user prompts are not logged.
- New `server/services/groqTransport.js`: bounded successful DNS cache and
  dedicated Undici dispatcher. `package.json` and `package-lock.json` add Undici
  only for backend transport; no new frontend dependency is imported.
- `server/transcription.js`: preserves MediaRecorder WebM/Ogg and adds PCM/float
  WAV upload validation (RIFF length, format chunk and sample data), still capped
  at 5 MB. Real audio is sent as multipart; no transcript is fabricated.
- `src/conversationController.js`, `src/useConversation.js` and
  `src/ConversationPanel.jsx`: retry reuses the original failed turn, locks
  overlapping requests, clears errors on success and retains completed memory.
  Health checks use a fresh cancellation signal after a previous timeout.
- `.env`, `.env.example`, `README.md`, `GROQ_SETUP.md`: accurate Groq defaults and
  setup. The example contains no configured credentials. Unused files from the
  interrupted xAI migration were removed.
- Tests: `test/chat.test.js`, `test/groq.test.js`,
  `test/groqDiagnostics.test.js`, `test/groqTransport.test.js`,
  `test/transcription.test.js`, `test/conversation.test.js`.
- Verification scripts: `scripts/smoke-groq.mjs`, `scripts/smoke-chat.mjs`,
  `scripts/browser-groq-recovery.mjs`, new `scripts/browser-groq-pipeline.mjs`.

No VRM binary, voice ID, visual styling, facial/IK/body animation implementation
or avatar selection implementation was changed.

## Verification and limits

| Check | Result / evidence |
| --- | --- |
| Backend and Vite proxy | Running; model status reports Groq / GPT-OSS 20B |
| Real models and four personalities | HTTP 200; `verification/groq/live-results.json` |
| Real conversation memory | Luna → Mira name recall passed in live API checks |
| Original typed prompt | HTTP 200 through production Vite proxy; `verification/groq-free/original-prompt-results.json` |
| Real WAV transcription | Whisper HTTP 200 and real reply from the returned transcript; live-results JSON |
| Real browser recorded speech | Live Groq STT and reply passed; real getUserMedia/MediaRecorder with a synthesized WAV virtual microphone; `verification/zirumi/microphone-results.json` |
| Microphone permissions and repeat capture | Denial, permission recovery, track release before playback and two recordings without duplicate turns passed in that browser check |
| Browser failure recovery | Actual offline state plus explicitly controlled auth/quota/balance responses; original bubble reused, errors cleared, no automatic retries; `verification/groq/browser-recovery-results.json` |
| Zyra real audio and actual avatar mouth | Real ElevenLabs MP3, real Audio/WebAudio/RMS, Stop and character switch passed; `verification/permanent-voices/browser/browser-live-ember-audio-results.json` |
| Full Whisper → Groq → ElevenLabs browser run | Not verified: the latest combined attempt received transcription HTTP 504 before chat; earlier combined attempts received 502. `verification/groq-free/browser-pipeline-results.json` preserves the failure separately from passed individual stages |
| Unit/integration tests | `npm test`: 111 passed, zero failed; provider fixtures are not live API proof |
| Lint | `npm run lint` passed |
| Production build | `npm run build` passed, 619 modules; app JS 88.33 KB / gzip 29.51 KB |
| Secrets and assets | `scripts/verify-distribution.mjs` passed: zero credential matches, no .env shipped, all four VRM binaries preserved |

In-app Browser could not bootstrap in this environment. Browser checks used the
existing standalone Chromium harness instead. Physical microphone hardware,
physical speaker listening and audible voice distinctness are not claimed.
Earlier successful tests do not erase later network failures.

## ElevenLabs

| Character | Preserved identity | Latest live result |
| --- | --- | --- |
| Aira | Existing browser default; optional `AIRA_VOICE_ID` unchanged | Native playback passed; no configured ElevenLabs ID |
| Luna | `tnSpp4vdxKPjI9w0GnoV` | Official synthesis HTTP 402 `payment_required`; safe backend 503 |
| Mira | `kPzsL2i3teMYv0FxEYQ6` | Official synthesis HTTP 402 `payment_required`; safe backend 503 |
| Zyra | `hpp4J3VqNfWAUOO0d1Us` | Backend HTTP 200, valid MP3 51,453 bytes; real playback and mouth movement passed |

The account still denies voice/model catalog reads with `missing_permissions`.
Successful Zyra synthesis is recorded separately from unverified catalog names.
These are existing ElevenLabs restrictions; no replacement voice, account plan
change or silent browser fallback was introduced for the three cloud characters.
`verification/permanent-voices/live-elevenlabs-results.json` records exact results.

## Restart

Stop the existing backend with Ctrl+C in its terminal, then:

```powershell
cd "C:\Users\moham\OneDrive - ELCOT\Projects\3d Avatar\echo-avatar-day1\echo-avatar-day1"
npm run server
```

In a second terminal:

```powershell
cd "C:\Users\moham\OneDrive - ELCOT\Projects\3d Avatar\echo-avatar-day1\echo-avatar-day1"
npm run dev
```

Open `http://127.0.0.1:5173`. For production preview use `npm run build`, then
`npm run preview` with the backend running; open `http://127.0.0.1:4173`.
Do not overwrite the existing `.env` with the example. No additional AI key or
payment is requested. After changing backend settings, restart the backend.
