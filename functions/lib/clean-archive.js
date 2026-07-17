/**
 * Persist finished clean outputs under MEDIA_BUCKET prefix cleaned/.
 * Used by the Cleaned videos gallery. Never throws into the clean status path —
 * callers should catch / use scheduleCleanArchive (waitUntil).
 */

import { setVideoAccount } from './account-tags.js';
import { recordCleanedSource } from './clean-source-map.js';

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
      sourceKey,
      cleanedKey: existing.key,
      workId,
      account,
    });
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
  await trackSource(env, { sourceKey, cleanedKey: key, workId, account });

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
