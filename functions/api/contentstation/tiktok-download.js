import { json, requireSession } from '../../lib/contentstation-auth.js';
import { downloadTikTokToR2, looksLikeTikTokUrl } from '../../lib/tiktok-download.js';

/**
 * POST { url: "https://www.tiktok.com/…" }
 * → resolve no-watermark video, save to R2 tiktok/, return download path.
 */
export async function onRequestPost(context) {
  const denied = await requireSession(context.env, context.request);
  if (denied) return denied;

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

  const result = await downloadTikTokToR2(context.env, bucket, url);
  if (!result.ok) {
    const messages = {
      resolve_failed: 'Could not reach the download service. Try again.',
      resolve_invalid_json: 'Download service returned a bad response.',
      resolve_rejected: 'Could not resolve that TikTok link (private, removed, or blocked).',
      no_play_url: 'No video file was available for that link.',
      fetch_media_failed: 'Could not fetch the video file.',
      fetch_media_http: 'Video file fetch failed.',
      file_too_large: result.detail || 'Video is too large for automatic download.',
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
  });
}

export async function onRequestGet(context) {
  const denied = await requireSession(context.env, context.request);
  if (denied) return denied;
  return json({
    status: 'ok',
    ready: Boolean(context.env.MEDIA_BUCKET),
    hint: 'POST { url } to download a public TikTok video (no watermark when available).',
  });
}
