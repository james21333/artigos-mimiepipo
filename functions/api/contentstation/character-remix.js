/**
 * Character remix orchestration helpers (admin).
 *
 * GET  ?action=config
 * GET  ?action=status&jobId=…
 * POST { action: "run", sourceKey, originalKey?, characterKey, options? }
 * POST { action: "save", videoUrl?, videoBase64?, sourceKey?, filename?, runpodJobId? }
 * POST { action: "cancel", jobId }
 *
 * Pipeline (client-driven):
 *   1) TikTok download → R2 tiktok/
 *   2) GhostCut removeWatermark only (caption strip)
 *   3) This API → RunPod Serverless worker:
 *        segment → character replace → optional VACE scenery → stitch → audio → MP4
 *   4) save → character-remix/ (idempotent if worker already archived)
 *   5) optional CloudConvert alter-audio uniquify (client via /clean)
 */

import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  archiveRemixVideo,
  archiveRemixVideoFromBase64,
  buildRemixInput,
  configPayload,
  extractOutputVideoBase64,
  extractOutputVideoUrl,
  extractRemixProgress,
  fetchableMediaUrl,
  isComfyJobId,
  publicMediaUrl,
  remixBackend,
  remixConfigured,
  remixEndpointId,
  runpodConfigured,
  runpodFetch,
} from '../../lib/character-remix.js';
import {
  cancelComfyCharacterRemix,
  statusComfyCharacterRemix,
  submitComfyCharacterRemix,
} from '../../lib/comfyui-client.js';

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
      message: 'Set R2_PUBLIC_BASE_URL so RunPod/GhostCut can download media.',
    };
  }
  return { ok: true, key, url: fetchable.url, kind: fetchable.kind };
}

async function statusComfy(env, jobId) {
  const result = await statusComfyCharacterRemix(env, jobId);
  if (!result.ok) {
    return json(
      { ...result, ...configPayload(env) },
      result.status && result.status >= 400 ? result.status : 502,
    );
  }
  return json({
    ...result,
    backend: 'comfyui',
    id: result.promptId,
  });
}

async function statusRunpod(env, jobId, endpointId) {
  const ep = remixEndpointId(env, endpointId);
  if (!ep) return json({ error: 'missing_endpoint', ...configPayload(env) }, 503);
  const result = await runpodFetch(env, `/${ep}/status/${encodeURIComponent(jobId)}`);
  const data = result.data || {};
  const status = String(data.status || '').toUpperCase();
  let videoUrl = extractOutputVideoUrl(data);
  const b64 = !videoUrl && status === 'COMPLETED' ? extractOutputVideoBase64(data) : null;
  const progress = extractRemixProgress(data);
  const workerError =
    status === 'COMPLETED' && data.output && typeof data.output === 'object'
      ? data.output.error || null
      : null;

  // Strip bulky worker payloads from the client-facing status response.
  const slim = { ...data };
  if (slim.output && typeof slim.output === 'object') {
    const { video_base64: _vb, videoBase64: _vb2, ...restOut } = slim.output;
    slim.output = restOut;
  }

  // Materialize base64 worker output into R2 once so the client gets a fetchable URL.
  if (b64 && !videoUrl) {
    const archived = await archiveRemixVideoFromBase64(env, {
      base64: b64.base64,
      mime: b64.mime,
      runpodJobId: jobId,
      filename: jobId,
    });
    if (archived.ok) {
      videoUrl = archived.publicUrl || null;
      return json(
        {
          ...slim,
          output: undefined,
          backend: 'runpod',
          jobId,
          videoUrl,
          archivedKey: archived.key,
          downloadPath: archived.downloadPath,
          remixReady: true,
          progress,
          status: 'COMPLETED',
        },
        200,
      );
    }
    return json(
      {
        ...slim,
        output: undefined,
        backend: 'runpod',
        jobId,
        videoUrl: null,
        videoBase64: b64.base64,
        videoMime: b64.mime,
        archiveError: archived.error,
        remixReady: true,
        progress,
        status: 'COMPLETED',
      },
      result.ok ? 200 : result.status || 502,
    );
  }

  if (status === 'COMPLETED' && workerError && !videoUrl && !b64) {
    return json(
      {
        ...slim,
        output: undefined,
        backend: 'runpod',
        jobId,
        videoUrl: null,
        remixReady: false,
        progress,
        status: 'FAILED',
        error: workerError,
        message: data.output?.message || String(workerError),
      },
      200,
    );
  }

  return json(
    {
      ...slim,
      backend: 'runpod',
      jobId,
      videoUrl,
      remixReady: Boolean(videoUrl) && status === 'COMPLETED',
      progress,
    },
    result.ok ? 200 : result.status || 502,
  );
}

async function runComfy(env, body) {
  const sourceKey = body.sourceKey;
  const characterKey = body.characterKey;
  if (!sourceKey || !characterKey) {
    return json({ error: 'missing_keys', message: 'sourceKey and characterKey are required.' }, 400);
  }

  const source = await resolveKeyUrl(env, sourceKey);
  if (!source.ok) return json(source, 400);
  const character = await resolveKeyUrl(env, characterKey);
  if (!character.ok) return json(character, 400);

  const opts = body.options || {};
  const submitted = await submitComfyCharacterRemix(env, {
    videoUrl: source.url,
    imageUrl: character.url,
    options: {
      frameLoadCap: opts.frameLoadCap,
    },
  });

  if (!submitted.ok) {
    return json(
      {
        ok: false,
        backend: 'comfyui',
        error: submitted.error || 'comfy_submit_failed',
        message: submitted.message || 'ComfyUI submit failed',
        detail: submitted.detail || submitted.data || null,
        ...configPayload(env),
      },
      submitted.status && submitted.status >= 400 ? submitted.status : 502,
    );
  }

  return json({
    ok: true,
    backend: 'comfyui',
    jobId: submitted.jobId,
    promptId: submitted.promptId,
    uploaded: submitted.uploaded,
  });
}

async function runRunpod(env, body) {
  if (!runpodConfigured(env)) {
    return json({ error: 'runpod_unconfigured', ...configPayload(env) }, 503);
  }
  const ep = remixEndpointId(env, body.endpointId);
  if (!ep) return json({ error: 'missing_endpoint', ...configPayload(env) }, 503);

  const sourceKey = body.sourceKey;
  const originalKey = body.originalKey || body.sourceKey;
  const characterKey = body.characterKey;
  if (!sourceKey || !characterKey) {
    return json({ error: 'missing_keys', message: 'sourceKey and characterKey are required.' }, 400);
  }

  const source = await resolveKeyUrl(env, sourceKey);
  if (!source.ok) return json(source, 400);
  const character = await resolveKeyUrl(env, characterKey);
  if (!character.ok) return json(character, 400);
  let originalUrl = source.url;
  if (originalKey && originalKey !== sourceKey) {
    const original = await resolveKeyUrl(env, originalKey);
    if (original.ok) originalUrl = original.url;
  }

  const input = buildRemixInput({
    sourceVideoUrl: source.url,
    originalVideoUrl: originalUrl,
    characterImageUrl: character.url,
    options: body.options || {},
  });

  const result = await runpodFetch(env, `/${ep}/run`, {
    method: 'POST',
    body: { input },
  });

  const jobId = result.data?.id || result.data?.jobId || null;
  return json(
    {
      ok: result.ok,
      backend: 'runpod',
      jobId,
      endpointId: ep,
      input,
      runpod: result.data,
    },
    result.ok ? 200 : result.status || 502,
  );
}

export async function onRequest(context) {
  const auth = await requireRole(context, [ROLES.ADMIN]);
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  if (method === 'GET' || method === 'HEAD') {
    const action = url.searchParams.get('action') || 'config';
    if (action === 'config') {
      const payload = configPayload(env);
      return json(payload, payload.configured ? 200 : 503);
    }
    if (action === 'status') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'missing_jobId' }, 400);
      if (isComfyJobId(jobId)) {
        return statusComfy(env, jobId);
      }
      return statusRunpod(env, jobId, url.searchParams.get('endpointId'));
    }
    return json({ error: 'unknown_action' }, 400);
  }

  if (method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const action = body.action || 'run';

  if (action === 'cancel') {
    const jobId = body.jobId;
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    if (isComfyJobId(jobId)) {
      const result = await cancelComfyCharacterRemix(env, jobId);
      return json({ ...result, backend: 'comfyui' });
    }
    const ep = remixEndpointId(env, body.endpointId);
    if (!ep) return json({ error: 'missing_endpoint', ...configPayload(env) }, 503);
    const result = await runpodFetch(env, `/${ep}/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      body: {},
    });
    return json({ ...(result.data || {}), backend: 'runpod' }, result.ok ? 200 : result.status || 502);
  }

  if (action === 'save') {
    if (body.videoBase64) {
      const archived = await archiveRemixVideoFromBase64(env, {
        base64: body.videoBase64,
        mime: body.videoMime || 'video/mp4',
        filename: body.filename,
        sourceKey: body.sourceKey,
        runpodJobId: body.runpodJobId || body.jobId,
      });
      if (!archived.ok) {
        return json({ error: archived.error || 'archive_failed' }, 502);
      }
      return json({
        ok: true,
        ...archived,
        publicUrl: archived.publicUrl || publicMediaUrl(env, archived.key),
      });
    }
    const archived = await archiveRemixVideo(env, {
      sourceUrl: body.videoUrl,
      filename: body.filename,
      sourceKey: body.sourceKey,
      runpodJobId: body.runpodJobId || body.jobId,
    });
    if (!archived.ok) {
      return json({ error: archived.error || 'archive_failed' }, 502);
    }
    return json({ ok: true, ...archived });
  }

  if (action === 'run') {
    if (!remixConfigured(env)) {
      return json({ error: 'remix_unconfigured', ...configPayload(env) }, 503);
    }
    const backend = remixBackend(env);
    if (backend === 'comfyui') {
      return runComfy(env, body);
    }
    return runRunpod(env, body);
  }

  return json({ error: 'unknown_action' }, 400);
}
