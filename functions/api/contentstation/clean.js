import { json, requireSession } from '../../lib/contentstation-auth.js';
import { ghostcutPost } from '../../lib/ghostcut.js';
import {
  cloudconvertConfigured,
  createMetadataStripJob,
  getJob,
  summarizeCloudConvertJob,
} from '../../lib/cloudconvert.js';
import {
  archiveCleanedVideo,
  resolveArchivedDownload,
  scheduleCleanArchive,
} from '../../lib/clean-archive.js';

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
 *   removeWatermark  → needChineseOcclude + advanced_lite fullscreen OCR erase
 *   cleanMetadata    → CloudConvert ffmpeg -map_metadata -1 -c copy (after visual jobs)
 *   basicVideoRemix  → needTrim only + trim color/sharpness/speedup (Video Remaker defaults)
 *   remix            → needTrim + needRescale + needShift (+ trim color/sharpness/speedup)
 *   mirror           → needMirror=1
 *
 * Pipeline order: GhostCut visual options first → then CloudConvert metadata strip.
 */

const WORK_FREE = '/v-w-c/gateway/ve/work/free';
const WORK_STATUS = '/v-w-c/gateway/ve/work/status';
const UPLOAD_POLICY = '/v-w-c/gateway/ve/file/upload/policy/apply';
const MAX_PROXY_UPLOAD = 90 * 1024 * 1024;
const PIPE_CACHE_PREFIX = 'https://contentstation.internal/clean-pipe/';
/** GhostCut jobs still at processStatus < 1 after this are treated as stuck. */
const GC_STUCK_MS = 60 * 60 * 1000;

function friendlyError(raw) {
  const text = String(raw || 'Something went wrong. Please try again.');
  return text
    .replace(/ghost\s*cut/gi, 'processor')
    .replace(/jolly\s*today/gi, 'processor')
    .replace(/\bzhaoli\b/gi, 'processor')
    .replace(/\brunpod\b/gi, 'compute')
    .replace(/\bR2\b/g, 'storage')
    .replace(/cloudflare/gi, 'host')
    .replace(/cloud\s*convert/gi, 'processor')
    .replace(/\bffmpeg\b/gi, 'processor');
}

function sanitizePayload(data) {
  if (data == null) return data;
  if (typeof data === 'string') return friendlyError(data);
  if (Array.isArray(data)) return data.map(sanitizePayload);
  if (typeof data !== 'object') return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (/ghostcut|jolly|zhaoli|runpod|appkey|appsecret|cloudconvert/i.test(k)) continue;
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
    basicVideoRemix: Boolean(src.basicVideoRemix),
    remix: Boolean(src.remix),
    mirror: Boolean(src.mirror),
  };
}

function hasAnyCleanOption(opts) {
  return Boolean(
    opts.removeWatermark ||
      opts.cleanMetadata ||
      opts.basicVideoRemix ||
      opts.remix ||
      opts.mirror,
  );
}

function needsVisual(opts) {
  return Boolean(opts.removeWatermark || opts.basicVideoRemix || opts.remix || opts.mirror);
}

/** Official Video Remaker “Basic Edit” sub-options (no crop trailer). */
function videoRemakerTrimConfig() {
  return {
    adjust_color_on: true,
    adjust_sharpness_on: true,
    crop_trailer_on: false,
    speedup_on: true,
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

function processorConfigured(env) {
  return Boolean(env.GHOSTCUT_APP_KEY && env.GHOSTCUT_APP_SECRET);
}

function filenameFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const base = path.split('/').pop() || 'input.mp4';
    return base.slice(0, 80);
  } catch {
    return 'input.mp4';
  }
}

/**
 * Build /work/free payload from visual checkbox options only.
 * cleanMetadata is handled separately via CloudConvert after this step.
 */
export function buildCleanPayload(videoUrl, options) {
  const opts = parseOptions(options);
  if (!hasAnyCleanOption(opts)) {
    return { error: 'Select at least one clean option.' };
  }

  // Metadata-only jobs skip GhostCut entirely.
  if (!needsVisual(opts)) {
    return { skipVisual: true, opts };
  }

  const payload = {
    urls: [videoUrl],
    names: ['clean-video'],
    resolution: '1080p',
  };

  const extra = {};

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

  if (opts.basicVideoRemix || opts.remix) {
    // Video Remaker Basic Edit: color / sharpness / speedup (skill 27-video-basic-processing).
    payload.needTrim = 1;
    extra.extra_trim_config = videoRemakerTrimConfig();
  }

  if (opts.remix) {
    // Subtle remix adds dynamic zoom + smart pan on top of Basic Edit.
    payload.needRescale = 3;
    payload.needShift = 1;
  }

  if (opts.mirror) {
    payload.needMirror = 1;
  }

  if (Object.keys(extra).length) {
    payload.extraOptions = JSON.stringify(extra);
  }

  return { payload, opts };
}

function extractWorkId(data) {
  const list = data?.body?.dataList;
  if (Array.isArray(list) && list[0] && list[0].id != null) {
    return String(list[0].id);
  }
  return null;
}

function progressPct(processProgress) {
  const n = Number(processProgress);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function mapProcessStatus(processStatus, processProgress) {
  const n = Number(processStatus);
  const pct = progressPct(processProgress);
  const pctSuffix = pct != null && pct < 100 ? ` ${pct}%` : '';
  if (!Number.isFinite(n)) return { state: 'unknown', label: 'Checking…', progress: pct };
  // GhostCut: 1 = success, <1 = still processing, >1 = failed (see skill 14-video-process-status).
  if (n === 1) return { state: 'ready', label: 'Ready to download', progress: 100 };
  if (n < 1) return { state: 'processing', label: `Cleaning…${pctSuffix}`, progress: pct };
  return { state: 'failed', label: 'Cleaning failed', progress: pct };
}

function workAgeMs(c) {
  const t = Number(c?.createTime ?? c?.lastUpdateTime);
  if (!Number.isFinite(t) || t <= 0) return null;
  // GhostCut returns epoch ms; guard against accidental seconds.
  const ms = t < 1e12 ? t * 1000 : t;
  return Date.now() - ms;
}

/**
 * Estimate video-alter points from duration + options when the processor
 * does not return an exact cost. Billing unit = 30s (ceil).
 * Mapping (internal): watermark advanced_lite = 4/unit;
 * basicVideoRemix (needTrim only) ≈ 0.5/unit;
 * remix (trim+rescale+shift) ≈ 1/unit; mirror ≈ 0.5/unit.
 * Prefer client balance-delta.
 */
function estimateVideoAlterCredits(durationSec, optionsHint) {
  const secs = Number(durationSec);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const units = Math.max(1, Math.ceil(secs / 30));
  const opts = optionsHint && typeof optionsHint === 'object' ? optionsHint : {};
  let perUnit = 0;
  if (opts.removeWatermark) perUnit += 4;
  if (opts.remix) perUnit += 1;
  else if (opts.basicVideoRemix) perUnit += 0.5;
  if (opts.mirror) perUnit += 0.5;
  if (perUnit <= 0) perUnit = 4; // default assume watermark-class job
  return Math.round(units * perUnit * 10) / 10;
}

function extractDurationSec(c) {
  const candidates = [c?.duration, c?.videoDuration, c?.durationSeconds, c?.videoLen];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function summarizeStatus(data, optionsHint) {
  const content = data?.body?.content;
  if (!Array.isArray(content) || !content.length) {
    return { state: 'unknown', label: 'No status yet', works: [] };
  }
  const works = content.map((c) => {
    const mapped = mapProcessStatus(c.processStatus, c.processProgress);
    const downloadUrl =
      mapped.state === 'ready' ? c.videoUrl || c.videoUrlOut || null : null;
    const ageMs = workAgeMs(c);
    let state = mapped.state;
    let label = mapped.label;
    let error = mapped.state === 'failed' ? friendlyError(c.errorDetail || 'Processing failed') : null;

    // Stuck while still "processing" — surface instead of infinite Cleaning…
    if (state === 'processing' && ageMs != null && ageMs > GC_STUCK_MS) {
      state = 'failed';
      label = 'Cleaning timed out';
      error = friendlyError(
        c.errorDetail ||
          'This job is taking too long and may be stuck. Please try again with a new upload.',
      );
    }

    return {
      workId: c.id != null ? String(c.id) : null,
      state,
      label,
      progress: mapped.progress,
      processStatus: c.processStatus,
      downloadUrl,
      error,
      stage: 'visual',
      durationSec: extractDurationSec(c),
    };
  });
  const primary = works[0];
  let creditsUsed = null;
  if (primary.state === 'ready') {
    const estimated = estimateVideoAlterCredits(primary.durationSec, optionsHint);
    if (estimated != null) {
      creditsUsed = { cleaning: null, videoAlter: estimated };
    }
  }
  return {
    state: primary.state,
    label: primary.label,
    progress: primary.progress,
    downloadUrl: primary.downloadUrl,
    error: primary.error,
    stage: primary.stage,
    durationSec: primary.durationSec ?? null,
    creditsUsed,
    works,
  };
}

function encodeWorkId({ kind, id }) {
  if (kind === 'cc') return `cc:${id}`;
  if (kind === 'pipe') return `pipe:gc:${id}`;
  if (kind === 'gc') return `gc:${id}`;
  return String(id);
}

function parseWorkId(raw) {
  const s = String(raw || '').trim();
  if (!s) return { kind: 'unknown' };
  if (s.startsWith('cc:')) return { kind: 'cc', id: s.slice(3) };
  if (s.startsWith('pipe:gc:')) return { kind: 'pipe', id: s.slice(8) };
  if (s.startsWith('gc:')) return { kind: 'gc', id: s.slice(3) };
  // Legacy numeric GhostCut ids
  if (/^\d+$/.test(s)) return { kind: 'gc', id: s };
  return { kind: 'unknown', id: s };
}

async function readPipeCache(gcId) {
  const data = await readPipeMeta(gcId);
  return data && data.ccJobId ? String(data.ccJobId) : null;
}

async function readPipeMeta(gcId) {
  try {
    const cache = caches.default;
    const hit = await cache.match(new Request(`${PIPE_CACHE_PREFIX}${gcId}`));
    if (!hit) return null;
    return await hit.json();
  } catch {
    return null;
  }
}

async function writePipeCache(gcId, ccJobId, extra = {}) {
  try {
    const cache = caches.default;
    const prev = (await readPipeMeta(gcId)) || {};
    const body = JSON.stringify({
      ...prev,
      ccJobId,
      at: new Date().toISOString(),
      ...extra,
    });
    await cache.put(
      new Request(`${PIPE_CACHE_PREFIX}${gcId}`),
      new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        },
      }),
    );
  } catch {
    // Best-effort memoization; duplicate strip jobs are rare if the client follows workId.
  }
}

async function writeJobOptionsCache(workKey, options) {
  try {
    const cache = caches.default;
    const body = JSON.stringify({ options: parseOptions(options), at: new Date().toISOString() });
    await cache.put(
      new Request(`${PIPE_CACHE_PREFIX}opts/${workKey}`),
      new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        },
      }),
    );
  } catch {
    /* ignore */
  }
}

async function readJobOptionsCache(workKey) {
  try {
    const cache = caches.default;
    const hit = await cache.match(new Request(`${PIPE_CACHE_PREFIX}opts/${workKey}`));
    if (!hit) return null;
    const data = await hit.json();
    return data?.options || null;
  } catch {
    return null;
  }
}

async function startMetadataStrip(env, videoUrl, tag) {
  const result = await createMetadataStripJob(env, videoUrl, {
    filename: filenameFromUrl(videoUrl),
    tag: tag || 'cs-clean-meta',
  });
  if (!result.ok) {
    const msg =
      result.data?.message ||
      result.data?.error ||
      (Array.isArray(result.data?.errors) && result.data.errors[0]?.detail) ||
      'Could not start metadata cleaning.';
    return { ok: false, response: clientFail(friendlyError(msg), result.status || 502) };
  }
  const jobId = result.data?.data?.id || result.data?.id;
  if (!jobId) {
    return {
      ok: false,
      response: clientFail('Metadata job started but no id was returned.', 502, {
        detail: sanitizePayload(result.data),
      }),
    };
  }
  return {
    ok: true,
    jobId: String(jobId),
    response: json({
      ok: true,
      workId: encodeWorkId({ kind: 'cc', id: jobId }),
      state: 'processing',
      label: 'Stripping metadata…',
      stage: 'metadata',
      message: 'Job submitted. Poll status until ready.',
    }),
  };
}

async function submitGhostCut(env, videoUrl, payload) {
  const result = await ghostcutPost(env, WORK_FREE, payload);
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
  return { ok: true, workId };
}

async function submitWork(env, videoUrl, options) {
  if (!isPublicHttpsUrl(videoUrl)) {
    return { ok: false, response: clientFail('A valid public video URL is required.', 400) };
  }

  const opts = parseOptions(options);
  if (!hasAnyCleanOption(opts)) {
    return { ok: false, response: clientFail('Select at least one clean option.', 400) };
  }

  if (opts.cleanMetadata && !cloudconvertConfigured(env)) {
    return {
      ok: false,
      response: clientFail('Metadata cleaning isn’t configured.', 503, {
        error: 'metadata_unconfigured',
      }),
    };
  }

  const visual = needsVisual(opts);
  if (visual && !processorConfigured(env)) {
    return {
      ok: false,
      response: clientFail('Video cleaning isn’t fully configured yet.', 503),
    };
  }

  // Metadata-only: CloudConvert strip on the source URL.
  if (!visual && opts.cleanMetadata) {
    return startMetadataStrip(env, videoUrl, 'cs-meta-only');
  }

  const built = buildCleanPayload(videoUrl, opts);
  if (built.error) {
    return { ok: false, response: clientFail(built.error, 400) };
  }

  const gc = await submitGhostCut(env, videoUrl, built.payload);
  if (!gc.ok) return gc;

  const workId = opts.cleanMetadata
    ? encodeWorkId({ kind: 'pipe', id: gc.workId })
    : encodeWorkId({ kind: 'gc', id: gc.workId });

  await writeJobOptionsCache(gc.workId, opts);

  return {
    ok: true,
    response: json({
      ok: true,
      workId,
      state: 'processing',
      label: opts.cleanMetadata ? 'Cleaning video…' : 'Cleaning…',
      stage: 'visual',
      progress: 0,
      message: 'Job submitted. Poll status until ready.',
    }),
  };
}

async function statusGhostCut(env, rawId) {
  if (rawId == null || rawId === '') {
    return { ok: false, response: clientFail('Missing work id.', 400) };
  }
  const id = /^\d+$/.test(String(rawId)) ? Number(rawId) : rawId;
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
  const optionsHint = await readJobOptionsCache(String(rawId));
  return {
    ok: true,
    summary: summarizeStatus(result.data, optionsHint),
    rawId: String(rawId),
  };
}

async function statusCloudConvert(env, jobId, creditExtras = null) {
  const result = await getJob(env, jobId);
  if (!result.ok) {
    return {
      ok: false,
      response: clientFail(
        friendlyError(
          result.data?.message || result.data?.error || 'Status check failed.',
        ),
        result.status || 502,
      ),
    };
  }
  const summary = summarizeCloudConvertJob(result.data, jobId);
  let creditsUsed = summary.creditsUsed;
  if (creditsUsed && creditExtras && creditExtras.videoAlter != null) {
    creditsUsed = {
      cleaning: creditsUsed.cleaning,
      videoAlter: creditExtras.videoAlter,
    };
  } else if (!creditsUsed && creditExtras && creditExtras.videoAlter != null) {
    creditsUsed = { cleaning: null, videoAlter: creditExtras.videoAlter };
  }
  return {
    ok: true,
    response: json({
      ok: true,
      workId: encodeWorkId({ kind: 'cc', id: jobId }),
      ...summary,
      creditsUsed,
      error: summary.error ? friendlyError(summary.error) : null,
    }),
  };
}

async function statusPipe(env, gcId) {
  const pipeMeta = await readPipeMeta(gcId);
  const videoAlterEstimate =
    pipeMeta?.videoAlterEstimate != null
      ? Number(pipeMeta.videoAlterEstimate)
      : null;

  // If we already started the metadata step, follow that job.
  const cachedCc = pipeMeta?.ccJobId ? String(pipeMeta.ccJobId) : null;
  if (cachedCc) {
    return statusCloudConvert(env, cachedCc, {
      videoAlter: Number.isFinite(videoAlterEstimate) ? videoAlterEstimate : null,
    });
  }

  const gc = await statusGhostCut(env, gcId);
  if (!gc.ok) return gc;

  const { summary } = gc;
  if (summary.state === 'failed') {
    return {
      ok: true,
      response: json({
        ok: true,
        workId: encodeWorkId({ kind: 'pipe', id: gcId }),
        stage: 'visual',
        ...summary,
      }),
    };
  }

  if (summary.state !== 'ready' || !summary.downloadUrl) {
    const pct = summary.progress;
    const pctSuffix = pct != null && pct < 100 ? ` ${pct}%` : '';
    return {
      ok: true,
      response: json({
        ok: true,
        workId: encodeWorkId({ kind: 'pipe', id: gcId }),
        state: 'processing',
        label: summary.label || `Cleaning video…${pctSuffix}`,
        progress: pct ?? null,
        stage: 'visual',
        downloadUrl: null,
        error: null,
        works: summary.works || [],
      }),
    };
  }

  const alterUsed =
    summary.creditsUsed?.videoAlter != null
      ? summary.creditsUsed.videoAlter
      : null;

  // Visual stage done → start metadata strip on the result (once).
  if (!cloudconvertConfigured(env)) {
    // Don't strand a finished visual job: return the cleaned video without metadata strip.
    return {
      ok: true,
      response: json({
        ok: true,
        workId: encodeWorkId({ kind: 'gc', id: gcId }),
        state: 'ready',
        label: 'Ready to download',
        progress: 100,
        stage: 'visual',
        downloadUrl: summary.downloadUrl,
        error: null,
        creditsUsed: alterUsed != null ? { cleaning: null, videoAlter: alterUsed } : summary.creditsUsed,
        message: 'Visual clean done. Metadata cleaning isn’t configured, so that step was skipped.',
        works: summary.works || [],
      }),
    };
  }

  // Re-check cache in case another poll started the job.
  const againMeta = await readPipeMeta(gcId);
  if (againMeta?.ccJobId) {
    return statusCloudConvert(env, String(againMeta.ccJobId), {
      videoAlter:
        againMeta.videoAlterEstimate != null
          ? Number(againMeta.videoAlterEstimate)
          : alterUsed,
    });
  }

  const started = await startMetadataStrip(env, summary.downloadUrl, `cs-pipe-${gcId}`);
  if (!started.ok) {
    // Visual result exists — surface metadata failure but keep download available.
    const failBody = await started.response.clone().json().catch(() => null);
    const metaErr =
      failBody?.message || 'Could not start metadata cleaning after the visual step finished.';
    return {
      ok: true,
      response: json({
        ok: true,
        workId: encodeWorkId({ kind: 'gc', id: gcId }),
        state: 'ready',
        label: 'Ready to download',
        progress: 100,
        stage: 'visual',
        downloadUrl: summary.downloadUrl,
        error: null,
        creditsUsed: alterUsed != null ? { cleaning: null, videoAlter: alterUsed } : summary.creditsUsed,
        warning: friendlyError(metaErr),
        message: 'Visual clean done. Metadata strip failed — download is the visual result.',
        works: summary.works || [],
      }),
    };
  }

  await writePipeCache(gcId, started.jobId, {
    videoAlterEstimate: alterUsed,
    options: pipeMeta?.options || (await readJobOptionsCache(gcId)),
  });
  return {
    ok: true,
    response: json({
      ok: true,
      workId: encodeWorkId({ kind: 'cc', id: started.jobId }),
      state: 'processing',
      label: 'Stripping metadata…',
      progress: null,
      stage: 'metadata',
      message: 'Visual clean done; stripping metadata…',
      downloadUrl: null,
      error: null,
      creditsUsed: alterUsed != null ? { cleaning: null, videoAlter: alterUsed } : null,
    }),
  };
}

async function statusWork(env, workId) {
  const parsed = parseWorkId(workId);
  if (parsed.kind === 'cc') {
    return statusCloudConvert(env, parsed.id);
  }
  if (parsed.kind === 'pipe') {
    return statusPipe(env, parsed.id);
  }
  if (parsed.kind === 'gc') {
    const gc = await statusGhostCut(env, parsed.id);
    if (!gc.ok) return gc;
    return {
      ok: true,
      response: json({
        ok: true,
        workId: encodeWorkId({ kind: 'gc', id: parsed.id }),
        ...gc.summary,
      }),
    };
  }
  return { ok: false, response: clientFail('Unknown work id.', 400) };
}

/**
 * When a clean is ready, prefer an already-saved library copy; otherwise schedule
 * a background save to cleaned/. Never awaits the upload — polling stays fast.
 */
async function attachLibraryFields(context, env, data) {
  if (!data || data.state !== 'ready' || !data.downloadUrl || !data.workId) {
    return data;
  }
  const existing = await resolveArchivedDownload(env, data.workId);
  if (existing) {
    return {
      ...data,
      downloadUrl: existing.downloadPath,
      cleanedKey: existing.key,
      inLibrary: true,
    };
  }
  scheduleCleanArchive(context, env, {
    workId: data.workId,
    sourceUrl: data.downloadUrl,
  });
  return {
    ...data,
    inLibrary: false,
    savingToLibrary: true,
  };
}

async function archiveFromStatus(context, env, workId) {
  if (!workId) {
    return { ok: false, response: clientFail('Missing work id.', 400) };
  }
  const existing = await resolveArchivedDownload(env, workId);
  if (existing) {
    return {
      ok: true,
      response: json({
        ok: true,
        workId,
        cleanedKey: existing.key,
        downloadUrl: existing.downloadPath,
        inLibrary: true,
        existed: true,
      }),
    };
  }

  const status = await statusWork(env, workId);
  if (!status.ok) return status;
  let data;
  try {
    data = await status.response.clone().json();
  } catch {
    return { ok: false, response: clientFail('Could not read job status.', 502) };
  }
  // Follow pipe → cc workId if status advanced.
  const effectiveId = data.workId || workId;
  if (data.state === 'ready' && data.downloadUrl) {
    const archived = await archiveCleanedVideo(env, {
      workId: effectiveId,
      sourceUrl: data.downloadUrl,
    });
    if (!archived.ok) {
      return { ok: false, response: clientFail(archived.error || 'Could not save to library.', 502) };
    }
    return {
      ok: true,
      response: json({
        ok: true,
        workId: effectiveId,
        cleanedKey: archived.key,
        downloadUrl: archived.downloadPath,
        inLibrary: true,
        existed: Boolean(archived.existed),
      }),
    };
  }
  if (data.state === 'processing') {
    return {
      ok: false,
      response: clientFail('Job is still processing — try again when it’s ready.', 409, {
        workId: effectiveId,
        state: data.state,
        label: data.label,
      }),
    };
  }
  return {
    ok: false,
    response: clientFail(
      data.error || data.message || 'No finished download URL available to save.',
      404,
      { workId: effectiveId, state: data.state || null },
    ),
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

  const opts = parseOptions(options);
  // Metadata-only can still use the visual processor's upload host for a public fetch URL.
  if (!processorConfigured(env) && needsVisual(opts)) {
    return {
      ok: false,
      response: clientFail('Video cleaning isn’t fully configured yet.', 503),
    };
  }
  if (!processorConfigured(env) && opts.cleanMetadata && !needsVisual(opts)) {
    // No OSS uploader available — client should use /media (R2) then submit URL.
    return {
      ok: false,
      response: clientFail(
        'Direct upload needs the video processor configured, or upload via storage first.',
        503,
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
      if (!result.ok) return result.response;
      let data;
      try {
        data = await result.response.json();
      } catch {
        return result.response;
      }
      const enriched = await attachLibraryFields(context, env, data);
      return json(enriched);
    }

    if (action === 'archive') {
      // Explicit save into cleaned/ gallery (also used for backfill of finished jobs).
      if (body.sourceUrl && body.workId) {
        const archived = await archiveCleanedVideo(env, {
          workId: body.workId,
          sourceUrl: body.sourceUrl,
          filename: body.filename,
        });
        if (!archived.ok) {
          return clientFail(archived.error || 'Could not save to library.', 502);
        }
        return json({
          ok: true,
          workId: body.workId,
          cleanedKey: archived.key,
          downloadUrl: archived.downloadPath,
          inLibrary: true,
          existed: Boolean(archived.existed),
        });
      }
      const result = await archiveFromStatus(context, env, body.workId);
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
