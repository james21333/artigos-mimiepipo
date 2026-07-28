/**
 * Index of TikTok videos that were cleaned / used (not merely downloaded).
 * Marker objects: tiktok/_used/{tiktokId}.json
 * Download page blocks re-use unless admin Duplicate Video Override.
 */

export const USED_PREFIX = 'tiktok/_used/';
/** Legacy download-time markers — ignored for blocking. */
export const SEEN_PREFIX = USED_PREFIX;
const READY_KEY = `${USED_PREFIX}_index_ready_v1`;

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
  return `${USED_PREFIX}${id}.json`;
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
 * Record that a TikTok was cleaned / used. Idempotent.
 */
export async function markTikTokSeen(
  bucket,
  { tiktokId, tiktokUrl, key, cleanedKey, author, title, source, account } = {},
) {
  const id = String(tiktokId || extractTikTokVideoId(tiktokUrl) || '').replace(/[^\d]/g, '');
  if (!bucket || !id) return { ok: false, error: 'missing_tiktok_id' };
  const markerKey = seenMarkerKey(id);
  const prev = await getSeenRecord(bucket, id);
  const now = new Date().toISOString();
  const mediaKey = String(cleanedKey || key || prev?.cleanedKey || prev?.key || '').slice(0, 300);
  const record = {
    tiktokId: id,
    tiktokUrl: String(tiktokUrl || prev?.tiktokUrl || '').slice(0, 400),
    key: mediaKey,
    cleanedKey: String(cleanedKey || prev?.cleanedKey || mediaKey || '').slice(0, 300),
    author: String(author || prev?.author || '').slice(0, 80),
    title: String(title || prev?.title || '').slice(0, 200),
    account: String(account || prev?.account || '').slice(0, 80),
    source: String(source || prev?.source || 'cleaned').slice(0, 40),
    firstAt: prev?.firstAt || now,
    lastAt: now,
    useCount: Number(prev?.useCount || prev?.downloadCount || 0) + 1,
  };
  try {
    await bucket.put(markerKey, JSON.stringify(record), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        tiktokId: id,
        tiktokUrl: record.tiktokUrl.slice(0, 200),
        mediaKey: record.key.slice(0, 200),
        account: record.account.slice(0, 80),
      },
    });
    return { ok: true, record };
  } catch (err) {
    return { ok: false, error: 'mark_failed', detail: String(err?.message || err) };
  }
}

function idFromObject(obj) {
  if (!obj || !obj.key || obj.key.endsWith('/')) return '';
  if (String(obj.key).startsWith(USED_PREFIX)) return '';
  if (String(obj.key).startsWith('tiktok/_seen/')) return '';
  const cm = obj.customMetadata || {};
  const fromMeta = String(cm.tiktokId || cm.tiktokid || cm.id || '').replace(/[^\d]/g, '');
  if (fromMeta) return fromMeta;
  const fromUrl = extractTikTokVideoId(cm.tiktokUrl || cm.tiktokurl || '');
  if (fromUrl) return fromUrl;
  const base = String(obj.key).split('/').pop().replace(/\.mp4$/i, '');
  const m = base.match(/_(\d{10,})_\d+$/);
  return m ? m[1] : '';
}

async function putUsedMarker(bucket, already, {
  id,
  tiktokUrl,
  key,
  author,
  title,
  account,
  source,
  firstAt,
}) {
  if (!id || already.has(id)) return false;
  const now = firstAt || new Date().toISOString();
  const rec = {
    tiktokId: id,
    tiktokUrl: String(tiktokUrl || '').slice(0, 400),
    key: String(key || '').slice(0, 300),
    cleanedKey: String(key || '').slice(0, 300),
    author: String(author || '').slice(0, 80),
    title: String(title || '').slice(0, 200),
    account: String(account || '').slice(0, 80),
    source: String(source || 'backfill').slice(0, 40),
    firstAt: now,
    lastAt: now,
    useCount: 1,
  };
  await bucket.put(seenMarkerKey(id), JSON.stringify(rec), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      tiktokId: id,
      tiktokUrl: rec.tiktokUrl.slice(0, 200),
      mediaKey: String(rec.key || '').slice(0, 200),
      account: rec.account.slice(0, 80),
    },
  });
  already.add(id);
  return true;
}

/**
 * Backfill used markers from cleaned/ library (+ optional download→clean map sources).
 */
export async function backfillTikTokSeenIndex(bucket, { maxObjects = 4000 } = {}) {
  if (!bucket) return { ok: false, error: 'no_bucket', marked: 0 };

  /** @type {Set<string>} */
  const already = new Set();
  let usedCursor;
  do {
    const listed = await bucket.list({
      prefix: USED_PREFIX,
      limit: 1000,
      cursor: usedCursor,
    });
    for (const obj of listed.objects || []) {
      if (!obj?.key || !obj.key.endsWith('.json') || obj.key === READY_KEY) continue;
      const id = obj.key.slice(USED_PREFIX.length).replace(/\.json$/i, '');
      if (id) already.add(id);
    }
    usedCursor = listed.truncated ? listed.cursor : undefined;
  } while (usedCursor);

  let cursor;
  let scanned = 0;
  let marked = 0;

  // Primary: cleaned/ outputs that carry TikTok meta.
  do {
    const listed = await bucket.list({
      prefix: 'cleaned/',
      limit: 1000,
      cursor,
      include: ['customMetadata'],
    });
    for (const obj of listed.objects || []) {
      scanned += 1;
      if (scanned > maxObjects) break;
      const id = idFromObject(obj);
      if (!id) continue;
      const cm = obj.customMetadata || {};
      const ok = await putUsedMarker(bucket, already, {
        id,
        tiktokUrl: cm.tiktokUrl || cm.tiktokurl || '',
        key: obj.key,
        author: cm.author || '',
        title: cm.title || '',
        account: cm.account || '',
        source: 'backfill-cleaned',
        firstAt: obj.uploaded ? new Date(obj.uploaded).toISOString() : undefined,
      });
      if (ok) marked += 1;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
    if (scanned > maxObjects) break;
  } while (cursor);

  // Secondary: download→clean map → resolve source tiktok/ keys for ids missing on cleaned.
  try {
    const mapObj = await bucket.get('meta/download-clean-map.json');
    if (mapObj) {
      const map = JSON.parse(await mapObj.text());
      if (map && typeof map === 'object') {
        for (const [sourceKey, entry] of Object.entries(map)) {
          if (scanned > maxObjects) break;
          scanned += 1;
          if (!sourceKey || !entry?.cleanedKey) continue;
          let id = '';
          let cm = {};
          try {
            const head = await bucket.head(sourceKey);
            cm = head?.customMetadata || {};
            id = idFromObject({ key: sourceKey, customMetadata: cm });
          } catch {
            /* ignore */
          }
          if (!id) {
            try {
              const chead = await bucket.head(entry.cleanedKey);
              const ccm = chead?.customMetadata || {};
              id = idFromObject({ key: entry.cleanedKey, customMetadata: ccm });
              cm = { ...ccm, ...cm };
            } catch {
              /* ignore */
            }
          }
          if (!id) continue;
          const ok = await putUsedMarker(bucket, already, {
            id,
            tiktokUrl: cm.tiktokUrl || cm.tiktokurl || '',
            key: entry.cleanedKey,
            author: cm.author || '',
            title: cm.title || '',
            account: entry.account || cm.account || '',
            source: 'backfill-map',
            firstAt: entry.cleanedAt || undefined,
          });
          if (ok) marked += 1;
        }
      }
    }
  } catch {
    /* ignore map backfill */
  }

  try {
    await bucket.put(
      READY_KEY,
      JSON.stringify({ readyAt: new Date().toISOString(), marked, scanned, kind: 'cleaned' }),
      { httpMetadata: { contentType: 'application/json' } },
    );
  } catch {
    /* ignore */
  }
  return { ok: true, marked, scanned };
}

/** Ensure cleaned/used backfill has run once. */
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
    prefix: USED_PREFIX,
    limit: Math.min(1000, Math.max(1, limit)),
    cursor: cursor || undefined,
  });
  const objects = [];
  for (const obj of listed.objects || []) {
    if (!obj?.key || obj.key === READY_KEY || obj.key.endsWith('/')) continue;
    if (!obj.key.endsWith('.json')) continue;
    const rec = await getSeenRecord(
      bucket,
      obj.key.slice(USED_PREFIX.length).replace(/\.json$/i, ''),
    );
    if (rec?.tiktokId) objects.push(rec);
  }
  return {
    objects,
    cursor: listed.truncated ? listed.cursor : null,
    truncated: Boolean(listed.truncated),
  };
}

/** Cheap count of used markers (no JSON reads). Caps pages for config UI. */
export async function countSeenTikToks(bucket, { maxPages = 5 } = {}) {
  if (!bucket) return { count: 0, truncated: false };
  let count = 0;
  let cursor;
  let pages = 0;
  let truncated = false;
  do {
    const listed = await bucket.list({
      prefix: USED_PREFIX,
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
  const key = record?.cleanedKey || record?.key || null;
  return {
    ok: false,
    error: 'already_downloaded',
    tiktokId: record?.tiktokId || null,
    key,
    downloadPath: key
      ? `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`
      : null,
    tiktokUrl: record?.tiktokUrl || null,
    account: record?.account || null,
    detail: record?.tiktokId ? `id ${record.tiktokId}` : null,
  };
}
