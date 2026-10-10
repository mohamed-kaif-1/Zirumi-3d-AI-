// Read-only catalog inspection. No synthesis or preview credits are consumed.
import { speechRequest, readProviderJson } from '../server/services/speechHttp.js';
const key = process.env.CARTESIA_API_KEY || '';
const version = process.env.CARTESIA_API_VERSION || '2026-08-14';
const eligible = []; let after;
try {
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://api.cartesia.ai/voices'); url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('starting_after', after);
    const result = await speechRequest(url.href, { provider: 'Cartesia', apiKey: key, timeoutMs: 15_000, headers: { Authorization: `Bearer ${key.trim()}`, 'Cartesia-Version': version }, consume: readProviderJson });
    if (!Array.isArray(result.data)) throw new Error('Cartesia returned an unexpected catalog envelope.');
    for (const voice of result.data) {
      if (voice.status === 'active' && voice.gender === 'feminine' && (voice.access === 'public' || voice.access === 'private' && voice.is_owner === true) && (voice.language === 'en' || voice.accents?.some(a => /^en(?:-|$)/.test(a.locale || '') && a.is_native))) eligible.push({ id: voice.id, name: typeof voice.name === 'string' ? voice.name.slice(0, 200) : null, tagline: typeof voice.tagline === 'string' ? voice.tagline.slice(0, 100) : '', access: voice.access, proClone: voice.is_pro === true });
    }
    if (!result.has_more || !result.data.length) break;
    after = result.data.at(-1).id;
  }
  console.log(JSON.stringify({ provider: 'Cartesia', eligibleEnglishFeminineVoices: eligible, synthesisVerified: false, billingAccess: 'Must verify synthesis with this account before marking ready.' }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
