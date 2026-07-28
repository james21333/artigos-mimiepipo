/**
 * Persistent “already downloaded” index for TikTok library downloads.
 * Marker objects live at tiktok/_seen/{tiktokId}.json so we can block duplicates
 * without scanning the whole library on every request.
 */

export const SEEN_PREFIX = 'tiktok/_seen/';
const READY_KEY = `${SEEN_PREFIX}_index_ready`;

/** Extract numeric TikTok video id from a full or short-ish URL when present. */
export function extractTikTokVideoId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const path = u.pathname || '';
    const m =
      path.match(/\/video\/(\d{5,})/i) ||
      path.match(/\/v\/(\d{5,})/i) ||
      path.match(/\/photo\/(\d{5,})/i);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  const loose = s.match(/(?:video|photo)\/(\d{5,})/i) || s.match(/\b(\d{15,})\b/);
  return loose ? loose[1] : '';
}

export function seenMarkerKey(tiktokId) {
  const id = String(tiktokId || '').replace(/[^\d]/g, '').slice(0, 40);
  if (!id) return null;
  return `${SEEN_PREFIX}${id}.json`;
}

export async function getSeenRecord(bucket, tiktokId) {
  const key = seenMarkerKey(tiktokId);
  if (!bucket || !key) return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    const text = await obj.text();
    try {
      const data = JSON.parse(text);
      return data && typeof data === 'object' ? data : { tiktokId: String(tiktokId) };
    } catch {
      return { tiktokId: String(tiktokId), key: null };
    }
  } catch {
    return null;
  }
}

export async function isTikTokSeen(bucket, tiktokId) {
  const rec = await getSeenRecord(bucket, tiktokId);
  return Boolean(rec);
}

/**
 * Record a successful library download. Idempotent — keeps first key/url, updates lastAt.
 */
export async function markTikTokSeen(
  bucket,
  { tiktokId, tiktokUrl, key, author, title, source } = {},
) {
  const id = String(tiktokId || extractTikTokVideoId(tiktokUrl) || '').replace(/[^\d]/g, '');
  if (!bucket || !id) return { ok: false, error: 'missing_tiktok_id' };
  const markerKey = seenMarkerKey(id);
  const prev = await getSeenRecord(bucket, id);
  const now = new Date().toISOString();
  const record = {
    tiktokId: id,
    tiktokUrl: String(tiktokUrl || prev?.tiktokUrl || '').slice(0, 400),
    key: String(key || prev?.key || '').slice(0, 300),
    author: String(author || prev?.author || '').slice(0, 80),
    title: String(title || prev?.title || '').slice(0, 200),
    source: String(source || prev?.source || 'tiktok-download').slice(0, 40),
    firstAt: prev?.firstAt || now,
    lastAt: now,
    downloadCount: Number(prev?.downloadCount || 0) + 1,
  };
  try {
    await bucket.put(markerKey, JSON.stringify(record), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        tiktokId: id,
        tiktokUrl: record.tiktokUrl.slice(0, 200),
        mediaKey: record.key.slice(0, 200),
      },
    });
    return { ok: true, record };
  } catch (err) {
    return { ok: false, error: 'mark_failed', detail: String(err?.message || err) };
  }
}

function idFromTikTokObject(obj) {
  if (!obj || !obj.key || obj.key.endsWith('/')) return '';
  if (String(obj.key).startsWith(SEEN_PREFIX)) return '';
  const cm = obj.customMetadata || {};
  const fromMeta = String(cm.tiktokId || cm.tiktokid || cm.id || '').replace(/[^\d]/g, '');
  if (fromMeta) return fromMeta;
  const fromUrl = extractTikTokVideoId(cm.tiktokUrl || cm.tiktokurl || '');
  if (fromUrl) return fromUrl;
  const base = String(obj.key).split('/').pop().replace(/\.mp4$/i, '');
  const m = base.match(/_(\d{10,})_\d+$/);
  return m ? m[1] : '';
}

/**
 * One-time (or rare) backfill of seen markers from existing tiktok/ MP4s.
 */
export async function backfillTikTokSeenIndex(bucket, { maxObjects = 3000 } = {}) {
  if (!bucket) return { ok: false, error: 'no_bucket', marked: 0 };

  /** @type {Set<string>} */
  const already = new Set();
  let seenCursor;
  do {
    const seenListed = await bucket.list({
      prefix: SEEN_PREFIX,
      limit: 1000,
      cursor: seenCursor,
    });
    for (const obj of seenListed.objects || []) {
      if (!obj?.key || !obj.key.endsWith('.json') || obj.key === READY_KEY) continue;
      const id = obj.key.slice(SEEN_PREFIX.length).replace(/\.json$/i, '');
      if (id) already.add(id);
    }
    seenCursor = seenListed.truncated ? seenListed.cursor : undefined;
  } while (seenCursor);

  let cursor;
  let scanned = 0;
  let marked = 0;
  do {
    const listed = await bucket.list({
      prefix: 'tiktok/',
      limit: 1000,
      cursor,
      include: ['customMetadata'],
    });
    for (const obj of listed.objects || []) {
      scanned += 1;
      if (scanned > maxObjects) break;
      const id = idFromTikTokObject(obj);
      if (!id || already.has(id)) continue;
      const cm = obj.customMetadata || {};
      const now = obj.uploaded
        ? new Date(obj.uploaded).toISOString()
        : new Date().toISOString();
      const rec = {
        tiktokId: id,
        tiktokUrl: String(cm.tiktokUrl || cm.tiktokurl || '').slice(0, 400),
        key: obj.key,
        author: String(cm.author || '').slice(0, 80),
        title: String(cm.title || '').slice(0, 200),
        source: 'backfill',
        firstAt: now,
        lastAt: now,
        downloadCount: 1,
      };
      await bucket.put(seenMarkerKey(id), JSON.stringify(rec), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          tiktokId: id,
          tiktokUrl: rec.tiktokUrl.slice(0, 200),
          mediaKey: String(rec.key || '').slice(0, 200),
        },
      });
      already.add(id);
      marked += 1;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
    if (scanned > maxObjects) break;
  } while (cursor);

  try {
    await bucket.put(READY_KEY, JSON.stringify({ readyAt: new Date().toISOString(), marked, scanned }), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    /* ignore */
  }
  return { ok: true, marked, scanned };
}

/** Ensure backfill has run once so historical downloads block duplicates. */
export async function ensureTikTokSeenIndex(bucket) {
  if (!bucket) return { ok: false, ready: false };
  try {
    const ready = await bucket.head(READY_KEY);
    if (ready) return { ok: true, ready: true, backfilled: false };
  } catch {
    /* continue */
  }
  const result = await backfillTikTokSeenIndex(bucket);
  return { ok: result.ok, ready: true, backfilled: true, marked: result.marked, scanned: result.scanned };
}

export async function listSeenTikToks(bucket, { limit = 200, cursor } = {}) {
  if (!bucket) return { objects: [], cursor: null, truncated: false };
  const listed = await bucket.list({
    prefix: SEEN_PREFIX,
    limit: Math.min(1000, Math.max(1, limit)),
    cursor: cursor || undefined,
  });
  const objects = [];
  for (const obj of listed.objects || []) {
    if (!obj?.key || obj.key === READY_KEY || obj.key.endsWith('/')) continue;
    if (!obj.key.endsWith('.json')) continue;
    const rec = await getSeenRecord(
      bucket,
      obj.key.slice(SEEN_PREFIX.length).replace(/\.json$/i, ''),
    );
    if (rec?.tiktokId) objects.push(rec);
  }
  return {
    objects,
    cursor: listed.truncated ? listed.cursor : null,
    truncated: Boolean(listed.truncated),
  };
}

/** Cheap count of seen markers (no JSON reads). Caps pages for config UI. */
export async function countSeenTikToks(bucket, { maxPages = 5 } = {}) {
  if (!bucket) return { count: 0, truncated: false };
  let count = 0;
  let cursor;
  let pages = 0;
  let truncated = false;
  do {
    const listed = await bucket.list({
      prefix: SEEN_PREFIX,
      limit: 1000,
      cursor: cursor || undefined,
    });
    pages += 1;
    for (const obj of listed.objects || []) {
      if (!obj?.key || obj.key === READY_KEY || obj.key.endsWith('/')) continue;
      if (obj.key.endsWith('.json')) count += 1;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
    if (cursor && pages >= maxPages) {
      truncated = true;
      break;
    }
  } while (cursor);
  return { count, truncated };
}

export function alreadyDownloadedResult(record) {
  const key = record?.key || null;
  return {
    ok: false,
    error: 'already_downloaded',
    tiktokId: record?.tiktokId || null,
    key,
    downloadPath: key
      ? `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`
      : null,
    tiktokUrl: record?.tiktokUrl || null,
    detail: record?.tiktokId ? `id ${record.tiktokId}` : null,
  };
}
