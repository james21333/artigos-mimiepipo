import { json, requireRole, ROLES } from '../../lib/contentstation-auth.js';
import { fetchCreditBalances } from '../../lib/credits.js';

/**
 * Credit balances for the Clean video UI (Josh naming — no vendor names).
 *   cleaningCreditsLeft   → metadata strip account
 *   videoAlterCreditsLeft → visual alter (watermark / remix / deep remake / mirror) account
 *
 * Legacy pointAssets payload is still included for the archive ops page.
 */

export async function onRequestGet(context) {
  const auth = await requireRole(context, [ROLES.ADMIN]);
  if (!auth.ok) return auth.response;

  const balances = await fetchCreditBalances(context.env);
  const legacy = balances._ghostcut;

  const body = {
    cleaningCreditsLeft: balances.cleaningCreditsLeft,
    videoAlterCreditsLeft: balances.videoAlterCreditsLeft,
    cleaningConfigured: balances.cleaningConfigured,
    videoAlterConfigured: balances.videoAlterConfigured,
  };

  // Keep legacy fields so old213223523.html balance button still works.
  if (legacy?.data && typeof legacy.data === 'object') {
    if (legacy.data.code != null) body.code = legacy.data.code;
    if (legacy.data.msg != null) body.msg = legacy.data.msg;
    if (legacy.data.body != null) body.body = legacy.data.body;
  }

  const status =
    balances.videoAlterConfigured && legacy && !legacy.ok
      ? legacy.status || 502
      : balances.cleaningConfigured &&
          balances._cloudconvert &&
          !balances._cloudconvert.ok &&
          balances.videoAlterCreditsLeft == null
        ? balances._cloudconvert.status || 502
        : 200;

  return json(body, status);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestGet(context);
}
