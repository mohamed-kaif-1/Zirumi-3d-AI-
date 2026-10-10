// Explicit opt-in: calls the running backend and real Groq (uses API quota).
// Never included in npm test. Optional argument: a known spoken .webm/.ogg file.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const status = await (await fetch(`${base}/api/chat/status`)).json();
assert.equal(status.configured, true, 'Configure GROQ_API_KEY and start the backend first.');
console.log(`Live chat model: ${status.model}`);
const history = [];
async function chat(message, context = history) {
  const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history: context }), signal: AbortSignal.timeout(50_000) });
  const result = await response.json();
  assert.equal(response.status, 200, result.error || 'Chat request failed.');
  assert.ok(typeof result.reply === 'string' && result.reply.trim());
  console.log(JSON.stringify({ message, reply: result.reply }));
  return result.reply;
}
for (const message of ['Hello, who are you?', 'My name is Kaif.', 'What is my name?']) {
  const reply = await chat(message);
  if (message === 'What is my name?') assert.match(reply, /Kaif/i, 'Memory did not preserve the name.');
  history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
}
const empty = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '', history: [] }) });
assert.equal(empty.status, 400);
if (process.argv[2]) {
  const path = process.argv[2];
  const type = path.endsWith('.webm') ? 'audio/webm' : path.endsWith('.ogg') ? 'audio/ogg' : path.endsWith('.wav') ? 'audio/wav' : null;
  assert.ok(type, 'Provide a WebM, Ogg or WAV recording.');
  const response = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': type }, body: await readFile(path), signal: AbortSignal.timeout(50_000) });
  const result = await response.json();
  assert.equal(response.status, 200, result.error || 'Transcription failed.');
  assert.ok(result.transcript?.trim(), 'No spoken words returned.');
  console.log(JSON.stringify({ liveTranscript: result.transcript }));
  await chat(result.transcript, []);
}
console.log('PASS: real Groq chat, name recall, and empty-message validation. Browser capture/playback not tested.');
