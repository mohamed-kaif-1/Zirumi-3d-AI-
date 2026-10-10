import { ApiError } from '../errors.js';
import { groqFetch } from './groqTransport.js';

export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_CHAT_MODEL = 'openai/gpt-oss-20b';
export const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo';
const MAX_PROVIDER_BYTES = 512 * 1024;
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']);

function connectionFailure(cause) {
  // Log only allowlisted codes; upstream exception text can contain private data.
  const candidates = [cause, cause?.cause, ...(Array.isArray(cause?.cause?.errors) ? cause.cause.errors : [])];
  const code = candidates.map(item => item?.code).find(value => NETWORK_CODES.has(value));
  const dns = ['ENOTFOUND', 'EAI_AGAIN'].includes(code);
  const tls = ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code);
  const timedOut = ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code);
  const error = new ApiError(timedOut ? 504 : 502, timedOut ? 'The connection to Groq timed out. Check the network and use Try again.'
    : dns ? 'The backend could not resolve Groq\u2019s address. Check the internet connection or DNS, then try again.'
    : tls ? 'The backend could not verify Groq\u2019s secure connection. Check the system clock and network certificate settings.'
      : 'The backend connection to Groq was interrupted. Check the connection, then use Try again.');
  if (code) error.networkCode = code;
  return error;
}

export function groqBaseUrl(value = DEFAULT_GROQ_BASE_URL) {
  let url;
  try { url = new URL(value); } catch { throw new ApiError(503, 'The Groq backend URL configuration is invalid.'); }
  // Prevent a configuration mistake from sending a Groq credential elsewhere.
  if (url.origin !== 'https://api.groq.com' || url.pathname.replace(/\/$/, '') !== '/openai/v1' || url.search || url.hash || url.username || url.password) throw new ApiError(503, 'The Groq backend URL must use the official HTTPS API.');
  return DEFAULT_GROQ_BASE_URL;
}
export function validateGroqModel(model) {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/.test(model) || model.includes('..')) throw new ApiError(503, 'The configured Groq model is invalid.');
  return model;
}
export function groqFailure(status, kind = 'AI', code) {
  const billing = ['insufficient_credits', 'credits_exhausted'].includes(code);
  const message = billing ? 'Groq account credits are exhausted. Check your account limits before trying again.'
    : ['model_not_found', 'model_decommissioned'].includes(code) ? 'The configured Groq model is unavailable. Choose an accessible model in the backend settings.'
    : code === 'audio_too_short' ? 'The recording contains too little audio. Record a longer, clear sentence and try again.'
    : status === 401 ? 'Groq authentication failed. Check the backend API key and try again.'
    : status === 402 ? 'Groq account balance or spending limit reached. Check billing before trying again.'
      : status === 403 ? 'Groq denied access. Check backend key permissions, model access and account limits.'
        : status === 404 ? 'The configured Groq model or endpoint is unavailable. Check the backend model setting.'
          : status === 429 ? 'Groq rate limit or quota reached. Wait before trying again.'
            : [400, 413, 415, 422].includes(status) ? kind === 'transcription' ? 'Groq rejected the recording. Try a clear WebM, Ogg or WAV recording.' : 'Groq rejected the request. Check the configured conversation model.'
              : 'Groq is temporarily unavailable. Try again shortly.';
  const error = new ApiError(billing ? 503 : status === 429 ? 429 : [401, 402, 403].includes(status) ? 503 : [400, 413, 415, 422].includes(status) ? 422 : 502, message);
  error.providerStatus = status;
  return error;
}

async function readJson(response) {
  if (Number(response.headers?.get('content-length')) > MAX_PROVIDER_BYTES) throw new ApiError(502, 'Groq returned an oversized response.');
  try {
    // Bound streamed provider bodies too; do not retain raw error bodies.
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > MAX_PROVIDER_BYTES) { await reader.cancel(); throw new ApiError(502, 'Groq returned an oversized response.'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'Groq returned an unreadable response. Please try again.');
  }
}

export async function groqJson(path, { apiKey, baseUrl = DEFAULT_GROQ_BASE_URL, fetchImpl = groqFetch, signal, body, kind = 'AI', timeoutMs = 45_000 } = {}) {
  if (!apiKey?.trim()) throw new ApiError(503, 'Groq is not connected. Configure GROQ_API_KEY on the backend and restart the server.');
  if (!['models', 'chat/completions', 'audio/transcriptions'].includes(path)) throw new ApiError(503, 'Unsupported Groq API endpoint.');
  const base = groqBaseUrl(baseUrl);
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  if (requestSignal.aborted) throw new ApiError(504, 'The AI request timed out or was cancelled. Please try again.');
  try {
    const multipart = body instanceof FormData;
    const response = await fetchImpl(`${base}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) },
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
      signal: requestSignal, redirect: 'error',
    });
    if (!response.ok) {
      let code;
      try {
        const failure = await readJson(response);
        const candidate = failure?.error?.code;
        if (['invalid_api_key', 'authentication_error', 'permission_denied', 'organization_restricted', 'model_not_found', 'model_decommissioned', 'invalid_request_error', 'rate_limit_exceeded', 'insufficient_quota', 'insufficient_credits', 'credits_exhausted', 'audio_too_short'].includes(candidate)) code = candidate;
      } catch { /* The HTTP status still classifies malformed error bodies. */ }
      const error = groqFailure(response.status, kind, code);
      if (code) error.errorCode = code;
      const retryAfter = response.headers?.get('retry-after');
      if (response.status === 429 && retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) error.retryAfter = Math.min(86400, Math.max(1, Math.ceil(Number(retryAfter))));
      throw error;
    }
    const result = await readJson(response);
    if (requestSignal.aborted) throw new ApiError(504, 'The AI request timed out or was cancelled. Please try again.');
    return result;
  } catch (error) {
    if (requestSignal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError') throw Object.assign(new ApiError(504, 'The Groq request timed out or was cancelled. Please try again.'), { endpoint: `${base}/${path}`, errorCode: 'timeout' });
    const failure = error instanceof ApiError ? error : connectionFailure(error);
    failure.endpoint = `${base}/${path}`;
    throw failure;
  }
}

export function safeUsage(usage) {
  if (!usage || typeof usage !== 'object') return {};
  const allowed = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'queue_time', 'prompt_time', 'completion_time', 'total_time', 'cost_usd', 'cost_in_usd_ticks'];
  const result = Object.fromEntries(allowed.filter(key => Number.isFinite(usage[key]) && usage[key] >= 0).map(key => [key, usage[key]]));
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  if (Number.isFinite(reasoning) && reasoning >= 0) result.reasoning_tokens = reasoning;
  return result;
}

export function createGroqModelRegistry(options = {}) {
  let cache = null, expires = 0, loading = null;
  const now = options.now || Date.now;
  async function verify(model, { signal } = {}) {
    validateGroqModel(model);
    if (!options.apiKey) throw new ApiError(503, 'Groq is not connected. Configure GROQ_API_KEY on the backend and restart the server.');
    if (!cache || now() >= expires) {
      if (!loading) loading = groqJson('models', { ...options, timeoutMs: 15_000 }).then(data => {
        if (!Array.isArray(data?.data)) throw new ApiError(502, 'Groq returned unreadable model metadata.');
        cache = new Set(data.data.filter(item => item && item.active !== false && typeof item.id === 'string').map(item => item.id));
        expires = now() + 5 * 60_000;
      }).finally(() => { loading = null; });
      // Coalesce unbilled discovery. A cancelled caller cannot cancel discovery
      // needed by another caller, but cannot start billable work afterward.
      await loading;
    }
    if (signal?.aborted) throw new ApiError(504, 'The AI request timed out or was cancelled. Please try again.');
    if (!cache.has(model)) throw Object.assign(new ApiError(503, 'The configured Groq model is unavailable to this account. Choose an accessible model in the backend settings.'), { endpoint: `${groqBaseUrl(options.baseUrl)}/models`, errorCode: 'model_not_found' });
    return true;
  }
  return { verify, isVerified: model => Boolean(cache?.has(model) && now() < expires) };
}
