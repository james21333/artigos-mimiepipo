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

export function configPayload(env) {
  const configured = remix2WorkerConfigured(env);
  return {
    configured,
    backend: 'fast-panda-og',
    hasWorkerUrl: Boolean(String(env?.REMIX2_WORKER_URL || '').trim()),
    hasWorkerSecret: Boolean(String(env?.REMIX2_WORKER_SECRET || '').trim()),
    stages: {
      firstFrames: 'codex-oauth',
      videos: 'grok-oauth-after-supergrok',
      stitch: 'ffmpeg-on-fast-panda',
    },
    message: configured
      ? 'Remix 2 - OG worker ready (Codex first-frames; Grok videos after SuperGrok login on Fast Panda).'
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
