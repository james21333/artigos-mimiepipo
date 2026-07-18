/**
 * ComfyUI HTTP client for Character Remix (Wan Animate Replace Person).
 *
 * Debug-only path when COMFYUI_BASE_URL is set (manual pod proxy).
 * Production uses RunPod Serverless — see runpod/character-remix/ and
 * RUNPOD_CHARACTER_REMIX_ENDPOINT_ID.
 *
 * Workflow is a plain JS module export so Cloudflare Pages Functions bundling
 * does not depend on JSON import attributes.
 */

import WAN_REPLACE_WORKFLOW from './workflows/wan-animate-replace-person.api.js';

const LOAD_IMAGE_NODE = '311';
const LOAD_VIDEO_NODE = '417';
const SAVE_VIDEO_NODE = '393';
/** ~5s at 16fps — keeps GPU jobs bounded; override via options.frameLoadCap (0 = uncapped). */
const DEFAULT_FRAME_CAP = 81;

export function comfyConfigured(env) {
  return Boolean(String(env?.COMFYUI_BASE_URL || '').trim());
}

export function comfyBaseUrl(env) {
  return String(env?.COMFYUI_BASE_URL || '')
    .trim()
    .replace(/\/$/, '')
    .replace(/#.*$/, '');
}

function browserHeaders(base, extra = {}) {
  return {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (compatible; ContentStation/1.0; +https://artigos.mimiepipo.com.br)',
    Origin: base,
    Referer: `${base}/`,
    ...extra,
  };
}

async function comfyFetch(env, path, { method = 'GET', body, headers } = {}) {
  const base = comfyBaseUrl(env);
  if (!base) {
    return { ok: false, status: 503, data: { error: 'comfy_unconfigured' } };
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: browserHeaders(base, headers),
    body,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data, text };
}

function safeUploadName(name, fallback) {
  const base = String(name || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 100);
  return base || fallback;
}

/**
 * Upload bytes to ComfyUI input folder. Works for images and videos (VHS reads input/).
 */
export async function comfyUpload(env, bytes, filename, contentType) {
  const base = comfyBaseUrl(env);
  if (!base) return { ok: false, error: 'comfy_unconfigured' };

  const form = new FormData();
  const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
  form.append('image', blob, filename);
  form.append('overwrite', 'true');
  form.append('type', 'input');

  const res = await fetch(`${base}/upload/image`, {
    method: 'POST',
    headers: browserHeaders(base),
    body: form,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    return { ok: false, error: 'upload_failed', status: res.status, data };
  }
  const name = data?.name || data?.Name || data?.filename || filename;
  return { ok: true, name, subfolder: data?.subfolder || '', data };
}

async function fetchUrlBytes(url) {
  const res = await fetch(url);
  if (!res.ok) {
    return { ok: false, error: `fetch_${res.status}`, status: res.status };
  }
  const buf = await res.arrayBuffer();
  const ct = res.headers.get('content-type') || 'application/octet-stream';
  return { ok: true, bytes: buf, contentType: ct };
}

function cloneWorkflow() {
  // Prefer structuredClone; fall back for older runtimes.
  if (typeof structuredClone === 'function') {
    return structuredClone(WAN_REPLACE_WORKFLOW);
  }
  return JSON.parse(JSON.stringify(WAN_REPLACE_WORKFLOW));
}

function buildPrompt(videoName, imageName, { frameLoadCap } = {}) {
  const prompt = cloneWorkflow();
  if (!prompt[LOAD_IMAGE_NODE] || !prompt[LOAD_VIDEO_NODE]) {
    throw new Error('workflow_missing_load_nodes');
  }
  prompt[LOAD_IMAGE_NODE].inputs = {
    ...prompt[LOAD_IMAGE_NODE].inputs,
    image: imageName,
  };
  const capRaw = frameLoadCap === undefined || frameLoadCap === null ? DEFAULT_FRAME_CAP : Number(frameLoadCap);
  const cap = Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : DEFAULT_FRAME_CAP;
  prompt[LOAD_VIDEO_NODE].inputs = {
    ...prompt[LOAD_VIDEO_NODE].inputs,
    video: videoName,
    force_rate: prompt[LOAD_VIDEO_NODE].inputs.force_rate ?? 16,
    frame_load_cap: cap,
    skip_first_frames: 0,
    select_every_nth: 1,
  };
  return prompt;
}

/**
 * Download media from public URLs, upload to Comfy, queue Wan Animate Replace.
 * @returns {{ ok, jobId: `comfy:${prompt_id}`, promptId }}
 */
export async function submitComfyCharacterRemix(env, { videoUrl, imageUrl, options = {} } = {}) {
  if (!comfyConfigured(env)) {
    return { ok: false, error: 'comfy_unconfigured', message: 'Set COMFYUI_BASE_URL' };
  }
  if (!videoUrl || !imageUrl) {
    return { ok: false, error: 'missing_urls' };
  }

  const stamp = Date.now();
  const videoFetch = await fetchUrlBytes(videoUrl);
  if (!videoFetch.ok) return { ok: false, error: 'video_fetch_failed', detail: videoFetch };
  const imageFetch = await fetchUrlBytes(imageUrl);
  if (!imageFetch.ok) return { ok: false, error: 'image_fetch_failed', detail: imageFetch };

  const videoExt = /\.webm$/i.test(videoUrl) ? 'webm' : 'mp4';
  const imageExt = /\.jpe?g$/i.test(imageUrl)
    ? 'jpg'
    : /\.webp$/i.test(imageUrl)
      ? 'webp'
      : 'png';
  const videoName = safeUploadName(`cs_src_${stamp}.${videoExt}`, `source.${videoExt}`);
  const imageName = safeUploadName(`cs_char_${stamp}.${imageExt}`, `character.${imageExt}`);

  const upVideo = await comfyUpload(env, videoFetch.bytes, videoName, videoFetch.contentType || 'video/mp4');
  if (!upVideo.ok) return { ok: false, error: 'video_upload_failed', detail: upVideo };
  const upImage = await comfyUpload(env, imageFetch.bytes, imageName, imageFetch.contentType || 'image/png');
  if (!upImage.ok) return { ok: false, error: 'image_upload_failed', detail: upImage };

  let prompt;
  try {
    prompt = buildPrompt(upVideo.name, upImage.name, {
      frameLoadCap: options.frameLoadCap,
    });
  } catch (err) {
    return { ok: false, error: 'workflow_build_failed', message: err?.message || String(err) };
  }

  const queued = await comfyFetch(env, '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      client_id: `contentstation-${stamp}`,
    }),
  });

  if (!queued.ok) {
    const errObj = queued.data?.error;
    const nodeErrs = queued.data?.node_errors
      ? JSON.stringify(queued.data.node_errors).slice(0, 400)
      : '';
    const msg =
      (typeof errObj === 'string' && errObj) ||
      errObj?.message ||
      nodeErrs ||
      queued.data?.message ||
      'ComfyUI rejected the workflow';
    return {
      ok: false,
      error: 'prompt_failed',
      status: queued.status,
      data: queued.data,
      message: msg,
    };
  }

  const promptId = queued.data?.prompt_id || queued.data?.promptId;
  if (!promptId) {
    return { ok: false, error: 'missing_prompt_id', data: queued.data };
  }

  return {
    ok: true,
    backend: 'comfyui',
    jobId: `comfy:${promptId}`,
    promptId,
    uploaded: { video: upVideo.name, image: upImage.name },
  };
}

function viewUrlFor(base, item) {
  const q = new URLSearchParams({
    filename: item.filename,
    subfolder: item.subfolder || '',
    type: item.type || 'output',
  });
  return `${base}/view?${q.toString()}`;
}

function pushMediaItems(media, nodeId, kind, arr, base) {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (!item?.filename) continue;
    media.push({
      nodeId,
      kind,
      filename: item.filename,
      viewUrl: viewUrlFor(base, item),
      item,
    });
  }
}

function collectMediaFromHistory(historyEntry, base) {
  const outputs = historyEntry?.outputs || {};
  const media = [];
  for (const [nodeId, out] of Object.entries(outputs)) {
    // SaveVideo / PreviewVideo often land under images (with video mime) or videos.
    pushMediaItems(media, nodeId, 'videos', out?.videos, base);
    pushMediaItems(media, nodeId, 'gifs', out?.gifs, base);
    pushMediaItems(media, nodeId, 'images', out?.images, base);
    // Some custom nodes nest under files / output
    pushMediaItems(media, nodeId, 'files', out?.files, base);
  }

  const isVideoName = (m) => /\.(mp4|webm|mov|mkv)$/i.test(m.filename || '');
  // Prefer SaveVideo node 393, then any mp4/webm, then first media
  const fromSave =
    media.find((m) => m.nodeId === SAVE_VIDEO_NODE && isVideoName(m)) ||
    media.find((m) => m.nodeId === SAVE_VIDEO_NODE) ||
    null;
  const video = fromSave || media.find(isVideoName) || media[0] || null;
  return { media, video };
}

/** Comfy queue row: [number, prompt_id, prompt, extra_data, outputs_to_execute] */
function rowPromptId(row) {
  if (!Array.isArray(row)) return null;
  const id = row[1];
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object') return id.prompt_id || id.promptId || null;
  return null;
}

/**
 * Poll Comfy history for a comfy:promptId job.
 */
export async function statusComfyCharacterRemix(env, jobId) {
  if (!comfyConfigured(env)) {
    return { ok: false, error: 'comfy_unconfigured' };
  }
  const promptId = String(jobId || '').replace(/^comfy:/, '');
  if (!promptId) return { ok: false, error: 'missing_prompt_id' };

  const base = comfyBaseUrl(env);
  const hist = await comfyFetch(env, `/history/${encodeURIComponent(promptId)}`);
  if (!hist.ok) {
    return { ok: false, status: hist.status, data: hist.data, error: 'history_failed' };
  }

  // /history/{id} returns { [promptId]: entry } or occasionally the entry alone
  let entry = hist.data?.[promptId];
  if (!entry && hist.data?.outputs) {
    entry = hist.data;
  }
  if (!entry && hist.data && typeof hist.data === 'object') {
    const keys = Object.keys(hist.data);
    if (keys.length === 1) entry = hist.data[keys[0]];
  }

  if (!entry) {
    // Still queued / running — or vanished (treat as in-progress until timeout client-side)
    const q = await comfyFetch(env, '/queue');
    const running = q.data?.queue_running || [];
    const pending = q.data?.queue_pending || [];
    const inRunning = running.some((row) => rowPromptId(row) === promptId);
    const inPending = pending.some((row) => rowPromptId(row) === promptId);
    return {
      ok: true,
      status: inRunning ? 'IN_PROGRESS' : inPending ? 'IN_QUEUE' : 'IN_PROGRESS',
      jobId: `comfy:${promptId}`,
      promptId,
      remixReady: false,
      videoUrl: null,
    };
  }

  const statusStr = String(entry.status?.status_str || '').toLowerCase();
  const messages = entry.status?.messages;
  const execErr = Array.isArray(messages)
    ? messages.find((m) => m?.[0] === 'execution_error')
    : null;
  if (statusStr === 'error' || execErr) {
    const errMsg =
      execErr?.[1]?.exception_message ||
      execErr?.[1]?.exception_type ||
      'ComfyUI execution failed';
    return {
      ok: true,
      status: 'FAILED',
      jobId: `comfy:${promptId}`,
      promptId,
      remixReady: false,
      videoUrl: null,
      error: errMsg,
      history: entry.status,
    };
  }

  // History present but not marked complete yet (rare) — keep polling
  if (entry.status && entry.status.completed === false && statusStr !== 'success') {
    return {
      ok: true,
      status: 'IN_PROGRESS',
      jobId: `comfy:${promptId}`,
      promptId,
      remixReady: false,
      videoUrl: null,
    };
  }

  const { video, media } = collectMediaFromHistory(entry, base);
  if (video?.viewUrl) {
    return {
      ok: true,
      status: 'COMPLETED',
      jobId: `comfy:${promptId}`,
      promptId,
      remixReady: true,
      videoUrl: video.viewUrl,
      media,
    };
  }

  // Outputs missing but status success — still treat as incomplete briefly
  if (statusStr === 'success' || entry.status?.completed === true) {
    return {
      ok: true,
      status: 'COMPLETED',
      jobId: `comfy:${promptId}`,
      promptId,
      remixReady: false,
      videoUrl: null,
      error: 'no_output_video',
      media,
    };
  }

  return {
    ok: true,
    status: 'IN_PROGRESS',
    jobId: `comfy:${promptId}`,
    promptId,
    remixReady: false,
    videoUrl: null,
  };
}

export async function cancelComfyCharacterRemix(env, jobId) {
  const promptId = String(jobId || '').replace(/^comfy:/, '');
  // Best-effort interrupt current + delete from queue
  await comfyFetch(env, '/interrupt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (promptId) {
    await comfyFetch(env, '/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    });
  }
  return { ok: true, jobId: `comfy:${promptId}` };
}
