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
  const publicBaseUrl = env.R2_PUBLIC_BASE_URL || null;
  return {
    configured,
    backend: 'fast-panda-og',
    hasWorkerUrl: Boolean(String(env?.REMIX2_WORKER_URL || '').trim()),
    hasWorkerSecret: Boolean(String(env?.REMIX2_WORKER_SECRET || '').trim()),
    publicBaseUrl,
    r2: { publicBaseUrl },
    stages: {
      analyze: 'ffmpeg-edl-ms',
      analyzingBeats: 'codex-vision-beat-notes',
      deriveCharacter: 'codex-oauth-auto-similar',
      firstFrames: 'codex-oauth',
      videos: 'grok-oauth',
      stitch: 'ffmpeg-edl-trim',
      restoringOverlays: 'codex-vision-overlay-ass-burn',
      waitingProvider: 'provider-quota-cooldown-auto-resume',
    },
    characterModes: ['upload', 'auto-similar'],
    versions: ['v1', 'v2'],
    identityLockNote:
      'V2 (identityLock): Codex refs = character face + structure_* beat-start keyframe + vision beat notes only (no product/set); remake similar-from-scratch; Grok start = Codex stills only.',
    musicLockNote:
      'musicLock (default false): exact EDL durationMs trim/pad, video-only concat, remux TikTok source audio. Talking Heads keeps Grok audio. audioMode=mix = source bed + Grok amix.',
    restoreOverlaysNote:
      'restoreOverlays (Music-Only default true): OCR original on-screen hooks from source.mp4 and burn ASS onto final at source timings. Gen prompts stay no-captions.',
    viralBuilderNote:
      'viral-builder / writeFromScratch: analyze → awaiting_prompts (edit per-scene prompts + text rewrites) → continue → Codex → Grok → stitch. Codex uses Josh’s written prompts + identity lock.',
    message: configured
      ? 'Remix 2 ready: TikTok → ms EDL → (V2: beat analyze) → Codex frames → Grok clips → stitch. V2 Talking Heads, Music-Only, or Viral Builder (write-from-scratch).'
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

/**
 * Turn opaque worker / Cloudflare edge failures into a UI-safe message.
 * Avoids the generic "Worker rejected job create" when the body is HTML/CF text.
 */
export function describeWorkerFailure(status, data, fallback = 'Worker request failed') {
  const d = data && typeof data === 'object' ? data : {};
  if (typeof d.message === 'string' && d.message.trim()) return d.message.trim().slice(0, 500);
  if (typeof d.detail === 'string' && d.detail.trim()) return d.detail.trim().slice(0, 500);
  if (Array.isArray(d.detail) && d.detail.length) {
    try {
      return JSON.stringify(d.detail).slice(0, 400);
    } catch {
      /* ignore */
    }
  }
  const raw = typeof d.raw === 'string' ? d.raw : '';
  const rawLower = raw.toLowerCase();
  const cfCode = (raw.match(/error\s*code:\s*(\d+)/i) || [])[1];
  if (
    status === 530 ||
    cfCode === '1033' ||
    rawLower.includes('error code: 1033') ||
    rawLower.includes('origin is unreachable')
  ) {
    return (
      'Remix 2 worker unreachable (Cloudflare 1033 — Fast Panda origin/tunnel down). ' +
      'Power on / reboot Fast Panda and ensure cloudflared + worker on :8791.'
    );
  }
  if (status === 401 || status === 403) {
    return (
      (typeof d.error === 'string' && d.error) ||
      `Worker auth failed (HTTP ${status}) — check REMIX2_WORKER_SECRET matches Fast Panda.`
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    return (
      (typeof d.error === 'string' && d.error !== 'worker_error' ? d.error : null) ||
      `Worker gateway error (HTTP ${status}). Fast Panda may be down or overloaded.`
    );
  }
  if (typeof d.error === 'string' && d.error.trim() && d.error !== 'worker_error') {
    return d.error.trim().slice(0, 500);
  }
  if (raw && !raw.trimStart().startsWith('<')) {
    return `Worker HTTP ${status || '?'}: ${raw.replace(/\s+/g, ' ').trim().slice(0, 240)}`;
  }
  if (status) return `Worker HTTP ${status}: ${fallback}`;
  return fallback;
}

export async function workerFetch(env, path, { method = 'GET', body, timeoutMs = 60000 } = {}) {
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
  let res;
  try {
    const init = { method, headers, body: payload };
    if (timeoutMs > 0 && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    res = await fetch(url, init);
  } catch (err) {
    const msg = String(err?.message || err || 'fetch failed').slice(0, 240);
    const timedOut = /abort|timeout/i.test(msg);
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      data: {
        error: timedOut ? 'worker_timeout' : 'worker_unreachable',
        message: timedOut
          ? `Remix 2 worker timed out after ${Math.round(timeoutMs / 1000)}s (${base}).`
          : `Remix 2 worker unreachable: ${msg}. Check Fast Panda + tunnel (${base}).`,
      },
    };
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  data = sanitizeWorkerPayload(data);
  if (!res.ok) {
    const message = describeWorkerFailure(res.status, data, 'Worker rejected request');
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      data = { error: 'worker_error', message, raw: text?.slice?.(0, 400) };
    } else if (!data.message) {
      data = {
        ...data,
        error: data.error || (res.status === 401 || res.status === 403 ? 'worker_auth' : 'worker_error'),
        message,
      };
    }
  }
  return { ok: res.ok, status: res.status, data };
}

function downloadPath(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

function publicUrl(env, key) {
  const base = (env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/${key}`;
}

function parseBoolMeta(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return null;
}

function variantFromMeta(meta = {}) {
  const musicLock = parseBoolMeta(meta.musicLock ?? meta.musiclock);
  let remixVariant = String(meta.remixVariant || meta.remixvariant || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!remixVariant) {
    if (musicLock === true) remixVariant = 'music-only';
    else if (musicLock === false) remixVariant = 'talking-heads';
  }
  return { musicLock, remixVariant };
}

/**
 * List Remix 2 OG finals under character-remix-2-og/{jobId}/final.mp4.
 * Uses delimiter listing of job folders so intermediate frames/clips are skipped.
 *
 * @param {object} env
 * @param {{ limit?: number, cursor?: string }} opts
 */
export async function listRemix2Finals(env, opts = {}) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };

  const wantLimit = Math.min(200, Math.max(1, Number(opts.limit || 50) || 50));
  let cursor = opts.cursor || undefined;
  const objects = [];
  let truncated = false;
  let nextCursor = null;

  for (let round = 0; round < 40 && objects.length < wantLimit; round += 1) {
    const listed = await bucket.list({
      prefix: REMIX2_PREFIX,
      delimiter: '/',
      limit: 100,
      cursor,
    });
    const prefixes = listed.delimitedPrefixes || [];
    for (const folder of prefixes) {
      if (objects.length >= wantLimit) {
        truncated = true;
        nextCursor = listed.truncated ? listed.cursor : folder;
        break;
      }
      const m = /^character-remix-2-og\/([^/]+)\/$/.exec(folder);
      if (!m) continue;
      const jobId = m[1];
      const key = `${REMIX2_PREFIX}${jobId}/final.mp4`;
      let head;
      try {
        head = await bucket.head(key);
      } catch {
        head = null;
      }
      if (!head) continue;

      const meta = { ...(head.customMetadata || {}) };
      let uploadedAt = head.uploaded ? new Date(head.uploaded).toISOString() : null;
      // Always prefer ready.json sidecar when present (metadata casing / stripping is unreliable on R2).
      try {
        const sidecar = await bucket.get(`${REMIX2_PREFIX}${jobId}/ready.json`);
        if (sidecar) {
          const text = await sidecar.text();
          const json = text ? JSON.parse(text) : null;
          if (json && typeof json === 'object') {
            if (json.musicLock != null) {
              meta.musicLock = json.musicLock ? 'true' : 'false';
            }
            if (json.remixVariant) {
              meta.remixVariant = String(json.remixVariant);
            }
            if (json.tiktokUrl) meta.tiktokUrl = String(json.tiktokUrl);
            if (json.title) meta.title = String(json.title);
            if (json.audioMode) meta.audioMode = String(json.audioMode);
            if (json.uploadedAt) {
              const t = Date.parse(json.uploadedAt);
              if (Number.isFinite(t)) uploadedAt = new Date(t).toISOString();
            }
          }
        }
      } catch {
        /* ignore sidecar errors */
      }
      // Normalize lowercase S3-style metadata keys if sidecar was missing.
      if (meta.musiclock != null && meta.musicLock == null) meta.musicLock = meta.musiclock;
      if (meta.remixvariant && !meta.remixVariant) meta.remixVariant = meta.remixvariant;
      if (meta.tiktokurl && !meta.tiktokUrl) meta.tiktokUrl = meta.tiktokurl;

      const { musicLock, remixVariant } = variantFromMeta(meta);
      objects.push({
        key,
        jobId,
        size: head.size ?? null,
        uploaded: uploadedAt,
        contentType: head.httpMetadata?.contentType || 'video/mp4',
        downloadPath: downloadPath(key),
        publicUrl: publicUrl(env, key),
        musicLock,
        remixVariant: remixVariant || null,
        tiktokUrl: meta.tiktokUrl || meta.tiktokurl || null,
        title: meta.title || null,
        customMetadata: meta,
      });
    }

    if (objects.length >= wantLimit) break;
    if (!listed.truncated) {
      truncated = false;
      nextCursor = null;
      break;
    }
    cursor = listed.cursor;
    truncated = true;
    nextCursor = listed.cursor;
  }

  objects.sort((a, b) => {
    const ta = a.uploaded ? Date.parse(a.uploaded) : 0;
    const tb = b.uploaded ? Date.parse(b.uploaded) : 0;
    if (tb !== ta) return tb - ta;
    return String(b.key).localeCompare(String(a.key));
  });

  return {
    ok: true,
    prefix: REMIX2_PREFIX,
    truncated,
    cursor: truncated ? nextCursor : null,
    objects,
  };
}
