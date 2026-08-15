import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  accountSummaries,
  createAccount,
  getAccountCharacter,
  getTagForKey,
  isVideoPosted,
  keysForAccount,
  listAccountCharacters,
  readTagsMap,
  renameAccount,
  sanitizeAccountName,
  setAccountCharacter,
  setVideoAccount,
  setVideoPosted,
} from '../../lib/account-tags.js';
import { resolvePostInfoForKey } from '../../lib/tiktok-post-info.js';

/**
 * Account tags for Ready For Upload.
 *
 * Roles:
 *   admin    → all actions
 *   download → list, tag, create, rename (account picker on TikTok download)
 *   ready    → list, tags, videos, tag, posted, create, rename, info
 *
 * GET  ?action=list              → accounts + counts (+ character defaults)
 * GET  ?action=tags              → full key→account map
 * GET  ?action=videos&account=   → tagged keys for account (cleaned + Remix 2 + FaceFusion)
 * GET  ?action=tag&key=          → tag for one key
 * GET  ?action=info&key=         → original TikTok post info for a cleaned video
 * GET  ?action=character&account= → default character + history for one account
 * GET  ?action=characters        → all account character defaults/history
 * POST { action: "create", name }
 * POST { action: "rename", from, to }
 * POST { action: "tag", key, account }   // account "" clears
 * POST { action: "posted", key, posted } // boolean — marked posted to TikTok
 * POST { action: "set-character", account, key } // key "" clears default
 */

function downloadPath(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

async function enrichKeys(env, keys) {
  const bucket = env.MEDIA_BUCKET;
  const out = [];
  for (const key of keys) {
    let size = null;
    let uploaded = null;
    let customMetadata = {};
    if (bucket) {
      try {
        const head = await bucket.head(key);
        if (head) {
          size = head.size ?? null;
          uploaded = head.uploaded ? new Date(head.uploaded).toISOString() : null;
          customMetadata = head.customMetadata || {};
        }
      } catch {
        /* skip head errors */
      }
    }
    const remix2 = /^character-remix-2-og\/([^/]+)\/final\.mp4$/i.exec(key);
    // Tagged before R2 upload (or upload failed) → no object. Skip so Ready
    // does not show a black/unplayable 404 card.
    if (remix2 && (size == null || size === 0)) {
      continue;
    }
    if (remix2 && bucket) {
      try {
        const sidecar = await bucket.get(`character-remix-2-og/${remix2[1]}/ready.json`);
        if (sidecar) {
          const text = await sidecar.text();
          const json = text ? JSON.parse(text) : null;
          if (json && typeof json === 'object') {
            if (json.musicLock != null) customMetadata.musicLock = json.musicLock ? 'true' : 'false';
            if (json.remixVariant) customMetadata.remixVariant = String(json.remixVariant);
            if (json.tiktokUrl) customMetadata.tiktokUrl = String(json.tiktokUrl);
            if (json.sourceKey) customMetadata.sourceKey = String(json.sourceKey);
            if (json.musicId) customMetadata.musicId = String(json.musicId);
            if (json.musicTitle) customMetadata.musicTitle = String(json.musicTitle);
            if (json.musicAuthor) customMetadata.musicAuthor = String(json.musicAuthor);
            if (json.musicOriginal != null && json.musicOriginal !== '') {
              customMetadata.musicOriginal = String(json.musicOriginal);
            }
            if (json.uploadedAt) {
              const t = Date.parse(json.uploadedAt);
              if (Number.isFinite(t)) uploaded = new Date(t).toISOString();
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    const musicLockRaw = String(customMetadata.musicLock || customMetadata.musiclock || '').toLowerCase();
    const musicLock =
      musicLockRaw === '1' || musicLockRaw === 'true' || musicLockRaw === 'yes'
        ? true
        : musicLockRaw === '0' || musicLockRaw === 'false' || musicLockRaw === 'no'
          ? false
          : null;
    const remixVariant = String(customMetadata.remixVariant || customMetadata.remixvariant || '').trim();
    out.push({
      key,
      size,
      uploaded,
      downloadPath: downloadPath(key),
      account: await getTagForKey(env, key),
      posted: await isVideoPosted(env, key),
      kind: remix2 ? 'remix2' : 'cleaned',
      jobId: remix2 ? remix2[1] : null,
      musicLock,
      remixVariant,
      tiktokUrl: customMetadata.tiktokUrl || customMetadata.tiktokurl || null,
    });
  }
  // Newest first
  out.sort((a, b) => {
    const ta = a.uploaded ? Date.parse(a.uploaded) : 0;
    const tb = b.uploaded ? Date.parse(b.uploaded) : 0;
    if (tb !== ta) return tb - ta;
    return String(b.key).localeCompare(String(a.key));
  });
  return out;
}

function forbidden(role) {
  return json({ ok: false, error: 'forbidden', role }, 403);
}

export async function onRequestGet(context) {
  const auth = await requireRole(context, [ROLES.DOWNLOAD, ROLES.READY]);
  if (!auth.ok) return auth.response;

  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';
  const role = auth.role;

  if (action === 'list') {
    const accounts = await accountSummaries(env);
    return json({ ok: true, accounts });
  }

  if (action === 'tags') {
    // Full tag map is used by cleaned gallery (admin) and ready flows.
    if (role === ROLES.DOWNLOAD) return forbidden(role);
    const tags = await readTagsMap(env);
    return json({ ok: true, tags });
  }

  if (action === 'videos') {
    if (role === ROLES.DOWNLOAD) return forbidden(role);
    const account = sanitizeAccountName(url.searchParams.get('account'));
    if (!account) {
      return json({ ok: false, error: 'missing_account', message: 'Account name required.' }, 400);
    }
    const keys = await keysForAccount(env, account);
    const videos = await enrichKeys(env, keys);
    return json({ ok: true, account, videos });
  }

  if (action === 'tag') {
    const key = url.searchParams.get('key');
    const account = await getTagForKey(env, key);
    return json({ ok: true, key, account });
  }

  if (action === 'info') {
    if (role === ROLES.DOWNLOAD) return forbidden(role);
    const key = url.searchParams.get('key');
    if (!key || typeof key !== 'string') {
      return json({ ok: false, error: 'missing_key', message: 'Video key required.' }, 400);
    }
    const result = await resolvePostInfoForKey(env, key);
    if (!result.ok) {
      return json(
        { ok: false, error: result.error || 'info_failed', message: 'Could not load post info.' },
        400,
      );
    }
    return json({
      ok: true,
      key: result.key,
      sourceKey: result.sourceKey,
      info: result.info,
    });
  }

  if (action === 'character') {
    const account = sanitizeAccountName(url.searchParams.get('account'));
    if (!account) {
      return json({ ok: false, error: 'missing_account', message: 'Account name required.' }, 400);
    }
    const result = await getAccountCharacter(env, account);
    if (!result.ok) {
      return json({ ok: false, error: 'character_failed', message: result.error }, 400);
    }
    return json({ ok: true, ...result });
  }

  if (action === 'characters') {
    const characters = await listAccountCharacters(env);
    return json({ ok: true, characters });
  }

  return json({ ok: false, error: 'unknown_action' }, 400);
}

export async function onRequestPost(context) {
  const auth = await requireRole(context, [ROLES.DOWNLOAD, ROLES.READY]);
  if (!auth.ok) return auth.response;

  const { env, request } = context;
  const role = auth.role;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Invalid JSON body.' }, 400);
  }

  const action = body.action || 'create';

  if (action === 'create') {
    // Admin, download, and ready managers can create accounts.
    const result = await createAccount(env, body.name);
    if (!result.ok) {
      return json({ ok: false, error: 'create_failed', message: result.error }, 400);
    }
    return json({
      ok: true,
      name: result.name,
      accounts: await accountSummaries(env),
    });
  }

  if (action === 'rename') {
    // Admin, ready, and download can rename (download manages accounts on TikTok download).
    const result = await renameAccount(env, body.from, body.to);
    if (!result.ok) {
      return json({ ok: false, error: 'rename_failed', message: result.error }, 400);
    }
    return json({
      ok: true,
      from: result.from,
      to: result.to,
      renamed: result.renamed,
      accounts: result.accounts,
    });
  }

  if (action === 'tag') {
    const result = await setVideoAccount(env, body.key, body.account);
    if (!result.ok) {
      return json({ ok: false, error: 'tag_failed', message: result.error }, 400);
    }
    return json({
      ok: true,
      key: result.key,
      account: result.account,
      accounts: await accountSummaries(env),
    });
  }

  if (action === 'posted') {
    if (role === ROLES.DOWNLOAD) return forbidden(role);
    if (typeof body.posted !== 'boolean') {
      return json(
        { ok: false, error: 'invalid_posted', message: 'posted must be true or false.' },
        400,
      );
    }
    const result = await setVideoPosted(env, body.key, body.posted);
    if (!result.ok) {
      return json({ ok: false, error: 'posted_failed', message: result.error }, 400);
    }
    return json({
      ok: true,
      key: result.key,
      posted: result.posted,
      postedAt: result.postedAt,
    });
  }

  if (action === 'set-character') {
    const result = await setAccountCharacter(env, body.account, body.key);
    if (!result.ok) {
      return json({ ok: false, error: 'set_character_failed', message: result.error }, 400);
    }
    return json({
      ok: true,
      ...result,
      accounts: await accountSummaries(env),
    });
  }

  return json({ ok: false, error: 'unknown_action', message: 'Unknown action.' }, 400);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method_not_allowed' }, 405);
}
