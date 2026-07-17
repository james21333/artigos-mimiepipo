/**
 * Resolve a public TikTok URL to a no-watermark play URL, then save to R2.
 * TikLiveAPI resolves the play URL; CloudConvert pulls the bytes (TikTok CDN
 * often crashes Pages Functions on direct fetch).
 */

import {
  cloudconvertConfigured,
  createImportExportJob,
  extractExportUrl,
  extractJobError,
  waitForJob,
} from './cloudconvert.js';

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

/**
 * @param {object} obj
 * @param {{ preferHd?: boolean }} [opts] preferHd default true
 */
function pickPlayUrl(obj, opts = {}) {
  if (!obj || typeof obj !== 'object') return null;
  const preferHd = opts.preferHd !== false;
  const hdFirst = [obj.video_hd, obj.hdplay, obj.video, obj.play, obj.noWatermarkUrl, obj.downloadUrl, obj.download];
  const sdFirst = [obj.video, obj.play, obj.noWatermarkUrl, obj.downloadUrl, obj.download, obj.video_hd, obj.hdplay];
  const candidates = preferHd ? hdFirst : sdFirst;
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}

async function resolveViaTikLive(env, tiktokUrl, { preferHd = true } = {}) {
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

  if (!res) {
    return { ok: false, error: 'resolve_failed', detail: 'Empty response from download service' };
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

  const d = body?.data && typeof body.data === 'object' ? body.data : body;
  const playUrl = pickPlayUrl(d, { preferHd });
  if (!playUrl) {
    return { ok: false, error: 'no_play_url', detail: 'No downloadable video URL returned' };
  }

  const usedHd =
    preferHd &&
    typeof playUrl === 'string' &&
    (playUrl === d.video_hd || playUrl === d.hdplay || /hdplay|original|_original/i.test(playUrl));

  let meta = {
    id: d.id ? String(d.id) : null,
    title: d.title || d.desc || '',
    duration: d.duration ?? null,
    cover: d.cover || d.origin_cover || null,
    author:
      d.author?.unique_id ||
      d.author?.nickname ||
      (typeof d.author === 'string' ? d.author : null) ||
      null,
    size: (usedHd ? d.hd_size : null) ?? d.size ?? null,
    createTime: d.create_time ?? null,
    quality: usedHd ? 'hd' : 'standard',
  };

  // download-video often returns only URLs — enrich title/author from post-detail (best effort).
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
    if (detailRes?.ok) {
      const detailBody = await detailRes.json();
      const pd =
        detailBody?.data && typeof detailBody.data === 'object' ? detailBody.data : detailBody;
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
          size: (preferHd ? pd.hd_size : null) ?? pd.size ?? meta.size,
          createTime: pd.create_time ?? meta.createTime,
          quality: meta.quality,
        };
        if (preferHd && (pd.hdplay || pd.play)) {
          const better = pickPlayUrl(
            { video_hd: pd.hdplay, hdplay: pd.hdplay, video: pd.play, play: pd.play },
            { preferHd },
          );
          if (better) {
            return {
              ok: true,
              playUrl: better,
              meta: {
                ...meta,
                size: pd.hd_size ?? pd.size ?? meta.size,
                quality: better === pd.hdplay ? 'hd' : meta.quality,
              },
              provider: 'tiklive',
            };
          }
        }
      }
    }
  } catch {
    // ignore enrichment failures
  }

  return {
    ok: true,
    playUrl,
    meta,
    provider: 'tiklive',
  };
}

async function resolveViaLegacy(env, tiktokUrl, { preferHd = true } = {}) {
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
  const playUrl = pickPlayUrl(d, { preferHd }) || d.hdplay || d.play || null;
  if (!playUrl || typeof playUrl !== 'string') {
    return { ok: false, error: 'no_play_url', detail: 'No downloadable video URL returned' };
  }

  const usedHd = preferHd && (playUrl === d.hdplay || playUrl === d.video_hd);
  return {
    ok: true,
    playUrl,
    meta: {
      id: d.id ? String(d.id) : null,
      title: d.title || '',
      duration: d.duration ?? null,
      cover: d.cover || d.origin_cover || null,
      author: d.author?.unique_id || d.author?.nickname || null,
      size: (usedHd ? d.hd_size : null) ?? d.size ?? null,
      createTime: d.create_time ?? null,
      quality: usedHd ? 'hd' : 'standard',
    },
    provider: 'legacy',
  };
}

export async function resolveTikTokPlayUrl(env, tiktokUrl, opts = {}) {
  const preferHd = opts.preferHd !== false;
  const hasKey = Boolean((env.TIKLIVE_API_KEY || env.TIKTOK_DOWNLOAD_API_KEY || '').trim());
  if (hasKey) return resolveViaTikLive(env, tiktokUrl, { preferHd });
  return resolveViaLegacy(env, tiktokUrl, { preferHd });
}

async function fetchBytesViaCloudConvert(env, playUrl, filename) {
  if (!cloudconvertConfigured(env)) {
    return { ok: false, error: 'transfer_unconfigured', detail: 'File transfer isn’t configured.' };
  }

  const created = await createImportExportJob(env, playUrl, {
    filename,
    tag: 'tiktok-download',
  });
  if (!created.ok) {
    return {
      ok: false,
      error: 'transfer_failed',
      detail: created.data?.message || created.data?.error || `HTTP ${created.status}`,
    };
  }

  const jobId = created.data?.data?.id || created.data?.id;
  if (!jobId) {
    return { ok: false, error: 'transfer_failed', detail: 'No transfer job id returned' };
  }

  const waited = await waitForJob(env, jobId, { timeoutMs: 90000, intervalMs: 2000 });
  if (!waited.ok) {
    return {
      ok: false,
      error: waited.data?.error === 'job_timeout' ? 'transfer_timeout' : 'transfer_failed',
      detail: waited.data?.message || waited.data?.error || 'Transfer failed',
    };
  }

  const status = String(waited.data?.data?.status || waited.data?.status || '').toLowerCase();
  if (status === 'error') {
    return {
      ok: false,
      error: 'transfer_failed',
      detail: extractJobError(waited.data) || 'Transfer job error',
    };
  }

  const exportUrl = extractExportUrl(waited.data);
  if (!exportUrl) {
    return { ok: false, error: 'transfer_failed', detail: 'No export URL from transfer' };
  }

  let mediaRes;
  try {
    mediaRes = await fetch(exportUrl, {
      headers: { 'User-Agent': 'ContentStation/1.0' },
    });
  } catch (err) {
    return { ok: false, error: 'fetch_media_failed', detail: String(err?.message || err) };
  }

  if (!mediaRes || !mediaRes.ok) {
    return {
      ok: false,
      error: 'fetch_media_http',
      detail: `HTTP ${mediaRes ? mediaRes.status : 'no response'}`,
    };
  }

  const contentType = mediaRes.headers?.get?.('content-type') || 'video/mp4';
  let bytes;
  try {
    bytes = await mediaRes.arrayBuffer();
  } catch (err) {
    return { ok: false, error: 'fetch_media_failed', detail: String(err?.message || err) };
  }

  return { ok: true, bytes, contentType };
}

export async function downloadTikTokToR2(env, bucket, tiktokUrl, opts = {}) {
  let preferHd = opts.preferHd !== false;
  let resolved = await resolveTikTokPlayUrl(env, tiktokUrl, { preferHd });
  if (!resolved.ok) return resolved;

  const metaTooBig =
    resolved.meta?.size != null && Number(resolved.meta.size) > MAX_BYTES;

  // HD often exceeds the Pages/Worker body limit — fall back to standard when possible.
  if (metaTooBig && preferHd) {
    const sd = await resolveTikTokPlayUrl(env, tiktokUrl, { preferHd: false });
    if (sd.ok) {
      const sdSize = sd.meta?.size != null ? Number(sd.meta.size) : null;
      const hdSize = Number(resolved.meta.size);
      if (sdSize == null || sdSize <= MAX_BYTES || sdSize < hdSize) {
        resolved = sd;
        preferHd = false;
      }
    }
  }

  if (resolved.meta?.size != null && Number(resolved.meta.size) > MAX_BYTES) {
    return {
      ok: false,
      error: 'file_too_large',
      detail: `Video is ${Math.round(Number(resolved.meta.size) / (1024 * 1024))}MB; max ~${Math.round(MAX_BYTES / (1024 * 1024))}MB`,
    };
  }

  const idPart = sanitizeFilenamePart(resolved.meta.id || 'video');
  const authorPart = sanitizeFilenamePart(resolved.meta.author || 'tiktok');
  const filename = `${authorPart}_${idPart}.mp4`;

  let transferred = await fetchBytesViaCloudConvert(env, resolved.playUrl, filename);
  if (!transferred.ok) return transferred;

  if (transferred.bytes.byteLength > MAX_BYTES && preferHd) {
    const sd = await resolveTikTokPlayUrl(env, tiktokUrl, { preferHd: false });
    if (sd.ok && sd.playUrl && sd.playUrl !== resolved.playUrl) {
      const retry = await fetchBytesViaCloudConvert(env, sd.playUrl, filename);
      if (retry.ok && retry.bytes.byteLength <= MAX_BYTES) {
        transferred = retry;
        resolved = { ...resolved, playUrl: sd.playUrl, meta: { ...resolved.meta, ...sd.meta } };
        preferHd = false;
      }
    }
  }

  if (transferred.bytes.byteLength > MAX_BYTES) {
    return {
      ok: false,
      error: 'file_too_large',
      detail: `Video is ${Math.round(transferred.bytes.byteLength / (1024 * 1024))}MB; max ~${Math.round(MAX_BYTES / (1024 * 1024))}MB`,
    };
  }

  const key = `tiktok/${authorPart}_${idPart}_${Date.now()}.mp4`;

  try {
    await bucket.put(key, transferred.bytes, {
      httpMetadata: {
        contentType: transferred.contentType || 'video/mp4',
      },
      customMetadata: {
        source: 'tiktok-download',
        provider: resolved.provider || '',
        tiktokId: resolved.meta.id || '',
        title: String(resolved.meta.title || '').slice(0, 200),
        author: resolved.meta.author || '',
        quality: preferHd ? 'hd' : 'standard',
      },
    });
  } catch (err) {
    return { ok: false, error: 'r2_put_failed', detail: String(err?.message || err) };
  }

  const meta = { ...resolved.meta, quality: preferHd ? 'hd' : 'standard' };
  return {
    ok: true,
    key,
    size: transferred.bytes.byteLength,
    contentType: transferred.contentType || 'video/mp4',
    downloadPath: `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`,
    quality: preferHd ? 'hd' : 'standard',
    meta,
    provider: resolved.provider,
  };
}
