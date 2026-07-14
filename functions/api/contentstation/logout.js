import { json, sessionCookieHeader } from '../../lib/contentstation-auth.js';

export async function onRequestPost() {
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader('', { clear: true }) });
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestPost(context);
}
