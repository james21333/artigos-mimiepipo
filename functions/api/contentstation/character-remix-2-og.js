/**
 * Character Remix 2 - OG (admin).
 *
 * GET  ?action=config
 * GET  ?action=status&jobId=…
 * POST { action: "create", characterKey, productKey?, setKey?, scenes: [...] }
 * POST { action: "first-frames", jobId }
 * POST { action: "videos", jobId }   // requires SuperGrok OAuth on Fast Panda
 * POST { action: "stitch", jobId }
 */

import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import { configPayload, remix2WorkerConfigured, workerFetch } from '../../lib/character-remix-2-og.js';

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

    for (const k of ['productKey', 'setKey']) {
      if (body[k]) {
        const r = await resolveKey(env, body[k]);
        if (!r.ok) return json(r, 400);
      }
    }

    const scenes = Array.isArray(body.scenes) ? body.scenes : [];
    if (!scenes.length) {
      return json({ error: 'missing_scenes', message: 'Provide at least one scene.' }, 400);
    }

    const result = await workerFetch(env, '/jobs', {
      method: 'POST',
      body: {
        characterKey,
        productKey: body.productKey || null,
        setKey: body.setKey || null,
        title: body.title || 'Remix 2 OG',
        scenes,
        r2: {
          publicBaseUrl: env.R2_PUBLIC_BASE_URL || null,
          bucket: env.R2_BUCKET_NAME || env.R2_BUCKET || null,
          endpoint: env.R2_ENDPOINT || null,
          accessKeyId: env.R2_ACCESS_KEY_ID || null,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY || null,
          accountId: env.R2_ACCOUNT_ID || null,
        },
      },
    });
    return json(result.data || { error: 'worker_error' }, result.ok ? 200 : result.status || 502);
  }

  if (action === 'first-frames' || action === 'videos' || action === 'stitch') {
    const jobId = body.jobId;
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    const path =
      action === 'first-frames'
        ? `/jobs/${encodeURIComponent(jobId)}/first-frames`
        : action === 'videos'
          ? `/jobs/${encodeURIComponent(jobId)}/videos`
          : `/jobs/${encodeURIComponent(jobId)}/stitch`;
    const result = await workerFetch(env, path, { method: 'POST', body: {} });
    return json(result.data || { error: 'worker_error' }, result.ok ? 200 : result.status || 502);
  }

  return json({ error: 'unknown_action' }, 400);
}
