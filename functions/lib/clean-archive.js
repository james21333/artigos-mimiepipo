/**
 * Persist finished clean outputs under MEDIA_BUCKET prefix cleaned/.
 * Used by the Cleaned videos gallery. Never throws into the clean status path —
 * callers should catch / use scheduleCleanArchive (waitUntil).
 */

import { setVideoAccount } from './account-tags.js';
import { recordCleanedSource, sanitizeSourceKey } from './clean-source-map.js';
import { extractTikTokVideoId, markTikTokSeen } from './tiktok-download-seen.js';
import { cleanedCustomMetaFromSource } from './tiktok-post-info.js';

const CLEANED_PREFIX = 'cleaned/';

function downloadPath(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

export function cleanedKeyForWorkId(workId) {
  const safe = String(workId || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  if (!safe) return null;
  return `${CLEANED_PREFIX}${safe}.mp4`;
}

export async function resolveArchivedDownload(env, workId) {
  const bucket = env.MEDIA_BUCKET;
  const key = cleanedKeyForWorkId(workId);
  if (!bucket || !key) return null;
  try {
    const head = await bucket.head(key);
    if (!head) return null;
    return {
      key,
      size: head.size ?? null,
      downloadPath: downloadPath(key),
      contentType: head.httpMetadata?.contentType || 'video/mp4',
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a finished clean URL and store it in cleaned/. Idempotent by workId key.
 * @returns {{ ok: true, key, downloadPath, existed?: boolean } | { ok: false, error: string }}
 */
async function trackSource(env, { sourceKey, cleanedKey, workId, account }) {
  if (!sourceKey || !cleanedKey) return;
  try {
    await recordCleanedSource(env, { sourceKey, cleanedKey, workId, account });
  } catch {
    /* best-effort */
  }
}

/** Block future TikTok downloads of this video id once it has been cleaned/used. */
async function markUsedFromClean(env, { sourceKey, cleanedKey, account, extra } = {}) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return;
  try {
    const cm = extra && typeof extra === 'object' ? extra : {};
    let tiktokUrl = cm.tiktokUrl || cm.tiktokurl || '';
    let tiktokId = String(cm.tiktokId || cm.tiktokid || '').replace(/[^\d]/g, '');
    let author = cm.author || '';
    let title = cm.title || '';
    if ((!tiktokId || !tiktokUrl) && sourceKey) {
      try {
        const head = await bucket.head(sourceKey);
        const scm = head?.customMetadata || {};
        tiktokUrl = tiktokUrl || scm.tiktokUrl || scm.tiktokurl || '';
        tiktokId =
          tiktokId || String(scm.tiktokId || scm.tiktokid || '').replace(/[^\d]/g, '');
        author = author || scm.author || '';
        title = title || scm.title || '';
      } catch {
        /* ignore */
      }
    }
    if (!tiktokId) tiktokId = extractTikTokVideoId(tiktokUrl);
    if (!tiktokId) return;
    await markTikTokSeen(bucket, {
      tiktokId,
      tiktokUrl,
      key: cleanedKey,
      cleanedKey,
      author,
      title,
      account,
      source: 'cleaned',
    });
  } catch {
    /* best-effort */
  }
}

async function postMetaFromSource(env, sourceRaw) {
  const bucket = env.MEDIA_BUCKET;
  const key = sanitizeSourceKey(sourceRaw);
  if (!bucket || !key) return { sourceKey: null, extra: {} };
  try {
    const head = await bucket.head(key);
    const cm = head?.customMetadata || {};
    return {
      sourceKey: key,
      extra: cleanedCustomMetaFromSource(cm, key),
    };
  } catch {
    return { sourceKey: key, extra: { sourceKey: key } };
  }
}

export async function archiveCleanedVideo(
  env,
  { workId, sourceUrl, filename, account, sourceKey } = {},
) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) {
    return { ok: false, error: 'Storage isn’t available.' };
  }
  const key = cleanedKeyForWorkId(workId);
  if (!key) {
    return { ok: false, error: 'Missing work id.' };
  }
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return { ok: false, error: 'Missing download URL.' };
  }

  const postBits = await postMetaFromSource(env, sourceKey);

  const existing = await resolveArchivedDownload(env, workId);
  if (existing) {
    if (account) {
      try {
        await setVideoAccount(env, existing.key, account);
      } catch {
        /* best-effort tag */
      }
    }
    await trackSource(env, {
      sourceKey: postBits.sourceKey || sourceKey,
      cleanedKey: existing.key,
      workId,
      account,
    });
    await markUsedFromClean(env, {
      sourceKey: postBits.sourceKey || sourceKey,
      cleanedKey: existing.key,
      account,
      extra: postBits.extra,
    });
    // Best-effort: stamp TikTok post meta onto existing cleaned object if missing.
    if (Object.keys(postBits.extra || {}).length) {
      try {
        const head = await bucket.head(existing.key);
        if (head) {
          const prev = head.customMetadata || {};
          const needs = !prev.tiktokUrl && !prev.title && !prev.musicTitle && !prev.musicId;
          if (needs) {
            const obj = await bucket.get(existing.key);
            if (obj?.body) {
              await bucket.put(existing.key, obj.body, {
                httpMetadata: head.httpMetadata || { contentType: 'video/mp4' },
                customMetadata: { ...prev, ...postBits.extra },
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    return {
      ok: true,
      key: existing.key,
      downloadPath: existing.downloadPath,
      existed: true,
      account: account || null,
    };
  }

  let res;
  try {
    res = await fetch(sourceUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'ContentStation/1.0' },
    });
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : 'Could not download cleaned video.',
    };
  }
  if (!res.ok || !res.body) {
    return {
      ok: false,
      error: `Could not download cleaned video (${res.status}).`,
    };
  }

  const contentType =
    res.headers.get('Content-Type') ||
    (String(filename || '').match(/\.(mov|webm|mkv)$/i) ? 'application/octet-stream' : 'video/mp4');

  try {
    await bucket.put(key, res.body, {
      httpMetadata: { contentType },
      customMetadata: {
        workId: String(workId),
        account: account ? String(account).slice(0, 80) : '',
        sourceHost: (() => {
          try {
            return new URL(sourceUrl).hostname;
          } catch {
            return '';
          }
        })(),
        archivedAt: new Date().toISOString(),
        originalName: String(filename || '').slice(0, 120),
        ...postBits.extra,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : 'Could not save cleaned video.',
    };
  }

  if (account) {
    try {
      await setVideoAccount(env, key, account);
    } catch {
      /* best-effort tag */
    }
  }
  await trackSource(env, {
    sourceKey: postBits.sourceKey || sourceKey,
    cleanedKey: key,
    workId,
    account,
  });
  await markUsedFromClean(env, {
    sourceKey: postBits.sourceKey || sourceKey,
    cleanedKey: key,
    account,
    extra: postBits.extra,
  });

  return { ok: true, key, downloadPath: downloadPath(key), existed: false, account: account || null };
}

/**
 * Fire-and-forget archive so clean status polling never blocks on R2 upload.
 */
export function scheduleCleanArchive(
  context,
  env,
  { workId, sourceUrl, filename, account, sourceKey } = {},
) {
  if (!env.MEDIA_BUCKET || !workId || !sourceUrl) return;
  const task = archiveCleanedVideo(env, {
    workId,
    sourceUrl,
    filename,
    account,
    sourceKey,
  }).catch(() => null);
  if (context && typeof context.waitUntil === 'function') {
    context.waitUntil(task);
  }
}
