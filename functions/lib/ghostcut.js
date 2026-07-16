/**
 * GhostCut / JollyToday signed API helpers.
 * Sign: AppSign = md5(md5(body_str) + AppSecret)  (hex)
 * Base: https://api.zhaoli.com
 *
 * Requires wrangler.toml: compatibility_flags = ["nodejs_compat"]
 * so we can use node:crypto MD5 (Web Crypto has no MD5).
 */

import { createHash } from 'node:crypto';

export function dumpsBody(payload) {
  return JSON.stringify(payload ?? {});
}

function md5Hex(text) {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

export async function makeAppSign(bodyStr, appSecret) {
  const bodyMd5 = md5Hex(bodyStr);
  return md5Hex(bodyMd5 + appSecret);
}

export async function ghostcutPost(env, path, payload) {
  const appKey = env.GHOSTCUT_APP_KEY;
  const appSecret = env.GHOSTCUT_APP_SECRET;
  const base = (env.GHOSTCUT_API_BASE || 'https://api.zhaoli.com').replace(/\/$/, '');
  if (!appKey || !appSecret) {
    return {
      ok: false,
      status: 500,
      data: { error: 'GhostCut credentials not configured (GHOSTCUT_APP_KEY / GHOSTCUT_APP_SECRET)' },
    };
  }

  const bodyStr = dumpsBody(payload);
  const appSign = await makeAppSign(bodyStr, appSecret);
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      AppKey: appKey,
      AppSign: appSign,
    },
    body: bodyStr,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}
