import { json, requireRole, ROLES } from '../../../lib/contentstation-auth.js';
import { ghostcutPost } from '../../../lib/ghostcut.js';

/**
 * Authenticated proxy to GhostCut API.
 * POST /api/contentstation/ghostcut/<path...>
 * Body: JSON payload forwarded to GhostCut (signed server-side).
 *
 * Allowlist: only known /v-w-c/gateway/ve/* ops paths (no arbitrary SSRF).
 */

const ALLOWED_PATHS = new Set([
  '/v-w-c/gateway/ve/point/query',
  '/v-w-c/gateway/ve/work/status',
  '/v-w-c/gateway/ve/work/free',
]);

// Prefix allow for series / material ops used by ops station (still GhostCut-only host).
const ALLOWED_PREFIXES = [
  '/v-w-c/gateway/ve/work/',
  '/v-w-c/gateway/ve/point/',
];

function resolvePath(context) {
  const params = context.params?.path;
  if (!params) return '';
  if (Array.isArray(params)) return '/' + params.join('/');
  return '/' + String(params).replace(/^\/+/, '');
}

function isAllowedPath(path) {
  if (ALLOWED_PATHS.has(path)) return true;
  return ALLOWED_PREFIXES.some((p) => path.startsWith(p));
}

export async function onRequestPost(context) {
  const auth = await requireRole(context, [ROLES.ADMIN]);
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
  if (!isAllowedPath(path)) {
    return json(
      {
        error: 'path_not_allowlisted',
        message: 'This GhostCut path is not on the Content Station allowlist.',
        path,
        allowed: [...ALLOWED_PATHS],
      },
      403,
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
