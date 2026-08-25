import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import { downloadTikTokToR2, looksLikeTikTokUrl } from '../../lib/tiktok-download.js';
import {
  countSeenTikToks,
  ensureTikTokSeenIndex,
  listSeenTikToks,
} from '../../lib/tiktok-download-seen.js';
import { addUrlsToList, DEFAULT_LIST_ID } from '../../lib/tiktok-url-lists.js';

async function rememberDownloadOnList(env, body, url, extra = {}) {
  try {
    await addUrlsToList(env, body?.listId || DEFAULT_LIST_ID, [url], {
      addedFrom: 'tiktok-download',
      tiktokId: extra.tiktokId,
    });
  } catch {
    /* list write must not block download */
  }
}

/**
 * POST { url, smallerFile?, allowDuplicate? }
 * → resolve no-watermark video, save to R2 tiktok/, return download path.
 * Duplicates blocked unless admin sends allowDuplicate: true.
 *
 * GET  ?action=config|seen
 */
export async function onRequestPost(context) {
  try {
    const auth = await requireRole(context, [ROLES.DOWNLOAD, ROLES.KENNETH]);
    if (!auth.ok) return auth.response;

    const bucket = context.env.MEDIA_BUCKET;
    if (!bucket) {
      return json({ error: 'storage_not_configured', message: 'Video storage isn’t ready.' }, 503);
    }

    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url || !looksLikeTikTokUrl(url)) {
      return json(
        {
          error: 'invalid_url',
          message: 'Paste a public TikTok video link (tiktok.com or vm.tiktok.com).',
        },
        400,
      );
    }

    // Default HD. smallerFile / noHd → standard no-watermark file.
    const smallerFile = Boolean(body?.smallerFile || body?.noHd);
    const preferHd = !smallerFile;

    // Only master (admin) may override duplicate blocking. Download-only role cannot.
    const allowDuplicate = Boolean(body?.allowDuplicate) && auth.role === ROLES.ADMIN;
    const skipIfSeen = !allowDuplicate;

    if (!(context.env.TIKLIVE_API_KEY || context.env.TIKTOK_DOWNLOAD_API_KEY || '').trim()) {
      return json(
        { error: 'api_key_missing', message: 'Download isn’t configured yet.' },
        503,
      );
    }

    const result = await downloadTikTokToR2(context.env, bucket, url, {
      preferHd,
      skipIfSeen,
      seenSource: 'tiktok-download',
    });
    if (!result.ok) {
      if (result.error === 'already_downloaded') {
        await rememberDownloadOnList(context.env, body, url, { tiktokId: result.tiktokId });
      }
      const messages = {
        api_key_missing: 'Download isn’t configured yet.',
        resolve_failed: 'Could not reach the download service. Try again.',
        resolve_invalid_json: 'Download service returned a bad response.',
        resolve_rejected: 'Could not resolve that TikTok link (private, removed, or blocked).',
        resolve_rate_limited: 'Download service rate-limited the request. Wait a second and try again.',
        no_play_url: 'No video file was available for that link.',
        provider_balance:
          'TikLive balance needs to be topped up. Backup download also failed — add credits at tikliveapi.com, then try again.',
        transfer_unconfigured: 'File transfer isn’t configured.',
        transfer_failed: 'Could not transfer the video file. Try again.',
        transfer_timeout: 'Download timed out — try again or use a shorter clip.',
        fetch_media_failed: 'Could not fetch the video file.',
        fetch_media_http: 'Video file fetch failed.',
        file_too_large: 'Video too long/big. Please go find another video.',
        r2_put_failed: 'Could not save the video. Try again.',
        already_downloaded:
          'This TikTok was already cleaned and used. Master login can enable Duplicate Video Override to download it again.',
      };
      const status =
        result.error === 'file_too_large' ? 413 : result.error === 'already_downloaded' ? 409 : 502;
      return json(
        {
          error: result.error,
          message: messages[result.error] || 'Download failed.',
          detail: result.detail || null,
          tiktokId: result.tiktokId || null,
          key: result.key || null,
          downloadPath: result.downloadPath || null,
          tiktokUrl: result.tiktokUrl || null,
        },
        status,
      );
    }

    await rememberDownloadOnList(context.env, body, result.tiktokUrl || url, {
      tiktokId: result.tiktokId || result.meta?.tiktokId,
    });

    return json({
      status: 'ok',
      key: result.key,
      size: result.size,
      contentType: result.contentType,
      downloadPath: result.downloadPath,
      meta: result.meta,
      quality: result.meta?.quality || (preferHd ? 'hd' : 'standard'),
      provider: result.provider || null,
      tikliveBalanceExhausted: Boolean(result.tikliveBalanceExhausted),
      warning: result.warning || null,
      allowDuplicate,
    });
  } catch (err) {
    return json(
      {
        error: 'download_exception',
        message: 'Download failed.',
        detail: String(err?.message || err),
      },
      500,
    );
  }
}

export async function onRequestGet(context) {
  const auth = await requireRole(context, [ROLES.DOWNLOAD, ROLES.KENNETH]);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const action = (url.searchParams.get('action') || 'config').trim();
  const bucket = context.env.MEDIA_BUCKET;
  const ready = Boolean(
    bucket && (context.env.TIKLIVE_API_KEY || context.env.TIKTOK_DOWNLOAD_API_KEY || '').trim(),
  );

  if (action === 'seen') {
    if (!bucket) return json({ error: 'storage_not_configured' }, 503);
    await ensureTikTokSeenIndex(bucket);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200) || 200));
    const listed = await listSeenTikToks(bucket, {
      limit,
      cursor: url.searchParams.get('cursor') || undefined,
    });
    return json({
      status: 'ok',
      count: listed.objects.length,
      truncated: listed.truncated,
      cursor: listed.cursor,
      objects: listed.objects,
    });
  }

  let seenCount = null;
  if (bucket) {
    try {
      await ensureTikTokSeenIndex(bucket);
      const counted = await countSeenTikToks(bucket);
      seenCount = counted.truncated ? `${counted.count}+` : counted.count;
    } catch {
      seenCount = null;
    }
  }

  return json({
    status: 'ok',
    ready,
    role: auth.role,
    canOverrideDuplicate: auth.role === ROLES.ADMIN,
    seenCount,
    hint: 'POST { url } to download. Re-download blocked only after a video was cleaned/used, unless admin allowDuplicate.',
  });
}
