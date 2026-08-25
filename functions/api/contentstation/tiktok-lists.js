import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import {
  addUrlsToList,
  createUrlList,
  DEFAULT_LIST_ID,
  getUrlList,
  listUrlLists,
} from '../../lib/tiktok-url-lists.js';

/**
 * Named TikTok URL lists (GLP-1 List, etc.)
 * GET  ?action=list
 * GET  ?action=get&listId=
 * POST { action: "create", name }
 * POST { action: "add", listId, urls: string[] | url: string }
 */
export async function onRequest(context) {
  const auth = await requireRole(context, [ROLES.ADMIN, ROLES.DOWNLOAD, ROLES.KENNETH]);
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
    const result = await createUrlList(env, body.name);
    if (!result.ok) return json(result, 400);
    return json(result);
  }

  if (action === 'add') {
    const urls = Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [];
    const result = await addUrlsToList(env, body.listId || DEFAULT_LIST_ID, urls, {
      addedFrom: body.addedFrom || 'manual',
      tiktokId: body.tiktokId,
    });
    if (!result.ok) return json(result, result.error === 'list_not_found' ? 404 : 400);
    return json(result);
  }

  return json({ ok: false, error: 'unknown_action' }, 400);
}
