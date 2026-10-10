export const LANGUAGES = Object.freeze({
  en: { label: 'English', shortLabel: 'English', sample: null },
  'ta-IN': { label: 'Tamil (தமிழ்)', shortLabel: 'Tamil', sample: { default: 'வணக்கம்! நான் ஐரா. உங்களை சந்தித்ததில் மகிழ்ச்சி.', sky: 'வணக்கம்! நான் லூனா. இன்று என்ன பேசலாம்?', nova: 'வணக்கம். நான் மீரா. உங்களுக்கு எப்படி உதவலாம்?', ember: 'வணக்கம்! நான் ஜைரா. புதிய விஷயங்களை கண்டறியலாம்!' } },
  'hi-IN': { label: 'Hindi (हिन्दी)', shortLabel: 'Hindi', sample: { default: 'नमस्ते! मैं आइरा हूँ। आपसे मिलकर खुशी हुई।', sky: 'नमस्ते! मैं लूना हूँ। आज क्या बात करें?', nova: 'नमस्ते। मैं मीरा हूँ। मैं आपकी कैसे मदद करूँ?', ember: 'नमस्ते! मैं ज़ाइरा हूँ। चलिए कुछ नया सीखें!' } },
  'en-IN': { label: 'Indian English', shortLabel: 'Indian English', sample: null },
});

export const LANGUAGE_STORAGE_KEY = 'zirumi_conversation_language';
export function loadConversationLanguage(env = globalThis) {
  try {
    const saved = env.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return Object.hasOwn(LANGUAGES, saved) ? saved : 'en';
  } catch { return 'en'; }
}
export function saveConversationLanguage(language, env = globalThis) {
  if (!Object.hasOwn(LANGUAGES, language)) return;
  try { env.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* The selected route still works when storage is blocked. */ }
}

export function conversationWelcome(language, character) {
  const translated = language === 'ta-IN' ? {
    hello: 'வணக்கம்', question: 'இன்று என்ன பேசலாம்?', prompts: ['உன் நாள் எப்படி இருந்தது?', 'ஒரு சுவாரஸ்யமான தகவலைச் சொல்', 'ஒரு புதிய யோசனையைப் பற்றி பேசலாம்'],
  } : language === 'hi-IN' ? {
    hello: 'नमस्ते', question: 'आज क्या बात करें?', prompts: ['तुम्हारा दिन कैसा था?', 'एक रोचक बात बताओ', 'किसी नए विचार पर बात करें'],
  } : { hello: 'HELLO, YOU.', question: 'What’s on your mind?', prompts: character.prompts };
  return { ...translated, greeting: LANGUAGES[language]?.sample?.[character.id] || character.greeting };
}
