import { json, parseCookies, verifySessionToken, COOKIE_NAME } from '../../lib/contentstation-auth.js';

export async function onRequestGet(context) {
  const cookies = parseCookies(context.request.headers.get('Cookie') || '');
  const ok = await verifySessionToken(context.env, cookies[COOKIE_NAME]);
  return json({
    authenticated: ok,
    ghostcutConfigured: Boolean(context.env.GHOSTCUT_APP_KEY && context.env.GHOSTCUT_APP_SECRET),
    passwordConfigured: Boolean(context.env.CONTENT_STATION_PASSWORD),
    features: {
      ghostcut: true,
      r2: false,
      runpod: false,
    },
  });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestGet(context);
}
