# ZIRUMI Phase 2 - 2026-10-10

**PHASE PASSED**  
**ZIRUMI NOT READY - Sarvam Phase 3 remains unfinished**

Mem0 is integrated using the official hosted `mem0ai` SDK 3.3.1. Memory starts
off for every browser identity and stores only a short preference explicitly
approved through the Memory form. It never automatically saves conversations,
microphone recordings or every sentence. The conversation header exposes Enable
Memory, View Remembered Information, individual Delete, and confirmed Clear Memory.
Disabling memory stops saving/recall and retains view/delete controls. Clearing chat
preserves long-term preferences; character switches share the authorized identity.

## Identity, privacy and failure behavior

The backend authenticates an opaque 256-bit HttpOnly SameSite=Strict cookie and
stores only its hash, a random Mem0 user ID and consent in ignored
`.zirumi/memory-identities.json`. Atomic serialized writes preserve this identity
and consent across server restarts. No frontend user ID is accepted. All SDK calls
use the verified user plus app_id=zirumi; individual deletion verifies ownership,
and clear never uses wildcard/project-wide deletion. There is a 512-identity local
capacity and a 100-preference limit per identity. Clearing cookies loses access
to that local identity; this is not a public login/account recovery implementation.

Search injects at most three owned facts of at most 500 characters each, labelled
untrusted reference data. It uses the documented default relevance threshold 0.1.
If Mem0 is unavailable, the same Groq chat uses completed session history and shows
a notice. Disabled identities trigger no automatic provider reads or writes. Saved
data remains manageable by its owner when memory is disabled.

The pinned SDK transport disables telemetry and automatic initialization, permits
only official HTTPS endpoints, discards upstream error bodies, limits JSON size,
enforces 15-second provider/20-second route deadlines and propagates cancellation.
There are no automatic billed retries. Add uses infer=false for the selected fact,
with no provider extraction model or whole-chat payload.

## Actual live tests and latency

`verification/phase2/mem0-auth-results.json` records a successful read-only check
on a new isolated identity. `browser-live-memory-results.json` records real Mem0
and Groq responses, with no mocked provider data:

- Initially off; explicitly enabled and saved Favorite subject: Astronomy.
- Saved information appeared in the UI and persisted into a new browser context.
- Groq recalled “Your favorite subject is astronomy.” with empty new session history.
- After switching to Luna and clearing chat, it recalled the same authorized fact.
- A second browser identity had no preferences and started with memory off.
- Disabled recall answered that the subject was unknown; the saved entry remained
  available for management. Individual deletion and scoped Clear Memory passed.
- The isolated test identity was disabled and its test data cleaned up.
- Mobile 390px memory controls/dialog fit and were visually inspected.

Groq safe logs measured enabled recall 924 ms, cross-avatar recall 798 ms, disabled
reply 719 ms. Mem0 aggregate latency was not separately captured; none is invented.
Remaining account balances/plan quotas are unknown. The verification used only a
short non-sensitive preference per run and cleaned the test identities. A diagnostic
write helped identify the search cutoff issue. A new browser context re-enabled the
app's default voice output in the successful harness, producing three short Cartesia
replies (468/367/987 ms); the harness now explicitly disables output after context
or avatar changes to avoid those unnecessary calls in future. No paid rerun was
performed merely to verify that harness adjustment.

## Mocked checks, bugs and fixes

All 128 tests pass, including six Mem0 SDK/HTTP/privacy tests. Lint, production
build and credential/model distribution checks pass. Tests cover real SDK payload
serialization with simulated provider responses, user/app isolation, foreign
deletion rejection, scoped clear, cancellation, safe provider errors, default-off
consent, duplicate prevention, protected preference validation, durable identity
storage and session-context fallback. Existing speech, animation/IK and history
tests remain passing. No model/IK implementation or installed VRM was replaced.

The first normal SDK install attempted an unused native SQLite peer and failed
under Windows application-control/build restrictions. Installing only the hosted
client dependencies through legacy peer resolution succeeded; `.npmrc` makes this
reproducible. The pinned SDK and transport contract are tested; no native policy
bypass or local database provider is used.

The first live recall failed because the correct fact scored 0.2365, below the
uncalibrated 0.35 cutoff. Safe diagnostic metadata identified this; the adapter now
uses the documented 0.1 default and a regression fixture with the observed score.
The later real recall passed. An asynchronous controlled checkbox caused the first
browser harness to check too early; it now waits for the server-confirmed state.
Memory controls were moved from the footer to the conversation header because the
existing mobile layout hides the footer. UI strings escape remembered content.

## Files, credentials and checkpoint

New: `server/services/mem0.js`, `server/memoryIdentity.js`, `server/memory.js`,
`src/MemoryControls.jsx`, `test/memory.test.js`, `scripts/browser-phase2-live.mjs`,
`.npmrc`, PHASE2_SETUP.md and this report. Updated: package.json/lock, .gitignore,
server/index.js, server/chat.js, ConversationPanel, conversationController and CSS.
Mem0 credentials are configured and live verified; no new key is currently missing
for Phase 2. See PHASE2_SETUP.md for consent, configuration and identity storage.

The clean Git checkpoint is recorded in `verification/phase2/git-checkpoint.json`.
The preceding Phase 1 commit is fc4e5e0. Both secret `.env` and identity state are
ignored; preserve them separately when restoring code. Verification artifacts are
also ignored and kept locally as evidence.

## Readiness limits

Phase 3 may now begin. Phase 1 speech remains Deepgram/Groq/Cartesia and its actual
live proof is retained. Sarvam has not been implemented or claimed working here.
Human voice quality and physical microphone checks remain unverified. No public
deployment occurred; HTTPS, Secure cookies, account authentication and per-user
rate limits are still required for public hosting. No optional WebSocket/streaming
speech capability is claimed.
