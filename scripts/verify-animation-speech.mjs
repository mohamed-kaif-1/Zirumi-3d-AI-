import { mkdir, writeFile } from 'node:fs/promises';
const output = 'verification/animation-engine-2'; await mkdir(output, { recursive: true });
const tests = [
  { language: 'en', text: 'Hello! There are three main steps. Absolutely, let us do it together!' },
  { language: 'ta-IN', text: 'வணக்கம்! மூன்று முக்கிய படிகள் உள்ளன. ஒன்றாக முயற்சி செய்யலாம்.' },
  { language: 'hi-IN', text: 'नमस्ते! तीन मुख्य कदम हैं। हम मिलकर कोशिश कर सकते हैं।' },
];
const reports = [];
for (const item of tests) {
  const start = performance.now();
  try {
    const response = await fetch('http://127.0.0.1:3001/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.zirumi.speech+json' }, body: JSON.stringify({ avatarId: 'default', ...item }), signal: AbortSignal.timeout(60000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Speech synthesis failed.');
    const audio = Buffer.from(result.audio, 'base64');
    await writeFile(`${output}/reference-${item.language}.wav`, audio);
    await writeFile(`${output}/reference-${item.language}.json`, JSON.stringify({ text: item.text, alignment: result.alignment, provider: result.provider, model: result.model, language: item.language }, null, 2));
    const report = { language: item.language, provider: result.provider, model: result.model, bytes: audio.length, latencyMs: Math.round(performance.now() - start), method: result.alignment?.method || 'AUDIO-AMPLITUDE APPROXIMATION', phonemes: result.alignment?.phonemes?.length || 0, words: result.alignment?.words?.length || 0 };
    reports.push(report); console.log(JSON.stringify(report));
  } catch (error) { reports.push({ language: item.language, error: error.message }); process.exitCode = 1; console.log(item.language + ': ' + error.message); }
}
await writeFile(`${output}/speech-provider-results.json`, JSON.stringify(reports, null, 2));
