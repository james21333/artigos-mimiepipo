import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  addUrlsToList,
  createUrlList,
  DEFAULT_LIST_ID,
  getUrlList,
  listUrlLists,
  purgeLongVideosFromAllLists,
  purgePhotoUrlsFromAllLists,
  removeUrlsFromList,
} from '../../lib/tiktok-url-lists.js';
import { isTikTokPhotoUrl } from '../../lib/tiktok-download-seen.js';
import { lookupTikTokDurationSec } from '../../lib/tiktok-download.js';
import { isOverMaxListDuration, MAX_LIST_VIDEO_SEC } from '../../lib/tiktok-duration.js';

/**
 * Named TikTok URL lists (GLP-1 List, etc.)
 * GET  ?action=list
 * GET  ?action=get&listId=
 * POST { action: "create", name, reuseUrls?: boolean }
 * POST { action: "add", listId, urls: string[] | url: string }
 * POST { action: "remove", listId, urls: string[] | url: string }
 * POST { action: "purge-photos" } — strip TikTok /photo/ items from every list
 * POST { action: "purge-long" } — strip clips longer than 30 seconds from every list
 * POST { action: "add" } — rejects clips longer than 30 seconds
 */
export async function onRequest(context) {
  const auth = await requireRole(context, [ROLES.DOWNLOAD, ROLES.READY, ROLES.KENNETH]);
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  if (method === 'GET' || method === 'HEAD') {
    const action = url.searchParams.get('action') || 'list';
    if (action === 'list') {
      const result = await listUrlLists(env);
      if (!result.ok) return json({ ok: false, error: result.error }, 503);
      return json(result);
    }
    if (action === 'get') {
      const result = await getUrlList(env, url.searchParams.get('listId') || DEFAULT_LIST_ID);
      if (!result.ok) return json({ ok: false, error: result.error }, 404);
      return json({
        ok: true,
        list: {
          id: result.list.id,
          name: result.list.name,
          reuseUrls: result.list.reuseUrls === true,
          count: (result.list.items || []).length,
          items: result.list.items || [],
        },
      });
    }
    return json({ ok: false, error: 'unknown_action' }, 400);
  }

  if (method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  const action = body.action || 'add';

  if (action === 'create') {
    const result = await createUrlList(env, body.name, {
      reuseUrls: body.reuseUrls === true,
    });
    if (!result.ok) return json(result, 400);
    return json(result);
  }

  if (action === 'add') {
    const urls = (Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [])
      .map((raw) => String(raw || '').trim())
      .filter(Boolean);
    const looked = await Promise.all(
      urls.map(async (url) => ({ url, sec: await lookupTikTokDurationSec(env, url) })),
    );
    const durationByUrl = {};
    const rejected = [];
    const accepted = [];
    for (const { url, sec } of looked) {
      if (isOverMaxListDuration(sec)) {
        rejected.push({ url, durationSec: sec });
        continue;
      }
      if (sec != null) durationByUrl[url] = sec;
      accepted.push(url);
    }
    const result = await addUrlsToList(env, body.listId || DEFAULT_LIST_ID, accepted, {
      addedFrom: body.addedFrom || 'manual',
      tiktokId: body.tiktokId,
      durationByUrl,
    });
    if (!result.ok) return json(result, result.error === 'list_not_found' ? 404 : 400);
    return json({
      ...result,
      rejectedLong: rejected.length,
      rejected,
      maxDurationSec: MAX_LIST_VIDEO_SEC,
      message: rejected.length
        ? `Skipped ${rejected.length} video(s) longer than ${MAX_LIST_VIDEO_SEC} seconds.`
        : undefined,
    });
  }

  if (action === 'remove') {
    const urls = Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [];
    const result = await removeUrlsFromList(env, body.listId || DEFAULT_LIST_ID, urls);
    if (!result.ok) return json(result, result.error === 'list_not_found' ? 404 : 400);
    return json(result);
  }

  if (action === 'purge-photos') {
    const result = await purgePhotoUrlsFromAllLists(env, isTikTokPhotoUrl);
    if (!result.ok) return json(result, 503);
    return json(result);
  }

  if (action === 'purge-long') {
    const result = await purgeLongVideosFromAllLists(env, async (item) => {
      if (!item?.url) return null;
      return lookupTikTokDurationSec(env, item.url);
    });
    if (!result.ok) return json(result, 503);
    return json({ ...result, maxDurationSec: MAX_LIST_VIDEO_SEC });
  }

  return json({ ok: false, error: 'unknown_action' }, 400);
}
