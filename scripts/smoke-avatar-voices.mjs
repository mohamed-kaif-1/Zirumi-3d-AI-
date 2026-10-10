// Explicit live verification; uses Groq quota and the running local backend.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const status = await (await fetch(`${base}/api/chat/status`)).json();
assert.equal(status.configured, true);
const history = [];
const results = [];
for (const [avatarId, message] of [
  ['default', 'Introduce yourself in one short sentence.'],
  ['sky', 'My name is Aster. Please remember it for this conversation.'],
  ['nova', 'What is my name? Answer in one short sentence.'],
  ['ember', 'In a calm, serious tone, explain in one sentence why two plus two equals four.'],
]) {
  const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId, message, history }), signal: AbortSignal.timeout(50_000) });
  const result = await response.json();
  assert.equal(response.status, 200, result.error || 'Live Groq request failed.');
  assert.ok(result.reply?.trim());
  if (avatarId === 'nova') assert.match(result.reply, /Aster/i);
  results.push({ avatarId, message, reply: result.reply, status: response.status, historyMessages: history.length });
  console.log(JSON.stringify(results.at(-1)));
  history.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
}
await mkdir('verification/voices', { recursive: true });
await writeFile('verification/voices/live-groq-results.json', JSON.stringify({ model: status.model, results }, null, 2));
console.log('PASS real Groq replies for four avatar identities and memory across switches.');
