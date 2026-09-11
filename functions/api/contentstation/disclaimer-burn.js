/**
 * Disclaimer burn (admin): upload → freeform prompt → Fast Panda ffmpeg ASS burn.
 *
 * POST { action: "burn", sourceKey, prompt }
 * POST { action: "cleanup", keys: string[] }
 */

import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  describeWorkerFailure,
  remix2R2Payload,
  remix2WorkerConfigured,
  workerFetch,
} from '../../lib/character-remix-2-og.js';

function downloadPath(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

async function deleteKey(env, key) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket || !key) return { ok: false, key, error: 'missing' };
  try {
    await bucket.delete(key);
    return { ok: true, key };
  } catch (err) {
    return { ok: false, key, error: String(err?.message || err).slice(0, 200) };
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const auth = await requireRole(context, [ROLES.ADMIN]);
  if (!auth.ok) return auth.response;

  if (method === 'GET') {
    const url = new URL(request.url);
    const jobId = String(url.searchParams.get('jobId') || '').trim();
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    if (!remix2WorkerConfigured(env)) {
      return json({ error: 'remix2_unconfigured' }, 503);
    }
    const { ok, status, data } = await workerFetch(env, `/disclaimer-burn/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      timeoutMs: 15000,
    });
    if (!ok) {
      return json(
        {
          error: data?.error || 'status_failed',
          message: describeWorkerFailure(status, data, 'Disclaimer burn status failed'),
          detail: data,
        },
        status >= 400 && status < 600 ? status : 502,
      );
    }
    return json({ ok: true, ...data });
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

  const action = String(body.action || 'burn').trim();

  if (action === 'cleanup') {
    const keys = Array.isArray(body.keys) ? body.keys : [];
    const cleaned = [];
    for (const raw of keys.slice(0, 20)) {
      const key = String(raw || '').trim();
      if (!key || !key.startsWith('disclaimer-tmp/')) continue;
      cleaned.push(await deleteKey(env, key));
    }
    return json({ ok: true, cleaned });
  }

  if (action !== 'burn') {
    return json({ error: 'unknown_action' }, 400);
  }

  if (!remix2WorkerConfigured(env)) {
    return json(
      {
        error: 'remix2_unconfigured',
        message: 'REMIX2_WORKER_URL / REMIX2_WORKER_SECRET missing on Pages.',
      },
      503,
    );
  }

  const sourceKey = String(body.sourceKey || '').trim();
  const prompt = String(body.prompt || '').trim();
  if (!sourceKey) return json({ error: 'missing_sourceKey' }, 400);
  if (!sourceKey.startsWith('disclaimer-tmp/')) {
    return json({ error: 'source_must_be_disclaimer_tmp' }, 400);
  }
  if (!prompt) return json({ error: 'missing_prompt' }, 400);
  if (prompt.length > 4000) return json({ error: 'prompt_too_long' }, 400);

  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return json({ error: 'MEDIA_BUCKET not bound' }, 503);
  try {
    const head = await bucket.head(sourceKey);
    if (!head) return json({ error: 'object_not_found', key: sourceKey }, 404);
  } catch {
    return json({ error: 'object_not_found', key: sourceKey }, 404);
  }

  // Start async on Fast Panda (CF Pages can't wait for ffmpeg).
  const { ok, status, data } = await workerFetch(env, '/disclaimer-burn', {
    method: 'POST',
    timeoutMs: 60000,
    body: {
      sourceKey,
      prompt,
      outputPrefix: 'disclaimer-tmp/',
      async: true,
      r2: remix2R2Payload(env),
    },
  });

  if (!ok) {
    return json(
      {
        error: data?.error || 'burn_failed',
        message: describeWorkerFailure(status, data, 'Disclaimer burn failed'),
        detail: data,
      },
      status >= 400 && status < 600 ? status : 502,
    );
  }

  const jobId = String(data?.jobId || '').trim();
  if (!jobId) {
    return json({ error: 'no_job', message: 'Worker returned no jobId' }, 502);
  }

  return json({
    ok: true,
    started: true,
    jobId,
    sourceKey,
    stage: data?.stage || 'running',
  });
}
