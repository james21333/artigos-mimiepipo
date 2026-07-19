/**
 * Remix 2 - OG: Content Station ↔ Fast Panda worker helpers.
 * Pages never holds Codex/Grok OAuth — only REMIX2_WORKER_URL + REMIX2_WORKER_SECRET.
 */

export const REMIX2_PREFIX = 'character-remix-2-og/';

export function remix2WorkerConfigured(env) {
  return Boolean(String(env?.REMIX2_WORKER_URL || '').trim() && String(env?.REMIX2_WORKER_SECRET || '').trim());
}

export function remix2WorkerBase(env) {
  return String(env?.REMIX2_WORKER_URL || '')
    .trim()
    .replace(/\/$/, '');
}

export function remix2R2Payload(env) {
  return {
    publicBaseUrl: env.R2_PUBLIC_BASE_URL || null,
    bucket: env.R2_BUCKET_NAME || env.R2_BUCKET || null,
    endpoint: env.R2_ENDPOINT || null,
    accessKeyId: env.R2_ACCESS_KEY_ID || null,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || null,
    accountId: env.R2_ACCOUNT_ID || null,
  };
}

export function configPayload(env) {
  const configured = remix2WorkerConfigured(env);
  return {
    configured,
    backend: 'fast-panda-og',
    hasWorkerUrl: Boolean(String(env?.REMIX2_WORKER_URL || '').trim()),
    hasWorkerSecret: Boolean(String(env?.REMIX2_WORKER_SECRET || '').trim()),
    stages: {
      analyze: 'ffmpeg-edl-ms',
      deriveCharacter: 'codex-oauth-auto-similar',
      firstFrames: 'codex-oauth',
      videos: 'grok-oauth',
      stitch: 'ffmpeg-edl-trim',
    },
    characterModes: ['upload', 'auto-similar'],
    versions: ['v1', 'v2'],
    identityLockNote:
      'V2 (identityLock): uploaded character only — Codex refs = character (+ product/set); never structure_*/TikTok keyframes; Grok start = Codex stills.',
    message: configured
      ? 'Remix 2 ready: TikTok → ms EDL → (optional auto-similar character) → Codex frames → Grok clips → stitch. V2 = identity-lock upload.'
      : 'Set REMIX2_WORKER_URL and REMIX2_WORKER_SECRET (Fast Panda worker).',
    n8nFallbackNote:
      'If video gen fails, fall back to visual n8n on Fast Panda for audit/tweak — not required for v1.',
  };
}

/** Strip R2 credentials if a worker ever echoes them in job state. */
export function sanitizeWorkerPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = { ...data };
  if (out.r2 && typeof out.r2 === 'object') {
    const r2 = out.r2;
    out.r2 = {
      publicBaseUrl: r2.publicBaseUrl || null,
      bucket: r2.bucket || null,
      configured: Boolean(
        r2.configured ||
          r2.publicBaseUrl ||
          (r2.accessKeyId && r2.secretAccessKey && (r2.endpoint || r2.accountId)),
      ),
    };
  }
  return out;
}

export async function workerFetch(env, path, { method = 'GET', body } = {}) {
  const base = remix2WorkerBase(env);
  const secret = String(env?.REMIX2_WORKER_SECRET || '').trim();
  if (!base || !secret) {
    return {
      ok: false,
      status: 503,
      data: { error: 'remix2_unconfigured', message: 'REMIX2_WORKER_URL / REMIX2_WORKER_SECRET missing.' },
    };
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${secret}`,
    Accept: 'application/json',
  };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data: sanitizeWorkerPayload(data) };
}
