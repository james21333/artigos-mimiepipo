/**
 * Shared Content Station auth helpers for Cloudflare Pages Functions.
 * Cookie session is HMAC-signed with CONTENT_STATION_SESSION_SECRET (or password as fallback).
 */

const COOKIE_NAME = 'cs_session';
const SESSION_TTL_SEC = 60 * 60 * 12; // 12 hours

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      ...extraHeaders,
    },
  });
}

function getPassword(env) {
  return env.CONTENT_STATION_PASSWORD || '';
}

function getSessionSecret(env) {
  return env.CONTENT_STATION_SESSION_SECRET || getPassword(env) || 'dev-insecure';
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = `v1.${exp}`;
  const sig = await hmacHex(getSessionSecret(env), payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(env, token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [v, expStr, sig] = parts;
  if (v !== 'v1') return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const payload = `${v}.${expStr}`;
  const expected = await hmacHex(getSessionSecret(env), payload);
  if (expected.length !== sig.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return ok === 0;
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookieHeader(token, { clear = false } = {}) {
  const maxAge = clear ? 0 : SESSION_TTL_SEC;
  const value = clear ? '' : encodeURIComponent(token);
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export async function requireSession(context) {
  const cookies = parseCookies(context.request.headers.get('Cookie') || '');
  const token = cookies[COOKIE_NAME];
  const ok = await verifySessionToken(context.env, token);
  if (!ok) {
    return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  }
  return { ok: true };
}

export function checkPassword(env, password) {
  const expected = getPassword(env);
  if (!expected) return false;
  if (typeof password !== 'string') return false;
  if (password.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) {
    ok |= password.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return ok === 0;
}

export { COOKIE_NAME, SESSION_TTL_SEC };
