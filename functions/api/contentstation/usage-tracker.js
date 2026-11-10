/**
 * Grok / OpenAI usage tracker (all Content Station logins).
 * GET /api/contentstation/usage-tracker
 */
import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import { remix2WorkerConfigured, workerFetch, configPayload } from '../../lib/character-remix-2-og.js';

export async function onRequest(context) {
  const auth = await requireRole(context, [ROLES.DOWNLOAD, ROLES.READY, ROLES.KENNETH]);
  if (!auth.ok) return auth.response;

  if (!remix2WorkerConfigured(context.env)) {
    return json({ ok: false, error: 'remix2_unconfigured', ...configPayload(context.env) }, 503);
  }

  const result = await workerFetch(context.env, '/usage-tracker', { timeoutMs: 45000 });
  const data = result.data || { ok: false, error: 'worker_error' };
  return json(data, result.ok ? 200 : result.status || 502);
}
