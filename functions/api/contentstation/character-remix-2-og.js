/**
 * Character Remix 2 - OG (admin).
 *
 * GET  ?action=config
 * GET  ?action=status&jobId=…
 * POST { action: "create", characterKey?, characterMode?, version?, identityLock?, scenes? | sourceKey?, autoRun? }
 * POST { action: "from-tiktok", tiktokUrl, characterKey?, characterMode?, version?, identityLock?, autoRun? }
 * POST { action: "run" | "first-frames" | "videos" | "stitch" | "derive-character", jobId }
 *
 * characterMode: "upload" (default) | "auto-similar"
 *   auto-similar / deriveCharacterFromSource:true → Codex invents a similar character from
 *   TikTok keyframes first; that image is identity for all scene frames. Uploaded character
 *   is ignored when auto-similar is selected.
 *
 * version: "v1" (default) | "v2"
 * identityLock: true (or version=v2) → uploaded character only; never structure_* / TikTok
 *   keyframes as Codex image refs; Grok start images must be Codex stills. Auto-similar forbidden.
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
    const characterKey = body.characterKey || null;
    const versionRaw = String(body.version || 'v1').trim().toLowerCase();
    const identityLock = body.identityLock === true || versionRaw === 'v2' || versionRaw === '2';
    const version = identityLock ? 'v2' : 'v1';
    const characterMode = identityLock
      ? 'upload'
      : body.deriveCharacterFromSource
        ? 'auto-similar'
        : String(body.characterMode || 'upload').trim() || 'upload';
    const autoSimilar =
      !identityLock && (characterMode === 'auto-similar' || body.deriveCharacterFromSource === true);
    if (!tiktokUrl || !looksLikeTikTokUrl(tiktokUrl)) {
      return json({ error: 'invalid_tiktok_url', message: 'Provide a valid TikTok URL.' }, 400);
    }
    if (identityLock || !autoSimilar) {
      if (!characterKey) {
        return json(
          {
            error: 'missing_characterKey',
            message: identityLock
              ? 'V2 identity-lock requires an uploaded character image.'
              : 'characterKey is required (or enable auto-similar).',
          },
          400,
        );
      }
      const character = await resolveKey(env, characterKey);
      if (!character.ok) return json(character, 400);
    } else if (characterKey) {
      // Optional upload ignored when auto-similar wins — still validate if provided.
      const character = await resolveKey(env, characterKey);
      if (!character.ok) return json(character, 400);
    }

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
    if (!dl?.ok || !dl?.key) {
      return json(
        {
          error: dl?.error || 'tiktok_download_failed',
          message: dl?.detail || dl?.message || 'TikTok download failed (no R2 key).',
        },
        502,
      );
    }
    const sourceKey = dl.key;

    const result = await workerFetch(env, '/jobs', {
      method: 'POST',
      body: {
        characterKey: autoSimilar ? null : characterKey,
        characterMode: autoSimilar ? 'auto-similar' : 'upload',
        deriveCharacterFromSource: autoSimilar,
        version,
        identityLock,
        productKey: body.productKey || null,
        setKey: body.setKey || null,
        title: body.title || (identityLock ? 'TikTok remake (identity lock)' : 'TikTok remake'),
        sourceKey,
        dialogueCues: Array.isArray(body.dialogueCues) ? body.dialogueCues : [],
        scenes: [],
        autoRun: body.autoRun !== false,
        r2,
      },
    });
    if (!result.ok) {
      const d = result.data || {};
      const detail =
        d.message ||
        d.detail ||
        (Array.isArray(d.detail) ? JSON.stringify(d.detail).slice(0, 400) : null) ||
        d.error ||
        'Worker rejected job create';
      return json(
        { error: 'worker_error', message: String(detail).slice(0, 500), sourceKey, raw: d },
        result.status || 502,
      );
    }
    return json(
      {
        ...(result.data || {}),
        sourceKey,
        tiktokMeta: dl?.meta || null,
      },
      200,
    );
  }

  if (action === 'create') {
    if (!remix2WorkerConfigured(env)) {
      return json({ error: 'remix2_unconfigured', ...configPayload(env) }, 503);
    }
    const characterKey = body.characterKey || null;
    const versionRaw = String(body.version || 'v1').trim().toLowerCase();
    const identityLock = body.identityLock === true || versionRaw === 'v2' || versionRaw === '2';
    const version = identityLock ? 'v2' : 'v1';
    const characterMode = identityLock
      ? 'upload'
      : body.deriveCharacterFromSource
        ? 'auto-similar'
        : String(body.characterMode || 'upload').trim() || 'upload';
    const autoSimilar =
      !identityLock && (characterMode === 'auto-similar' || body.deriveCharacterFromSource === true);
    if (identityLock || !autoSimilar) {
      if (!characterKey) {
        return json(
          {
            error: 'missing_characterKey',
            message: identityLock
              ? 'V2 identity-lock requires an uploaded character image.'
              : 'characterKey is required (or enable auto-similar).',
          },
          400,
        );
      }
      const character = await resolveKey(env, characterKey);
      if (!character.ok) return json(character, 400);
    }

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
    if (autoSimilar && !body.sourceKey) {
      return json(
        { error: 'missing_sourceKey', message: 'sourceKey is required for characterMode=auto-similar.' },
        400,
      );
    }

    const result = await workerFetch(env, '/jobs', {
      method: 'POST',
      body: {
        characterKey: autoSimilar ? null : characterKey,
        characterMode: autoSimilar ? 'auto-similar' : 'upload',
        deriveCharacterFromSource: autoSimilar,
        version,
        identityLock,
        productKey: body.productKey || null,
        setKey: body.setKey || null,
        title: body.title || (identityLock ? 'Remix 2 OG V2' : 'Remix 2 OG'),
        scenes,
        sourceKey: body.sourceKey || null,
        dialogueCues: Array.isArray(body.dialogueCues) ? body.dialogueCues : [],
        autoRun: Boolean(body.autoRun),
        r2,
      },
    });
    return json(result.data || { error: 'worker_error' }, result.ok ? 200 : result.status || 502);
  }

  if (
    action === 'run' ||
    action === 'first-frames' ||
    action === 'videos' ||
    action === 'stitch' ||
    action === 'derive-character'
  ) {
    const jobId = body.jobId;
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    const path =
      action === 'run'
        ? `/jobs/${encodeURIComponent(jobId)}/run`
        : action === 'first-frames'
          ? `/jobs/${encodeURIComponent(jobId)}/first-frames`
          : action === 'videos'
            ? `/jobs/${encodeURIComponent(jobId)}/videos`
            : action === 'derive-character'
              ? `/jobs/${encodeURIComponent(jobId)}/derive-character`
              : `/jobs/${encodeURIComponent(jobId)}/stitch`;
    const result = await workerFetch(env, path, { method: 'POST', body: {} });
    return json(result.data || { error: 'worker_error' }, result.ok ? 200 : result.status || 502);
  }

  return json({ error: 'unknown_action' }, 400);
}
