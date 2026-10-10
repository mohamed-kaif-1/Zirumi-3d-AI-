# Conversation language selector repair — 2026-10-11

Implemented directly in the existing nested ZIRUMI application. Tamil and Hindi
passed fresh real-provider browser speech conversations. All four characters
passed real native speech previews. No credentials or speaker configuration are
missing for the current routes. Physical microphone quality and human listening
remain user checks.

## Root cause

The selector already existed in main Settings. It was behind an icon-only gear
in the header, below animation preferences. The separate Voice settings modal
showed the Browser fallback voice dropdown without a link to language settings.
Those Microsoft voices did not represent the Sarvam conversation language route.

The controller initialized language to English on every page load and did not
save its selection. Empty conversation greetings and suggested prompts also
remained English. PHASE3_REPORT.md accurately described earlier provider checks,
but those checks opened the known gear directly; they did not establish that
users could discover the selector or that the selection survived a refresh.

## How to select Tamil or Hindi

Click the visible **Settings** button in the main header. **Conversation Language**
is now the first section, with these options:

| Option | Stored/API locale |
| --- | --- |
| English | `en` |
| Tamil (தமிழ்) | `ta-IN` |
| Hindi (हिन्दी) | `hi-IN` |
| Indian English | `en-IN` |

The **Language: …** button beside the conversation opens the same setting.
**Voice settings → Conversation Language** also opens it. The Browser fallback
dropdown remains separately labelled and retains its existing voice preferences.
It is available on the English route; Sarvam language routes do not use it.

Changing language does not reload the page or remove completed conversation
messages. Existing session-only history still clears on a full page refresh.
The language choice persists separately in localStorage under
`zirumi_conversation_language`. A saved supported locale initializes both speech
controllers before the first input; storage failures are handled without crashing.
Unsupported stored values are rejected. The selector is disabled during an active
turn or avatar switch.

## Routing and data flow

| Locale | Speech recognition | Conversation | Speech synthesis |
| --- | --- | --- | --- |
| `en` | Deepgram `nova-3` | Groq `openai/gpt-oss-20b` | Cartesia `sonic-3.6` |
| `ta-IN` | Sarvam `saaras:v4` | Same Groq model, Tamil instruction | Sarvam `bulbul:v3` |
| `hi-IN` | Sarvam `saaras:v4` | Same Groq model, Hindi instruction | Sarvam `bulbul:v4-flash` |
| `en-IN` | Sarvam `saaras:v4` | Same Groq model, Indian English instruction | Sarvam `bulbul:v4-flash` |

The application uses `conversationController.snapshot.language` as the active
locale. It configures microphone recognition and speech output together, sends
the locale in `X-Zirumi-Language` for `/api/transcribe`, and uses the `language`
JSON field for native `/api/chat` and `/api/tts` requests. English may omit that
field and uses the existing server default `en`. Provider status queries include
the locale. Server-owned Groq instructions and native-script validation remain
in effect; wrong-language replies and provider failures surface as errors.

Preview samples, visible welcome greetings and suggested prompts now follow the
selected language for Aira, Luna, Mira and Zyra. Indian English retains English
text and uses its separate verified Sarvam route. No automatic English fallback
was added. Existing speaker assignments remain:

| Character | Tamil | Hindi | Indian English |
| --- | --- | --- | --- |
| Aira | `roopa` | `roopa_hi_companion` | `aparna_en_companion` |
| Luna | `ritu` | `ritu_hi_social_lively` | `ritu_en_reels` |
| Mira | `kavitha` | `kavya_hi_conversational` | `ishita_en_customer` |
| Zyra | `neha` | `shreya_hi_conversational` | `sanchita_en_social` |

Cartesia voices, saved character voice settings, backend models/configuration,
dependencies, VRM assets, rigging and animation implementation were preserved.

## Fresh verification

Tests used actual Chromium against the running application at
`http://127.0.0.1:5173`, with the real backend and configured credentials. The
in-app browser connection was unavailable because its sandbox metadata lacked
`sandboxPolicy`; the existing local Playwright/Chromium runner was used.

| Check | Result |
| --- | --- |
| All four language options can be selected | Passed in the real UI |
| Visible first Settings section at 320, 390 and 1440 pixels | Passed; screenshots inspected |
| Language persists after refresh and applies before first input | Passed |
| Language changes avoid reloads and preserve current history | Passed |
| Voice settings link and separate Browser fallback dropdown | Passed |
| Every character switches between native languages | Passed |
| Tamil previews for all four loaded VRMs | Real Sarvam audio, playback and mouth motion passed |
| Hindi previews for all four loaded VRMs | Real Sarvam audio, playback and mouth motion passed |
| Tamil microphone → Sarvam STT → Groq → Sarvam TTS | Passed with Luna |
| Hindi microphone → Sarvam STT → Groq → Sarvam TTS | Passed with Aira |
| Native-script Groq replies | Passed for both fresh conversations |
| Released capture tracks, one transcript submission and mic exclusion during playback | Passed |
| Saved character voice preferences unchanged | Passed |
| Missing voice/model error visible; no browser English speech | Passed with an explicit error-only mock |
| Existing and new unit tests | `npm test`: 139 passed, 0 failed |
| Lint | `npm run lint`: passed |
| Production build | `npm run build`: passed after final responsive CSS change |

Tamil transcription took 855 ms and its Groq response 282 ms. Hindi transcription
took 342 ms and its Groq response 418 ms. These are individual measurements,
not a latency guarantee. Both generated non-silent audio and moved the loaded
VRM's mouth. Normal provider responses in the fresh live runs were not mocked.
Only the final missing-speaker error case substituted a 503 response to verify
error visibility without deliberately breaking the account configuration.

The browser microphone used prerecorded synthetic Tamil/Hindi fixtures through
the real MediaRecorder capture path. A physical microphone and subjective native
speaker listening were not verified. English's live provider status was checked;
its complete live speech flow and Indian English's real speech flow remain
covered by the earlier Phase 1/3 evidence. This repair freshly verified Indian
English selection and persistence, without claiming an additional paid en-IN
speech run. No deployment was performed. Existing recorded speech/WAV playback
does not claim streaming.

Evidence is stored in ignored `verification/language-selector/`:
`ta-IN-live.json`, `hi-IN-live.json`, `ui.json`, `checks.json`, native conversation
screenshots, and `settings-320.png`, `settings-390.png`, `settings-1440.png`.
Earlier provider evidence remains under `verification/phase1/` and
`verification/phase3/`. API keys are excluded from the report and evidence.

## Files changed

- `src/App.jsx`: visible Settings label, first language section and modal links.
- `src/ConversationPanel.jsx`: language shortcut and localized welcome/prompts.
- `src/VoiceSelector.jsx`: link from voice settings to conversation language.
- `src/languages.js`: locale labels, guarded storage helpers and native welcomes.
- `src/conversationController.js`: save/restore language and initialize providers.
- `src/useConversation.js`: initialize React's first render with the saved locale.
- `src/style.css`: focused language controls and narrow-screen spacing.
- `test/conversation.test.js`: persistence, first-turn routing, blocked/invalid
  storage and per-character native greeting checks.
- `scripts/browser-language-selector-live.mjs`: actual provider/browser tests.
- `scripts/browser-language-selector-ui.mjs`: responsive discoverability tests.
- `README.md`, `PHASE3_REPORT.md`, and this report: current selection instructions
  and verification scope.

No credential replacements or new speaker assignments were required. Provider
balances, billing allowances and physical microphone quality are not certified.
