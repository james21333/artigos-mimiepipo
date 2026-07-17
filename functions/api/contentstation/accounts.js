import { json, requireSession } from '../../lib/contentstation-auth.js';
import {
  accountSummaries,
  createAccount,
  getTagForKey,
  isVideoPosted,
  keysForAccount,
  readTagsMap,
  renameAccount,
  sanitizeAccountName,
  setVideoAccount,
  setVideoPosted,
} from '../../lib/account-tags.js';

/**
 * Account tags for Ready For Upload.
 *
 * GET  ?action=list              → accounts + counts
 * GET  ?action=tags              → full key→account map
 * GET  ?action=videos&account=   → cleaned keys for account
 * GET  ?action=tag&key=          → tag for one key
 * POST { action: "create", name }
 * POST { action: "rename", from, to }
 * POST { action: "tag", key, account }   // account "" clears
 * POST { action: "posted", key, posted } // boolean — marked posted to TikTok
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
    if (bucket) {
      try {
        const head = await bucket.head(key);
        if (head) {
          size = head.size ?? null;
          uploaded = head.uploaded ? new Date(head.uploaded).toISOString() : null;
        }
      } catch {
        /* skip head errors */
      }
    }
    out.push({
      key,
      size,
      uploaded,
      downloadPath: downloadPath(key),
      account: await getTagForKey(env, key),
      posted: await isVideoPosted(env, key),
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

export async function onRequestGet(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';

  if (action === 'list') {
    const accounts = await accountSummaries(env);
    return json({ ok: true, accounts });
  }

  if (action === 'tags') {
    const tags = await readTagsMap(env);
    return json({ ok: true, tags });
  }

  if (action === 'videos') {
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

  return json({ ok: false, error: 'unknown_action' }, 400);
}

export async function onRequestPost(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  const { env, request } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Invalid JSON body.' }, 400);
  }

  const action = body.action || 'create';

  if (action === 'create') {
    const result = await createAccount(env, body.name);
    if (!result.ok) {
      return json({ ok: false, error: 'create_failed', message: result.error }, 400);
    }
    return json({
      ok: true,
      name: result.name,
      accounts: (await accountSummaries(env)),
    });
  }

  if (action === 'rename') {
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
