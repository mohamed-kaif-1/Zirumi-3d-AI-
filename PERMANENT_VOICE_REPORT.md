# ZIRUMI permanent character voice integration

Verified 2026-10-10. Implemented directly in the existing application. **Groq is
preserved**, following the user's explicit clarification for this task. No xAI,
Gemini or provider migration was introduced.

**Implementation complete; live availability is partial.** Zyra's real
ElevenLabs synthesis, playback, mouth animation and typed Groq pipeline pass.
Luna and Mira require provider account-plan/payment access. Aira retains her
working browser voice until an exact ElevenLabs identity is configured.

## 1. Character-to-voice mapping

| Character | Stable application ID | Registered ElevenLabs identity | Current result |
| --- | --- | --- | --- |
| Aira | `default` (`original` accepted as a TTS alias) | None; configurable with `AIRA_VOICE_ID` | ElevenLabs pending; actual browser playback passed |
| Luna | `sky` | `tnSpp4vdxKPjI9w0GnoV` | Provider HTTP 402 `payment_required` |
| Mira | `nova` | `kPzsL2i3teMYv0FxEYQ6` | Provider HTTP 402 `payment_required` |
| Zyra | `ember` | `hpp4J3VqNfWAUOO0d1Us` | Actual `/api/tts` HTTP 200, valid MP3 and live browser playback |

All three supplied IDs remain unchanged. `default` is the actual pre-existing
Aira ID and remains the stored/frontend ID. No fabricated Aira voice was added.

## 2. Actual ElevenLabs metadata

GET `/v1/models` still returned HTTP 401 `missing_permissions` (`models_read`).
GET `/v1/voices/{exact_id}` returned HTTP 401 `missing_permissions`
(`voices_read`) for each assigned character after the user confirmed permissions.
Consequently actual provider voice names, descriptions, categories and catalog
model details remain **unverified**. The application does not label guessed names
as provider metadata. Zyra's successful real synthesis separately proves access
to her exact assigned voice and the configured synthesis model.

The server distinguishes missing catalog-read permission from TTS permission.
It permits a bounded synthesis attempt for the server-registered ID when only
catalog reads are restricted. It never accepts arbitrary client voice IDs or
claims metadata verification for that case. Authentication, model incompatibility,
restricted voices, billing and quota failures remain explicit errors.

## 3. Aira's current configuration

Neither `AIRA_VOICE_ID` nor the legacy backend `ELEVENLABS_VOICE_ID` is set.
Aira uses her existing saved/automatic browser identity. The production test
observed real `speechSynthesis` start/end events for **Microsoft David - English
(United States)**. Her gallery card clearly says ElevenLabs is pending.
The server module supports a valid exact `AIRA_VOICE_ID`, and frontend discovery
chooses ElevenLabs automatically when it is supplied. The first playback waits
for server configuration, preventing an accidental browser reply before Aira's
configured cloud identity has been resolved. Configured Aira is verified by
backend/controller fixtures, not claimed as live ElevenLabs success.

## 4. Files modified

- `server/voiceRegistry.js`: new reusable server-side registry and Aira env support.
- `server/tts.js`: four-character validation, alias, metadata/error handling,
  TTS-scoped key support, exact synthesis, redirect protection and deadlines.
- `server/index.js`: injects Aira voice configuration and the shared clock.
- `src/speechController.js`: discovers Aira identity, truthful readiness, explicit
  preview errors, cloud playback routing and cancellation.
- `src/audioSpeechPlayer.js`: bounded in-memory preview caching and silence on stall.
- `src/characterPersonalities.js`: the four exact requested preview sentences.
- `src/AvatarSelector.jsx`: voice readiness/error status alongside speaker controls.
- `src/VoiceSelector.jsx`: pending Aira and cloud-error notices.
- `src/App.jsx`: cancels previews on selector/editor dismissal or navigation.
- `test/tts.test.js`, `test/audioSpeechPlayer.test.js`, `test/avatarVoices.test.js`,
  `test/conversation.test.js`: configuration, actual routing, cache, cancellation,
  restricted-key, billing/quota and preserved-memory coverage.
- `scripts/verify-permanent-voices.mjs`, `scripts/browser-permanent-voices.mjs`,
  `scripts/browser-permanent-voices-live-state.mjs`: separate live and fixture checks.
- `.env.example`, `package.json`, `README.md`, `ELEVENLABS_SETUP.md`, this report:
  current setup, safe empty examples and reproducible verification.
- Ignored backend `.env`: retains the provided server credential; sets fallback to
  `none`. Credentials found in the shareable example were cleared.

VRM binaries, hand IK, animation controller, Groq chat/STT services and stored
avatar/settings identifiers remain intact. No production dependency was added.

## 5. TTS endpoint implementation

`POST /api/tts` accepts `{ avatarId, text }` plus bounded delivery settings. JSON
must fit 32 KB, with 1–6,000 characters. It validates the character against the
server registry, resolves its exact identity and calls
`https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with server-only
`xi-api-key`, `model_id: eleven_multilingual_v2` and `mp3_44100_128` output.
It returns validated `audio/mpeg` bytes with `Cache-Control: no-store`. Requests
containing client `voiceId` or other unrestricted fields are rejected.

Local host/origin checks, ten POST attempts/minute, two concurrent AI operations,
45-second deadline, disconnection cancellation and a 10 MB audio limit prevent
unlimited local synthesis. Provider redirects cannot carry the key to another
host. Permission, payment, quota, bad audio and cancellation errors are sanitized.
Provider bodies and credentials are never returned verbatim.

Cloud previews never substitute browser speech. The local setting requires
ElevenLabs for cloud replies as well; an explicitly configured browser fallback
remains available for replies only. Pending Aira retains her original browser
behavior. Exact samples are cached only in page memory, keyed by character,
resolved voice/model, text and delivery settings. Replies are not cached.

## 6. Voice switching and previews

All four configured-cloud paths pass backend/controller fixture tests. Requests
contain avatar IDs only. Switching aborts pending old synthesis, pauses old audio,
releases its graph/URL, zeros amplitude and invalidates late callbacks. Only the
latest character can play. Stop and selector/editor dismissal cancel playback.

The real production UI selected Luna, Mira and Zyra. Luna/Mira failures produced
visible retryable errors without browser substitution. Zyra returned actual MP3
and played. Aira's actual existing browser sample started and ended. Real previews
did not create chat messages. The selected indicator and readiness text remain
visible; raw voice IDs are absent from the gallery. Desktop and 390px mobile
gallery checks pass with no overflow or page errors.

The four-character synthetic MP3 browser run separately measured each actual
VRM controller's mouth, natural completion, Stop, switching and repeated preview
reuse. Its temporary Aira identity is test-only. It does not prove four live
ElevenLabs voices or audible distinctions. Fixture results are explicitly marked
`liveElevenLabs: false`.

## 7. Live audio synthesis and conversation

Zyra's exact voice returned valid MP3 through the actual backend: HTTP 200,
51,453 bytes in the final account smoke check. The live browser test used real
provider audio, observed playback completion, Stop and switching, and verified
that repeat previews reused one synthesis request.

The production browser also submitted a real typed message as Zyra. Groq returned
“Hi Cedar! Nice to meet you.” The actual `/api/tts` request used `ember` and exactly
that reply text, followed by real audio `playing`/`ended` events. Microphone input
was disabled during playback. After selecting Mira, Groq correctly answered
“Your name is Cedar.” Both conversation turns remained visible despite Mira's
unavailable cloud voice. The four live Groq introductions and Luna→Mira name recall
also pass the existing live smoke script. Character instructions remain factual,
safe and distinct. Recorded transcription still uses the existing Groq route;
physical microphone and end-to-end recorded-input cloud speech were not newly
verified in this task.

Luna and Mira independently returned provider HTTP 402 `payment_required` for
their exact supplied IDs. The backend maps these to a safe HTTP 503 with an
account-plan/billing explanation. No replacement voices were selected.
**Audible distinctness across all four voices cannot be verified while two cloud
voices require payment access and Aira has no ElevenLabs ID.**

Evidence: `verification/permanent-voices/live-elevenlabs-results.json`,
`verification/permanent-voices/browser/browser-live-ember-audio-results.json`,
`verification/permanent-voices/production/browser-results.json`, and the separate
four-character fixture browser JSON. Generated proprietary speech was not saved.

## 8. Animation synchronization

Actual Zyra audio reached peak measured RMS 0.2131 and mouth opening 0.8505.
Sound/silence samples and playback events drove the existing VRM controller;
idle closes the mouth. Four synthetic-audio runs also measured the actual
rendered controllers, not detached test models. Blinking, head movement, gestures
and interactive hand controls remain in the existing animation system.
This is smoothed amplitude-based synchronization, **not phoneme-perfect lip-sync**.
Physical speaker output and subjective listening quality were not assessed.

## 9. Build, lint and privacy checks

- `npm test`: **101 passed, 0 failed**.
- `npm run lint`: passed.
- `npm run build`: passed, 619 modules; current app JS about 88.07 KB, gzip 29.40 KB.
- Production credential scan: no configured keys and no `.env` files shipped.
- All four built VRMs match their source hashes; no asset replacement occurred.
- Production real-browser checks: passed, no page errors, Aira native playback,
  Zyra live pipeline, preserved conversation memory and no cloud browser fallback.
- Separate four-character fixture checks validate playback/cancellation/cache/IK
  plumbing, with live synthesis explicitly false.

Existing in-app browser connection failed, so verification used the established
standalone Chromium harness. The running production preview is local at
`http://127.0.0.1:4173`; this task does not claim public deployment.

## 10. Incomplete functionality and next actions

1. Enable account-plan/payment access for **Luna and Mira's exact existing IDs**.
   Their code paths are implemented, but live audio is currently rejected.
2. Supply `AIRA_VOICE_ID` only when an exact accessible ElevenLabs identity is
   available. Until then her existing browser voice is intentionally retained.
3. Grant `voices_read` and `models_read` to retrieve actual provider metadata.
   Missing catalog reads no longer block Zyra's working TTS permission.
4. Re-run `npm run test:voices:live` and live browser checks after account changes;
   manually listen to all available voices before claiming audible distinctions.

**Final verdict: permanent voice integration implemented; live four-character
ElevenLabs availability remains partial because of the above account configuration.**
