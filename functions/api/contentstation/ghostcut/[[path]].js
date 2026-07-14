import { json, requireSession } from '../../../lib/contentstation-auth.js';
import { ghostcutPost } from '../../../lib/ghostcut.js';

/**
 * Authenticated proxy to GhostCut API.
 * POST /api/contentstation/ghostcut/<path...>
 * Body: JSON payload forwarded to GhostCut (signed server-side).
 *
 * Examples:
 *   POST /api/contentstation/ghostcut/v-w-c/gateway/ve/point/query
 *   POST /api/contentstation/ghostcut/v-w-c/gateway/ve/work/status
 */

function resolvePath(context) {
  const params = context.params?.path;
  if (!params) return '';
  if (Array.isArray(params)) return '/' + params.join('/');
  return '/' + String(params).replace(/^\/+/, '');
}

export async function onRequestPost(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  const path = resolvePath(context);
  if (!path.startsWith('/v-w-c/')) {
    return json(
      {
        error: 'invalid_path',
        message: 'Only /v-w-c/* GhostCut paths are allowed through this proxy.',
      },
      400,
    );
  }

  let payload = {};
  const ct = context.request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    try {
      payload = await context.request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
  }

  const result = await ghostcutPost(context.env, path, payload);
  return json(result.data, result.ok ? 200 : result.status || 502);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }
  if (context.request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestPost(context);
}
