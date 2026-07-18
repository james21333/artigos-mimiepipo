/**
 * Character remix helpers: RunPod Serverless (primary) + optional ComfyUI proxy debug.
 */

import { createR2PresignedGet } from './r2-presign.js';
import { comfyConfigured } from './comfyui-client.js';

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

/**
 * Production path: RunPod Serverless.
 * COMFYUI_BASE_URL is debug-only (manual pod proxy) and only used when Serverless is unset.
 */
export function remixBackend(env) {
  if (runpodConfigured(env)) return 'runpod';
  if (comfyConfigured(env)) return 'comfyui';
  return null;
}

export function remixConfigured(env) {
  return remixBackend(env) != null;
}

export function isComfyJobId(jobId) {
  return String(jobId || '').startsWith('comfy:');
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
    // Default 0.85 — strong enough for visible scenery change (was 0.62 / silent-weak).
    automatic_scene_restyle_strength: numOr(opts.sceneRestyleStrength, 0.85),
    enable_scene_restyle: opts.enableSceneRestyle !== false,
    source_scene_similarity: numOr(opts.sourceSceneSimilarity, 0.72),
    environment_variation: numOr(opts.environmentVariation, 0.58),
    preserve_audio: opts.preserveAudio !== false,
    discard_speech_captions: opts.discardSpeechCaptions === true,
    restore_non_speech_text: opts.restoreNonSpeechText !== false,
    output_width: 720,
    output_height: 1280,
    output_fps: opts.outputFps ?? 24,
    seed: opts.seed ?? Math.floor(Math.random() * 1e9),
    frame_load_cap: opts.frameLoadCap ?? 81,
    max_source_seconds: numOr(opts.maxSourceSeconds, 18),
    chunk_seconds: numOr(opts.chunkSeconds, 81 / 16),
    max_chunks: Math.max(1, Math.floor(numOr(opts.maxChunks, 4))),
  };
}

/** Pull worker progress / stage from RunPod status payloads. */
export function extractRemixProgress(data) {
  if (!data || typeof data !== 'object') return null;
  const progress = data.progress ?? data.output?.progress ?? null;
  const meta = data.output?.processing_metadata || data.processing_metadata || null;
  const stage =
    (progress && typeof progress === 'object' && (progress.stage || progress.message)) ||
    (typeof progress === 'string' ? progress : null) ||
    meta?.stage ||
    null;
  if (!stage && !meta && progress == null) return null;
  return {
    stage: stage ? String(stage) : null,
    message:
      (progress && typeof progress === 'object' && progress.message) ||
      (typeof progress === 'string' ? progress : null) ||
      null,
    chunk: progress && typeof progress === 'object' ? progress.chunk ?? null : null,
    chunks: progress && typeof progress === 'object' ? progress.chunks ?? null : null,
    mode: meta?.mode || null,
    vaceEnabled: meta?.vace_enabled ?? null,
    vaceAvailable: meta?.vace_available ?? null,
    chunkCount: data.output?.chunk_count ?? meta?.chunk_count ?? null,
    durationSeconds: data.output?.duration_seconds ?? null,
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
export async function archiveRemixVideo(
  env,
  { sourceUrl, filename, sourceKey, runpodJobId, tiktokUrl } = {},
) {
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
      tiktokUrl: tiktokUrl ? String(tiktokUrl).slice(0, 500) : '',
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

/** Base64 MP4 from worker when R2 upload is not configured on the endpoint. */
export function extractOutputVideoBase64(data) {
  if (!data || typeof data !== 'object') return null;
  const out = data.output ?? data;
  if (!out || typeof out !== 'object') return null;
  const b64 = out.video_base64 || out.videoBase64;
  if (typeof b64 !== 'string' || b64.length < 32) return null;
  return {
    base64: b64,
    mime: out.video_mime || out.videoMime || 'video/mp4',
  };
}

/**
 * Archive base64 worker output into character-remix/ on R2.
 * When `key` or `runpodJobId` is provided, uses a stable key so status polls are idempotent.
 */
export async function archiveRemixVideoFromBase64(
  env,
  { base64, filename, sourceKey, runpodJobId, mime, key: forcedKey, tiktokUrl } = {},
) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };
  if (!base64 || typeof base64 !== 'string') {
    return { ok: false, error: 'missing_base64' };
  }

  let key = forcedKey;
  if (!key && runpodJobId) {
    key = `${CHARACTER_REMIX_PREFIX}runpod/${safeName(runpodJobId, 'job')}.mp4`;
  }
  if (!key) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = safeName(filename || sourceKey || 'remix');
    key = `${CHARACTER_REMIX_PREFIX}${stamp}_${base}.mp4`;
  }

  // Idempotent: if we already archived this job, reuse it.
  try {
    const existing = await bucket.head(key);
    if (existing) {
      return {
        ok: true,
        key,
        downloadPath: downloadPath(key),
        publicUrl: publicMediaUrl(env, key),
        reused: true,
      };
    }
  } catch {
    // head miss — continue to put
  }

  let bytes;
  try {
    const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
    const bin = atob(cleaned);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    bytes = arr;
  } catch (err) {
    return { ok: false, error: err?.message || 'base64_decode_failed' };
  }

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: mime || 'video/mp4' },
    customMetadata: {
      source: 'character-remix',
      runpodJobId: runpodJobId ? String(runpodJobId) : '',
      sourceKey: sourceKey ? String(sourceKey) : '',
      tiktokUrl: tiktokUrl ? String(tiktokUrl).slice(0, 500) : '',
    },
  });

  return {
    ok: true,
    key,
    downloadPath: downloadPath(key),
    publicUrl: publicMediaUrl(env, key),
  };
}

export function configPayload(env) {
  const ep = remixEndpointId(env);
  const backend = remixBackend(env);
  const comfy = comfyConfigured(env);
  const runpod = runpodConfigured(env);
  let message;
  if (backend === 'runpod') {
    message =
      'Full remix via RunPod Serverless: character replace, optional VACE scenery, segment+stitch ≤18s → one MP4.';
  } else if (backend === 'comfyui') {
    message =
      'Debug: ComfyUI proxy (character only, no stitch). Production uses RUNPOD_CHARACTER_REMIX_ENDPOINT_ID.';
  } else {
    message =
      'Set RUNPOD_API_KEY + RUNPOD_CHARACTER_REMIX_ENDPOINT_ID (RunPod Serverless). See runpod/character-remix/README.md.';
  }
  return {
    configured: Boolean(backend),
    backend,
    pipeline: {
      captionStrip: 'ghostcut_removeWatermark',
      characterReplace: 'wan_animate_replace_person',
      sceneRestyle: 'wan21_vace_if_workflow_present',
      segmentStitch: { maxSeconds: 18, chunkFrames: 81, chunkFps: 16 },
      hooksRestore: 'ghostcut_ocr_minus_asr_burn',
      alterAudio: 'cloudconvert_optional',
      output: 'character-remix/ mp4',
    },
    backends: {
      runpod: {
        configured: runpod,
        preferred: true,
        hasApiKey: Boolean(env.RUNPOD_API_KEY),
        hasEndpointId: Boolean(ep),
        endpointId: ep,
      },
      comfyui: {
        configured: comfy,
        preferred: false,
        debugOnly: true,
      },
    },
    hasApiKey: Boolean(env.RUNPOD_API_KEY),
    hasEndpointId: Boolean(ep),
    endpointId: ep,
    templateId: env.RUNPOD_TEMPLATE_ID ? String(env.RUNPOD_TEMPLATE_ID) : null,
    r2Public: Boolean(env.R2_PUBLIC_BASE_URL),
    message,
  };
}
