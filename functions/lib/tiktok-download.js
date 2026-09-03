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
import {
  alreadyDownloadedResult,
  ensureTikTokSeenIndex,
  extractTikTokVideoId,
  getSeenRecord,
} from './tiktok-download-seen.js';
import { extractMusicFromProvider, flattenPostMetaForStorage } from './tiktok-post-info.js';

const TIKLIVE_DOWNLOAD = 'https://api.tikliveapi.com/download-video/';
const TIKLIVE_POST_DETAIL = 'https://api.tikliveapi.com/post-detail/';
const LEGACY_RESOLVE_BASE = 'https://www.tikwm.com/api/';
/** Pointer to newest R2 tiktok/*.mp4 for a video id (reuse when API flakes). */
const CACHE_PREFIX = 'tiktok/_cache/';
/** HD over this → fall back to no HD. */
const MAX_HD_BYTES = 20 * 1024 * 1024;
/** No HD (standard) hard cap — reject if still too big. */
const MAX_SD_BYTES = 40 * 1024 * 1024;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function cacheMarkerKey(tiktokId) {
  const id = String(tiktokId || '')
    .replace(/[^\d]/g, '')
    .slice(0, 40);
  if (!id) return null;
  return `${CACHE_PREFIX}${id}.json`;
}

/**
 * Expand /t/…, vm., vt. short links to a canonical /@user/video/{id} URL when possible.
 * extractTikTokVideoId cannot read short paths, so this is required for cache + duplicate checks.
 */
export async function expandTikTokUrl(raw) {
  const url = String(raw || '').trim();
  if (!url || !looksLikeTikTokUrl(url)) return url;
  try {
    const u = new URL(url);
    if (/\/(?:video|photo)\/\d{5,}/i.test(u.pathname)) {
      u.search = '';
      u.hash = '';
      return u.toString();
    }
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': BROWSER_UA,
      },
    });
    const finalUrl = String(res?.url || '').trim();
    if (!finalUrl || !looksLikeTikTokUrl(finalUrl)) return url;
    const f = new URL(finalUrl);
    if (!/\/(?:video|photo)\/\d{5,}/i.test(f.pathname)) return url;
    f.search = '';
    f.hash = '';
    return f.toString();
  } catch {
    return url;
  }
}

async function writeCachePointer(bucket, tiktokId, mediaKey, meta = {}) {
  const marker = cacheMarkerKey(tiktokId);
  if (!bucket || !marker || !mediaKey) return;
  try {
    await bucket.put(
      marker,
      JSON.stringify({
        tiktokId: String(tiktokId || '').replace(/[^\d]/g, ''),
        key: String(mediaKey).slice(0, 300),
        tiktokUrl: String(meta.tiktokUrl || '').slice(0, 400),
        author: String(meta.author || '').slice(0, 80),
        title: String(meta.title || '').slice(0, 200),
        updatedAt: new Date().toISOString(),
      }),
      { httpMetadata: { contentType: 'application/json' } },
    );
  } catch {
    /* ignore cache write failures */
  }
}

async function findTikTokMp4ById(bucket, tiktokId) {
  const id = String(tiktokId || '').replace(/[^\d]/g, '');
  if (!bucket || !id) return null;
  const needle = `_${id}_`;
  let cursor;
  let best = null;
  do {
    const listed = await bucket.list({ prefix: 'tiktok/', limit: 500, cursor });
    for (const obj of listed.objects || []) {
      const k = String(obj.key || '');
      if (!k.endsWith('.mp4') || k.startsWith('tiktok/_') || !k.includes(needle)) continue;
      if (!best || (obj.uploaded && (!best.uploaded || obj.uploaded > best.uploaded))) {
        best = obj;
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return best;
}

/**
 * Reuse a prior tiktok/{author}_{id}_{ts}.mp4 when TikLive/tikwm cannot resolve again.
 * Not the same as tiktok/_used (clean blocklist) — Johnny/remix may re-use freely.
 */
async function resolveCachedDownload(bucket, tiktokId, tiktokUrl) {
  const id = String(tiktokId || '').replace(/[^\d]/g, '');
  if (!bucket || !id) return null;

  let mediaKey = null;
  let head = null;
  const marker = cacheMarkerKey(id);
  if (marker) {
    try {
      const obj = await bucket.get(marker);
      if (obj) {
        const data = JSON.parse(await obj.text());
        const key = String(data?.key || '').trim();
        if (key) {
          head = await bucket.head(key);
          if (head) mediaKey = key;
        }
      }
    } catch {
      /* fall through to list scan */
    }
  }

  if (!mediaKey) {
    const found = await findTikTokMp4ById(bucket, id);
    if (found?.key) {
      try {
        head = await bucket.head(found.key);
        if (head) mediaKey = found.key;
      } catch {
        mediaKey = null;
      }
    }
  }
  if (!mediaKey || !head) return null;

  const cm = head.customMetadata || {};
  const meta = {
    id,
    title: cm.title || '',
    author: cm.author || '',
    tiktokUrl: cm.tiktokUrl || cm.tiktokurl || String(tiktokUrl || '').trim(),
    musicId: cm.musicId || cm.musicid || '',
    musicTitle: cm.musicTitle || cm.musictitle || '',
    musicAuthor: cm.musicAuthor || cm.musicauthor || '',
    musicOriginal: cm.musicOriginal || cm.musicoriginal || '',
    quality: cm.quality || 'standard',
    size: head.size ?? null,
  };
  await writeCachePointer(bucket, id, mediaKey, meta);
  return {
    ok: true,
    key: mediaKey,
    size: head.size ?? null,
    contentType: head.httpMetadata?.contentType || 'video/mp4',
    downloadPath: `/api/contentstation/media?action=get&key=${encodeURIComponent(mediaKey)}`,
    quality: meta.quality,
    meta,
    provider: 'r2_cache',
    reused: true,
    tikliveBalanceExhausted: false,
    warning: null,
  };
}

function sizeTooBigResult(bytes) {
  const mb = Math.round(Number(bytes) / (1024 * 1024));
  return {
    ok: false,
    error: 'file_too_large',
    detail: Number.isFinite(mb) ? `~${mb}MB` : null,
  };
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

  const apiMessage = body?.message || body?.msg || body?.error || null;
  if (!res.ok) {
    return {
      ok: false,
      error: 'resolve_rejected',
      detail: apiMessage || `HTTP ${res.status}`,
    };
  }

  // TikLive often returns HTTP 200 with only { message: "…balance…" } when out of credits.
  const d = body?.data && typeof body.data === 'object' ? body.data : body;
  const playUrl = pickPlayUrl(d, { preferHd });
  if (!playUrl) {
    const detail =
      typeof apiMessage === 'string' && apiMessage.trim()
        ? apiMessage.trim()
        : d && typeof d === 'object' && ('video' in d || 'video_hd' in d)
          ? 'TikLive returned empty video URLs (clip may be unavailable to the API)'
          : 'No downloadable video URL returned';
    const exhausted = /balance|exhausted|purchase|credit|quota|limit/i.test(detail);
    return {
      ok: false,
      error: exhausted ? 'provider_balance' : 'no_play_url',
      detail,
    };
  }

  const usedHd =
    preferHd &&
    typeof playUrl === 'string' &&
    (playUrl === d.video_hd || playUrl === d.hdplay || /hdplay|original|_original/i.test(playUrl));

  const music0 = extractMusicFromProvider(d);
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
    tiktokUrl: tiktokUrl.trim(),
    musicId: music0.musicId,
    musicTitle: music0.musicTitle,
    musicAuthor: music0.musicAuthor,
    musicOriginal: music0.musicOriginal,
  };

  // download-video often returns only URLs — enrich title/author/music from post-detail (best effort).
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
        const music = extractMusicFromProvider(pd);
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
          tiktokUrl: meta.tiktokUrl,
          musicId: music.musicId || meta.musicId,
          musicTitle: music.musicTitle || meta.musicTitle,
          musicAuthor: music.musicAuthor || meta.musicAuthor,
          musicOriginal:
            music.musicOriginal != null ? music.musicOriginal : meta.musicOriginal,
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
  const legacyHeaders = {
    Accept: 'application/json',
    // tikwm rate-limits / blocks non-browser UAs more aggressively.
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  async function once() {
    let res;
    try {
      res = await fetch(endpoint, { headers: legacyHeaders });
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
      const detail = body?.msg || body?.message || `HTTP ${res.status}`;
      const rateLimited = /limit|rate|too many|1 request/i.test(String(detail || ''));
      return {
        ok: false,
        error: rateLimited ? 'resolve_rate_limited' : 'resolve_rejected',
        detail,
      };
    }

    return { ok: true, res, body };
  }

  let first = await once();
  if (!first.ok && first.error === 'resolve_rate_limited') {
    await new Promise((r) => setTimeout(r, 1200));
    first = await once();
  }
  if (!first.ok) return first;

  const body = first.body;

  const d = body.data;
  const playUrl = pickPlayUrl(d, { preferHd }) || d.hdplay || d.play || null;
  if (!playUrl || typeof playUrl !== 'string') {
    return { ok: false, error: 'no_play_url', detail: 'No downloadable video URL returned' };
  }

  const usedHd = preferHd && (playUrl === d.hdplay || playUrl === d.video_hd);
  const music = extractMusicFromProvider(d);
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
      tiktokUrl: tiktokUrl.trim(),
      musicId: music.musicId,
      musicTitle: music.musicTitle,
      musicAuthor: music.musicAuthor,
      musicOriginal: music.musicOriginal,
    },
    provider: 'legacy',
  };
}

export async function resolveTikTokPlayUrl(env, tiktokUrl, opts = {}) {
  const preferHd = opts.preferHd !== false;
  const hasKey = Boolean((env.TIKLIVE_API_KEY || env.TIKTOK_DOWNLOAD_API_KEY || '').trim());
  if (hasKey) {
    const primary = await resolveViaTikLive(env, tiktokUrl, { preferHd });
    if (primary.ok) return primary;
    // TikLive out of balance / empty payload → fall back to tikwm-compatible resolver.
    const fallback = await resolveViaLegacy(env, tiktokUrl, { preferHd });
    if (fallback.ok) {
      return {
        ...fallback,
        provider: 'legacy_fallback',
        primaryError: primary.error,
        primaryDetail: primary.detail || null,
      };
    }
    return {
      ...primary,
      detail: primary.detail || fallback.detail || null,
      fallbackError: fallback.error,
      fallbackDetail: fallback.detail || null,
    };
  }
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
  const skipIfSeen = Boolean(opts.skipIfSeen);
  const forceRedownload = Boolean(opts.forceRedownload);

  // Short links (/t/…, vm.) must expand before id extract / TikLive — otherwise API + cache miss.
  const expandedUrl = await expandTikTokUrl(tiktokUrl);
  const workingUrl = expandedUrl || String(tiktokUrl || '').trim();
  const idFromUrl = extractTikTokVideoId(workingUrl) || extractTikTokVideoId(tiktokUrl);

  if (skipIfSeen && bucket) {
    await ensureTikTokSeenIndex(bucket);
    if (idFromUrl) {
      const seen = await getSeenRecord(bucket, idFromUrl);
      if (seen) return alreadyDownloadedResult(seen);
    }
  }

  // Remix / Johnny: reuse prior R2 download when present (API often flakes on old clips).
  // Download-page skipIfSeen path above still blocks cleaned/used videos.
  if (!forceRedownload && !skipIfSeen && bucket && idFromUrl) {
    const cached = await resolveCachedDownload(bucket, idFromUrl, workingUrl);
    if (cached?.ok) return cached;
  }

  let resolved = await resolveTikTokPlayUrl(env, workingUrl, { preferHd });
  if (!resolved.ok) {
    if (!forceRedownload && bucket && idFromUrl) {
      const cached = await resolveCachedDownload(bucket, idFromUrl, workingUrl);
      if (cached?.ok) {
        return {
          ...cached,
          warning: `Download API failed (${resolved.error || 'unknown'}); reused prior R2 copy.`,
          primaryError: resolved.error || null,
          primaryDetail: resolved.detail || null,
        };
      }
    }
    return resolved;
  }

  if (skipIfSeen && bucket) {
    const id =
      String(resolved.meta?.id || resolved.meta?.tiktokId || '').replace(/[^\d]/g, '') ||
      idFromUrl ||
      extractTikTokVideoId(workingUrl);
    if (id) {
      const seen = await getSeenRecord(bucket, id);
      if (seen) return alreadyDownloadedResult(seen);
    }
  }

  const metaSize =
    resolved.meta?.size != null && Number.isFinite(Number(resolved.meta.size))
      ? Number(resolved.meta.size)
      : null;

  // HD ≥20MB → prefer no HD before transferring.
  if (preferHd && metaSize != null && metaSize >= MAX_HD_BYTES) {
    if (metaSize >= MAX_SD_BYTES) {
      // Known size already over the no-HD cap — only continue if a smaller stream exists.
      const sd = await resolveTikTokPlayUrl(env, workingUrl, { preferHd: false });
      if (!sd.ok) return sizeTooBigResult(metaSize);
      resolved = sd;
      preferHd = false;
    } else {
      const sd = await resolveTikTokPlayUrl(env, workingUrl, { preferHd: false });
      if (sd.ok) resolved = sd;
      // Under 40MB: allow download even if no separate SD stream (same URL as HD).
      preferHd = false;
    }
  }

  const sdMetaSize =
    resolved.meta?.size != null && Number.isFinite(Number(resolved.meta.size))
      ? Number(resolved.meta.size)
      : null;

  // No HD (or forced standard) ≥40MB → reject; don't download.
  if (!preferHd && sdMetaSize != null && sdMetaSize >= MAX_SD_BYTES) {
    return sizeTooBigResult(sdMetaSize);
  }

  const idPart = sanitizeFilenamePart(resolved.meta.id || idFromUrl || 'video');
  const authorPart = sanitizeFilenamePart(resolved.meta.author || 'tiktok');
  const filename = `${authorPart}_${idPart}.mp4`;

  let transferred = await fetchBytesViaCloudConvert(env, resolved.playUrl, filename);
  if (!transferred.ok) {
    // Transfer failed — still try R2 cache before giving up.
    if (!forceRedownload && bucket && (resolved.meta?.id || idFromUrl)) {
      const cached = await resolveCachedDownload(
        bucket,
        resolved.meta?.id || idFromUrl,
        workingUrl,
      );
      if (cached?.ok) {
        return {
          ...cached,
          warning: `Byte transfer failed (${transferred.error || 'unknown'}); reused prior R2 copy.`,
        };
      }
    }
    return transferred;
  }

  // Meta size missing: HD came back ≥20MB → try a smaller stream once, then allow up to 40MB.
  if (preferHd && transferred.bytes.byteLength >= MAX_HD_BYTES) {
    const sd = await resolveTikTokPlayUrl(env, workingUrl, { preferHd: false });
    if (sd.ok && sd.playUrl && sd.playUrl !== resolved.playUrl) {
      const retry = await fetchBytesViaCloudConvert(env, sd.playUrl, filename);
      if (!retry.ok) return retry;
      transferred = retry;
      resolved = { ...resolved, playUrl: sd.playUrl, meta: { ...resolved.meta, ...sd.meta } };
    }
    preferHd = false;
  }

  // Hard cap is always the no-HD max (40MB). HD path only keeps files under 20MB above.
  if (transferred.bytes.byteLength >= MAX_SD_BYTES) {
    return sizeTooBigResult(transferred.bytes.byteLength);
  }
  if (preferHd && transferred.bytes.byteLength >= MAX_HD_BYTES) {
    preferHd = false;
  }

  const key = `tiktok/${authorPart}_${idPart}_${Date.now()}.mp4`;
  const postFlat = flattenPostMetaForStorage(resolved.meta, workingUrl);

  try {
    await bucket.put(key, transferred.bytes, {
      httpMetadata: {
        contentType: transferred.contentType || 'video/mp4',
      },
      customMetadata: {
        source: 'tiktok-download',
        provider: resolved.provider || '',
        tiktokId: postFlat.tiktokId || idPart,
        title: postFlat.title || '',
        author: postFlat.author || authorPart,
        quality: preferHd ? 'hd' : 'standard',
        tiktokUrl: postFlat.tiktokUrl || String(workingUrl || '').trim().slice(0, 400),
        musicId: postFlat.musicId || '',
        musicTitle: postFlat.musicTitle || '',
        musicAuthor: postFlat.musicAuthor || '',
        musicOriginal: postFlat.musicOriginal || '',
      },
    });
  } catch (err) {
    return { ok: false, error: 'r2_put_failed', detail: String(err?.message || err) };
  }

  // Do not mark as "used" here — only a successful clean/archive blocks re-download.
  await writeCachePointer(bucket, postFlat.tiktokId || idPart, key, {
    ...postFlat,
    author: postFlat.author || authorPart,
  });

  const meta = {
    ...resolved.meta,
    ...postFlat,
    quality: preferHd ? 'hd' : 'standard',
  };
  const usedFallback = resolved.provider === 'legacy_fallback';
  const tikliveBalanceExhausted =
    usedFallback &&
    (resolved.primaryError === 'provider_balance' ||
      /balance|exhausted|purchase|credit|quota/i.test(String(resolved.primaryDetail || '')));
  return {
    ok: true,
    key,
    size: transferred.bytes.byteLength,
    contentType: transferred.contentType || 'video/mp4',
    downloadPath: `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`,
    quality: preferHd ? 'hd' : 'standard',
    meta,
    provider: resolved.provider,
    tikliveBalanceExhausted,
    warning: tikliveBalanceExhausted
      ? 'TikLive balance needs to be topped up. Using backup download for now.'
      : null,
  };
}
