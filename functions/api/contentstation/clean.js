import { json, requireSession } from '../../lib/contentstation-auth.js';
import { ghostcutPost } from '../../lib/ghostcut.js';

/**
 * Consumer-facing clean-video API.
 * Wraps signed video processing without exposing vendor names in client-facing messages.
 *
 * POST JSON:
 *   { action: "submit", videoUrl, options }
 *   { action: "status", workId }
 *   { action: "upload-policy" }  → OSS form fields for direct video upload
 *
 * POST multipart/form-data:
 *   file + options (JSON string) → upload then submit (≤ ~90MB)
 *
 * Option → API mapping (internal; see docs/CLEAN-VIDEO-INTERNAL.md):
 *   removeWatermark → needChineseOcclude + advanced_lite fullscreen OCR erase
 *   cleanMetadata   → re-encode via write_options.crf (no strip/rewrite metadata flag exists)
 *   remix           → needTrim + needRescale + needShift (+ trim color/crop/speed)
 *   mirror          → needMirror=1
 */

const WORK_FREE = '/v-w-c/gateway/ve/work/free';
const WORK_STATUS = '/v-w-c/gateway/ve/work/status';
const UPLOAD_POLICY = '/v-w-c/gateway/ve/file/upload/policy/apply';
const MAX_PROXY_UPLOAD = 90 * 1024 * 1024;

function friendlyError(raw) {
  const text = String(raw || 'Something went wrong. Please try again.');
  return text
    .replace(/ghost\s*cut/gi, 'processor')
    .replace(/jolly\s*today/gi, 'processor')
    .replace(/\bzhaoli\b/gi, 'processor')
    .replace(/\brunpod\b/gi, 'compute')
    .replace(/\bR2\b/g, 'storage')
    .replace(/cloudflare/gi, 'host');
}

function sanitizePayload(data) {
  if (data == null) return data;
  if (typeof data === 'string') return friendlyError(data);
  if (Array.isArray(data)) return data.map(sanitizePayload);
  if (typeof data !== 'object') return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (/ghostcut|jolly|zhaoli|runpod|appkey|appsecret/i.test(k)) continue;
    out[k] = sanitizePayload(v);
  }
  return out;
}

function clientFail(message, status = 400, extra = {}) {
  return json({ ok: false, error: 'clean_failed', message: friendlyError(message), ...extra }, status);
}

function parseOptions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    removeWatermark: Boolean(src.removeWatermark),
    cleanMetadata: Boolean(src.cleanMetadata),
    remix: Boolean(src.remix),
    mirror: Boolean(src.mirror),
  };
}

function isPublicHttpsUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    // Processor rejects Chinese characters in URL paths.
    if (/[\u4e00-\u9fff]/.test(url)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Build /work/free payload from checkbox options.
 * Limitation: there is no documented metadata strip/rewrite flag; cleanMetadata
 * forces a re-encode (write_options.crf) so the export is a new container.
 */
export function buildCleanPayload(videoUrl, options) {
  const opts = parseOptions(options);
  if (!opts.removeWatermark && !opts.cleanMetadata && !opts.remix && !opts.mirror) {
    return { error: 'Select at least one clean option.' };
  }

  const payload = {
    urls: [videoUrl],
    names: ['clean-video'],
    resolution: '1080p',
  };

  const extra = {};

  if (opts.cleanMetadata) {
    // Closest supported approach: re-export with a fresh encode.
    // Does not inject fake device metadata; source tags are typically dropped on re-mux.
    extra.write_options = { crf: 18 };
  }

  if (opts.removeWatermark) {
    // TikTok-style text/logo overlays: advanced_lite fullscreen OCR erase.
    payload.needChineseOcclude = 2;
    payload.videoInpaintLang = 'all';
    extra.extra_inpaint_config = { model: 'advanced_lite' };
    payload.videoInpaintMasks = JSON.stringify([
      {
        type: 'remove_only_ocr',
        start: 0,
        end: 99999,
        region: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      },
    ]);
  }

  if (opts.remix) {
    // Community unique-ify: color / micro-crop / speed + rescale + camera shift.
    payload.needTrim = 1;
    payload.needRescale = 3;
    payload.needShift = 1;
    extra.extra_trim_config = {
      adjust_color_on: true,
      adjust_sharpness_on: true,
      crop_trailer_on: false,
      speedup_on: true,
    };
  }

  if (opts.mirror) {
    payload.needMirror = 1;
  }

  if (Object.keys(extra).length) {
    payload.extraOptions = JSON.stringify(extra);
  }

  return { payload };
}

function extractWorkId(data) {
  const list = data?.body?.dataList;
  if (Array.isArray(list) && list[0] && list[0].id != null) {
    return String(list[0].id);
  }
  return null;
}

function mapProcessStatus(processStatus) {
  const n = Number(processStatus);
  if (!Number.isFinite(n)) return { state: 'unknown', label: 'Checking…' };
  if (n === 1) return { state: 'ready', label: 'Ready to download' };
  if (n < 1) return { state: 'processing', label: 'Cleaning…' };
  return { state: 'failed', label: 'Cleaning failed' };
}

function summarizeStatus(data) {
  const content = data?.body?.content;
  if (!Array.isArray(content) || !content.length) {
    return { state: 'unknown', label: 'No status yet', works: [] };
  }
  const works = content.map((c) => {
    const mapped = mapProcessStatus(c.processStatus);
    return {
      workId: c.id != null ? String(c.id) : null,
      state: mapped.state,
      label: mapped.label,
      processStatus: c.processStatus,
      downloadUrl: mapped.state === 'ready' ? c.videoUrl || null : null,
      error: mapped.state === 'failed' ? friendlyError(c.errorDetail || 'Processing failed') : null,
    };
  });
  const primary = works[0];
  return {
    state: primary.state,
    label: primary.label,
    downloadUrl: primary.downloadUrl,
    error: primary.error,
    works,
  };
}

async function submitWork(env, videoUrl, options) {
  if (!isPublicHttpsUrl(videoUrl)) {
    return { ok: false, response: clientFail('A valid public video URL is required.', 400) };
  }
  const built = buildCleanPayload(videoUrl, options);
  if (built.error) {
    return { ok: false, response: clientFail(built.error, 400) };
  }

  const result = await ghostcutPost(env, WORK_FREE, built.payload);
  if (!result.ok) {
    const msg =
      result.data?.msg ||
      result.data?.message ||
      result.data?.error ||
      'Could not start cleaning.';
    return {
      ok: false,
      response: clientFail(msg, result.status || 502, { detail: sanitizePayload(result.data) }),
    };
  }

  // Upstream business errors often still HTTP 200 with code != 1000
  if (result.data && result.data.code != null && Number(result.data.code) !== 1000) {
    return {
      ok: false,
      response: clientFail(result.data.msg || 'Could not start cleaning.', 502, {
        detail: sanitizePayload(result.data),
      }),
    };
  }

  const workId = extractWorkId(result.data);
  if (!workId) {
    return {
      ok: false,
      response: clientFail('Job started but no work id was returned.', 502, {
        detail: sanitizePayload(result.data),
      }),
    };
  }

  return {
    ok: true,
    response: json({
      ok: true,
      workId,
      state: 'processing',
      label: 'Cleaning…',
      message: 'Job submitted. Poll status until ready.',
    }),
  };
}

async function statusWork(env, workId) {
  if (workId == null || workId === '') {
    return { ok: false, response: clientFail('Missing work id.', 400) };
  }
  const id = /^\d+$/.test(String(workId)) ? Number(workId) : workId;
  const result = await ghostcutPost(env, WORK_STATUS, { idWorks: [id] });
  if (!result.ok) {
    return {
      ok: false,
      response: clientFail(
        result.data?.msg || result.data?.message || result.data?.error || 'Status check failed.',
        result.status || 502,
      ),
    };
  }
  const summary = summarizeStatus(result.data);
  return {
    ok: true,
    response: json({
      ok: true,
      workId: String(workId),
      ...summary,
    }),
  };
}

function safeFilename(name) {
  const base = String(name || 'video.mp4')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '');
  if (!base) return `video_${Date.now()}.mp4`;
  if (!/\.(mp4|mov|mkv|avi|m4v|webm)$/i.test(base)) return `${base}.mp4`;
  return base.slice(0, 80);
}

async function getUploadPolicy(env) {
  const nonce = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const result = await ghostcutPost(env, UPLOAD_POLICY, {
    nonce,
    materialFileType: 'video',
  });
  if (!result.ok || !result.data?.body?.host) {
    return {
      ok: false,
      response: clientFail(
        result.data?.msg || result.data?.error || 'Could not prepare upload.',
        result.status || 502,
      ),
    };
  }
  const body = result.data.body;
  return {
    ok: true,
    policy: body,
    response: json({
      ok: true,
      host: body.host,
      urlPrefix: body.urlPrefix,
      dir: body.dir,
      fields: {
        OSSAccessKeyId: body.accessid,
        policy: body.policy,
        signature: body.signature,
        callback: body.base64CallbackBody,
        success_action_status: '200',
      },
      message: 'Upload the file to host with the given fields, then submit with the resulting URL.',
    }),
  };
}

async function uploadThenSubmit(env, file, options) {
  const size = file.size ?? 0;
  if (size > MAX_PROXY_UPLOAD) {
    return {
      ok: false,
      response: clientFail(
        `File is too large for direct upload (${size} bytes). Upload via storage first, then submit the public URL.`,
        413,
        { maxBytes: MAX_PROXY_UPLOAD },
      ),
    };
  }

  const policyRes = await getUploadPolicy(env);
  if (!policyRes.ok) return policyRes;

  const policy = policyRes.policy;
  const filename = safeFilename(file.name);
  const key = `${policy.dir}${filename}`;
  const form = new FormData();
  form.append('key', key);
  form.append('OSSAccessKeyId', policy.accessid);
  form.append('policy', policy.policy);
  form.append('signature', policy.signature);
  form.append('callback', policy.base64CallbackBody);
  form.append('success_action_status', '200');
  form.append('file', file, filename);

  const up = await fetch(policy.host, { method: 'POST', body: form });
  const upText = await up.text();
  if (!up.ok) {
    return { ok: false, response: clientFail('Upload failed. Please try again.', 502) };
  }
  try {
    const parsed = JSON.parse(upText);
    if (parsed && parsed.Status && String(parsed.Status).toUpperCase() !== 'OK') {
      return { ok: false, response: clientFail('Upload was rejected.', 502) };
    }
  } catch {
    // Some OSS responses are empty on success — continue if HTTP ok.
  }

  const videoUrl = `${policy.urlPrefix}${filename}`;
  return submitWork(env, videoUrl, options);
}

export async function onRequestPost(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  const ct = request.headers.get('Content-Type') || '';

  try {
    if (ct.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') {
        return clientFail('Expected a video file.', 400);
      }
      let options = {};
      const optionsRaw = form.get('options');
      if (typeof optionsRaw === 'string' && optionsRaw.trim()) {
        try {
          options = JSON.parse(optionsRaw);
        } catch {
          return clientFail('Invalid options JSON.', 400);
        }
      }
      const result = await uploadThenSubmit(env, file, options);
      return result.response;
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return clientFail('Invalid JSON body.', 400);
    }

    const action = body.action || 'submit';

    if (action === 'upload-policy') {
      const result = await getUploadPolicy(env);
      return result.response;
    }

    if (action === 'status') {
      const result = await statusWork(env, body.workId);
      return result.response;
    }

    if (action === 'submit') {
      const result = await submitWork(env, body.videoUrl, body.options || {});
      return result.response;
    }

    return clientFail('Unknown action.', 400);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return clientFail(message, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }
  if (context.request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestPost(context);
}
