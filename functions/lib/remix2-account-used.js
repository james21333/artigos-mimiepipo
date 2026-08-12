/**
 * Per-account “already remixed this TikTok” index for Remix 2 pages
 * (Music-Only V2, Talking Heads V2, Viral Video Builder).
 *
 * Separate from tiktok/_used (TikTok Download stays global).
 *
 *   remix2/_used/{accountSlug}/{tiktokId}.json
 *   remix2/_used/{accountSlug}/_ready.json
 */

import { accountSlug, keysForAccount, sanitizeAccountName } from './account-tags.js';
import { extractTikTokVideoId } from './tiktok-download-seen.js';

export const REMIX_USED_PREFIX = 'remix2/_used/';

function idOnly(raw) {
  return String(raw || '').replace(/[^\d]/g, '').slice(0, 40);
}

function markerKey(account, tiktokId) {
  const slug = accountSlug(account);
  const id = idOnly(tiktokId);
  if (!slug || !id) return null;
  return `${REMIX_USED_PREFIX}${slug}/${id}.json`;
}

function readyKey(account) {
  const slug = accountSlug(account);
  if (!slug) return null;
  return `${REMIX_USED_PREFIX}${slug}/_ready.json`;
}

async function readJson(bucket, key) {
  if (!bucket || !key) return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    const text = await obj.text();
    if (!text) return null;
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function idFromReady(json) {
  if (!json || typeof json !== 'object') return '';
  return (
    idOnly(json.tiktokId || json.tiktokid || json.id) ||
    extractTikTokVideoId(json.tiktokUrl || json.tiktokurl || json.url || '')
  );
}

/**
 * Backfill markers from remix2 finals already tagged to this account.
 * Runs once per account (ready flag).
 */
export async function ensureRemixUsedIndex(env, accountRaw) {
  const bucket = env?.MEDIA_BUCKET;
  const account = sanitizeAccountName(accountRaw);
  if (!bucket || !account) return { ok: false };

  const ready = readyKey(account);
  try {
    if (ready && (await bucket.head(ready))) return { ok: true, backfilled: false };
  } catch {
    /* continue */
  }

  const keys = await keysForAccount(env, account);
  let marked = 0;
  for (const key of keys) {
    const m = /^character-remix-2-og\/([^/]+)\/final\.mp4$/i.exec(String(key || ''));
    if (!m) continue;
    const jobId = m[1];
    let json = null;
    try {
      const obj = await bucket.get(`character-remix-2-og/${jobId}/ready.json`);
      if (obj) json = JSON.parse(await obj.text());
    } catch {
      json = null;
    }
    const id = idFromReady(json);
    if (!id) continue;
    const rec = {
      tiktokId: id,
      tiktokUrl: String(json?.tiktokUrl || json?.tiktokurl || '').slice(0, 400),
      account,
      jobId,
      source: 'backfill-tagged-remix2',
      firstAt: json?.uploadedAt || new Date().toISOString(),
    };
    const mk = markerKey(account, id);
    if (!mk) continue;
    try {
      await bucket.put(mk, JSON.stringify(rec), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          tiktokId: id,
          account: account.slice(0, 80),
          jobId: String(jobId).slice(0, 40),
        },
      });
      marked += 1;
    } catch {
      /* ignore one */
    }
  }

  if (ready) {
    try {
      await bucket.put(
        ready,
        JSON.stringify({ readyAt: new Date().toISOString(), marked, account }),
        { httpMetadata: { contentType: 'application/json' } },
      );
    } catch {
      /* ignore */
    }
  }
  return { ok: true, backfilled: true, marked };
}

/** Numeric TikTok ids already remixed for this account. */
export async function listRemixUsedIds(env, accountRaw) {
  const bucket = env?.MEDIA_BUCKET;
  const account = sanitizeAccountName(accountRaw);
  const slug = accountSlug(account);
  /** @type {Set<string>} */
  const ids = new Set();
  if (!bucket || !slug) return ids;
  const prefix = `${REMIX_USED_PREFIX}${slug}/`;
  let cursor;
  do {
    const listed = await bucket.list({
      prefix,
      limit: 1000,
      cursor: cursor || undefined,
    });
    for (const obj of listed.objects || []) {
      if (!obj?.key || !obj.key.endsWith('.json')) continue;
      const base = obj.key.slice(prefix.length);
      if (!base || base === '_ready.json' || base.includes('/')) continue;
      const id = base.replace(/\.json$/i, '');
      if (/^\d{5,}$/.test(id)) ids.add(id);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return ids;
}

export async function getRemixUsedRecord(env, { tiktokId, tiktokUrl, account } = {}) {
  const bucket = env?.MEDIA_BUCKET;
  const name = sanitizeAccountName(account);
  const id = idOnly(tiktokId) || extractTikTokVideoId(tiktokUrl);
  if (!bucket || !name || !id) return null;
  return readJson(bucket, markerKey(name, id));
}

export async function markRemixUsed(
  env,
  { tiktokId, tiktokUrl, account, jobId, variant } = {},
) {
  const bucket = env?.MEDIA_BUCKET;
  const name = sanitizeAccountName(account);
  const id = idOnly(tiktokId) || extractTikTokVideoId(tiktokUrl);
  if (!bucket || !name || !id) return { ok: false, error: 'missing_account_or_id' };
  const prev = await getRemixUsedRecord(env, { tiktokId: id, account: name });
  const now = new Date().toISOString();
  const rec = {
    tiktokId: id,
    tiktokUrl: String(tiktokUrl || prev?.tiktokUrl || '').slice(0, 400),
    account: name,
    jobId: String(jobId || prev?.jobId || '').slice(0, 80),
    variant: String(variant || prev?.variant || '').slice(0, 40),
    source: 'remix2-from-tiktok',
    firstAt: prev?.firstAt || now,
    lastAt: now,
    useCount: Number(prev?.useCount || 0) + 1,
  };
  const mk = markerKey(name, id);
  try {
    await bucket.put(mk, JSON.stringify(rec), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        tiktokId: id,
        account: name.slice(0, 80),
        jobId: rec.jobId.slice(0, 40),
      },
    });
    return { ok: true, record: rec };
  } catch (err) {
    return { ok: false, error: 'mark_failed', detail: String(err?.message || err) };
  }
}

export function alreadyRemixedResult(record, account) {
  return {
    ok: false,
    error: 'already_remixed_for_account',
    message: `Already remixed for this account${account ? ` (${account})` : ''}. Skipped.`,
    tiktokId: record?.tiktokId || null,
    tiktokUrl: record?.tiktokUrl || null,
    jobId: record?.jobId || null,
    account: record?.account || account || null,
  };
}

export { extractTikTokVideoId };
