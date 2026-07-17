/**
 * Character remix orchestration helpers (admin).
 *
 * GET  ?action=config
 * GET  ?action=status&jobId=…
 * POST { action: "run", sourceKey, originalKey?, characterKey, options? }
 * POST { action: "save", videoUrl, sourceKey?, filename?, runpodJobId? }
 * POST { action: "cancel", jobId }
 *
 * Pipeline (client-driven):
 *   1) TikTok download → R2 tiktok/
 *   2) GhostCut removeWatermark only (caption strip)
 *   3) This API → RunPod WAN (character + scene restyle; hooks from original_video_url)
 *   4) save → character-remix/
 */

import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  archiveRemixVideo,
  buildRemixInput,
  extractOutputVideoUrl,
  fetchableMediaUrl,
  remixEndpointId,
  runpodConfigured,
  runpodFetch,
} from '../../lib/character-remix.js';

function configPayload(env) {
  const ep = remixEndpointId(env);
  return {
    configured: runpodConfigured(env),
    hasApiKey: Boolean(env.RUNPOD_API_KEY),
    hasEndpointId: Boolean(ep),
    endpointId: ep,
    templateId: env.RUNPOD_TEMPLATE_ID ? String(env.RUNPOD_TEMPLATE_ID) : null,
    r2Public: Boolean(env.R2_PUBLIC_BASE_URL),
    message: runpodConfigured(env)
      ? 'Character remix RunPod endpoint ready.'
      : 'Set RUNPOD_API_KEY and RUNPOD_CHARACTER_REMIX_ENDPOINT_ID (or RUNPOD_ENDPOINT_ID).',
  };
}

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
      return json(configPayload(env), runpodConfigured(env) ? 200 : 503);
    }
    if (action === 'status') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'missing_jobId' }, 400);
      const ep = remixEndpointId(env, url.searchParams.get('endpointId'));
      if (!ep) return json({ error: 'missing_endpoint', ...configPayload(env) }, 503);
      const result = await runpodFetch(env, `/${ep}/status/${encodeURIComponent(jobId)}`);
      const data = result.data || {};
      const videoUrl = extractOutputVideoUrl(data);
      return json(
        {
          ...data,
          jobId,
          videoUrl,
          remixReady: Boolean(videoUrl) && String(data.status || '').toUpperCase() === 'COMPLETED',
        },
        result.ok ? 200 : result.status || 502,
      );
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
    const ep = remixEndpointId(env, body.endpointId);
    if (!ep) return json({ error: 'missing_endpoint', ...configPayload(env) }, 503);
    const result = await runpodFetch(env, `/${ep}/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      body: {},
    });
    return json(result.data, result.ok ? 200 : result.status || 502);
  }

  if (action === 'save') {
    const archived = await archiveRemixVideo(env, {
      sourceUrl: body.videoUrl,
      filename: body.filename,
      sourceKey: body.sourceKey,
      runpodJobId: body.runpodJobId,
    });
    if (!archived.ok) {
      return json({ error: archived.error || 'archive_failed' }, 502);
    }
    return json({ ok: true, ...archived });
  }

  if (action === 'run') {
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
        jobId,
        endpointId: ep,
        input,
        runpod: result.data,
      },
      result.ok ? 200 : result.status || 502,
    );
  }

  return json({ error: 'unknown_action' }, 400);
}
