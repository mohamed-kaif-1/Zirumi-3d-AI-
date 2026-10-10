# ZIRUMI Phase 1 — 2026-10-10

**PHASE PASSED — automated mandatory functional checks**  
**At this checkpoint: Phases 2 and 3 were pending. Current readiness: [PHASE3_REPORT.md](PHASE3_REPORT.md).**

Phase 1 is implemented inside `echo-avatar-day1/Zirumi`. The real Deepgram →
Groq → Cartesia browser conversation passed with a spoken virtual microphone,
actual provider responses and actual VRM playback. All four assigned voices
generated real speech and drove mouth animation. Physical microphone quality and
a human listening review remain unverified. Phase 2 Mem0 may now proceed; Phase 3
Sarvam remained gated on Phase 2 at this historical checkpoint. The final report
documents the subsequently completed phases.

## Latest live verification

The replacement Cartesia credential passed read-only catalog verification.
The four actual public, active, feminine native-English voices are Ariana for
Aira (ec1e269e-9ca0-402f-8a18-58e0e022355a), Pippa for Luna
(81cd8d19-45e7-47b2-ad0e-bcd94f557ad0), Shana for Mira
(548172e3-7581-406b-8788-f5346fb992de), and Joanie for Zyra
(a7b8d8fa-f6e5-4908-900e-0c11d1d82519). Their catalog descriptions match warm,
bright/playful, composed and confident styles respectively. Subjective voice
quality has not been rated by a human.

`verification/phase1/browser-live-speech-results.json` records all four HTTP 200
previews, actual RMS/mouth movement and silence closure, cached-preview Stop,
then one Deepgram transcription, one Groq reply and one Cartesia reply for Luna.
The transcript appeared once, capture was excluded during playback, and microphone
tracks were released. The response was “Hi there! 🌟”. Safe backend latencies:
Deepgram 2,830 ms for 4.26 seconds of captured speech, Groq 725 ms, Cartesia reply
993 ms. Preview synthesis took Luna 842/Aira 578/Mira 701/Zyra 633 ms. The original
browser artifact's `responseMs` includes playback; future harness runs record
response and total preview times separately. No extra billed run was used to rename it.

The first catalog request rejected the old credential with HTTP 401. After the
user replaced it, real WAV output exposed unknown-length RIFF/data sentinels
(`0xffffffff`) plus a LIST metadata chunk. The adapter now repairs only these
sentinels after the bounded response is complete, preserving metadata and rejecting
corrupt chunks, incomplete sample frames and invalid PCM encoding. A regression
test covers the actual layout. Two short 15-character probes exposed this issue;
the later browser run consumed four short previews and one reply, without retries.
Remaining credits and account plan limits are unknown.

A duplicate DEFAULT_TTS_PROVIDER setting was removed so the restarted backend
actually selects Cartesia. All credential values and explicit legacy options
were preserved. The latest full suite passes 122 tests; lint/build and the fresh
distribution credential/model scan pass. Earlier verification below remains
evidence for preserved UI/IK behavior and the implementation baseline.

## Implementation and active configuration

Modular `server/services/deepgram.js`, `cartesia.js` and `speechHttp.js` fit the
existing server structure. `server/providerConfig.js` owns explicit routing.
Existing `/api/chat`, `/api/transcribe` and `/api/tts` contracts are preserved;
status routes expose actual selected providers, verification and audio modes.

- Deepgram: Nova-3, raw validated WebM/Ogg/WAV bytes, documented Token auth,
  final prerecorded transcript extraction, bounded JSON, empty/silence handling.
- Groq: retained GPT-OSS 20B, actual account model discovery, low reasoning effort,
  bounded completed history and server-owned personalities. `original` is now a
  chat alias for stable `default`; persisted character and model IDs stay intact.
- Cartesia: Sonic 3.6, pinned API version 2026-08-14, documented bytes REST API,
  server-owned distinct UUID mapping, active/access/gender/native-English catalog
  checks, documented generation speed/emotion and validated PCM16 WAV output.
  Model availability is established only after successful synthesis, not assumed
  from documentation or a configured key. Empty/ineligible profiles stay pending.
- Playback: same Audio/WebAudio owner handles MP3 and WAV; real playing/ended/RMS
  events drive the existing VRM controller. Preview caching includes provider,
  voice and model, with four-entry/16 MB bounds. Replies are not cached to disk.
- Reliability: cancellation/stale-response protection, microphone release before
  upload, explicit provider switches, safe status-specific errors, no automatic
  billed retries, bounded response sizes, deadlines, correlation IDs and safe logs.

The supplied Deepgram credential was configured server-side and live-tested.
Groq/ElevenLabs credentials were preserved. Current local routing is
**Deepgram → Groq → Cartesia output** after real verification. New-install defaults
also select Deepgram/Cartesia. No error
silently changes to another provider. Legacy Groq Whisper and explicit browser
recognition remain available through configuration/settings.

Optional Deepgram WebSocket recognition and streamed audio playback are not
implemented or advertised. The mandatory prerecorded/normal Cartesia pipeline
must be live-verified first. This build uses push-to-talk HTTP and buffered audio.
No word/phoneme timing is invented. No new dependencies or trained models were added.

## Verification

| Check | Result / evidence |
| --- | --- |
| Baseline | 111 tests, lint and build passed; verification/phase1/BASELINE.md and baseline-test.log |
| Current tests | 122 passed, 0 failed; verification/phase1/test-results.log |
| Lint / production build | Passed; 619 modules; build.log |
| Credentials / VRM distribution | Three configured credential values absent from frontend; no environment files shipped; all four VRM binaries byte-identical; verification/groq/distribution-results.json |
| Live Deepgram direct | Passed, real 5.71-second spoken WAV fixture, 1,744 ms; deepgram-live-results.json |
| Live browser capture / Groq | Passed with real getUserMedia, MediaRecorder and provider responses; one transcription request, one initial chat turn, microphone released; browser-live-input-results.json |
| Live cross-avatar context | Aira reply followed by Mira correctly answering “Your name is Aster.” No persistent memory claimed |
| Live browser STT latency | 2,733 ms for 15.66-second actual captured audio; Chromium virtual microphone loops the short sample |
| Live Groq latency | Initial response 1,106 ms; recall 923 ms, from safe backend request logs |
| Simulated Cartesia playback | All four actual loaded VRMs, real WAV decoding, RMS mouth amplitude, silence closure, Stop/cancel, preview cache and mobile passed; browser-cartesia-fixture-results.json |
| Browser hand controls | Retry run logged actual mouse dragging, reach-limit and Reset Pose passing for all four avatars; browser-regression-retry.log |
| Broader UI regression | Passed: session history, clipboard, invalid/stale avatar recovery, preferences, clear, 320/390/768/1024/1440 layouts, keyboard dialogs and reduced motion; browser-ui-regression.log and verification/zirumi/browser-ui-only-fixture-results.json |
| Real Cartesia | Replacement key/catalog and all four speech outputs passed; browser-live-speech-results.json and provider-gate.json |
| Physical microphone | Not verified; browser capture used a known synthesized spoken fixture |
| Full speech-to-speech gate | Passed using real providers and a virtual microphone; physical microphone and human listening quality remain unverified |

Provider HTTP unit/integration tests use clearly synthetic UUIDs and PCM fixtures.
They cover documented authentication/payloads, silence/malformed transcripts,
container/MIME/size validation, credential independence, ineligible voice blocking,
quota/auth/billing errors, cancellation, no retries, no secret/raw-body leakage,
provider metadata and correlation headers. Existing turn-taking, IK, model,
history and ElevenLabs tests continue to pass. Playback test tones establish
animation integration only; they do not establish four distinct real voices.

The virtual microphone supplied repeating sample audio during a slow software
rendering run. Repeated words inside that one provider transcript were kept
verbatim; only one transcript/chat turn was submitted. Deepgram rendered the
spoken character name as “Eira”; no fabricated correction was inserted. Physical
microphone quality and recognition of character names still need human checks.

## Preserved functionality and fixes

ZIRUMI branding, four characters, installed models, Three.js rendering, selector,
mouth animation, supported expressions, blinking, breathing, gestures, manual
hand/IK priority, Reset Pose, typed chat, session context, responsive layout and
voice controls remain. Model and animation source modules were not rewritten.
The existing browser rig harness regenerated the four character thumbnails from
their same models; model binaries and attribution are unchanged.

Fixed provider assumptions in microphone notices, voice settings, gallery labels,
speech metadata and MP3-only playback. Automatic recognition now honors configured
Deepgram instead of selecting browser recognition first. Explicit Browser can
still be selected. The legacy live Groq smoke script no longer tries to validate
Deepgram's model against Groq's catalog. README's moved app path was corrected,
and its missing deployment guide was added.

The first combined browser regression timed out during a model switch while
multiple software-rendered browser runs competed for resources. A sequential
retry verified all four rig/hand interactions; its remaining UI steps were
interrupted by the repeated attachment/new turn and continued separately.
An initial WAV harness completion check incorrectly inspected `audio.ended`
after the player had unloaded the source; it was corrected to observe the actual
ended event, after which all four playback checks passed. No fake audio events
were used to make those checks pass.

## Remaining blockers and readiness

1. Complete a human listening review and physical microphone checks. Automated
   real speech-to-speech and four-voice playback passed; subjective quality is
   not claimed verified. Remaining provider balances/plan limits are unknown.
2. Implement Mem0 now that Phase 1's mandatory functional gate passed. Sarvam
   remains gated on memory verification. Existing session history is not Mem0.
3. Optional streaming remains deferred; request-response audio works. Keep exact
   account-visible voice UUIDs and explicit legacy provider choices configurable.

Historical ElevenLabs account limitations remain: Luna/Mira returned provider
HTTP 402, Aira has no assigned cloud ID, and catalog read permissions were
restricted. This work did not consume additional ElevenLabs synthesis quota or
claim those voices now work. Intermittent Groq DNS/TCP failures remain a known
external risk, although the fresh Deepgram/Groq browser test passed.

Local development is available at http://127.0.0.1:5173 with the Node backend on
3001. No public deployment was performed. Production needs an authenticated
HTTPS backend/reverse proxy; current local global rate limits do not provide
multi-user authentication. No WebSocket host capability has been claimed.

## Files and rollback reference

New provider/config files: `server/providerConfig.js`, `server/services/deepgram.js`,
`server/services/cartesia.js`, `server/services/speechHttp.js`.

Updated runtime files: `server/index.js`, `server/chat.js`, `src/voiceController.js`,
`src/speechController.js`, `src/audioSpeechPlayer.js`, `src/VoiceSelector.jsx`,
`src/AvatarSelector.jsx`, `src/App.jsx`.

Checks/scripts: `test/phase1Providers.test.js`, updated audio/voice/conversation
tests, `scripts/inspect-cartesia-voices.mjs`, `scripts/verify-phase1.mjs`,
`scripts/browser-phase1.mjs`, `scripts/browser-phase1-input.mjs`, updated browser
regression/smoke/distribution helpers and verification artifacts.

Configuration/docs: ignored `.env` (credential values never reported), blank
`.env.example`, README.md, GROQ_SETUP.md, PHASE1_SETUP.md, DEPLOYMENT.md and this report.

Phase 1 now passed its automated live gate. The Git checkpoint is recorded in
`verification/phase1/git-checkpoint.json`. Baseline rollback source archive:
`verification/phase1/baseline-source.zip`. Current implementation checkpoint:
`verification/phase1/phase1-source.zip`. Both exclude the secret `.env`; preserve
it separately when restoring source. See PHASE1_SETUP.md for next steps.
