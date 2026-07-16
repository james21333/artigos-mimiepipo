/**
 * CloudConvert API v2 helpers (ffmpeg post-process: metadata strip + audio alter).
 * Auth: Authorization: Bearer CLOUDCONVERT_API_KEY
 * Docs: https://cloudconvert.com/docs/operations/execute-commands
 */

const API_BASE = 'https://api.cloudconvert.com/v2';

/** Subtle pitch micro-shift (~3%). Tempo restored so duration/speech pace stay natural. */
export const AUDIO_ALTER_PITCH = 1.03;

export function cloudconvertConfigured(env) {
  return Boolean(env && env.CLOUDCONVERT_API_KEY);
}

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.CLOUDCONVERT_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function safeVideoFilename(name) {
  const base = String(name || 'input.mp4')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '');
  if (!base) return 'input.mp4';
  if (!/\.(mp4|mov|mkv|avi|m4v|webm)$/i.test(base)) return `${base.slice(0, 72)}.mp4`;
  return base.slice(0, 80);
}

function outputNameFromInput(filename) {
  const safe = safeVideoFilename(filename);
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 ? safe.slice(dot) : '.mp4';
  return `cleaned${ext.toLowerCase()}`;
}

/**
 * Community-style micro pitch (~3%) via asetrate + aresample, then atempo to restore tempo.
 * Portable (no rubberband). Speech stays natural; fingerprint shifts slightly.
 */
export function buildAudioAlterFilter(pitch = AUDIO_ALTER_PITCH) {
  const p = Number(pitch);
  const ratio = Number.isFinite(p) && p > 0.5 && p < 1.5 ? p : AUDIO_ALTER_PITCH;
  const atempo = Math.round((1 / ratio) * 1e6) / 1e6;
  return `asetrate=44100*${ratio},aresample=44100,atempo=${atempo}`;
}

/**
 * Build ffmpeg args for post-process.
 * - strip only: stream-copy (fast)
 * - alter audio (± strip): copy video, re-encode audio with micro pitch filter
 */
export function buildFfmpegArguments(inputTaskName, inputFilename, outputFilename, flags = {}) {
  const stripMetadata = Boolean(flags.stripMetadata);
  const alterAudio = Boolean(flags.alterAudio);
  const inPath = `/input/${inputTaskName}/${safeVideoFilename(inputFilename)}`;
  const outPath = `/output/${outputFilename || outputNameFromInput(inputFilename)}`;
  const meta = stripMetadata || alterAudio ? '-map_metadata -1 -map_chapters -1' : '';

  if (alterAudio) {
    const af = buildAudioAlterFilter(flags.pitch);
    // Video stream-copy; AAC re-encode required for the audio filter.
    // Quote the filter — commas would otherwise break argument splitting.
    return `-i ${inPath} -map 0:v:0 -map 0:a:0 ${meta} -c:v copy -af "${af}" -c:a aac -b:a 192k -movflags +faststart -fflags +bitexact ${outPath}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Metadata strip only — stream copy when possible.
  return `-i ${inPath} -map 0 ${meta || '-map_metadata -1 -map_chapters -1'} -c copy -fflags +bitexact ${outPath}`
    .replace(/\s+/g, ' ')
    .trim();
}

/** @deprecated Prefer buildFfmpegArguments — kept for callers that only strip. */
export function buildStripArguments(inputTaskName, inputFilename, outputFilename) {
  return buildFfmpegArguments(inputTaskName, inputFilename, outputFilename, {
    stripMetadata: true,
    alterAudio: false,
  });
}

async function parseJsonResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function postProcessLabel(flags = {}, { processing = false } = {}) {
  const strip = Boolean(flags.stripMetadata);
  const audio = Boolean(flags.alterAudio);
  if (processing) {
    if (strip && audio) return 'Finishing audio & metadata…';
    if (audio) return 'Altering audio…';
    return 'Stripping metadata…';
  }
  if (strip && audio) return 'audio+metadata';
  if (audio) return 'audio';
  return 'metadata';
}

/**
 * Create an async job: import/url → ffmpeg (strip and/or alter audio) → export/url.
 * Prefer one combined command when both stripMetadata and alterAudio are set.
 */
export async function createFfmpegPostJob(env, videoUrl, { filename, tag, stripMetadata, alterAudio } = {}) {
  if (!cloudconvertConfigured(env)) {
    return {
      ok: false,
      status: 503,
      data: { error: 'metadata_unconfigured', message: 'Post-processing isn’t configured.' },
    };
  }
  if (!videoUrl || typeof videoUrl !== 'string') {
    return { ok: false, status: 400, data: { error: 'invalid_url', message: 'A valid video URL is required.' } };
  }

  const strip = Boolean(stripMetadata);
  const audio = Boolean(alterAudio);
  if (!strip && !audio) {
    return {
      ok: false,
      status: 400,
      data: { error: 'no_post_options', message: 'Select metadata strip and/or alter audio.' },
    };
  }

  const inputName = 'import-file';
  const inputFilename = safeVideoFilename(filename || 'input.mp4');
  const outputFilename = outputNameFromInput(inputFilename);
  const flags = { stripMetadata: strip || audio, alterAudio: audio };
  // When altering audio we always strip map_metadata in the same command (cheap).
  // When strip-only, keep the stream-copy path.
  if (audio) flags.stripMetadata = true;
  else flags.stripMetadata = strip;

  const body = {
    tasks: {
      [inputName]: {
        operation: 'import/url',
        url: videoUrl.trim(),
        filename: inputFilename,
      },
      'ffmpeg-post': {
        operation: 'command',
        input: inputName,
        engine: 'ffmpeg',
        command: 'ffmpeg',
        capture_output: false,
        arguments: buildFfmpegArguments(inputName, inputFilename, outputFilename, flags),
      },
      'export-file': {
        operation: 'export/url',
        input: 'ffmpeg-post',
      },
    },
  };
  if (tag) body.tag = String(tag).slice(0, 120);

  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify(body),
  });
  return parseJsonResponse(res);
}

/**
 * Create an async job: import/url → ffmpeg metadata strip (stream copy) → export/url.
 */
export async function createMetadataStripJob(env, videoUrl, opts = {}) {
  return createFfmpegPostJob(env, videoUrl, {
    ...opts,
    stripMetadata: true,
    alterAudio: Boolean(opts.alterAudio),
  });
}

export async function getJob(env, jobId) {
  if (!cloudconvertConfigured(env)) {
    return {
      ok: false,
      status: 503,
      data: { error: 'metadata_unconfigured', message: 'Post-processing isn’t configured.' },
    };
  }
  const id = String(jobId || '').trim();
  if (!id) {
    return { ok: false, status: 400, data: { error: 'missing_job_id' } };
  }
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: authHeaders(env),
  });
  return parseJsonResponse(res);
}

/**
 * Simple import/url → export/url (no ffmpeg). Used to pull remote media into a
 * Worker-friendly CDN URL (TikTok CDN often fails from Pages Functions).
 */
export async function createImportExportJob(env, videoUrl, { filename, tag } = {}) {
  if (!cloudconvertConfigured(env)) {
    return {
      ok: false,
      status: 503,
      data: { error: 'metadata_unconfigured', message: 'Post-processing isn’t configured.' },
    };
  }
  if (!videoUrl || typeof videoUrl !== 'string') {
    return { ok: false, status: 400, data: { error: 'invalid_url' } };
  }
  const inputFilename = safeVideoFilename(filename || 'input.mp4');
  const body = {
    tasks: {
      'import-file': {
        operation: 'import/url',
        url: videoUrl.trim(),
        filename: inputFilename,
      },
      'export-file': {
        operation: 'export/url',
        input: 'import-file',
      },
    },
  };
  if (tag) body.tag = String(tag).slice(0, 120);

  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify(body),
  });
  return parseJsonResponse(res);
}

/** Poll a job until finished/error or timeout (ms). */
export async function waitForJob(env, jobId, { timeoutMs = 55000, intervalMs = 1500 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await getJob(env, jobId);
    if (!last.ok) return last;
    const status = String(last.data?.data?.status || last.data?.status || '').toLowerCase();
    if (status === 'finished' || status === 'error') return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return {
    ok: false,
    status: 504,
    data: { error: 'job_timeout', message: 'Timed out waiting for transfer.', last: last?.data || null },
  };
}

/**
 * Remaining conversion credits for the API key (GET /v2/users/me).
 * Requires user.read scope on the token.
 */
export async function getUserCredits(env) {
  if (!cloudconvertConfigured(env)) {
    return {
      ok: false,
      status: 503,
      data: { error: 'metadata_unconfigured', message: 'Post-processing isn’t configured.' },
      credits: null,
    };
  }
  const res = await fetch(`${API_BASE}/users/me`, {
    method: 'GET',
    headers: authHeaders(env),
  });
  const parsed = await parseJsonResponse(res);
  const creditsRaw = parsed.data?.data?.credits ?? parsed.data?.credits;
  const credits =
    creditsRaw != null && Number.isFinite(Number(creditsRaw)) ? Number(creditsRaw) : null;
  return { ...parsed, credits };
}

/** Sum credits charged across finished tasks in a job payload. */
export function sumJobCredits(jobPayload) {
  const job = jobPayload?.data || jobPayload || {};
  const tasks = job.tasks || [];
  if (!Array.isArray(tasks) || !tasks.length) return null;
  let sum = 0;
  let found = false;
  for (const t of tasks) {
    if (t == null || t.credits == null) continue;
    const n = Number(t.credits);
    if (!Number.isFinite(n)) continue;
    sum += n;
    found = true;
  }
  return found ? sum : null;
}

export function extractExportUrl(job) {
  const tasks = job?.data?.tasks || job?.tasks || [];
  if (!Array.isArray(tasks)) return null;
  for (const t of tasks) {
    if (t.operation !== 'export/url' || t.status !== 'finished') continue;
    const files = t.result?.files;
    if (Array.isArray(files) && files[0]?.url) return files[0].url;
  }
  return null;
}

export function extractJobError(job) {
  const root = job?.data || job || {};
  if (root.message && root.status === 'error') return String(root.message);
  const tasks = root.tasks || [];
  if (!Array.isArray(tasks)) return null;
  for (const t of tasks) {
    if (t.status === 'error' && t.message) return String(t.message);
  }
  return null;
}

/**
 * Map CloudConvert job → Clean UI status shape.
 * Includes creditsUsed.cleaning from task.credits when finished (exact).
 * @param {{ stripMetadata?: boolean, alterAudio?: boolean }} [postFlags]
 */
export function summarizeCloudConvertJob(jobPayload, jobId, postFlags = null) {
  const job = jobPayload?.data || jobPayload || {};
  const status = String(job.status || '').toLowerCase();
  const id = job.id || jobId;
  const flags = postFlags && typeof postFlags === 'object' ? postFlags : { stripMetadata: true };
  const stage = flags.alterAudio && !flags.stripMetadata ? 'audio' : 'metadata';
  const cleaningCredits = status === 'finished' ? sumJobCredits(jobPayload) : null;
  const creditsUsed =
    cleaningCredits != null ? { cleaning: cleaningCredits, videoAlter: null } : null;
  const processingLabel = postProcessLabel(flags, { processing: true });

  if (status === 'finished') {
    const downloadUrl = extractExportUrl(jobPayload);
    if (downloadUrl) {
      return {
        state: 'ready',
        label: 'Ready to download',
        progress: 100,
        stage,
        downloadUrl,
        error: null,
        creditsUsed: creditsUsed || { cleaning: 1, videoAlter: null },
        works: [
          {
            workId: id ? `cc:${id}` : null,
            state: 'ready',
            label: 'Ready to download',
            downloadUrl,
            stage,
          },
        ],
      };
    }
    return {
      state: 'failed',
      label: 'Cleaning failed',
      progress: null,
      stage,
      downloadUrl: null,
      error: 'Post-process finished but no download URL was returned.',
      creditsUsed: null,
      works: [],
    };
  }

  if (status === 'error') {
    const err = extractJobError(jobPayload) || 'Post-processing failed.';
    return {
      state: 'failed',
      label: 'Cleaning failed',
      progress: null,
      stage,
      downloadUrl: null,
      error: err,
      creditsUsed: null,
      works: [
        {
          workId: id ? `cc:${id}` : null,
          state: 'failed',
          label: 'Cleaning failed',
          error: err,
          stage,
        },
      ],
    };
  }

  return {
    state: 'processing',
    label: processingLabel,
    progress: null,
    stage,
    downloadUrl: null,
    error: null,
    creditsUsed: null,
    works: [
      {
        workId: id ? `cc:${id}` : null,
        state: 'processing',
        label: processingLabel,
        stage,
      },
    ],
  };
}
