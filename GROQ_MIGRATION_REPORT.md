# ZIRUMI provider migration — 10 October 2026

**Verdict: MIGRATION PARTIALLY COMPLETE.** The user explicitly changed the
requested destination from xAI/Grok to **Groq**. Live Groq chat and recorded
transcription pass. The existing ElevenLabs integration is preserved, but its
configured credential returns access denied, preventing verification of the
complete live ElevenLabs voice pipeline. No public HTTPS deployment was made.

## 1. Files changed

| Area | Files |
| --- | --- |
| Provider service and server personalities | New `server/services/groq.js`, `server/errors.js`, `server/personalities.js` |
| Existing API routes | `server/chat.js`, `server/transcription.js`, `server/index.js` |
| Existing frontend | `src/voiceController.js`, `src/conversationController.js`, `src/ConversationPanel.jsx`, `src/App.jsx`, `src/useConversation.js` |
| Configuration and documentation | Ignored local `.env`, `.env.example`, `package.json`, `README.md`, `ELEVENLABS_SETUP.md`; new `GROQ_SETUP.md`, `DEPLOYMENT.md`, this report |
| Automated tests | `test/chat.test.js`, `test/transcription.test.js`, `test/voiceController.test.js`; new `test/groq.test.js` |
| Live and browser verification | New `scripts/smoke-groq.mjs`, `scripts/verify-distribution.mjs`, `scripts/browser-groq-recovery.mjs`; updated existing smoke/avatar/voice/ElevenLabs/ZIRUMI browser scripts |
| Evidence | `verification/groq/`, current `verification/zirumi/`, `verification/voices/live-groq-results.json`; actual-model thumbnails regenerated at their existing paths |

No new application or provider SDK dependency was introduced. VRM binaries,
voice IDs, model URLs, existing API paths and saved preference keys stay intact.

## 2. Gemini dependencies removed

Both direct Gemini `generateContent` implementations, Gemini role/response/audio
parsing, Google API authentication headers and active Gemini frontend notices
were replaced. The obsolete three Gemini environment settings were removed from
local `.env` and `.env.example`. No `@google/genai` or `@google/generative-ai`
dependency existed, so no unrelated Google package was removed. Historical
reports remain historical; their earlier Gemini results are not current evidence.

The restarted backend successfully passed live Groq verification after removal
of the old environment settings. Runtime sources contain no active Gemini or
xAI endpoint or key dependency.

## 3–6. Models, endpoints and configuration

| Item | Active value |
| --- | --- |
| Provider | Groq, not xAI/Grok |
| Chat model | `openai/gpt-oss-120b` |
| STT model | `whisper-large-v3-turbo` |
| Account discovery | `GET https://api.groq.com/openai/v1/models` |
| Text generation | `POST https://api.groq.com/openai/v1/chat/completions` |
| Recorded transcription | `POST https://api.groq.com/openai/v1/audio/transcriptions` |
| Frontend API contracts | Existing `/api/chat`, `/api/transcribe`, chat/transcription health routes and ElevenLabs routes |

Both selected models were present and active in actual authenticated account
discovery. The server verifies account model access before billable work and
caches/coalesces discovery for five minutes. There is no silent model or provider
substitution. Model settings are configurable; optional GPT-OSS reasoning
parameters are omitted for other models.

Required server secrets: `GROQ_API_KEY` and the separate `ELEVENLABS_API_KEY` for
assigned cloud speech. Configuration: `GROQ_BASE_URL`, `GROQ_CHAT_MODEL`,
`GROQ_STT_MODEL`, optional `GROQ_STT_LANGUAGE`, existing ElevenLabs options and
`TRANSCRIPTION_PORT`. Secured HTTPS proxy origins can be explicitly added using
`ZIRUMI_ALLOWED_ORIGINS`. See [setup](GROQ_SETUP.md) and
[deployment configuration](DEPLOYMENT.md).

The endpoint formats and WebM/Ogg support follow
[Groq's API reference](https://console.groq.com/docs/api-reference) and
[speech documentation](https://console.groq.com/docs/speech-to-text).

## 7. Migration and preserved behavior

One conversation engine serves Aira (`default`), Luna (`sky`), Mira (`nova`) and
Zyra (`ember`). The actual original ID is `default`, retained for compatibility.
The central server personality registry uses the existing distinct character
instructions and shared accuracy, uncertainty and requested-tone behavior.
Clients cannot supply arbitrary system instructions, provider settings or voices.

Memory remains session-managed: at most six completed user/assistant pairs,
chronological roles, bounded text and no provider response-chain duplication.
Pending/failed/cancelled turns are excluded; Clear aborts work and resets context;
switching retains completed history and originating-character reply labels.
No conversation database or server-side session storage was added.

Native recognition and automatic recorded fallback remain. Recorded WebM/Opus
and Ogg are validated and uploaded as multipart to Groq STT with the file last.
The optional language hint precedes the file. Empty recordings/transcripts and
measured silence never become chat input. Audio never enters text generation.
Microphone tracks are released before upload, chat and playback. Retry now
respects the selected Recorded speech mode after permission recovery.

Safe errors cover authentication, access, balance, quota, invalid recording,
network, unavailable providers and cancellation/deadlines. No automatic paid
retry or search is enabled. Limits: 16 chat, 10 STT and 10 TTS attempts/minute;
two combined active AI requests; 5 MB audio; 45-second provider deadlines.
Chat caps completion at 2,048 tokens and uses low GPT-OSS reasoning effort.
Logs/response metadata contain latency and allowlisted numeric usage. Actual
upstream status codes are logged without raw provider bodies. Monetary fields
are retained only if returned; no cost estimate was invented.

## 8. Live text-generation results

**Passed real Groq calls.** All four characters introduced themselves using their
own names and ZIRUMI. Luna acknowledged “My name is Kaif”; Mira subsequently
answered “Your name is Kaif” using supplied completed history. The initial live
reply introduced Aira as a friendly companion on ZIRUMI. A separate real browser
test preserved Aster from Zyra to Mira across actual model switching.

A deliberately invalid test token received actual Groq HTTP **401**; the service
converted it into a safe **503 authentication error**, without exposing the token
or provider body. Controlled balance/quota failures and actual browser offline /
reconnect behavior also passed, with no automatic retries and clean recovery.

Evidence: `verification/groq/live-results.json`,
`verification/voices/live-groq-results.json`,
`verification/zirumi/browser-live-results.json`, and
`verification/groq/browser-recovery-results.json`.

## 9. Live recorded-audio transcription results

**Passed actual capture/MediaRecorder and real Groq STT/chat.** Chromium received
a Windows-synthesized spoken WAV through its virtual microphone and uploaded
real WebM/Opus recordings: 41,012 and 28,481 bytes in the development repeated-recording
run. Two recordings produced exactly two transcription requests, two chat
requests and two user/assistant turns. Denial created no live stream; granting
permission and pressing Try again recovered using Recorded speech. Tracks were
ended before each chat request. Actual browser playback start/stop and microphone
isolation passed for Aira's retained native voice.

The first transcript spelled the synthesized proper names “Ira” and “Astor”;
the second produced “Aira” and “Aster”. This is real recognition output, not an
edited transcript. The repeating virtual audio source can repeat spoken words
inside a single transcript; it did not create duplicate conversation turns.
The final local production preview at http://127.0.0.1:4173 also passed live STT/chat, native playback/stop, denied permission, recovery and repeated recordings after the old Gemini settings were removed. Stop was exercised with the actual keyboard action. No physical microphone or real-user speech accuracy was verified.

Evidence: `verification/groq/development-microphone-results.json`,
`verification/zirumi/microphone-results.json` and microphone screenshots.
The recording is a synthetic fixture, while capture APIs, encoding, provider
transcription, generation and native playback are real. Unit tests independently
verify silence rejection, repeated recording, no-device/permission errors,
unsupported/oversized input, cleanup and stale callbacks.

## 10. ElevenLabs results

The unchanged mapping is:

| Character | Speech identity |
| --- | --- |
| Aira | Retained browser default and saved settings |
| Luna | `tnSpp4vdxKPjI9w0GnoV` |
| Mira | `kPzsL2i3teMYv0FxEYQ6` |
| Zyra | `hpp4J3VqNfWAUOO0d1Us` |

**Live ElevenLabs verification is blocked by access denied.** Metadata names are
still unverified; the report does not claim synthesis access, voice suitability,
audible distinctness or a complete live mic → Groq → ElevenLabs pipeline.
Evidence: `verification/female-avatars/elevenlabs-results.json` and current
`verification/groq/live-results.json` TTS metadata. The explicitly configured
browser fallback remains visible; it does not represent the three ElevenLabs
identities as verified voices. Four actual native previews started and finished in one production-preview run: Aira used Microsoft David; the other three used Microsoft Zira. That broader native harness subsequently timed out on another Zyra model load, so it is not reported as a fully passing suite. A later run also hit a first-preview startup deadline. These headless software-rendering timing limits remain recorded; physical browser/audio verification is required.

**Synthetic MP3 regression passed** for Luna, Mira and Zyra: real browser MP3
decoding, playing/ended events, Web Audio RMS, rendered-avatar mouth amplitude,
silence, stop, switching, gallery and mobile. Peak RMS was about 0.239 and peak
mouth opening about 0.955 for each. This is playback/animation evidence, not
ElevenLabs synthesis evidence. See
`verification/groq/audio/browser-fixture-audio-results.json`.

## 11. Avatar, animation and UI regression results

All four real VRMs passed rig/expression checks, natural blink, speaking/idle
mouth, held-pose priority, unchanged bone translations, constrained mouse hand
dragging and Reset Pose. Corrupt models preserve the current character; retry
works; delayed older loads cannot replace newer selections. Saved voice settings,
selection persistence, clipboard, history, clear, camera and fullscreen passed.

The MP3 regression caught and fixed a subscription timing issue introduced by
the UI refactor: child effects subscribed before the conversation owner existed.
The hook now queues listeners and reconnects them when the owner is created,
including StrictMode recreation, while retaining stable callbacks. Actual
rendered-mouth measurements passed afterward for all three cloud-voice avatars.

ZIRUMI branding, dark interface and existing layouts are preserved. Development
and production preview passed widths 320, 390, 768, 1024 and 1440, mobile chat
expansion, keyboard dialog focus/Escape/restore and reduced-motion preferences.
The production offline/recovery check also verified fullscreen keeps the
microphone available. Successful runs recorded no page errors.

## 12. Build, lint and security

- `npm test`: **94 passed, 0 failed**.
- `npm run lint`: **passed**.
- `npm run build`: **passed**, 619 modules; app JS 86.18 kB / 28.81 kB gzip.
- Production credential scan: **zero configured secret matches**, no `.env`
  shipped and no active Gemini/xAI endpoint or authentication dependency.
- All four built VRM binaries exactly match the source hashes. The three new
  model hashes also match the previously recorded source/license attribution.
- Existing host/origin restrictions remain; optional deployment origins require
  exact HTTPS values. Provider credentials cannot be redirected to another host.

Evidence: `verification/groq/distribution-results.json`, automated test output
and production-preview browser artifacts. No new production dependencies were
added. The package's existing internal name is retained.

## 13–14. Deployment and remaining actions

**Production build and local preview are verified; public HTTPS deployment is
not performed or claimed.** There is no supplied hosting target/public URL.
Deployment instructions preserve frontend/API paths and require a secured proxy,
authentication, quotas and server-only secrets.

Required remaining actions:

1. Configure an ElevenLabs credential with voice/model read and TTS permissions,
   account access to all three exact assigned IDs, and available quota. Restart
   the backend and rerun `smoke-elevenlabs.mjs --synthesize` and the browser's
   `--live` ElevenLabs checks. Do not substitute voice IDs.
2. Replace the Groq credential disclosed through the conversation with a newly
   issued backend-only key before continued use/deployment.
3. Verify a physical microphone, real listening quality and the complete live
   ElevenLabs pipeline once voice access is available.
4. Supply/configure a real secured HTTPS hosting target, then test the public app.
   The original VRM's restrictive embedded license remains a deployment limit;
   the migration does not change those asset rights.

**Final verdict: MIGRATION PARTIALLY COMPLETE — live Groq chat/STT verified;
live ElevenLabs access and public deployment remain outstanding.**
