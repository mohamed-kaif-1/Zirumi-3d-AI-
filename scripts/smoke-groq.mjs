// Explicit live Groq verification. Uses account quota; never run by npm test.
// Run: node --env-file=.env scripts/smoke-groq.mjs [spoken.webm|spoken.ogg]
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createGroqModelRegistry, groqJson } from '../server/services/groq.js';

const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const result = { provider: 'Groq', liveChat: false, liveTranscription: false, liveElevenLabs: false, accountModelsVerified: false, invalidCredentialHandled: false, responses: [] };
await mkdir('verification/groq', { recursive: true });
try {
  const chatStatus = await (await fetch(`${base}/api/chat/status`)).json();
  const sttStatus = await (await fetch(`${base}/api/transcription/status`)).json();
  assert.equal(chatStatus.provider, 'Groq'); assert.equal(chatStatus.configured, true, 'Configure GROQ_API_KEY on the backend.');
  result.chatModel = chatStatus.model; result.sttModel = sttStatus.model;
  result.sttProvider = sttStatus.provider;
  const registry = createGroqModelRegistry({ apiKey: process.env.GROQ_API_KEY, baseUrl: process.env.GROQ_BASE_URL });
  await Promise.all([registry.verify(chatStatus.model), ...(sttStatus.provider === 'Groq' ? [registry.verify(sttStatus.model)] : [])]);
  result.accountModelsVerified = true;
  const history = [];
  const chat = async (avatarId, message, context = []) => {
    const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId, message, history: context }), signal: AbortSignal.timeout(50_000) });
    const data = await response.json(); assert.equal(response.status, 200, data.error || 'Live Groq generation failed');
    assert.equal(data.metadata.provider, 'Groq'); assert.ok(data.reply?.trim());
    result.responses.push({ avatarId, message, reply: data.reply, metadata: data.metadata, status: response.status, historyMessages: context.length });
    return data.reply;
  };
  for (const [avatarId, name] of [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    const reply = await chat(avatarId, 'Hello, who are you? Introduce yourself as a ZIRUMI companion in one sentence.');
    assert.ok(reply.toLowerCase().includes(name.toLowerCase()), `${name} must introduce itself`); assert.match(reply, /ZIRUMI/i);
  }
  const remember = 'My name is Kaif. Please remember my name for this conversation.';
  const first = await chat('sky', remember); history.push({ role: 'user', content: remember }, { role: 'assistant', content: first });
  assert.match(await chat('nova', 'What is my name?', history), /Kaif/i);
  result.liveChat = true; result.crossAvatarMemory = true;
  // A deliberately invalid token, never the user's real key. No generation cost.
  try { await groqJson('models', { apiKey: 'invalid-groq-credential-for-safe-verification' }); assert.fail('Invalid token was accepted'); }
  catch (error) { assert.match(error.message, /authentication failed/i); result.invalidCredentialHandled = true; result.invalidCredentialSafeStatus = error.status; result.invalidCredentialProviderStatus = error.providerStatus; }
  if (process.argv[2]) {
    const filename = process.argv[2]; const mimeType = filename.endsWith('.webm') ? 'audio/webm' : filename.endsWith('.ogg') ? 'audio/ogg' : filename.endsWith('.wav') ? 'audio/wav' : null;
    assert.ok(mimeType, 'Supply a known spoken WebM, Ogg or WAV recording.');
    const response = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': mimeType }, body: await readFile(filename), signal: AbortSignal.timeout(50_000) });
    const data = await response.json(); assert.equal(response.status, 200, data.error || 'Live transcription failed'); assert.ok(data.transcript?.trim());
    result.liveTranscription = true; result.transcription = data;
    await chat('default', data.transcript);
  }
  result.ttsStatus = await (await fetch(`${base}/api/tts/status`)).json();
  console.log('PASS live Groq account models, four character introductions, cross-avatar Kaif recall and safe invalid-credential handling.');
  console.log(JSON.stringify({ chatModel: result.chatModel, sttModel: result.sttModel, liveTranscription: result.liveTranscription, elevenLabsConfigured: result.ttsStatus.configured }));
} catch (error) {
  result.failure = error.message; console.error(`Live Groq verification failed: ${error.message}`); process.exitCode = 1;
} finally {
  await writeFile('verification/groq/live-results.json', JSON.stringify(result, null, 2));
}
