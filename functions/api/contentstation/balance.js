import { json, requireSession } from '../../lib/contentstation-auth.js';
import { ghostcutPost } from '../../lib/ghostcut.js';

/** Convenience: query GhostCut point balance (requires session). */
export async function onRequestGet(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  const result = await ghostcutPost(context.env, '/v-w-c/gateway/ve/point/query', {
    notZero: true,
    isValid: true,
  });
  return json(result.data, result.ok ? 200 : result.status || 502);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestGet(context);
}
