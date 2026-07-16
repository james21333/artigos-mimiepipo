import { json, parseCookies, verifySessionToken, COOKIE_NAME } from '../../lib/contentstation-auth.js';

export async function onRequestGet(context) {
  const cookies = parseCookies(context.request.headers.get('Cookie') || '');
  const ok = await verifySessionToken(context.env, cookies[COOKIE_NAME]);
  const r2Bound = Boolean(context.env.MEDIA_BUCKET);
  const runpodConfigured = Boolean(context.env.RUNPOD_API_KEY);
  return json({
    authenticated: ok,
    ghostcutConfigured: Boolean(context.env.GHOSTCUT_APP_KEY && context.env.GHOSTCUT_APP_SECRET),
    passwordConfigured: Boolean(context.env.CONTENT_STATION_PASSWORD),
    r2Bound,
    runpodConfigured,
    features: {
      ghostcut: true,
      r2: r2Bound,
      runpod: runpodConfigured,
    },
  });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestGet(context);
}
