/**
 * Character Remix 2 - OG (admin).
 *
 * GET  ?action=config
 * GET  ?action=status&jobId=…
 * GET  ?action=list[&limit=][&cursor=][&variant=all|music-only|talking-heads]
 * POST { action: "create", characterKey?, characterMode?, version?, identityLock?, musicLock?, scenes? | sourceKey?, autoRun? }
 * POST { action: "from-tiktok", tiktokUrl, characterKey?, characterMode?, version?, identityLock?, musicLock?, autoRun? }
 * POST { action: "run" | "first-frames" | "videos" | "stitch" | "derive-character", jobId }
 *
 * characterMode: "upload" (default) | "auto-similar"
 *   auto-similar / deriveCharacterFromSource:true → Codex invents a similar character from
 *   TikTok keyframes first; that image is identity for all scene frames. Uploaded character
 *   is ignored when auto-similar is selected.
 *
 * version: "v1" (default) | "v2"
 * identityLock: true (or version=v2) → uploaded character face + structure_* beat-start
 *   keyframes + vision beat notes; remake similar-from-scratch; Grok start images must be
 *   Codex stills (never raw TikTok keyframes). Auto-similar forbidden.
 *
 * musicLock: false (default) | true — V2 Music-Only: exact EDL durationMs (trim/pad),
 *   video-only concat, remux TikTok source audio. Also accepted via audioMode:"source"
 *   or remixVariant:"music-only".
 *
 * restoreOverlays: Music-Only default true — OCR original on-screen hooks/titles from
 *   source.mp4 and burn ASS onto final at the same startMs/endMs. Ignored when !musicLock.
 */

import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  configPayload,
  listRemix2Finals,
  remix2WorkerConfigured,
  workerFetch,
  remix2R2Payload,
} from '../../lib/character-remix-2-og.js';
import { downloadTikTokToR2, looksLikeTikTokUrl } from '../../lib/tiktok-download.js';
import { getTagForKey } from '../../lib/account-tags.js';

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
    if (action === 'list') {
      const pageLimit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50) || 50));
      const wantVariant = String(url.searchParams.get('variant') || 'all')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-');
      // Pull a wider R2 window when filtering so Music-Only still fills after enrichment.
      const scanLimit =
        wantVariant === 'all' || wantVariant === '' ? pageLimit : Math.min(200, pageLimit * 3);

      const result = await listRemix2Finals(env, {
        limit: scanLimit,
        cursor: url.searchParams.get('cursor') || undefined,
      });
      if (!result.ok) return json({ error: result.error || 'list_failed' }, 503);

      const needEnrich = (result.objects || []).filter((o) => o.musicLock == null);
      if (needEnrich.length && remix2WorkerConfigured(env)) {
        const concurrency = 6;
        for (let i = 0; i < needEnrich.length; i += concurrency) {
          const batch = needEnrich.slice(i, i + concurrency);
          await Promise.all(
            batch.map(async (obj) => {
              try {
                const st = await workerFetch(env, `/jobs/${encodeURIComponent(obj.jobId)}`);
                if (!st.ok || !st.data) return;
                if (st.data.musicLock === true) obj.musicLock = true;
                else if (st.data.musicLock === false) obj.musicLock = false;
                else if (String(st.data.audioMode || '').toLowerCase() === 'source') {
                  obj.musicLock = true;
                }
                const rv = String(st.data.remixVariant || '')
                  .trim()
                  .toLowerCase()
                  .replace(/_/g, '-');
                if (rv) obj.remixVariant = rv;
                else if (obj.musicLock === true) obj.remixVariant = 'music-only';
                else if (obj.musicLock === false) obj.remixVariant = 'talking-heads';
                if (!obj.tiktokUrl && st.data.tiktokUrl) obj.tiktokUrl = st.data.tiktokUrl;
                if (!obj.title && st.data.title) obj.title = st.data.title;
              } catch {
                /* keep unknown */
              }
            }),
          );
        }
      }

      let objects = [];
      for (const obj of result.objects || []) {
        let { musicLock, remixVariant } = obj;
        if (!remixVariant) {
          if (musicLock === true) remixVariant = 'music-only';
          else if (musicLock === false) remixVariant = 'talking-heads';
        }

        if (wantVariant === 'music-only' || wantVariant === 'musiconly' || wantVariant === 'music') {
          if (musicLock !== true && remixVariant !== 'music-only' && remixVariant !== 'music') {
            continue;
          }
        } else if (
          wantVariant === 'talking-heads' ||
          wantVariant === 'talkingheads' ||
          wantVariant === 'talking'
        ) {
          if (musicLock === true || remixVariant === 'music-only' || remixVariant === 'music') {
            continue;
          }
        }

        objects.push({
          ...obj,
          musicLock,
          remixVariant: remixVariant || null,
          account: await getTagForKey(env, obj.key),
        });
      }

      const truncated = Boolean(result.truncated) || objects.length > pageLimit;
      if (objects.length > pageLimit) objects = objects.slice(0, pageLimit);

      return json({
        status: 'ok',
        ok: true,
        prefix: result.prefix,
        variant: wantVariant || 'all',
        truncated,
        cursor: truncated ? result.cursor : null,
        objects,
      });
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
    const remixVariantRaw = String(body.remixVariant || '').trim().toLowerCase().replace(/_/g, '-');
    const musicLock =
      body.musicLock === true ||
      String(body.audioMode || '').trim().toLowerCase() === 'source' ||
      remixVariantRaw === 'music-only' ||
      remixVariantRaw === 'musiconly' ||
      remixVariantRaw === 'music';
    const audioMode = musicLock ? 'source' : String(body.audioMode || 'grok').trim() || 'grok';
    const remixVariant =
      body.remixVariant ||
      (musicLock ? 'music-only' : identityLock ? 'talking-heads' : undefined);
    const restoreOverlays = musicLock
      ? body.restoreOverlays !== false
      : body.restoreOverlays === true;
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
        musicLock,
        audioMode,
        remixVariant,
        restoreOverlays,
        productKey: body.productKey || null,
        setKey: body.setKey || null,
        title:
          body.title ||
          (musicLock
            ? 'TikTok remake (music-only)'
            : identityLock
              ? 'TikTok remake (talking heads)'
              : 'TikTok remake'),
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
    const remixVariantRaw = String(body.remixVariant || '').trim().toLowerCase().replace(/_/g, '-');
    const musicLock =
      body.musicLock === true ||
      String(body.audioMode || '').trim().toLowerCase() === 'source' ||
      remixVariantRaw === 'music-only' ||
      remixVariantRaw === 'musiconly' ||
      remixVariantRaw === 'music';
    const audioMode = musicLock ? 'source' : String(body.audioMode || 'grok').trim() || 'grok';
    const remixVariant =
      body.remixVariant ||
      (musicLock ? 'music-only' : identityLock ? 'talking-heads' : undefined);
    const restoreOverlays = musicLock
      ? body.restoreOverlays !== false
      : body.restoreOverlays === true;
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
        musicLock,
        audioMode,
        remixVariant,
        restoreOverlays,
        productKey: body.productKey || null,
        setKey: body.setKey || null,
        title:
          body.title ||
          (musicLock
            ? 'Remix 2 OG V2 Music-Only'
            : identityLock
              ? 'Remix 2 OG V2 Talking Heads'
              : 'Remix 2 OG'),
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
