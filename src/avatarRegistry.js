/**
 * Registry of available 3D VRM characters for ZIRUMI.
 * Runtime capabilities are inspected independently for each loaded skeleton.
 */

export const AVATAR_REGISTRY = [
  {
    id: 'default',
    name: 'Aira',
    title: 'Original Companion',
    description: 'Sweet, friendly, caring',
    outfit: 'Floral Kimono',
    modelUrl: '/models/default.vrm',
    thumbnailUrl: '/avatars/default.png',
    defaultVoice: 'best_friend',
    author: 'pixiv VRoid Project',
    license: 'Embedded VRM 1.0 restrictive terms; see ATTRIBUTION.md',
    tags: ['Original', 'VRoid'],
  },
  {
    id: 'sky',
    name: 'Luna',
    title: 'Playful Adult Companion',
    description: 'Playful, cheerful, curious',
    outfit: 'Vivi Original Outfit',
    modelUrl: '/models/sky.vrm',
    thumbnailUrl: '/avatars/sky.png',
    defaultVoice: 'sweet',
    author: 'pixiv VRoid Project',
    license: 'CC0 1.0',
    tags: ['Female', 'Anime', 'Sweet'],
  },
  {
    id: 'nova',
    name: 'Mira',
    title: 'Elegant Virtual Assistant',
    description: 'Calm, elegant, intelligent',
    outfit: 'Victoria Rubin Original Outfit',
    modelUrl: '/models/nova.vrm',
    thumbnailUrl: '/avatars/nova.png',
    defaultVoice: 'calm',
    author: 'pixiv VRoid Project',
    license: 'CC0 1.0',
    tags: ['Female', 'Elegant', 'Calm'],
  },
  {
    id: 'ember',
    name: 'Zyra',
    title: 'Playful Cyber Companion',
    description: 'Energetic, confident, futuristic',
    outfit: 'Vita Cyber Outfit',
    modelUrl: '/models/ember.vrm',
    thumbnailUrl: '/avatars/ember.png',
    defaultVoice: 'playful',
    author: 'pixiv VRoid Project',
    license: 'CC0 1.0',
    tags: ['Female', 'Cyber', 'Playful'],
  },
];

export const DEFAULT_AVATAR_ID = 'default';

/**
 * Retrieve avatar configuration by ID with fallback to default avatar.
 * @param {string} id
 * @returns {object}
 */
export function getAvatarById(id) {
  const found = AVATAR_REGISTRY.find((avatar) => avatar.id === id);
  return found || AVATAR_REGISTRY[0];
}
