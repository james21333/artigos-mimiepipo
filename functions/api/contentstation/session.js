import {
  json,
  parseCookies,
  verifySessionToken,
  COOKIE_NAME,
  allowedPagesForRole,
  homePathForRole,
  anyPasswordConfigured,
  ROLES,
} from '../../lib/contentstation-auth.js';
import { fetchCreditBalances } from '../../lib/credits.js';

export async function onRequestGet(context) {
  const cookies = parseCookies(context.request.headers.get('Cookie') || '');
  const verified = await verifySessionToken(context.env, cookies[COOKIE_NAME]);
  const ok = verified.ok;
  const role = ok ? verified.role : null;
  const r2Bound = Boolean(context.env.MEDIA_BUCKET);
  const runpodConfigured = Boolean(context.env.RUNPOD_API_KEY);
  const processorReady = Boolean(context.env.GHOSTCUT_APP_KEY && context.env.GHOSTCUT_APP_SECRET);
  const metadataReady = Boolean(context.env.CLOUDCONVERT_API_KEY);
  const cleanReady = processorReady || metadataReady;
  const passwordConfigured = anyPasswordConfigured(context.env);

  const payload = {
    authenticated: ok,
    role,
    allowedPages: ok ? allowedPagesForRole(role) : [],
    homePath: ok ? homePathForRole(role) : null,
    // Friendly flags for the consumer Clean video UI (no vendor names).
    ready: cleanReady && passwordConfigured,
    cleanReady,
    metadataReady,
    uploadReady: r2Bound,
    // Legacy fields kept for old213223523.html ops panel.
    ghostcutConfigured: processorReady,
    passwordConfigured,
    r2Bound,
    runpodConfigured,
    features: {
      ghostcut: true,
      r2: r2Bound,
      runpod: runpodConfigured,
      metadataStrip: metadataReady,
      alterAudio: metadataReady,
    },
  };

  // Credits are admin-only (Clean video tooling).
  if (ok && role === ROLES.ADMIN) {
    try {
      const balances = await fetchCreditBalances(context.env);
      payload.cleaningCreditsLeft = balances.cleaningCreditsLeft;
      payload.videoAlterCreditsLeft = balances.videoAlterCreditsLeft;
    } catch {
      payload.cleaningCreditsLeft = null;
      payload.videoAlterCreditsLeft = null;
    }
  }

  return json(payload);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestGet(context);
}
