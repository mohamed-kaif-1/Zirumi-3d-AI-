# ZIRUMI Phase 3 — 2026-10-10

**PHASE PASSED — automated mandatory functional checks**  
**ZIRUMI READY FOR FINAL TESTING — local application**

The existing application now supports English through Deepgram → Groq → Cartesia,
optional consented Mem0 retrieval, and explicitly selected Tamil, Hindi and Indian
English through Sarvam → Groq → Sarvam. All three phases passed their mandatory
automated live checks in order. The current application remains local; nothing
was publicly deployed. Physical microphone quality and human listening/native
speaker review remain final user checks, rather than claimed test results.

## Implemented behavior

Settings exposes English, Tamil, Hindi and Indian English. The active language is
also visible in the conversation header. Auto detection is deliberately absent
because it has not been configured/verified. Changing language cancels unfinished
capture, replies, synthesis and playback; completed session history and approved
Mem0 preferences remain available. Browser recognition is explicitly an English
option. Regional languages use recorded Sarvam speech with a 30-second/5 MB bound.
Transcripts enter the existing conversation owner exactly once after tracks stop.

Groq receives the server-owned character personality and explicit native-language
instruction. Tamil/Hindi replies must contain predominantly native script before
speech is requested; unsupported/wrong-language results produce actionable errors.
Optional backend per-language Groq model overrides provide an explicit alternative
model path. There is no automatic translation, model retry or English substitution.

Sarvam returns validated, bounded PCM WAV audio. Existing audio playback, preview
cache, stop/cancel, RMS mouth animation, facial expressions and gestures are reused.
Preview caches include language and voice/model identity. Stale metadata from an old
language cannot select an English voice after switching. No provider audio or
microphone recordings are saved. Two synthetic, non-sensitive test greetings were
written only to the Windows temporary directory as virtual-microphone fixtures.

## Models, account access and voices

| Route | Transcription | Conversation | Synthesis |
| --- | --- | --- | --- |
| English | Deepgram `nova-3` | Groq `openai/gpt-oss-20b` | Cartesia `sonic-3.6` |
| Tamil | Sarvam `saaras:v4` | Same Groq model | Sarvam `bulbul:v3` |
| Hindi | Sarvam `saaras:v4` | Same Groq model | Sarvam `bulbul:v4-flash` |
| Indian English | Sarvam `saaras:v4` | Same Groq model | Sarvam `bulbul:v4-flash` |

All selected models passed actual requests with this account. All twelve Sarvam
character/language assignments generated real speech and played in the browser.
Exact speaker names and primary documentation references are in PHASE3_SETUP.md.
Tamil explicitly uses documented v3 feminine voices because the current v4 Flash
Tamil catalog offers male personas. This preserves the requested character identity
without an automatic fallback. Voices differ across language/provider routes.

No additional credentials are needed for the implemented local paths. Groq,
Deepgram, Cartesia, ElevenLabs, Mem0 and Sarvam keys remain in the ignored backend
environment; no key values are recorded here. Remaining credit balances, account
billing allowances and provider retention policies are not certified. The system
does not promise all services are free. Tests used short phrases, cached completed
previews and no automatic paid retries.

## Actual live verification

- Phase 1: real English recorded speech → Deepgram → Groq → Cartesia in Chromium;
  all four distinct English voices, RMS-driven loaded VRMs, safe turn-taking,
  single transcript submission and microphone exclusion passed.
- Phase 2: real Mem0 opt-in save/view, new browser-context persistence, Aira/Luna
  recall, second-user isolation, disabled recall, individual delete and scoped
  clear passed. Temporary test preferences were cleaned up.
- Phase 3: real Sarvam transcription → Groq → Sarvam browser conversations passed
  in Tamil, Hindi and Indian English. Each had one user/assistant pair, released
  capture tracks, disabled capture during output, actual audio energy and loaded
  VRM mouth motion. All four voices per language passed real previews, cache reuse
  and Stop Speaking. No provider responses were mocked in these browser tests.
- Informal Tamil with “AI” and mixed Hindi-English speech passed actual synthesis
  of short fixture input, Saaras transcription and native-script Groq replies.
  Sarvam transliterated “AI” into the native script; the meaning was retained.
  These synthetic samples do not certify all accents, dialects or conversational
  language quality.
- One approved astronomy preference was saved under a fresh test identity, recalled
  by Luna in English and Aira in Tamil with empty session histories, then cleared.
  This verified shared authorized memory across both avatar and language switches.
- Mobile language settings fit a 390×844 viewport, expose the provider accurately,
  retain selection when reopened and restore the English route without paid calls.

Evidence is retained under ignored `verification/phase3/`: three `*-browser-live.json`
files, screenshots, `native-routing-live.json`, `code-mixed-live.json`,
`cross-language-memory-live.json`, `browser-ui.json`, `checks.json` and
`git-checkpoint.json`. Phase 1/2 evidence remains in their corresponding directories.
Virtual microphones supplied prerecorded fixtures; physical microphone use was
not verified. Browser runtime errors were absent in the passing runs.

## Observed latency

| Route | Four preview HTTP responses | Browser transcription |
| --- | --- | --- |
| Tamil | 2,174 / 2,872 / 2,812 / 3,769 ms | 1,300 ms |
| Hindi | 5,240 / 2,307 / 2,313 / 2,119 ms | 1,087 ms |
| Indian English | 3,096 / 2,905 / 2,224 / 2,951 ms | 956 ms |

Short direct Tamil/Hindi transcription took 526/231 ms, and Groq generation took
512/365 ms. Cross-language memory-backed Groq generation took 578/491 ms, excluding
retrieval. These are individual observations, not guarantees. Browser software
rendering and playback time are excluded from the preview HTTP figures. Full
recorded turns include recording, upload, retrieval, generation and synthesis.

## Tests, defects and limits

The final suite contains 137 passing tests; lint and the production build passed.
Mocked unit/integration cases cover exact multipart/JSON contracts, twelve speaker
assignments, language validation, wrong-script rejection, corrupt/null/oversized
provider responses, credentials/quota failures, HTTP routing without a Groq STT
credential, language-specific cache separation, stale metadata/reply suppression
and microphone cancellation/30-second limits. Existing memory scoping, transport,
chat, audio, VRM loading, hand IK, reset and animation tests remain passing.

Defects addressed: language was previously absent from speech requests and preview
cache keys; old voice metadata could race a language change; recorder limits were
fixed at 45 seconds; the voice UI assumed only English providers; locale query
routes were unavailable. These now have explicit routing/cancellation and coverage.
A Windows shell encoding issue affected only the initial inline test fixture;
Unicode-safe source/escapes fixed it before that failed fixture reached a provider.
Two inserted UI separators were also corrected and visually checked.

The first Indian-English run completed all four previews and its real speech flow,
but the very short “Hello!” reply failed the mouth threshold under software
rendering. Its failed artifact is retained. A speech-only follow-up passed with
actual RMS and mouth movement (peak mouth 0.991), reusing prior successful preview
evidence to avoid four additional synthesis calls. No timing guarantees or
unverified diagnosis are claimed for that short-response measurement.

All four installed VRM files remain byte-identical, and the rig/IK/animation source
was not changed in Phase 3. Branding, character IDs, avatar selection, custom VRM
import, voice settings, chat, responsive layout, camera/fullscreen, hand controls
and session history remain. The build/source scan found no configured credentials.

Optional WebSocket transcription and streaming playback are not implemented;
status reports buffered prerecorded/request-response modes accurately. Public
deployment still requires authenticated HTTPS, secure cookies, durable/shared
identity storage and per-user limits as documented in DEPLOYMENT.md. The local
anonymous cookie is not a public account system. Final user testing should cover
the physical microphone, chosen voices, dialect/pronunciation and short replies
on the user's GPU/browser.

## Checkpoints and changed files

Phase 1 checkpoint: `fc4e5e0`. Phase 2 checkpoint: `6be196d`. Phase 3's final clean
commit is recorded in `verification/phase3/git-checkpoint.json` and is the commit
titled `Complete Sarvam language routes and three-phase verification`. Earlier
checkpoints remain available for review or a separate rollback branch; no automatic
reset is performed.

Phase 3 adds `server/services/sarvam.js`, server/client language metadata and guards,
Sarvam tests, real browser/UI harnesses, and PHASE3_SETUP/REPORT. It updates the
existing server routes, chat/TTS validation, shared speech JSON handling, microphone,
conversation and speech controllers, preview playback/cache, settings, conversation
language label and voice badges. README, DEPLOYMENT and `.env.example` describe the
active paths. Phase 3 adds no dependencies and keeps existing deployment commands.
