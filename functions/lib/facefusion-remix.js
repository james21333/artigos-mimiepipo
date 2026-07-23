/**
 * FaceFusion remix helpers (Remix 3) — RunPod Serverless headless face swap.
 */

import { createR2PresignedGet } from './r2-presign.js';

export const FACEFUSION_PREFIX = 'facefusion-remix/';
export const FACES_PREFIX = 'faces/';

const RUNPOD_BASE = 'https://api.runpod.ai/v2';

export function facefusionEndpointId(env, override) {
  const id = (
    override ||
    env.RUNPOD_FACEFUSION_ENDPOINT_ID ||
    env.RUNPOD_ENDPOINT_ID ||
    ''
  ).trim();
  return id || null;
}

export function facefusionConfigured(env) {
  return Boolean(env.RUNPOD_API_KEY && facefusionEndpointId(env));
}

export async function runpodFetch(env, path, { method = 'GET', body } = {}) {
  const key = env.RUNPOD_API_KEY;
  if (!key) {
    return {
      ok: false,
      status: 503,
      data: { error: 'runpod_unconfigured', message: 'RUNPOD_API_KEY is not set.' },
    };
  }
  const url = `${RUNPOD_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${key}`,
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
  return { ok: res.ok, status: res.status, data };
}

export function publicMediaUrl(env, key) {
  const base = (env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base || !key) return null;
  return `${base}/${key}`;
}

export async function fetchableMediaUrl(env, key) {
  const pub = publicMediaUrl(env, key);
  if (pub) return { url: pub, kind: 'public' };
  const signed = await createR2PresignedGet(env, { key, expiresIn: 21600 });
  if (signed.ok) return { url: signed.url, kind: 'presigned-get', expiresIn: signed.expiresIn };
  return { url: null, kind: null, error: signed };
}

export function buildFacefusionInput({ faceUrl, videoUrl, options = {} } = {}) {
  const opts = options || {};
  return {
    faceUrl,
    videoUrl,
    options: {
      enhance: opts.enhance !== false,
      maxSeconds: opts.maxSeconds ?? 90,
    },
  };
}

export function extractOutputVideoUrl(data) {
  const out = data?.output;
  if (!out || typeof out !== 'object') return null;
  for (const k of ['videoUrl', 'video_url', 'url', 'outputUrl', 'output_url']) {
    if (typeof out[k] === 'string' && /^https?:\/\//i.test(out[k])) return out[k];
  }
  return null;
}

export function extractOutputVideoBase64(data) {
  const out = data?.output;
  if (!out || typeof out !== 'object') return null;
  const b64 = out.videoBase64 || out.video_base64 || out.base64;
  if (typeof b64 !== 'string' || b64.length < 64) return null;
  return { base64: b64, mime: out.mime || 'video/mp4' };
}

export function extractFacefusionProgress(data) {
  const status = String(data?.status || '').toUpperCase();
  if (status === 'IN_QUEUE') {
    return { stage: 'queued', label: 'Waiting for GPU…' };
  }
  if (status === 'IN_PROGRESS') {
    return { stage: 'running', label: 'FaceFusion running…' };
  }
  if (status === 'COMPLETED') {
    return { stage: 'done', label: 'Done' };
  }
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
    return { stage: 'failed', label: status };
  }
  return null;
}

export function configPayload(env) {
  const ep = facefusionEndpointId(env);
  return {
    configured: facefusionConfigured(env),
    backend: facefusionConfigured(env) ? 'runpod' : null,
    endpointId: ep,
    facesPrefix: FACES_PREFIX,
    outputPrefix: FACEFUSION_PREFIX,
    r2Public: Boolean(env.R2_PUBLIC_BASE_URL),
  };
}

function safeName(s, fallback = 'clip') {
  return String(s || fallback)
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

export async function archiveFacefusionVideo(
  env,
  { sourceUrl, filename, sourceKey, runpodJobId, tiktokUrl, faceKey } = {},
) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return { ok: false, error: 'missing_source_url' };
  }

  let res;
  try {
    res = await fetch(sourceUrl, { headers: { 'User-Agent': 'ContentStation-FaceFusion/1.0' } });
  } catch (err) {
    return { ok: false, error: 'fetch_failed', detail: String(err?.message || err) };
  }
  if (!res.ok) {
    return { ok: false, error: 'fetch_http', detail: `HTTP ${res.status}` };
  }
  const bytes = await res.arrayBuffer();
  const base = safeName(filename || sourceKey || runpodJobId || 'facefusion');
  const key = `${FACEFUSION_PREFIX}${base}_${Date.now()}.mp4`;
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: 'video/mp4' },
    customMetadata: {
      source: 'facefusion-remix',
      sourceKey: sourceKey ? String(sourceKey).slice(0, 200) : '',
      faceKey: faceKey ? String(faceKey).slice(0, 200) : '',
      tiktokUrl: tiktokUrl ? String(tiktokUrl).slice(0, 300) : '',
      jobId: runpodJobId ? String(runpodJobId) : '',
      runpodJobId: runpodJobId ? String(runpodJobId) : '',
    },
  });
  return {
    ok: true,
    key,
    size: bytes.byteLength,
    publicUrl: publicMediaUrl(env, key),
    downloadPath: `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`,
  };
}

export async function archiveFacefusionVideoFromBase64(
  env,
  { base64, filename, sourceKey, runpodJobId, mime, key: forcedKey, tiktokUrl, faceKey } = {},
) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };
  if (!base64 || typeof base64 !== 'string') {
    return { ok: false, error: 'missing_base64' };
  }
  const raw = base64.includes(',') ? base64.split(',').pop() : base64;
  let bytes;
  try {
    const bin = atob(raw);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    bytes = arr.buffer;
  } catch (err) {
    return { ok: false, error: 'invalid_base64', detail: String(err?.message || err) };
  }

  let key = forcedKey;
  if (!key && runpodJobId) {
    key = `${FACEFUSION_PREFIX}runpod/${safeName(runpodJobId, 'job')}.mp4`;
  }
  if (!key) {
    const base = safeName(filename || sourceKey || 'facefusion');
    key = `${FACEFUSION_PREFIX}${base}_${Date.now()}.mp4`;
  }

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: mime || 'video/mp4' },
    customMetadata: {
      source: 'facefusion-remix',
      sourceKey: sourceKey ? String(sourceKey).slice(0, 200) : '',
      faceKey: faceKey ? String(faceKey).slice(0, 200) : '',
      tiktokUrl: tiktokUrl ? String(tiktokUrl).slice(0, 300) : '',
      jobId: runpodJobId ? String(runpodJobId) : '',
      runpodJobId: runpodJobId ? String(runpodJobId) : '',
    },
  });
  return {
    ok: true,
    key,
    size: bytes.byteLength,
    publicUrl: publicMediaUrl(env, key),
    downloadPath: `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`,
  };
}
