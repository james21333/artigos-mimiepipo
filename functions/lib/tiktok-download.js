/**
 * Resolve a public TikTok URL to a no-watermark play URL, then save to R2.
 * Provider: TikLiveAPI when TIKLIVE_API_KEY is set; otherwise legacy free resolver.
 * UI never shows vendor names.
 */

const TIKLIVE_DOWNLOAD = 'https://api.tikliveapi.com/download-video/';
const TIKLIVE_POST_DETAIL = 'https://api.tikliveapi.com/post-detail/';
const LEGACY_RESOLVE_BASE = 'https://www.tikwm.com/api/';
const MAX_BYTES = 90 * 1024 * 1024;

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

function pickPlayUrl(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const candidates = [
    obj.video_hd,
    obj.video,
    obj.hdplay,
    obj.play,
    obj.noWatermarkUrl,
    obj.downloadUrl,
    obj.download,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}

async function resolveViaTikLive(env, tiktokUrl) {
  const key = (env.TIKLIVE_API_KEY || env.TIKTOK_DOWNLOAD_API_KEY || '').trim();
  if (!key) return { ok: false, error: 'api_key_missing' };

  const endpoint = `${TIKLIVE_DOWNLOAD}?url=${encodeURIComponent(tiktokUrl.trim())}`;
  let res;
  try {
    res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': key,
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

  if (!res.ok) {
    return {
      ok: false,
      error: 'resolve_rejected',
      detail: body?.message || body?.msg || body?.error || `HTTP ${res.status}`,
    };
  }

  // Some responses wrap under data; others are flat { video, video_hd }
  const d = body?.data && typeof body.data === 'object' ? body.data : body;
  const playUrl = pickPlayUrl(d);
  if (!playUrl) {
    return { ok: false, error: 'no_play_url', detail: 'No downloadable video URL returned' };
  }

  // Optional richer metadata from post-detail (best effort; ignore failures)
  let meta = {
    id: d.id ? String(d.id) : null,
    title: d.title || d.desc || '',
    duration: d.duration ?? null,
    cover: d.cover || d.origin_cover || null,
    author: d.author?.unique_id || d.author?.nickname || d.author || null,
    size: d.size ?? d.hd_size ?? null,
    createTime: d.create_time ?? null,
  };

  try {
    const detailRes = await fetch(
      `${TIKLIVE_POST_DETAIL}?url=${encodeURIComponent(tiktokUrl.trim())}`,
      {
        headers: {
          Accept: 'application/json',
          'X-Api-Key': key,
          'User-Agent': 'ContentStation/1.0',
        },
      },
    );
    if (detailRes.ok) {
      const detailBody = await detailRes.json();
      const pd = detailBody?.data && typeof detailBody.data === 'object' ? detailBody.data : detailBody;
      if (pd && typeof pd === 'object') {
        meta = {
          id: pd.id ? String(pd.id) : meta.id,
          title: pd.title || pd.desc || meta.title,
          duration: pd.duration ?? meta.duration,
          cover: pd.cover || pd.origin_cover || meta.cover,
          author:
            pd.author?.unique_id ||
            pd.author?.nickname ||
            (typeof pd.author === 'string' ? pd.author : null) ||
            meta.author,
          size: pd.hd_size ?? pd.size ?? meta.size,
          createTime: pd.create_time ?? meta.createTime,
        };
        // Prefer HD from detail if download-video only returned a short link
        const better = pickPlayUrl({
          video_hd: pd.hdplay,
          video: pd.play,
          hdplay: pd.hdplay,
          play: pd.play,
        });
        if (better && /original|_original|hdplay/i.test(better)) {
          return { ok: true, playUrl: better, meta, provider: 'tiklive' };
        }
      }
    }
  } catch {
    // ignore metadata enrichment errors
  }

  return { ok: true, playUrl, meta, provider: 'tiklive' };
}

async function resolveViaLegacy(env, tiktokUrl) {
  const base = (env.TIKTOK_DOWNLOAD_API_BASE || LEGACY_RESOLVE_BASE).replace(/\/?$/, '/');
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
    provider: 'legacy',
  };
}

/**
 * @returns {Promise<{ ok: true, playUrl, meta, provider } | { ok: false, error, detail? }>}
 */
export async function resolveTikTokPlayUrl(env, tiktokUrl) {
  const hasKey = Boolean((env.TIKLIVE_API_KEY || env.TIKTOK_DOWNLOAD_API_KEY || '').trim());
  if (hasKey) return resolveViaTikLive(env, tiktokUrl);
  return resolveViaLegacy(env, tiktokUrl);
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
        provider: resolved.provider || '',
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
    provider: resolved.provider,
  };
}
