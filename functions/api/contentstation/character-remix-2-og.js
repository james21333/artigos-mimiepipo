/**
 * Character Remix 2 - OG (admin).
 *
 * GET  ?action=config
 * GET  ?action=status&jobId=…
 * GET  ?action=list[&limit=][&cursor=][&variant=all|music-only|talking-heads|viral-builder]
 * POST { action: "create", characterKey?, characterMode?, version?, identityLock?, musicLock?, scenes? | sourceKey?, autoRun? }
 * POST { action: "from-tiktok", tiktokUrl, characterKey?, characterMode?, version?, identityLock?, musicLock?, writeFromScratch?, autoRun? }
 * POST { action: "continue", jobId, scenes[], grokDialogue?, musicOnly?, restoreOverlays? }
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
 * writeFromScratch / remixVariant:"viral-builder" — two-phase Viral Video Builder:
 *   analyze (EDL + beats + overlays) → awaiting_prompts → continue with user scene prompts.
 *
 * restoreOverlays: Music-Only default true — OCR original on-screen hooks/titles from
 *   source.mp4 and burn ASS onto final at the same startMs/endMs. Ignored when !musicLock
 *   (except viral-builder, which burns rewritten text when provided).
 */

import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  configPayload,
  describeWorkerFailure,
  listRemix2Finals,
  remix2WorkerConfigured,
  workerFetch,
  remix2R2Payload,
} from '../../lib/character-remix-2-og.js';
import { downloadTikTokToR2, looksLikeTikTokUrl } from '../../lib/tiktok-download.js';
import { flattenPostMetaForStorage } from '../../lib/tiktok-post-info.js';
import { getTagForKey, sanitizeAccountName, setVideoAccount } from '../../lib/account-tags.js';
import {
  alreadyRemixedResult,
  ensureRemixUsedIndex,
  extractTikTokVideoId,
  getRemixUsedRecord,
  markRemixUsed,
} from '../../lib/remix2-account-used.js';
import { listRemixSourcePools } from '../../lib/remix2-source-pool.js';
import { addUrlsToList, DEFAULT_LIST_ID } from '../../lib/tiktok-url-lists.js';

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
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // Worker callback: auto-tag video after upload — authenticated via shared secret, not session cookie.
  if (method === 'POST') {
    let body;
    try { body = await request.clone().json(); } catch { body = null; }
    if (body && body.action === 'complete-tag') {
      const secret = String(env.REMIX2_WORKER_SECRET || '').trim();
      const provided = String(body.secret || '').trim();
      if (!secret || !provided || provided !== secret) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const key = String(body.key || '').trim();
      const account = sanitizeAccountName(body.account);
      if (!key || !account) {
        return json({ ok: false, error: 'missing key or account' }, 400);
      }
      const result = await setVideoAccount(env, key, account);
      return json(result, result.ok ? 200 : 400);
    }
  }

  const auth = await requireRole(context, [ROLES.ADMIN]);
  if (!auth.ok) return auth.response;

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
    if (action === 'health' || action === 'ping') {
      if (!remix2WorkerConfigured(env)) {
        return json(
          {
            ok: false,
            error: 'remix2_unconfigured',
            message: 'REMIX2_WORKER_URL / REMIX2_WORKER_SECRET missing.',
            ...configPayload(env),
          },
          503,
        );
      }
      const result = await workerFetch(env, '/health', { timeoutMs: 8000 });
      const message = result.ok
        ? 'Worker reachable'
        : describeWorkerFailure(result.status, result.data, 'Worker health check failed');
      return json(
        {
          ok: result.ok,
          status: result.status,
          message,
          worker: result.data,
          ...configPayload(env),
        },
        result.ok ? 200 : result.status || 502,
      );
    }
    if (action === 'source-pool') {
      const listId = url.searchParams.get('listId') || DEFAULT_LIST_ID;
      const result = await listRemixSourcePools(env, listId);
      if (!result.ok) {
        return json({ error: result.error || 'pool_failed', accounts: [] }, 503);
      }
      return json({
        ok: true,
        listId: result.listId,
        listName: result.listName,
        listCount: result.listCount,
        accounts: result.accounts,
      }, 200);
    }
    if (action === 'status') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'missing_jobId' }, 400);
      const result = await workerFetch(env, `/jobs/${encodeURIComponent(jobId)}`, {
        timeoutMs: 8000,
      });
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

      // Do not GET /jobs here. Status used to auto-resume (and --force Grok)
      // which burned quota whenever Recent remixes was open. Classification
      // comes from R2 metadata / ready.json sidecar.

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
          // Require an explicit non-music classification — unknowns used to leak into Talking Heads.
          const isMusic =
            musicLock === true || remixVariant === 'music-only' || remixVariant === 'music';
          const isTalking =
            musicLock === false || remixVariant === 'talking-heads' || remixVariant === 'talking';
          if (isMusic || !isTalking) {
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
    const remixVariantRaw = String(body.remixVariant || '').trim().toLowerCase().replace(/_/g, '-');
    const writeFromScratch =
      body.writeFromScratch === true ||
      remixVariantRaw === 'viral-builder' ||
      remixVariantRaw === 'viralbuilder' ||
      remixVariantRaw === 'write-from-scratch' ||
      remixVariantRaw === 'writefromscratch';
    const identityLock =
      body.identityLock === true || versionRaw === 'v2' || versionRaw === '2' || writeFromScratch;
    const version = identityLock ? 'v2' : 'v1';
    const musicLock =
      body.musicLock === true ||
      body.musicOnly === true ||
      String(body.audioMode || '').trim().toLowerCase() === 'source' ||
      String(body.audioMode || '').trim().toLowerCase() === 'mix' ||
      remixVariantRaw === 'music-only' ||
      remixVariantRaw === 'musiconly' ||
      remixVariantRaw === 'music';
    let audioMode = String(body.audioMode || 'grok').trim() || 'grok';
    if (writeFromScratch) {
      const wantGrok = body.grokDialogue !== false;
      const wantMusic = body.musicOnly === true || body.musicLock === true;
      if (wantGrok && wantMusic) audioMode = 'mix';
      else if (wantMusic) audioMode = 'source';
      else audioMode = 'grok';
    } else if (musicLock && audioMode !== 'mix') {
      audioMode = 'source';
    }
    const remixVariant =
      body.remixVariant ||
      (writeFromScratch
        ? 'viral-builder'
        : musicLock
          ? 'music-only'
          : identityLock
            ? 'talking-heads'
            : undefined);
    const restoreOverlays = writeFromScratch
      ? body.restoreOverlays !== false
      : musicLock
        ? body.restoreOverlays !== false
        : body.restoreOverlays === true;
    // Music-Only: subtle rewrite default ON when restoring overlays (unless explicitly false).
    const subtleRewriteOverlays =
      restoreOverlays &&
      (musicLock || writeFromScratch
        ? body.subtleRewriteOverlays !== false
        : body.subtleRewriteOverlays === true);
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
    try {
      await addUrlsToList(env, body.listId || DEFAULT_LIST_ID, [tiktokUrl], {
        addedFrom: remixVariant || 'remix2',
      });
    } catch {
      /* list write must not block remix */
    }
    const remixAccount = sanitizeAccountName(body.account) || null;
    if (remixAccount) {
      await ensureRemixUsedIndex(env, remixAccount);
      const idFromUrl = extractTikTokVideoId(tiktokUrl);
      if (idFromUrl) {
        const seen = await getRemixUsedRecord(env, {
          tiktokId: idFromUrl,
          tiktokUrl,
          account: remixAccount,
        });
        if (seen) {
          return json(alreadyRemixedResult(seen, remixAccount), 409);
        }
      }
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
    const postFlat = flattenPostMetaForStorage(dl.meta || {}, tiktokUrl);

    // Music-Only: cheap ASR + grok-4.3 MUSIC|SPEECH before creating a job.
    // SPEECH → replaceable Autogenerate failure (same pattern as file_too_large).
    if (musicLock && !writeFromScratch && audioMode !== 'mix') {
      const gate = await workerFetch(env, '/classify-source-audio', {
        method: 'POST',
        body: { sourceKey, r2 },
        timeoutMs: 90000,
      });
      const label = String(gate?.data?.label || '').toUpperCase();
      if (gate.ok && label === 'SPEECH') {
        return json(
          {
            error: 'source_is_speech',
            message:
              'Source has spoken dialogue — skipped for Music-Only. Autogenerate will try another leftover.',
            label: 'SPEECH',
            model: gate.data?.model || 'grok-4.3',
            sourceKey,
          },
          422,
        );
      }
      // label MUSIC / unknown / gate error → fail-open and create
    }

    if (remixAccount) {
      const resolvedId =
        String(postFlat.tiktokId || '').replace(/[^\d]/g, '') ||
        extractTikTokVideoId(postFlat.tiktokUrl || tiktokUrl);
      if (resolvedId) {
        const seen = await getRemixUsedRecord(env, {
          tiktokId: resolvedId,
          tiktokUrl: postFlat.tiktokUrl || tiktokUrl,
          account: remixAccount,
        });
        if (seen) {
          return json(alreadyRemixedResult(seen, remixAccount), 409);
        }
      }
    }

    const result = await workerFetch(env, '/jobs', {
      method: 'POST',
      body: {
        characterKey: autoSimilar ? null : characterKey,
        characterMode: autoSimilar ? 'auto-similar' : 'upload',
        deriveCharacterFromSource: autoSimilar,
        version,
        identityLock,
        musicLock: writeFromScratch ? audioMode !== 'grok' : musicLock,
        audioMode,
        remixVariant,
        restoreOverlays,
        subtleRewriteOverlays,
        writeFromScratch,
        grokDialogue: writeFromScratch ? body.grokDialogue !== false : undefined,
        musicOnly: writeFromScratch ? body.musicOnly === true : undefined,
        productKey: body.productKey || null,
        setKey: body.setKey || null,
        title:
          body.title ||
          postFlat.title ||
          (writeFromScratch
            ? 'Viral Video Builder — Write From Scratch'
            : musicLock
              ? 'TikTok remake (music-only)'
              : identityLock
                ? 'TikTok remake (talking heads)'
                : 'TikTok remake'),
        sourceKey,
        tiktokUrl: postFlat.tiktokUrl || tiktokUrl,
        tiktokId: postFlat.tiktokId || '',
        author: postFlat.author || '',
        musicId: postFlat.musicId || '',
        musicTitle: postFlat.musicTitle || '',
        musicAuthor: postFlat.musicAuthor || '',
        musicOriginal: postFlat.musicOriginal || '',
        dialogueCues: Array.isArray(body.dialogueCues) ? body.dialogueCues : [],
        scenes: [],
        // Viral builder never auto-runs generate; worker kicks analyze-only prepare.
        autoRun: writeFromScratch ? false : body.autoRun !== false,
        account: remixAccount || null,
        callbackUrl: new URL(request.url).origin + '/api/contentstation/character-remix-2-og',
        r2,
      },
    });
    if (!result.ok) {
      const d = result.data || {};
      const detail = describeWorkerFailure(
        result.status,
        d,
        'Worker rejected job create',
      );
      return json(
        {
          error: d.error || 'worker_error',
          message: String(detail).slice(0, 500),
          sourceKey,
          workerStatus: result.status || null,
          raw: d,
        },
        result.status || 502,
      );
    }
    const created = result.data || {};
    if (remixAccount && created.jobId) {
      await markRemixUsed(env, {
        tiktokId: postFlat.tiktokId,
        tiktokUrl: postFlat.tiktokUrl || tiktokUrl,
        account: remixAccount,
        jobId: created.jobId,
        variant: remixVariant || '',
      });
    }
    return json(
      {
        ...created,
        sourceKey,
        tiktokMeta: dl?.meta || null,
        account: remixAccount || null,
      },
      200,
    );
  }

  if (action === 'continue') {
    if (!remix2WorkerConfigured(env)) {
      return json({ error: 'remix2_unconfigured', ...configPayload(env) }, 503);
    }
    const jobId = body.jobId;
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    const result = await workerFetch(env, `/jobs/${encodeURIComponent(jobId)}/continue`, {
      method: 'POST',
      body: {
        scenes: Array.isArray(body.scenes) ? body.scenes : [],
        grokDialogue: body.grokDialogue !== false,
        musicOnly: body.musicOnly === true,
        restoreOverlays: body.restoreOverlays,
        title: body.title || undefined,
        autoRun: body.autoRun !== false,
      },
    });
    return json(result.data || { error: 'worker_error' }, result.ok ? 200 : result.status || 502);
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
    const subtleRewriteOverlays =
      restoreOverlays &&
      (musicLock
        ? body.subtleRewriteOverlays !== false
        : body.subtleRewriteOverlays === true);
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

    // Prefer explicit body music/url; else copy from tiktok/ source object meta (same as cleaned).
    let postFlat = flattenPostMetaForStorage(
      {
        id: body.tiktokId,
        author: body.author,
        title: body.title,
        tiktokUrl: body.tiktokUrl,
        musicId: body.musicId,
        musicTitle: body.musicTitle,
        musicAuthor: body.musicAuthor,
        musicOriginal:
          body.musicOriginal === true || body.musicOriginal === '1'
            ? true
            : body.musicOriginal === false || body.musicOriginal === '0'
              ? false
              : undefined,
      },
      body.tiktokUrl,
    );
    if (body.sourceKey && (!postFlat.musicId || !postFlat.tiktokUrl)) {
      try {
        const srcHead = await env.MEDIA_BUCKET?.head(body.sourceKey);
        const sm = srcHead?.customMetadata || {};
        const fromSrc = flattenPostMetaForStorage(
          {
            id: sm.tiktokId || sm.tiktokid || sm.id,
            author: sm.author,
            title: sm.title || sm.desc,
            tiktokUrl: sm.tiktokUrl || sm.tiktokurl,
            musicId: sm.musicId || sm.musicid,
            musicTitle: sm.musicTitle || sm.musictitle,
            musicAuthor: sm.musicAuthor || sm.musicauthor,
            musicOriginal:
              sm.musicOriginal === '1' || sm.musicoriginal === '1'
                ? true
                : sm.musicOriginal === '0' || sm.musicoriginal === '0'
                  ? false
                  : undefined,
          },
          sm.tiktokUrl || sm.tiktokurl || body.tiktokUrl,
        );
        postFlat = {
          tiktokUrl: postFlat.tiktokUrl || fromSrc.tiktokUrl,
          tiktokId: postFlat.tiktokId || fromSrc.tiktokId,
          author: postFlat.author || fromSrc.author,
          title: postFlat.title || fromSrc.title,
          musicId: postFlat.musicId || fromSrc.musicId,
          musicTitle: postFlat.musicTitle || fromSrc.musicTitle,
          musicAuthor: postFlat.musicAuthor || fromSrc.musicAuthor,
          musicOriginal: postFlat.musicOriginal || fromSrc.musicOriginal,
        };
      } catch {
        /* ignore */
      }
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
        subtleRewriteOverlays,
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
        tiktokUrl: postFlat.tiktokUrl || body.tiktokUrl || '',
        tiktokId: postFlat.tiktokId || '',
        author: postFlat.author || '',
        musicId: postFlat.musicId || '',
        musicTitle: postFlat.musicTitle || '',
        musicAuthor: postFlat.musicAuthor || '',
        musicOriginal: postFlat.musicOriginal || '',
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
