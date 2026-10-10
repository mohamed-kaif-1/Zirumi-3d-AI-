import { ApiError } from '../errors.js';

export async function readProviderBytes(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new ApiError(502, 'The speech provider returned oversized data.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, 'The speech provider returned an empty response.');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new ApiError(502, 'The speech provider returned oversized data.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function speechRequest(url, { provider, apiKey, headers, body, signal, timeoutMs = 45_000, fetchImpl = fetch, consume }) {
  if (!apiKey?.trim()) throw Object.assign(new ApiError(503, `${provider} is not configured. Add ${provider.toUpperCase()}_API_KEY to the backend .env and restart the server.`), { errorCode: 'missing_credentials' });
  const expected = provider === 'Deepgram' ? 'https://api.deepgram.com' : provider === 'Cartesia' ? 'https://api.cartesia.ai' : '';
  const target = new URL(url);
  if (!expected || target.origin !== expected || target.username || target.password || target.hash) throw new ApiError(503, 'Speech requests require the official provider endpoint.');
  const deadline = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers, body, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    if (!response.ok) {
      // Arbitrary upstream bodies may contain private input. Discard them.
      await response.body?.cancel();
      const status = response.status;
      const message = status === 401 ? `${provider} rejected its backend credential.` : status === 403 ? `${provider} denied access. Check key permissions and voice/model access.` : status === 402 ? `${provider} requires credits or a supported billing plan.` : status === 429 ? `${provider} rate limit or quota reached. Wait before trying again.` : status === 404 ? `${provider} could not find the configured voice or model.` : [400, 413, 415, 422].includes(status) ? `${provider} rejected the audio, voice, model or synthesis settings.` : `${provider} is temporarily unavailable. Try again later.`;
      const error = Object.assign(new ApiError(status === 429 ? 429 : [400, 413, 415, 422].includes(status) ? 422 : [401, 402, 403, 404].includes(status) ? 503 : 502, message), { providerStatus: status, errorCode: `provider_http_${status}` });
      const retry = response.headers.get('retry-after');
      if (status === 429 && /^\d+(?:\.\d+)?$/.test(retry || '')) error.retryAfter = Math.min(86400, Math.max(1, Math.ceil(Number(retry))));
      throw error;
    }
    return await consume(response);
  } catch (error) {
    if (error instanceof ApiError) { error.endpoint = `${target.origin}${target.pathname}`; throw error; }
    const expired = signal?.aborted || deadline.aborted;
    throw Object.assign(new ApiError(expired ? 504 : 502, expired ? `${provider} request was cancelled or timed out.` : `The backend could not reach ${provider}. Check the connection and try again.`), { errorCode: expired ? 'timeout_or_cancelled' : 'network_error', endpoint: `${target.origin}${target.pathname}` });
  }
}

export async function readProviderJson(response) {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new ApiError(502, 'The speech provider returned invalid JSON data.');
  const bytes = await readProviderBytes(response, 512 * 1024);
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new ApiError(502, 'The speech provider returned invalid JSON data.'); }
}
