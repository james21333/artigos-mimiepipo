/**
 * CloudConvert API v2 helpers (metadata strip via ffmpeg command).
 * Auth: Authorization: Bearer CLOUDCONVERT_API_KEY
 * Docs: https://cloudconvert.com/docs/operations/execute-commands
 */

const API_BASE = 'https://api.cloudconvert.com/v2';

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
 * Build ffmpeg args: strip container metadata, stream-copy when possible.
 * Equivalent to: ffmpeg -map_metadata -1 -map_chapters -1 -c copy …
 */
export function buildStripArguments(inputTaskName, inputFilename, outputFilename) {
  const inPath = `/input/${inputTaskName}/${safeVideoFilename(inputFilename)}`;
  const outPath = `/output/${outputFilename || outputNameFromInput(inputFilename)}`;
  // -map 0 keeps all streams; bitexact reduces residual encoder tags when muxing.
  return `-i ${inPath} -map 0 -map_metadata -1 -map_chapters -1 -c copy -fflags +bitexact ${outPath}`;
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

/**
 * Create an async job: import/url → ffmpeg metadata strip (stream copy) → export/url.
 */
export async function createMetadataStripJob(env, videoUrl, { filename, tag } = {}) {
  if (!cloudconvertConfigured(env)) {
    return {
      ok: false,
      status: 503,
      data: { error: 'metadata_unconfigured', message: 'Metadata cleaning isn’t configured.' },
    };
  }
  if (!videoUrl || typeof videoUrl !== 'string') {
    return { ok: false, status: 400, data: { error: 'invalid_url', message: 'A valid video URL is required.' } };
  }

  const inputName = 'import-file';
  const inputFilename = safeVideoFilename(filename || 'input.mp4');
  const outputFilename = outputNameFromInput(inputFilename);

  const body = {
    tasks: {
      [inputName]: {
        operation: 'import/url',
        url: videoUrl.trim(),
        filename: inputFilename,
      },
      'strip-metadata': {
        operation: 'command',
        input: inputName,
        engine: 'ffmpeg',
        command: 'ffmpeg',
        capture_output: false,
        arguments: buildStripArguments(inputName, inputFilename, outputFilename),
      },
      'export-file': {
        operation: 'export/url',
        input: 'strip-metadata',
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

export async function getJob(env, jobId) {
  if (!cloudconvertConfigured(env)) {
    return {
      ok: false,
      status: 503,
      data: { error: 'metadata_unconfigured', message: 'Metadata cleaning isn’t configured.' },
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
 * Remaining conversion credits for the API key (GET /v2/users/me).
 * Requires user.read scope on the token.
 */
export async function getUserCredits(env) {
  if (!cloudconvertConfigured(env)) {
    return {
      ok: false,
      status: 503,
      data: { error: 'metadata_unconfigured', message: 'Metadata cleaning isn’t configured.' },
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
 */
export function summarizeCloudConvertJob(jobPayload, jobId) {
  const job = jobPayload?.data || jobPayload || {};
  const status = String(job.status || '').toLowerCase();
  const id = job.id || jobId;
  const cleaningCredits = status === 'finished' ? sumJobCredits(jobPayload) : null;
  const creditsUsed =
    cleaningCredits != null ? { cleaning: cleaningCredits, videoAlter: null } : null;

  if (status === 'finished') {
    const downloadUrl = extractExportUrl(jobPayload);
    if (downloadUrl) {
      return {
        state: 'ready',
        label: 'Ready to download',
        progress: 100,
        stage: 'metadata',
        downloadUrl,
        error: null,
        creditsUsed: creditsUsed || { cleaning: 1, videoAlter: null },
        works: [
          {
            workId: id ? `cc:${id}` : null,
            state: 'ready',
            label: 'Ready to download',
            downloadUrl,
            stage: 'metadata',
          },
        ],
      };
    }
    return {
      state: 'failed',
      label: 'Cleaning failed',
      progress: null,
      stage: 'metadata',
      downloadUrl: null,
      error: 'Metadata strip finished but no download URL was returned.',
      creditsUsed: null,
      works: [],
    };
  }

  if (status === 'error') {
    const err = extractJobError(jobPayload) || 'Metadata cleaning failed.';
    return {
      state: 'failed',
      label: 'Cleaning failed',
      progress: null,
      stage: 'metadata',
      downloadUrl: null,
      error: err,
      creditsUsed: null,
      works: [
        {
          workId: id ? `cc:${id}` : null,
          state: 'failed',
          label: 'Cleaning failed',
          error: err,
          stage: 'metadata',
        },
      ],
    };
  }

  return {
    state: 'processing',
    label: 'Stripping metadata…',
    progress: null,
    stage: 'metadata',
    downloadUrl: null,
    error: null,
    creditsUsed: null,
    works: [
      {
        workId: id ? `cc:${id}` : null,
        state: 'processing',
        label: 'Stripping metadata…',
        stage: 'metadata',
      },
    ],
  };
}
