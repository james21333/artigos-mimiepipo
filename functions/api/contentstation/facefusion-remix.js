/**
 * Remix 3 — FaceFusion orchestration (admin).
 *
 * GET  ?action=config
 * GET  ?action=status&jobId=…
 * GET  ?action=list[&limit=][&cursor=]
 * POST { action: "run", faceKey, videoKey, options? }
 * POST { action: "save", videoUrl?, videoBase64?, sourceKey?, faceKey?, filename?, runpodJobId?, tiktokUrl? }
 * POST { action: "cancel", jobId }
 *
 * Client pipeline:
 *   1) Upload face → faces/
 *   2) TikTok download → tiktok/
 *   3) Optional GhostCut deepAiRemake → cleaned/
 *   4) This API → RunPod FaceFusion worker
 *   5) save → facefusion-remix/
 */

import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  FACEFUSION_PREFIX,
  archiveFacefusionVideo,
  archiveFacefusionVideoFromBase64,
  buildFacefusionInput,
  configPayload,
  extractFacefusionProgress,
  extractOutputVideoBase64,
  extractOutputVideoUrl,
  facefusionConfigured,
  facefusionEndpointId,
  fetchableMediaUrl,
  publicMediaUrl,
  runpodFetch,
} from '../../lib/facefusion-remix.js';

async function resolveKeyUrl(env, key) {
  if (!key || typeof key !== 'string') return { ok: false, error: 'missing_key' };
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };
  try {
    const head = await bucket.head(key);
    if (!head) return { ok: false, error: 'object_not_found', key };
  } catch {
    return { ok: false, error: 'object_not_found', key };
  }
  const fetchable = await fetchableMediaUrl(env, key);
  if (!fetchable.url) {
    return {
      ok: false,
      error: 'no_fetchable_url',
      message: 'Set R2_PUBLIC_BASE_URL so RunPod can download media.',
    };
  }
  return { ok: true, key, url: fetchable.url, kind: fetchable.kind };
}

function downloadPath(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

function runpodJobMissing(result) {
  if (!result) return false;
  if (result.status === 404) return true;
  const data = result.data || {};
  if (data.status === 404) return true;
  const detail = String(data.detail || data.error || data.title || data.message || '');
  return /job not found|not found/i.test(detail);
}

async function listArchived(env, url) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return json({ error: 'MEDIA_BUCKET not bound' }, 503);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50) || 50));
  const cursor = url.searchParams.get('cursor') || undefined;
  const listed = await bucket.list({
    prefix: FACEFUSION_PREFIX,
    limit,
    cursor,
    include: ['httpMetadata', 'customMetadata'],
  });
  const objects = (listed.objects || [])
    .filter((o) => o && o.key && !o.key.endsWith('/'))
    .map((o) => {
      const meta = o.customMetadata || {};
      const jobId = meta.jobId || meta.runpodJobId || '';
      return {
        key: o.key,
        size: o.size,
        uploaded: o.uploaded ? new Date(o.uploaded).toISOString() : null,
        contentType: o.httpMetadata?.contentType || null,
        downloadPath: downloadPath(o.key),
        publicUrl: publicMediaUrl(env, o.key),
        sourceKey: meta.sourceKey || '',
        faceKey: meta.faceKey || '',
        tiktokUrl: meta.tiktokUrl || '',
        runpodJobId: jobId,
        jobId,
        customMetadata: meta,
      };
    });
  return json({
    status: 'ok',
    prefix: FACEFUSION_PREFIX,
    truncated: Boolean(listed.truncated),
    cursor: listed.truncated ? listed.cursor : null,
    objects,
  });
}

async function statusJob(env, jobId, endpointId) {
  const ep = facefusionEndpointId(env, endpointId);
  if (!ep) return json({ error: 'missing_endpoint', ...configPayload(env) }, 503);
  const result = await runpodFetch(env, `/${ep}/status/${encodeURIComponent(jobId)}`);
  const data = result.data || {};

  if (runpodJobMissing(result)) {
    return json(
      {
        backend: 'runpod',
        jobId,
        endpointId: ep,
        status: 'FAILED',
        error: 'job_not_found',
        message:
          'RunPod job not found (finished, expired, or never submitted on this endpoint). Refresh and retry.',
        remixReady: false,
        videoUrl: null,
        progress: null,
      },
      200,
    );
  }

  const status = String(data.status || '').toUpperCase();
  let videoUrl = extractOutputVideoUrl(data);
  const b64 = !videoUrl && status === 'COMPLETED' ? extractOutputVideoBase64(data) : null;
  const progress = extractFacefusionProgress(data);
  const workerError =
    status === 'COMPLETED' && data.output && typeof data.output === 'object'
      ? data.output.error || null
      : null;

  if (b64 && !videoUrl) {
    const archived = await archiveFacefusionVideoFromBase64(env, {
      base64: b64.base64,
      mime: b64.mime,
      runpodJobId: jobId,
      filename: jobId,
    });
    if (archived.ok) {
      videoUrl = archived.publicUrl || null;
      return json({
        backend: 'runpod',
        jobId,
        endpointId: ep,
        status: 'COMPLETED',
        remixReady: true,
        videoUrl,
        key: archived.key,
        downloadPath: archived.downloadPath,
        progress,
      });
    }
  }

  if (status === 'COMPLETED' && workerError && !videoUrl) {
    return json({
      backend: 'runpod',
      jobId,
      endpointId: ep,
      status: 'FAILED',
      error: 'worker_error',
      message: String(workerError).slice(0, 500),
      remixReady: false,
      videoUrl: null,
      progress,
    });
  }

  const delayMs = data.delayTime != null ? Number(data.delayTime) : null;
  let message = null;
  if (status === 'IN_QUEUE') {
    const mins = delayMs != null && Number.isFinite(delayMs) ? Math.round(delayMs / 60000) : null;
    message =
      mins != null && mins >= 2
        ? `Starting GPU… still queued (~${mins} min). Cold starts vary.`
        : 'Starting GPU… cold starts vary.';
  } else if (status === 'IN_PROGRESS') {
    message = 'FaceFusion swapping faces…';
  }

  return json({
    backend: 'runpod',
    jobId,
    endpointId: ep,
    status,
    remixReady: Boolean(status === 'COMPLETED' && videoUrl),
    videoUrl: videoUrl || null,
    key: data.output?.key || null,
    progress,
    message,
    delayTime: delayMs,
    error: status === 'FAILED' ? data.error || data.output?.error || null : null,
  });
}

export async function onRequestGet(context) {
  const auth = await requireRole(context, [ROLES.ADMIN]);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const action = (url.searchParams.get('action') || 'config').trim();

  if (action === 'config') {
    return json({ status: 'ok', ...configPayload(context.env) });
  }
  if (action === 'list') {
    return listArchived(context.env, url);
  }
  if (action === 'status') {
    const jobId = (url.searchParams.get('jobId') || '').trim();
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    return statusJob(context.env, jobId, url.searchParams.get('endpointId'));
  }
  return json({ error: 'unknown_action' }, 400);
}

export async function onRequestPost(context) {
  const auth = await requireRole(context, [ROLES.ADMIN]);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const action = String(body?.action || '').trim();
  const env = context.env;

  if (action === 'config') {
    return json({ status: 'ok', ...configPayload(env) });
  }

  if (action === 'cancel') {
    const jobId = String(body.jobId || '').trim();
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    const ep = facefusionEndpointId(env, body.endpointId);
    if (!ep) return json({ error: 'missing_endpoint', ...configPayload(env) }, 503);
    const result = await runpodFetch(env, `/${ep}/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      body: {},
    });
    return json(
      { ...(result.data || {}), backend: 'runpod', jobId, endpointId: ep },
      result.ok ? 200 : result.status || 502,
    );
  }

  if (action === 'save') {
    if (body.videoBase64) {
      const archived = await archiveFacefusionVideoFromBase64(env, {
        base64: body.videoBase64,
        mime: body.mime,
        filename: body.filename,
        sourceKey: body.sourceKey || body.videoKey,
        faceKey: body.faceKey,
        runpodJobId: body.runpodJobId || body.jobId,
        tiktokUrl: body.tiktokUrl,
        key: body.key,
      });
      if (!archived.ok) return json(archived, 502);
      return json({ status: 'ok', ...archived });
    }
    const archived = await archiveFacefusionVideo(env, {
      sourceUrl: body.videoUrl,
      filename: body.filename,
      sourceKey: body.sourceKey || body.videoKey,
      faceKey: body.faceKey,
      runpodJobId: body.runpodJobId || body.jobId,
      tiktokUrl: body.tiktokUrl,
    });
    if (!archived.ok) return json(archived, 502);
    return json({ status: 'ok', ...archived });
  }

  if (action === 'run') {
    if (!facefusionConfigured(env)) {
      return json({ error: 'facefusion_unconfigured', ...configPayload(env) }, 503);
    }
    const faceKey = String(body.faceKey || '').trim();
    const videoKey = String(body.videoKey || body.sourceKey || '').trim();
    if (!faceKey) return json({ error: 'missing_faceKey', message: 'Upload a face image first.' }, 400);
    if (!videoKey) {
      return json({ error: 'missing_videoKey', message: 'Download a TikTok (or cleaned) video first.' }, 400);
    }

    const face = await resolveKeyUrl(env, faceKey);
    if (!face.ok) return json(face, 400);
    const video = await resolveKeyUrl(env, videoKey);
    if (!video.ok) return json(video, 400);

    const ep = facefusionEndpointId(env, body.endpointId);
    const input = buildFacefusionInput({
      faceUrl: face.url,
      videoUrl: video.url,
      options: body.options || {},
    });

    const result = await runpodFetch(env, `/${ep}/run`, {
      method: 'POST',
      body: { input },
    });
    if (!result.ok) {
      return json(
        {
          error: 'runpod_run_failed',
          message: result.data?.error || result.data?.message || `HTTP ${result.status}`,
          backend: 'runpod',
          runpod: result.data,
        },
        result.status || 502,
      );
    }

    const jobId = result.data?.id || result.data?.jobId || null;
    return json({
      status: 'ok',
      backend: 'runpod',
      jobId,
      endpointId: ep,
      faceKey,
      videoKey,
      message: 'FaceFusion job submitted',
    });
  }

  return json({ error: 'unknown_action' }, 400);
}
