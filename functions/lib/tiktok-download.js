/**
 * Resolve a public TikTok URL to a no-watermark play URL, then optionally save to R2.
 * Default provider: tikwm-compatible JSON API (no vendor names exposed to the UI).
 */

const DEFAULT_RESOLVE_BASE = 'https://www.tikwm.com/api/';
const MAX_BYTES = 90 * 1024 * 1024; // stay under typical Worker body limits

function resolveBase(env) {
  return (env.TIKTOK_DOWNLOAD_API_BASE || DEFAULT_RESOLVE_BASE).replace(/\/?$/, '/');
}

export function looksLikeTikTokUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return (
      host === 'tiktok.com' ||
      host.endsWith('.tiktok.com') ||
      host === 'vm.tiktok.com' ||
      host === 'vt.tiktok.com' ||
      host === 'm.tiktok.com'
    );
  } catch {
    return false;
  }
}

function sanitizeFilenamePart(s) {
  return String(s || '')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

/**
 * @returns {Promise<{ ok: true, playUrl, meta } | { ok: false, error, detail? }>}
 */
export async function resolveTikTokPlayUrl(env, tiktokUrl) {
  const base = resolveBase(env);
  const endpoint = `${base}?url=${encodeURIComponent(tiktokUrl.trim())}&hd=1`;
  let res;
  try {
    res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ContentStation/1.0',
      },
    });
  } catch (err) {
    return { ok: false, error: 'resolve_failed', detail: String(err?.message || err) };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: 'resolve_invalid_json', detail: `HTTP ${res.status}` };
  }

  if (!res.ok || body?.code !== 0 || !body?.data) {
    return {
      ok: false,
      error: 'resolve_rejected',
      detail: body?.msg || body?.message || `HTTP ${res.status}`,
    };
  }

  const d = body.data;
  const playUrl = d.hdplay || d.play || d.download || null;
  if (!playUrl || typeof playUrl !== 'string') {
    return { ok: false, error: 'no_play_url', detail: 'No downloadable video URL returned' };
  }

  return {
    ok: true,
    playUrl,
    meta: {
      id: d.id ? String(d.id) : null,
      title: d.title || '',
      duration: d.duration ?? null,
      cover: d.cover || d.origin_cover || null,
      author: d.author?.unique_id || d.author?.nickname || null,
      size: d.size ?? null,
      createTime: d.create_time ?? null,
    },
  };
}

/**
 * Fetch play URL and store under tiktok/ in MEDIA_BUCKET.
 */
export async function downloadTikTokToR2(env, bucket, tiktokUrl) {
  const resolved = await resolveTikTokPlayUrl(env, tiktokUrl);
  if (!resolved.ok) return resolved;

  let mediaRes;
  try {
    mediaRes = await fetch(resolved.playUrl, {
      headers: { 'User-Agent': 'ContentStation/1.0' },
    });
  } catch (err) {
    return { ok: false, error: 'fetch_media_failed', detail: String(err?.message || err) };
  }

  if (!mediaRes.ok || !mediaRes.body) {
    return {
      ok: false,
      error: 'fetch_media_http',
      detail: `HTTP ${mediaRes.status}`,
    };
  }

  const len = Number(mediaRes.headers.get('content-length') || 0);
  if (len && len > MAX_BYTES) {
    return {
      ok: false,
      error: 'file_too_large',
      detail: `Video is ${Math.round(len / (1024 * 1024))}MB; max ~${Math.round(MAX_BYTES / (1024 * 1024))}MB`,
    };
  }

  const idPart = sanitizeFilenamePart(resolved.meta.id || 'video');
  const authorPart = sanitizeFilenamePart(resolved.meta.author || 'tiktok');
  const key = `tiktok/${authorPart}_${idPart}_${Date.now()}.mp4`;

  try {
    await bucket.put(key, mediaRes.body, {
      httpMetadata: {
        contentType: mediaRes.headers.get('content-type') || 'video/mp4',
      },
      customMetadata: {
        source: 'tiktok-download',
        tiktokId: resolved.meta.id || '',
        title: String(resolved.meta.title || '').slice(0, 200),
        author: resolved.meta.author || '',
      },
    });
  } catch (err) {
    return { ok: false, error: 'r2_put_failed', detail: String(err?.message || err) };
  }

  const head = await bucket.head(key);
  return {
    ok: true,
    key,
    size: head?.size ?? len ?? null,
    contentType: head?.httpMetadata?.contentType || 'video/mp4',
    downloadPath: `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`,
    meta: resolved.meta,
  };
}
