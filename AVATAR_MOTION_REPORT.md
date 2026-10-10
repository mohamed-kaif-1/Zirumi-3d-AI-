# Avatar motion, collision and boundary interaction report — 2026-10-11

The four installed character assets remain the same stylized VRMs. Their geometry,
skin weights, clothing, expressions and identities were preserved. This update
improves how their existing humanoid rigs move and adds a deliberate, collision-
aware hand interaction mode with firm personal-boundary responses.

## Existing model quality

All nine installed VRM files were inspected, including the four active characters
and five retained fallback/duplicate assets. The audit records VRM version, mesh
counts, skeleton hierarchy, world/rest transforms, arm lengths, expressions,
materials, textures and skin-weight sums in ignored
`verification/avatar-motion/model-audit.json`. The active assets all have 54
humanoid bones and authored skinning. Aira is VRM 1.0 (26,523 unique vertices,
37,555 triangles); Luna, Mira and Zyra are VRM 0.x (18,338/25,834,
20,721/28,928 and 18,681/26,130 respectively). The audit found no materially
unnormalized primary skin-weight sums. This does not guarantee perfect joint
deformation or collision-free clothing at every pose.

Each model has its own authored proportions. Unscaled left upper-arm/forearm
lengths are approximately 0.242/0.224 m for Aira, 0.186/0.180 m for Luna and
0.219/0.214 m for both Mira and Zyra. The loader keeps its existing uniform
1.65 m height normalization and grounding. It never scales individual bones.
No model was downloaded, replaced, sculpted, reweighted or edited. The four
characters remain visibly stylized; animation cannot add mesh detail or change
Luna's original youthful-looking facial geometry. A more realistic adult
appearance would require a separately licensed, higher-detail model with reviewed
proportions, clothing and deformation.

## Rig motion and collision

The existing VRM normalized humanoid bones drive a two-bone analytical arm
solver. It measures each model's own segment lengths, clamps unreachable targets
and the elbow bend, selects a per-character elbow pole, and rotates bones with
quaternions in their actual parent frames. It does not change bone translations
or scales to reach a target. Smoothed targets and a retained safe pose reduce
snapping when a pose is clamped or rejected.

Skeleton-following capsule proxies cover the head, neck, chest/torso, pelvis,
shoulders, upper arms, forearms, hands and thighs. The hand solver excludes
directly connected segments, keeps the target on its own side of the torso and
out from behind the back, tests the arm segments against other body proxies, and
retreats toward the model's safe rest pose if a candidate intersects. Proxies are
math only; they are not visible mesh objects. They do not simulate clothing,
hair, fingers, legs, or full mesh-to-mesh physics. Loose sleeves, skirts and hair
can still clip in poses outside the tested interaction envelope.

The authored hand/finger rest transforms and standing leg alignment remain
untouched; there is no new foot placement, walking or balance simulation. Breathing
uses a small spine rotation without moving the rig's rest translations. Existing
blinking, listening posture, camera-directed eye contact, speech gestures and RMS
mouth animation remain active. Head motion is smoothed and bounded on the head
and neck bones. Boundary profiles tune shake amplitude, speed and firm-expression
weight for Aira, Luna, Mira and Zyra. Boundary animation takes priority over idle,
speech gestures and arm dragging, moves the character slightly back, and eases to
the saved scene position when speech ends or errors.

## Deliberate touch policy and voice

The **Interact** button is a separate mode; it disables orbit-camera movement
while enabled. A boundary attempt requires a primary stationary click on the
currently ray-hit skinned mesh, with no hover, scroll, pointer cancel, camera drag
or avatar loading event. Safe hands, arms, shoulders and head take priority over
nearby private proxies. Chest and pelvis regions are private, simplified zones;
they are never manipulable. The interaction has a 6.5-second cooldown. Fixed
refusal audio is cached in memory by language, character and voice identity, so
the same reaction does not repeatedly call a speech service.

The local decision cancels current speech, recording and pending AI work; it does
not call Groq or Mem0. Aira responds gently, Luna briskly, Mira calmly and Zyra
assertively through distinct low-weight expressions and head-shake timing. All
characters use the same boundary rule. The default message is “No, please respect
my boundaries.” Tamil and Hindi use fixed native-script equivalents. A refusal
is shown immediately. It uses the selected character's configured Cartesia voice
in English and Sarvam voice in Tamil/Hindi. Synthesis failure leaves the notice
visible, completes the motion and never invokes browser speech. The available
fixed response is also used for Indian English; that locale's boundary phrase
uses English wording.

## Verification results

The following checks ran against the actual installed VRMs in Chromium with
SwiftShader. They exercise real Three.js transforms and rendered pointer input;
they are not an assertion of perfect appearance from every camera angle.

| Check | Result |
| --- | --- |
| Load, bind and animate Aira, Luna, Mira and Zyra | Passed; no page errors |
| Ten reachable, torso-near, head-near, cross-body and unreachable IK poses per character | Passed across 40 audit poses |
| Bone translations remain unchanged; arm length stays within measured reach | Passed |
| Worst capsule penetration in the four-model motion audit | Under 0.001 model units |
| Actual pointer drags toward torso and beyond reach for all four characters | Passed; no paid requests or browser errors |
| Head shake, serious expression, audio playback and mouth movement | Passed for all four characters in English, Tamil and Hindi |
| Fixed voice/provider assignment | Passed: 4 Cartesia, 4 Tamil Sarvam and 4 Hindi Sarvam responses; real audio returned and played |
| Camera drag, zoom/scroll, hover and stationary safe shoulder/head selections | No boundary response |
| Repeated attempt and cached response | Cooldown and single-synthesis behavior passed |
| Missing-voice/TTS error in English, Tamil, Hindi and Indian English | Passed using an explicit 503 test fixture; refusal stays visible, no browser speech, animation recovers |
| Current unit suite | `npm test`: 150 passed, 0 failed |
| Lint and production build | `npm run lint` and `npm run build` passed |

Actual refusal calls in the saved Chromium run returned non-silent Cartesia/Sarvam
audio, used the expected character voice IDs and produced head and mouth movement.
That run completed all 12 English/Tamil/Hindi character combinations. Its optional
final error-note check timed out after the real reactions; the separate four-locale
error tests then passed. The raw run, including that test-harness timeout, is kept
as `verification/avatar-motion/boundary-live.json`; its 12 completed reactions
remain independently inspectable there.

The focused JavaScript motion update measured approximately 1.8–2.3 ms mean and
2.4–3.1 ms p95 across the four rigs; its IK/collision portion measured about
0.8–1.0 ms mean and 1.1–1.2 ms p95. These figures come from a local software-
rendered browser audit and do not establish 60 FPS on the development laptop.
The SwiftShader browser's observed frame gaps were much longer than 16.7 ms, so
hardware frame rate needs a manual check on the target laptop. The recorded
browser JavaScript heap and WebGL resource counts are diagnostics, not complete
GPU-memory measurements. No significant page errors were seen in the passing
browser runs.

Human review remains necessary for natural-looking clothing deformation, body
proportions, hand/finger poses, the exact boundary-region outline and listening
quality of each localized phrase. The fixed Tamil/Hindi text was checked for the
intended script and produced speech, but no native-speaker translation review
was conducted. The local browser used a virtual test environment for interaction;
physical mouse, touch-screen and target-laptop frame-rate behavior should be
checked manually.

Evidence and screenshots are under ignored `verification/avatar-motion/`:
`model-audit.json`, `model-motion.json`, `interaction-ui.json`, `boundary-live.json`,
`boundary-live-validation.json`, the four `error-recovery-*.json` files, pose
screenshots and boundary screenshots.
The in-app browser bridge was unavailable in this session; the local Chromium
runner provided the rendered browser checks instead.

## Files changed

`src/twoBoneIKSolver.js`, `src/bodyCollision.js`,
`src/AvatarAnimationController.js`, `src/CharacterInteraction.jsx`,
`src/HandHandle.jsx`, `src/Avatar.jsx`, `src/App.jsx`,
`src/boundaryBehavior.js`, `src/conversationController.js`,
`src/speechController.js`, `src/audioSpeechPlayer.js`, `src/avatarRegistry.js`,
`src/characterPersonalities.js`, `src/useConversation.js`, `src/style.css`, and
their focused tests were updated. `MODEL_QUALITY_REPORT.md` records the asset
audit. `scripts/audit-installed-vrms.mjs`, `scripts/avatar-motion-probe.js`,
`scripts/browser-avatar-motion.mjs`,
`scripts/browser-avatar-interaction-ui.mjs`,
`scripts/browser-boundary-live.mjs` and `scripts/browser-boundary-error.mjs`
contain repeatable audit and browser checks. The existing multilingual language
selector work remains preserved.

Checkpoint before this avatar feature work: `6744f76` (avatar collision and
boundary interaction). No credentials, model binaries or voice IDs were changed.
