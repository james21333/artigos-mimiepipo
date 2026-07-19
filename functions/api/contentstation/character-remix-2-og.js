/**
 * Character Remix 2 - OG (admin).
 *
 * GET  ?action=config
 * GET  ?action=status&jobId=…
 * POST { action: "create", characterKey, scenes? | sourceKey?, autoRun? }
 * POST { action: "from-tiktok", tiktokUrl, characterKey, autoRun? }
 * POST { action: "run" | "first-frames" | "videos" | "stitch", jobId }
 */

import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import { configPayload, remix2WorkerConfigured, workerFetch, remix2R2Payload } from '../../lib/character-remix-2-og.js';
import { downloadTikTokToR2, looksLikeTikTokUrl } from '../../lib/tiktok-download.js';

async function resolveKey(env, key) {
  if (!key || typeof key !== 'string') return { ok: false, error: 'missing_key' };
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };
  try {
    const head = await bucket.head(key);
    if (!head) return { ok: false, error: 'object_not_found', key };
  } catch {
    return { ok: false, error: 'object_not_found', key };
  }
  return { ok: true, key };
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
      return json(configPayload(env), remix2WorkerConfigured(env) ? 200 : 503);
    }
    if (action === 'status') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'missing_jobId' }, 400);
      const result = await workerFetch(env, `/jobs/${encodeURIComponent(jobId)}`);
      return json(result.data || { error: 'worker_error' }, result.ok ? 200 : result.status || 502);
    }
    return json({ error: 'unknown_action' }, 400);
  }

  if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const action = body.action || 'create';
  const r2 = remix2R2Payload(env);

  if (action === 'from-tiktok') {
    if (!remix2WorkerConfigured(env)) {
      return json({ error: 'remix2_unconfigured', ...configPayload(env) }, 503);
    }
    const tiktokUrl = String(body.tiktokUrl || body.url || '').trim();
    const characterKey = body.characterKey;
    if (!tiktokUrl || !looksLikeTikTokUrl(tiktokUrl)) {
      return json({ error: 'invalid_tiktok_url', message: 'Provide a valid TikTok URL.' }, 400);
    }
    if (!characterKey) {
      return json({ error: 'missing_characterKey', message: 'characterKey is required.' }, 400);
    }
    const character = await resolveKey(env, characterKey);
    if (!character.ok) return json(character, 400);

    const bucket = env.MEDIA_BUCKET;
    if (!bucket) return json({ error: 'MEDIA_BUCKET not bound' }, 500);

    let dl;
    try {
      dl = await downloadTikTokToR2(env, bucket, tiktokUrl, { preferHd: true });
    } catch (err) {
      return json(
        { error: 'tiktok_download_failed', message: String(err?.message || err).slice(0, 400) },
        502,
      );
    }
    const sourceKey = dl?.key;
    if (!sourceKey) {
      return json({ error: 'tiktok_download_failed', message: 'No R2 key returned.' }, 502);
    }

    const result = await workerFetch(env, '/jobs', {
      method: 'POST',
      body: {
        characterKey,
        productKey: body.productKey || null,
        setKey: body.setKey || null,
        title: body.title || 'TikTok remake',
        sourceKey,
        dialogueCues: Array.isArray(body.dialogueCues) ? body.dialogueCues : [],
        scenes: [],
        autoRun: body.autoRun !== false,
        r2,
      },
    });
    return json(
      {
        ...(result.data || { error: 'worker_error' }),
        sourceKey,
        tiktokMeta: dl?.meta || null,
      },
      result.ok ? 200 : result.status || 502,
    );
  }

  if (action === 'create') {
    if (!remix2WorkerConfigured(env)) {
      return json({ error: 'remix2_unconfigured', ...configPayload(env) }, 503);
    }
    const characterKey = body.characterKey;
    if (!characterKey) {
      return json({ error: 'missing_characterKey', message: 'characterKey is required.' }, 400);
    }
    const character = await resolveKey(env, characterKey);
    if (!character.ok) return json(character, 400);

    for (const k of ['productKey', 'setKey', 'sourceKey']) {
      if (body[k]) {
        const r = await resolveKey(env, body[k]);
        if (!r.ok) return json(r, 400);
      }
    }

    const scenes = Array.isArray(body.scenes) ? body.scenes : [];
    if (!scenes.length && !body.sourceKey) {
      return json(
        { error: 'missing_scenes', message: 'Provide scenes[] or sourceKey for EDL analyze.' },
        400,
      );
    }

    const result = await workerFetch(env, '/jobs', {
      method: 'POST',
      body: {
        characterKey,
        productKey: body.productKey || null,
        setKey: body.setKey || null,
        title: body.title || 'Remix 2 OG',
        scenes,
        sourceKey: body.sourceKey || null,
        dialogueCues: Array.isArray(body.dialogueCues) ? body.dialogueCues : [],
        autoRun: Boolean(body.autoRun),
        r2,
      },
    });
    return json(result.data || { error: 'worker_error' }, result.ok ? 200 : result.status || 502);
  }

  if (action === 'run' || action === 'first-frames' || action === 'videos' || action === 'stitch') {
    const jobId = body.jobId;
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    const path =
      action === 'run'
        ? `/jobs/${encodeURIComponent(jobId)}/run`
        : action === 'first-frames'
          ? `/jobs/${encodeURIComponent(jobId)}/first-frames`
          : action === 'videos'
            ? `/jobs/${encodeURIComponent(jobId)}/videos`
            : `/jobs/${encodeURIComponent(jobId)}/stitch`;
    const result = await workerFetch(env, path, { method: 'POST', body: {} });
    return json(result.data || { error: 'worker_error' }, result.ok ? 200 : result.status || 502);
  }

  return json({ error: 'unknown_action' }, 400);
}
