import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from './errors.js';

const digest = value => createHash('sha256').update(value).digest('hex');
export function createMemoryIdentityStore({ filePath = '.zirumi/memory-identities.json' } = {}) {
  let users = {}, writing = Promise.resolve();
  const ready = filePath ? readFile(filePath, 'utf8').then(raw => {
    const parsed = JSON.parse(raw);
    for (const [key, user] of Object.entries(parsed)) if (/^[0-9a-f]{64}$/.test(key) && /^zirumi-[0-9a-f-]{36}$/.test(user.userId) && typeof user.enabled === 'boolean') users[key] = user;
  }).catch(error => { if (error.code !== 'ENOENT') throw new ApiError(503, 'Memory identity storage is unavailable.'); }) : Promise.resolve();
  ready.catch(() => {}); // Report storage failures through routes, not unhandled rejection.
  async function persist() {
    if (!filePath) return;
    writing = writing.catch(() => {}).then(async () => { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath + '.tmp', JSON.stringify(users), { mode: 0o600 }); await rename(filePath + '.tmp', filePath); });
    await writing;
  }
  return {
    async resolve(request, response, create = false) {
      await ready;
      const token = request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('zirumi_memory='))?.slice('zirumi_memory='.length);
      if (/^[0-9a-f]{64}$/.test(token || '') && users[digest(token)]) return users[digest(token)];
      if (!create) return null;
      if (Object.keys(users).length >= 512) throw new ApiError(503, 'Memory identity capacity reached. Session chat still works.');
      const newToken = randomBytes(32).toString('hex'), user = { userId: 'zirumi-' + randomUUID(), enabled: false, version: 0 };
      users[digest(newToken)] = user; await persist();
      response.setHeader('Set-Cookie', `zirumi_memory=${newToken}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=31536000`);
      return user;
    },
    async consent(user, enabled) { const previous = user.enabled; user.enabled = enabled; user.version = (user.version || 0) + 1; try { await persist(); } catch { user.enabled = previous; throw new ApiError(503, 'Memory preferences could not be saved.'); } },
  };
}
