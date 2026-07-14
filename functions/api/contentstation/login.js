import {
  checkPassword,
  createSessionToken,
  json,
  sessionCookieHeader,
} from '../../lib/contentstation-auth.js';

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const password = body?.password;
  if (!checkPassword(context.env, password)) {
    return json({ error: 'invalid_password' }, 401);
  }

  if (!context.env.CONTENT_STATION_PASSWORD) {
    return json(
      {
        error: 'password_not_configured',
        message: 'Set CONTENT_STATION_PASSWORD in Cloudflare Pages environment variables.',
      },
      500,
    );
  }

  const token = await createSessionToken(context.env);
  return json(
    { ok: true },
    200,
    { 'Set-Cookie': sessionCookieHeader(token) },
  );
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (context.request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  return onRequestPost(context);
}
