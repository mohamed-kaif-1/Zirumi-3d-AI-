// Inspects the production artifact without displaying configured secret values.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const allFiles = async directory => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? allFiles(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
const files = await allFiles('dist');
const textFiles = files.filter(filename => /\.(?:js|css|html|json|webmanifest|svg|md|txt)$/i.test(filename));
const secrets = ['GROQ_API_KEY', 'ELEVENLABS_API_KEY', 'DEEPGRAM_API_KEY', 'CARTESIA_API_KEY', 'MEM0_API_KEY', 'SARVAM_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY'].map(key => process.env[key]).filter(value => value && value.length >= 8);
let credentialMatches = 0, activeLegacyProviderReferences = 0;
for (const filename of textFiles) {
  const content = await readFile(filename, 'utf8');
  credentialMatches += secrets.filter(secret => content.includes(secret)).length;
  if (/\.(?:js|html)$/.test(filename) && /generativelanguage\.googleapis|x-goog-api-key|api\.x\.ai|GEMINI_API_KEY|XAI_API_KEY/.test(content)) activeLegacyProviderReferences++;
}
assert.equal(credentialMatches, 0); assert.equal(activeLegacyProviderReferences, 0);
assert.ok(!files.some(filename => /(?:^|[\\/])\.env(?:\.|$)/.test(filename)));
const sha = async filename => createHash('sha256').update(await readFile(filename)).digest('hex');
const modelHashes = {};
for (const id of ['sky', 'nova', 'ember']) {
  const source = await sha(`public/models/${id}.vrm`); const built = await sha(`dist/models/${id}.vrm`);
  assert.equal(built, source); modelHashes[id] = source;
}
const originalBuilt = files.find(filename => /AvatarSample_W.*\.vrm$/.test(filename));
assert.ok(originalBuilt); modelHashes.default = await sha('AvatarSample_W.vrm'); assert.equal(await sha(originalBuilt), modelHashes.default);
assert.deepEqual((await readdir('dist/models')).filter(filename => filename.endsWith('.vrm')).sort(), ['ember.vrm', 'nova.vrm', 'sky.vrm']);
const result = { productionTextFilesScanned: textFiles.length, configuredCredentialsCompared: secrets.length, credentialMatches, activeLegacyProviderReferences, environmentFilesShipped: false, allModelBinariesPreserved: true, modelHashes };
await mkdir('verification/groq', { recursive: true }); await writeFile('verification/groq/distribution-results.json', JSON.stringify(result, null, 2));
console.log('PASS production credential scan, no active legacy provider and byte-identical VRM assets.');
