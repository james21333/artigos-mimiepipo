/**
 * Character remix helpers: RunPod WAN endpoint + archive remixed MP4s to R2.
 */

import { createR2PresignedGet } from './r2-presign.js';

export const CHARACTER_REMIX_PREFIX = 'character-remix/';
export const CHARACTERS_PREFIX = 'characters/';

const RUNPOD_BASE = 'https://api.runpod.ai/v2';

export function remixEndpointId(env, override) {
  const id = (
    override ||
    env.RUNPOD_CHARACTER_REMIX_ENDPOINT_ID ||
    env.RUNPOD_ENDPOINT_ID ||
    ''
  ).trim();
  return id || null;
}

export function runpodConfigured(env) {
  return Boolean(env.RUNPOD_API_KEY && remixEndpointId(env));
}

export async function runpodFetch(env, path, { method = 'GET', body } = {}) {
  const key = env.RUNPOD_API_KEY;
  if (!key) {
    return {
      ok: false,
      status: 503,
      data: {
        error: 'runpod_unconfigured',
        message: 'RUNPOD_API_KEY is not set.',
      },
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

/** Normalize UI/API options into RunPod worker input. */
export function buildRemixInput({
  sourceVideoUrl,
  originalVideoUrl,
  characterImageUrl,
  options = {},
} = {}) {
  const opts = options || {};
  return {
    source_video_url: sourceVideoUrl,
    original_video_url: originalVideoUrl || sourceVideoUrl,
    character_image_url: characterImageUrl,
    character_strength: numOr(opts.characterStrength, 0.9),
    automatic_scene_restyle_strength: numOr(opts.sceneRestyleStrength, 0.62),
    source_scene_similarity: numOr(opts.sourceSceneSimilarity, 0.72),
    environment_variation: numOr(opts.environmentVariation, 0.58),
    preserve_audio: opts.preserveAudio !== false,
    discard_speech_captions: opts.discardSpeechCaptions !== false,
    restore_non_speech_text: opts.restoreNonSpeechText !== false,
    output_width: 720,
    output_height: 1280,
    output_fps: opts.outputFps ?? 24,
    seed: opts.seed ?? Math.floor(Math.random() * 1e9),
  };
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function downloadPath(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

function safeName(raw, fallback = 'remix') {
  const s = String(raw || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return s || fallback;
}

/**
 * Download a finished remix URL into character-remix/ on R2.
 */
export async function archiveRemixVideo(env, { sourceUrl, filename, sourceKey, runpodJobId } = {}) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return { ok: false, error: 'missing_source_url' };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = safeName(filename || sourceKey || runpodJobId || 'remix');
  const key = `${CHARACTER_REMIX_PREFIX}${stamp}_${base}.mp4`;

  let res;
  try {
    res = await fetch(sourceUrl);
  } catch (err) {
    return { ok: false, error: err?.message || 'fetch_failed' };
  }
  if (!res.ok) {
    return { ok: false, error: `download_failed_${res.status}` };
  }
  const buf = await res.arrayBuffer();
  await bucket.put(key, buf, {
    httpMetadata: { contentType: 'video/mp4' },
    customMetadata: {
      source: 'character-remix',
      runpodJobId: runpodJobId ? String(runpodJobId) : '',
      sourceKey: sourceKey ? String(sourceKey) : '',
    },
  });

  return {
    ok: true,
    key,
    downloadPath: downloadPath(key),
    publicUrl: publicMediaUrl(env, key),
  };
}

/** Pull video URL from heterogeneous RunPod worker outputs. */
export function extractOutputVideoUrl(data) {
  if (!data || typeof data !== 'object') return null;
  const out = data.output ?? data;
  if (typeof out === 'string' && /^https?:\/\//i.test(out)) return out;
  if (out && typeof out === 'object') {
    for (const k of ['video_url', 'videoUrl', 'url', 'result_url', 'resultUrl']) {
      if (typeof out[k] === 'string' && /^https?:\/\//i.test(out[k])) return out[k];
    }
    if (Array.isArray(out.videos) && out.videos[0]) {
      const v = out.videos[0];
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
      if (v && typeof v.url === 'string') return v.url;
    }
  }
  return null;
}
