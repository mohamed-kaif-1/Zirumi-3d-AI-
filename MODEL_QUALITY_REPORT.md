# Installed VRM quality audit — 2026-10-11

All nine installed VRM binaries were inspected before motion changes. No model
was downloaded, replaced, reweighted, sculpted or individually bone-scaled.
Detailed rest transforms, hierarchy links, skin weights, embedded materials and
textures are recorded in `verification/avatar-motion/model-audit.json`.

| Active character | Asset | VRM | Unique position vertices | Triangles | Humanoid bones | File size |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Aira | `AvatarSample_W.vrm` / `public/models/default.vrm` | 1.0 | 26,523 | 37,555 | 54 | 19.47 MB |
| Luna | `public/models/sky.vrm` (Vivi) | 0.x | 18,338 | 25,834 | 54 | 18.09 MB |
| Mira | `public/models/nova.vrm` (Victoria Rubin) | 0.x | 20,721 | 28,928 | 54 | 15.48 MB |
| Zyra | `public/models/ember.vrm` (Vita) | 0.x | 18,681 | 26,130 | 54 | 14.36 MB |

All four have complete upper/lower arms, hands, head/neck, spine, hips, leg joints,
eye and finger chains. Facial presets include blinking, speech vowels and an
angry expression suitable at a low weight for a serious refusal. The VRM loader
normalizes legacy expression names such as `a` and `joy` to its runtime presets.
The meshes have authored skinning and inverse bind matrices; the audit found no
non-finite or materially unnormalized primary weight sums. Valid weight sums do
not prove visually perfect deformation at every joint.

The original models use authored humanoid rest transforms with arms extended
outward. The animation owner uses normalized VRM bones, independent of the raw
mesh skeleton's local axes. Bone hierarchy, local translations and world joint
positions were read from the actual files; arm lengths differ across models.
Unscaled left upper-arm/forearm lengths are approximately 0.242/0.224 m for
Aira, 0.186/0.180 m for Luna, and 0.219/0.214 m for Mira and Zyra. Existing whole
model scaling grounds each character and normalizes its overall height to 1.65 m.
This uniform scaling preserves the authored proportions; it does not change
head-to-body ratios or establish a character's age.

Aira has 19 embedded material entries and 33 images; the other active models
have 16 materials and 28 images each. Toon shading, stylized faces, garment
shapes and the existing embedded textures define their appearance.
Embedded images range from tiny lookup textures to 2048×2048 images; the original
resolutions are preserved. Aira's named morph targets are facial expressions,
and no supported body-proportion customization control was found in the app.
Correct
texture color-space handling remains with GLTFLoader/VRMLoaderPlugin. Key,
fill and rim lighting can improve presentation but cannot create additional
geometry, skin detail or higher-resolution textures.

Other preserved installed assets:

| Asset | VRM | Vertices | Triangles | Humanoid bones |
| --- | --- | ---: | ---: | ---: |
| `Shaza.vrm` and `public/models/avatar-3.vrm` | 1.0 | 31,667 | 45,035 | 54 |
| `public/models/avatar-2.vrm` (Alicia Solid) | 0.0 | 21,529 | 31,798 | 55 |
| `public/models/avatar-4.vrm` (Seed-san) | 1.0 | 34,059 | 45,058 | 51 |

These backups also had valid primary weight sums. The application retains its
existing four-character registry and all original binaries. Existing source
and license records remain in `public/models/ATTRIBUTION.md`; no asset license
was changed by this work.

## What can improve safely

Per-model rest poses, smooth quaternion motion, restricted arm targets, collision
proxies, subdued facial transitions, eye contact and restrained gestures improve
the existing characters without damaging clothing, weights or identity. Knees,
ankles and feet retain their authored standing alignment; there is no new walking
or balance simulation. Wrist/finger rest transforms are retained rather than
guessing model-specific flex axes. Natural movement still depends on the original
skinning and clothing topology.

All four remain stylized avatars. Luna retains a playful aesthetic, with an adult
companion identity in the shared personality/registry text. Her original facial
geometry and proportions are unchanged. If a clearly realistic adult appearance
or photorealism is required, especially a less youthful visual interpretation of
Luna, an appropriately licensed adult model with reviewed proportions, high-detail
skin/clothing textures and deformation tests is needed. Animation alone cannot
fulfil that mesh-design requirement.

Loose kimono sleeves, skirts, hair and layered clothing can still intersect under
unusual poses. Simplified body capsules do not model cloth or hair volume and are
not proof of perfect mesh-level collision. See `AVATAR_MOTION_REPORT.md` for actual
interaction tests, supported limits and manual visual review steps.
