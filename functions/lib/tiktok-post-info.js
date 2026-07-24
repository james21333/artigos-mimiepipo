/**
 * Normalize / resolve original TikTok post info for Ready "Info" UI.
 * Sources: cleaned customMetadata, or join via download-clean-map → tiktok/ object.
 */

import { getSourceForCleaned, sanitizeSourceKey } from './clean-source-map.js';

function trimStr(v, max = 300) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.slice(0, max);
}

/** Decode TikLive/email-style =?utf-8?Q?...?= fragments in captions. */
function decodeMimeWords(raw) {
  const s = String(raw || '');
  if (!/=\?[^?]+\?[bq]\?/i.test(s)) return s;
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_m, _charset, enc, data) => {
    try {
      if (String(enc).toLowerCase() === 'b') {
        const bin = atob(data.replace(/\s/g, ''));
        return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      }
      // Q-encoding
      const q = data
        .replace(/_/g, ' ')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return new TextDecoder().decode(Uint8Array.from(q, (c) => c.charCodeAt(0)));
    } catch {
      return data;
    }
  });
}

function cleanTitle(raw, max = 500) {
  return trimStr(decodeMimeWords(raw), max);
}

/** R2 / S3 often lowercases customMetadata keys — read case-insensitively. */
function metaGet(cm, ...names) {
  if (!cm || typeof cm !== 'object') return '';
  const lower = {};
  for (const [k, v] of Object.entries(cm)) {
    lower[String(k).toLowerCase()] = v;
  }
  for (const name of names) {
    const v = cm[name] ?? lower[String(name).toLowerCase()];
    if (v != null && String(v).trim() !== '') return v;
  }
  return '';
}

/** Parse author + video id from tiktok/{author}_{id}_{ts}.mp4 keys. */
export function parseTikTokKeyParts(sourceKey) {
  const base = String(sourceKey || '')
    .split('/')
    .pop()
    .replace(/\.mp4$/i, '');
  const m = base.match(/^(.+)_(\d{10,})_(\d+)$/);
  if (!m) return { author: '', tiktokId: '' };
  return { author: m[1], tiktokId: m[2] };
}

function slugifyMusic(title) {
  const s = String(title || 'original-sound')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'original-sound';
}

/** Extract music fields from TikLive / tikwm-style payloads. */
export function extractMusicFromProvider(obj) {
  if (!obj || typeof obj !== 'object') {
    return {
      musicId: null,
      musicTitle: '',
      musicAuthor: '',
      musicOriginal: null,
    };
  }
  const mi = obj.music_info && typeof obj.music_info === 'object' ? obj.music_info : null;
  const musicId =
    (mi?.id != null && String(mi.id)) ||
    (obj.music_id != null && String(obj.music_id)) ||
    (obj.musicId != null && String(obj.musicId)) ||
    null;
  const musicTitle = trimStr(mi?.title || obj.music_title || obj.musicTitle || '', 160);
  const musicAuthor = trimStr(
    (typeof mi?.author === 'string' ? mi.author : '') ||
      obj.music_author ||
      obj.musicAuthor ||
      '',
    80,
  );
  let musicOriginal = null;
  if (typeof mi?.original === 'boolean') musicOriginal = mi.original;
  else if (typeof obj.music_original === 'boolean') musicOriginal = obj.music_original;
  return { musicId, musicTitle, musicAuthor, musicOriginal };
}

export function buildMusicPageUrl(musicId, musicTitle) {
  const id = trimStr(musicId, 40);
  if (!id) return null;
  return `https://www.tiktok.com/music/${slugifyMusic(musicTitle)}-${id}`;
}

export function buildPostUrl({ tiktokUrl, author, tiktokId } = {}) {
  const stored = trimStr(tiktokUrl, 400);
  if (stored && /^https?:\/\//i.test(stored)) return stored;
  const id = trimStr(tiktokId, 40);
  const handle = trimStr(author, 80).replace(/^@/, '');
  if (handle && id) return `https://www.tiktok.com/@${handle}/video/${id}`;
  if (id) return `https://www.tiktok.com/video/${id}`;
  return null;
}

/**
 * Flatten provider meta + input URL into fields safe for R2 customMetadata (strings).
 */
export function flattenPostMetaForStorage(meta, tiktokUrl) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const music = extractMusicFromProvider(m);
  const musicId = m.musicId || music.musicId;
  const musicTitle = m.musicTitle || music.musicTitle;
  const musicAuthor = m.musicAuthor || music.musicAuthor;
  const musicOriginal =
    typeof m.musicOriginal === 'boolean' ? m.musicOriginal : music.musicOriginal;

  const tiktokId = trimStr(m.id || m.tiktokId, 40);
  const author = trimStr(m.author, 80);
  const title = cleanTitle(m.title || m.desc, 200);
  const url = buildPostUrl({
    tiktokUrl: tiktokUrl || m.tiktokUrl,
    author,
    tiktokId,
  });

  return {
    tiktokUrl: url || trimStr(tiktokUrl || m.tiktokUrl, 400),
    tiktokId,
    author,
    title,
    musicId: musicId ? String(musicId) : '',
    musicTitle: trimStr(musicTitle, 160),
    musicAuthor: trimStr(musicAuthor, 80),
    musicOriginal:
      musicOriginal === true ? '1' : musicOriginal === false ? '0' : '',
  };
}

export function postInfoFromCustomMetadata(cm) {
  if (!cm || typeof cm !== 'object') return emptyPostInfo();
  const tiktokId = trimStr(metaGet(cm, 'tiktokId', 'tiktokid', 'id'), 40);
  const author = trimStr(metaGet(cm, 'author'), 80);
  const title = cleanTitle(metaGet(cm, 'title', 'desc'), 500);
  const tiktokUrl = buildPostUrl({
    tiktokUrl: metaGet(cm, 'tiktokUrl', 'tiktokurl'),
    author,
    tiktokId,
  });
  const musicId = trimStr(metaGet(cm, 'musicId', 'musicid'), 40);
  const musicTitle = trimStr(metaGet(cm, 'musicTitle', 'musictitle'), 160);
  const musicAuthor = trimStr(metaGet(cm, 'musicAuthor', 'musicauthor'), 80);
  const musicUrl = buildMusicPageUrl(musicId, musicTitle);
  const musicOriginalRaw = String(metaGet(cm, 'musicOriginal', 'musicoriginal') || '');
  const musicOriginal =
    musicOriginalRaw === '1' || musicOriginalRaw === 'true'
      ? true
      : musicOriginalRaw === '0' || musicOriginalRaw === 'false'
        ? false
        : null;

  return {
    available: Boolean(tiktokUrl || title || musicTitle || musicId),
    tiktokUrl,
    title: title || null,
    author: author || null,
    tiktokId: tiktokId || null,
    musicTitle: musicTitle || null,
    musicAuthor: musicAuthor || null,
    musicId: musicId || null,
    musicUrl,
    musicOriginal,
    sourceKey: trimStr(metaGet(cm, 'sourceKey', 'sourcekey'), 200) || null,
  };
}

function emptyPostInfo() {
  return {
    available: false,
    tiktokUrl: null,
    title: null,
    author: null,
    tiktokId: null,
    musicTitle: null,
    musicAuthor: null,
    musicId: null,
    musicUrl: null,
    musicOriginal: null,
    sourceKey: null,
  };
}

function mergePostInfo(primary, fallback) {
  const a = primary || emptyPostInfo();
  const b = fallback || emptyPostInfo();
  const merged = {
    available: false,
    tiktokUrl: a.tiktokUrl || b.tiktokUrl,
    title: a.title || b.title,
    author: a.author || b.author,
    tiktokId: a.tiktokId || b.tiktokId,
    musicTitle: a.musicTitle || b.musicTitle,
    musicAuthor: a.musicAuthor || b.musicAuthor,
    musicId: a.musicId || b.musicId,
    musicUrl: a.musicUrl || b.musicUrl,
    musicOriginal: a.musicOriginal ?? b.musicOriginal,
    sourceKey: a.sourceKey || b.sourceKey,
  };
  if (!merged.tiktokUrl) {
    merged.tiktokUrl = buildPostUrl({
      author: merged.author,
      tiktokId: merged.tiktokId,
    });
  }
  if (!merged.musicUrl && merged.musicId) {
    merged.musicUrl = buildMusicPageUrl(merged.musicId, merged.musicTitle);
  }
  merged.available = Boolean(
    merged.tiktokUrl || merged.title || merged.musicTitle || merged.musicId,
  );
  return merged;
}

/**
 * Best-effort TikLive post-detail refresh when stored meta is thin.
 */
async function enrichFromTikLive(env, info) {
  const key = (env.TIKLIVE_API_KEY || env.TIKTOK_DOWNLOAD_API_KEY || '').trim();
  if (!key) return info;
  const url =
    info.tiktokUrl ||
    buildPostUrl({ author: info.author, tiktokId: info.tiktokId });
  if (!url) return info;
  try {
    const res = await fetch(
      `https://api.tikliveapi.com/post-detail/?url=${encodeURIComponent(url)}`,
      {
        headers: {
          Accept: 'application/json',
          'X-Api-Key': key,
          'User-Agent': 'ContentStation/1.0',
        },
      },
    );
    if (!res?.ok) return info;
    const body = await res.json();
    const pd = body?.data && typeof body.data === 'object' ? body.data : body;
    if (!pd || typeof pd !== 'object') return info;
    const music = extractMusicFromProvider(pd);
    const author =
      pd.author?.unique_id ||
      pd.author?.nickname ||
      (typeof pd.author === 'string' ? pd.author : null) ||
      info.author;
    const tiktokId = pd.id ? String(pd.id) : info.tiktokId;
    return mergePostInfo(info, {
      available: true,
      tiktokUrl: buildPostUrl({ tiktokUrl: url, author, tiktokId }),
      title: cleanTitle(pd.title || pd.desc, 500) || info.title,
      author: author || null,
      tiktokId: tiktokId || null,
      musicId: music.musicId,
      musicTitle: music.musicTitle || null,
      musicAuthor: music.musicAuthor || null,
      musicUrl: buildMusicPageUrl(music.musicId, music.musicTitle),
      musicOriginal: music.musicOriginal,
      sourceKey: info.sourceKey,
    });
  } catch {
    return info;
  }
}

/**
 * Resolve original post info for a cleaned/ key (or any key with meta).
 */
export async function resolvePostInfoForKey(env, cleanedKeyRaw) {
  const bucket = env.MEDIA_BUCKET;
  const cleanedKey = String(cleanedKeyRaw || '')
    .trim()
    .replace(/^\/+/, '');
  if (!bucket || !cleanedKey || cleanedKey.includes('..')) {
    return { ok: false, error: 'invalid_key', info: emptyPostInfo() };
  }

  let cleanedMeta = null;
  try {
    const head = await bucket.head(cleanedKey);
    cleanedMeta = head?.customMetadata || null;
  } catch {
    cleanedMeta = null;
  }

  let info = postInfoFromCustomMetadata(cleanedMeta);

  let sourceKey =
    sanitizeSourceKey(metaGet(cleanedMeta || {}, 'sourceKey', 'sourcekey')) ||
    (await getSourceForCleaned(env, cleanedKey));

  if (sourceKey) {
    info = mergePostInfo(info, { ...emptyPostInfo(), sourceKey });
    const parts = parseTikTokKeyParts(sourceKey);
    if (parts.author || parts.tiktokId) {
      info = mergePostInfo(info, {
        ...emptyPostInfo(),
        author: parts.author || null,
        tiktokId: parts.tiktokId || null,
        tiktokUrl: buildPostUrl(parts),
        sourceKey,
      });
    }
    try {
      const srcHead = await bucket.head(sourceKey);
      if (srcHead?.customMetadata) {
        info = mergePostInfo(info, {
          ...postInfoFromCustomMetadata(srcHead.customMetadata),
          sourceKey,
        });
      }
    } catch {
      /* ignore */
    }
  }

  // If still missing caption/sound, refresh from TikLive once.
  if (!info.title || !info.musicTitle) {
    info = await enrichFromTikLive(env, info);
  }

  // Ensure URL is always filled when we have author+id.
  if (!info.tiktokUrl) {
    info.tiktokUrl = buildPostUrl({
      author: info.author,
      tiktokId: info.tiktokId,
    });
  }
  info.available = Boolean(
    info.tiktokUrl || info.title || info.musicTitle || info.musicId,
  );

  return { ok: true, key: cleanedKey, sourceKey: sourceKey || null, info };
}

/**
 * Build string customMetadata fields to stamp onto cleaned/ objects.
 */
export function cleanedCustomMetaFromSource(sourceMeta, sourceKey) {
  const sm = sourceMeta || {};
  const flat = flattenPostMetaForStorage(
    {
      id: metaGet(sm, 'tiktokId', 'tiktokid', 'id'),
      title: metaGet(sm, 'title', 'desc'),
      author: metaGet(sm, 'author'),
      musicId: metaGet(sm, 'musicId', 'musicid'),
      musicTitle: metaGet(sm, 'musicTitle', 'musictitle'),
      musicAuthor: metaGet(sm, 'musicAuthor', 'musicauthor'),
      musicOriginal:
        metaGet(sm, 'musicOriginal', 'musicoriginal') === '1'
          ? true
          : metaGet(sm, 'musicOriginal', 'musicoriginal') === '0'
            ? false
            : null,
      tiktokUrl: metaGet(sm, 'tiktokUrl', 'tiktokurl'),
    },
    metaGet(sm, 'tiktokUrl', 'tiktokurl'),
  );
  const parts = parseTikTokKeyParts(sourceKey);
  if (!flat.tiktokId && parts.tiktokId) flat.tiktokId = parts.tiktokId;
  if (!flat.author && parts.author) flat.author = parts.author;
  if (!flat.tiktokUrl) {
    flat.tiktokUrl = buildPostUrl({
      author: flat.author,
      tiktokId: flat.tiktokId,
    }) || '';
  }
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    if (v != null && String(v) !== '') out[k] = String(v);
  }
  if (sourceKey) out.sourceKey = String(sourceKey).slice(0, 200);
  return out;
}
