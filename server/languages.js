import { ApiError } from './errors.js';
import { LANGUAGES } from '../src/languages.js';
export function validateLanguage(language = 'en') {
  if (typeof language !== 'string' || !Object.hasOwn(LANGUAGES, language)) throw new ApiError(400, 'Choose English, Tamil, Hindi or Indian English. Automatic language detection is not configured.');
  return language;
}
export function validateReplyLanguage(text, language) {
  const script = language === 'ta-IN' ? /\p{Script=Tamil}/gu : language === 'hi-IN' ? /\p{Script=Devanagari}/gu : null;
  if (!script) return;
  const native = (text.match(script) || []).length, letters = (text.match(/[\p{L}\p{M}]/gu) || []).length;
  if (!native || native / Math.max(1, letters) < 0.5) throw new ApiError(422, `The conversation model did not answer in ${language === 'ta-IN' ? 'Tamil' : 'Hindi'}. Try a shorter request or configure a capable Groq model for this language. No English voice was substituted.`);
}
