/**
 * Shared Content Station auth helpers for Cloudflare Pages Functions.
 * Cookie session is HMAC-signed with CONTENT_STATION_SESSION_SECRET (or password as fallback).
 *
 * Roles: admin | download | ready
 * Token: v2.${role}.${exp}.${sig}  (payload signed: v2.${role}.${exp})
 * Legacy v1.${exp}.${sig} tokens are accepted as admin until they expire.
 */

const COOKIE_NAME = 'cs_session';
const SESSION_TTL_SEC = 60 * 60 * 12; // 12 hours

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  DOWNLOAD: 'download',
  READY: 'ready',
});

const VALID_ROLES = new Set([ROLES.ADMIN, ROLES.DOWNLOAD, ROLES.READY]);

/** Page paths (relative to /contentstation/) each role may open. */
const ROLE_PAGES = Object.freeze({
  [ROLES.ADMIN]: [
    '/',
    '/index.html',
    '/cleaned.html',
    '/downloaded.html',
    '/tiktok-download.html',
    '/tiktok-download-character-remix.html',
    '/ready.html',
    '/ready-account.html',
    '/old213223523.html',
  ],
  [ROLES.DOWNLOAD]: ['/tiktok-download.html'],
  [ROLES.READY]: ['/ready.html', '/ready-account.html'],
});

const ROLE_HOME = Object.freeze({
  [ROLES.ADMIN]: './',
  [ROLES.DOWNLOAD]: './tiktok-download.html',
  [ROLES.READY]: './ready.html',
});

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
  return (
    env.CONTENT_STATION_SESSION_SECRET ||
    getPassword(env) ||
    env.CONTENT_STATION_PASSWORD_DOWNLOAD ||
    env.CONTENT_STATION_PASSWORD_READY ||
    'dev-insecure'
  );
}

function anyPasswordConfigured(env) {
  return Boolean(
    getPassword(env) ||
      env.CONTENT_STATION_PASSWORD_DOWNLOAD ||
      env.CONTENT_STATION_PASSWORD_READY,
  );
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

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let ok = 0;
  for (let i = 0; i < a.length; i++) {
    ok |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return ok === 0;
}

/**
 * Match password against configured role passwords.
 * Returns role string or null. Tries all configured passwords (constant-time per candidate).
 */
export function checkPassword(env, password) {
  if (typeof password !== 'string' || !password) return null;

  const candidates = [
    { role: ROLES.ADMIN, expected: getPassword(env) },
    { role: ROLES.DOWNLOAD, expected: env.CONTENT_STATION_PASSWORD_DOWNLOAD || '' },
    { role: ROLES.READY, expected: env.CONTENT_STATION_PASSWORD_READY || '' },
  ];

  let matched = null;
  for (const { role, expected } of candidates) {
    if (!expected) continue;
    // Always run a compare-shaped loop so empty slots don't short-circuit timing for others.
    if (timingSafeEqualStr(password, expected) && matched == null) {
      matched = role;
    }
  }
  return matched;
}

export async function createSessionToken(env, role = ROLES.ADMIN) {
  const safeRole = VALID_ROLES.has(role) ? role : ROLES.ADMIN;
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = `v2.${safeRole}.${exp}`;
  const sig = await hmacHex(getSessionSecret(env), payload);
  return `${payload}.${sig}`;
}

/**
 * @returns {{ ok: true, role: string } | { ok: false }}
 */
export async function verifySessionToken(env, token) {
  if (!token || typeof token !== 'string') return { ok: false };
  const parts = token.split('.');

  // Legacy v1.${exp}.${sig} → admin
  if (parts.length === 3 && parts[0] === 'v1') {
    const [, expStr, sig] = parts;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return { ok: false };
    const payload = `v1.${expStr}`;
    const expected = await hmacHex(getSessionSecret(env), payload);
    if (!timingSafeEqualStr(expected, sig)) return { ok: false };
    return { ok: true, role: ROLES.ADMIN };
  }

  // v2.${role}.${exp}.${sig}
  if (parts.length !== 4 || parts[0] !== 'v2') return { ok: false };
  const [, role, expStr, sig] = parts;
  if (!VALID_ROLES.has(role)) return { ok: false };
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return { ok: false };
  const payload = `v2.${role}.${expStr}`;
  const expected = await hmacHex(getSessionSecret(env), payload);
  if (!timingSafeEqualStr(expected, sig)) return { ok: false };
  return { ok: true, role };
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
  const verified = await verifySessionToken(context.env, token);
  if (!verified.ok) {
    return { ok: false, role: null, response: json({ error: 'unauthorized' }, 401) };
  }
  return { ok: true, role: verified.role };
}

/**
 * Require an authenticated session whose role is admin or in allowedRoles.
 */
export async function requireRole(context, allowedRoles = []) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth;
  if (auth.role === ROLES.ADMIN) return auth;
  const allowed = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (allowed.includes(auth.role)) return auth;
  return {
    ok: false,
    role: auth.role,
    response: json({ error: 'forbidden', role: auth.role }, 403),
  };
}

export function allowedPagesForRole(role) {
  if (role === ROLES.ADMIN) return ROLE_PAGES[ROLES.ADMIN];
  return ROLE_PAGES[role] || [];
}

export function homePathForRole(role) {
  return ROLE_HOME[role] || ROLE_HOME[ROLES.ADMIN];
}

export function roleMayAccessPage(role, pageId) {
  if (role === ROLES.ADMIN) return true;
  const pages = ROLE_PAGES[role];
  if (!pages) return false;
  // pageId examples: 'tiktok-download', 'ready', 'ready-account', 'clean', 'cleaned', 'downloaded'
  const map = {
    clean: ['/', '/index.html'],
    cleaned: ['/cleaned.html'],
    downloaded: ['/downloaded.html'],
    'tiktok-download': ['/tiktok-download.html'],
    'tiktok-download-character-remix': ['/tiktok-download-character-remix.html'],
    ready: ['/ready.html'],
    'ready-account': ['/ready-account.html'],
    old: ['/old213223523.html'],
  };
  const targets = map[pageId] || [];
  return targets.some((p) => pages.includes(p));
}

/**
 * Media key/prefix access by role.
 * download → tiktok/ read
 * ready → cleaned/ read
 * admin → all
 */
export function mediaKeyAllowed(role, key) {
  if (role === ROLES.ADMIN) return true;
  if (!key || typeof key !== 'string') return false;
  if (role === ROLES.DOWNLOAD) return key.startsWith('tiktok/');
  if (role === ROLES.READY) return key.startsWith('cleaned/');
  return false;
}

export function mediaPrefixAllowed(role, prefix) {
  if (role === ROLES.ADMIN) return true;
  const p = prefix || '';
  if (role === ROLES.DOWNLOAD) return p === 'tiktok/' || p.startsWith('tiktok/');
  if (role === ROLES.READY) return p === 'cleaned/' || p.startsWith('cleaned/');
  return false;
}

export function mediaWriteAllowed(role) {
  return role === ROLES.ADMIN;
}

export { COOKIE_NAME, SESSION_TTL_SEC, anyPasswordConfigured };
