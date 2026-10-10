import { CHARACTER_PERSONALITIES } from '../src/characterPersonalities.js';

// The server alone chooses instructions. Reuse the central identities without
// accepting client-supplied prompts, model names or voice configuration.
export const SERVER_PERSONALITIES = Object.freeze(Object.fromEntries(
  Object.entries(CHARACTER_PERSONALITIES).map(([id, character]) => [id, Object.freeze({ name: character.name, instruction: character.instruction })]),
));
const BASE_PERSONALITY = 'You are a virtual AI companion on ZIRUMI, the platform. Your character name is specified below; ZIRUMI is not a fifth character. Be respectful, kind, supportive and factually accurate. Acknowledge uncertainty and never invent facts or claim to be a real human. Keep answers concise and natural when spoken, usually two to four sentences unless the user asks for detail, with clear sentences and appropriate pauses. Avoid unnecessary markdown, filler words, repetitive catchphrases and exaggerated affectations. Adapt seriously to serious questions and follow the user’s requested tone. Preserve the same conversation and safety behavior across avatar changes.';
export function avatarSystemInstruction(id = 'default') {
  const character = SERVER_PERSONALITIES[Object.hasOwn(SERVER_PERSONALITIES, id) ? id : 'default'];
  return `${BASE_PERSONALITY} You are ${character.name}. ${character.instruction}`;
}
