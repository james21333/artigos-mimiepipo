import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import { downloadTikTokToR2, looksLikeTikTokUrl } from '../../lib/tiktok-download.js';

/**
 * POST { url: "https://www.tiktok.com/…" }
 * → resolve no-watermark video, save to R2 tiktok/, return download path.
 */
export async function onRequestPost(context) {
  try {
    const auth = await requireRole(context, [ROLES.DOWNLOAD]);
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

    if (!(context.env.TIKLIVE_API_KEY || context.env.TIKTOK_DOWNLOAD_API_KEY || '').trim()) {
      return json(
        { error: 'api_key_missing', message: 'Download isn’t configured yet.' },
        503,
      );
    }

    const result = await downloadTikTokToR2(context.env, bucket, url, { preferHd });
    if (!result.ok) {
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
      };
      return json(
        {
          error: result.error,
          message: messages[result.error] || 'Download failed.',
          detail: result.detail || null,
        },
        result.error === 'file_too_large' ? 413 : 502,
      );
    }

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
  const auth = await requireRole(context, [ROLES.DOWNLOAD]);
  if (!auth.ok) return auth.response;
  const ready = Boolean(
    context.env.MEDIA_BUCKET &&
      (context.env.TIKLIVE_API_KEY || context.env.TIKTOK_DOWNLOAD_API_KEY || '').trim(),
  );
  return json({
    status: 'ok',
    ready,
    hint: 'POST { url } to download a public TikTok video (no watermark when available).',
  });
}
