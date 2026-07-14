/**
 * GhostCut / JollyToday signed API helpers.
 * Sign: AppSign = md5(md5(body_str) + AppSecret)  (hex)
 * Base: https://api.zhaoli.com
 */

export function dumpsBody(payload) {
  return JSON.stringify(payload ?? {});
}

async function md5Hex(text) {
  // Web Crypto has no MD5; use a small pure JS implementation for Pages Functions.
  return md5(text);
}

export async function makeAppSign(bodyStr, appSecret) {
  const bodyMd5 = await md5Hex(bodyStr);
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

/* --- Minimal MD5 (hex) for Cloudflare Workers --- */
function md5(string) {
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function md5cycle(x, k) {
    let [a, b, c, d] = x;
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = hh(a, b, c, d, k[5], 4, -1444681467);
    d = hh(d, a, b, c, k[8], 11, -51403784);
    c = hh(c, d, a, b, k[11], 16, 1735328473);
    b = hh(b, c, d, a, k[14], 23, -1926607734);
    a = hh(a, b, c, d, k[1], 4, -378558);
    d = hh(d, a, b, c, k[4], 11, -2022574463);
    c = hh(c, d, a, b, k[7], 16, 1839030562);
    b = hh(b, c, d, a, k[10], 23, -353081563);
    a = hh(a, b, c, d, k[13], 4, -1530992060);
    d = hh(d, a, b, c, k[0], 11, 1272893353);
    c = hh(c, d, a, b, k[3], 16, -155497632);
    b = hh(b, c, d, a, k[6], 23, -1094730640);
    a = ii(a, b, c, d, k[0], 6, 681279174);
    d = ii(d, a, b, c, k[7], 10, -358537222);
    c = ii(c, d, a, b, k[14], 15, -722521979);
    b = ii(b, c, d, a, k[5], 21, 76029189);
    a = ii(a, b, c, d, k[12], 6, -640364487);
    d = ii(d, a, b, c, k[3], 10, -421815835);
    c = ii(c, d, a, b, k[10], 15, 530742520);
    b = ii(b, c, d, a, k[1], 21, -995338651);
    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);
  }
  function md5blk(s) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] =
        s.charCodeAt(i) +
        (s.charCodeAt(i + 1) << 8) +
        (s.charCodeAt(i + 2) << 16) +
        (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }
  function md51(s) {
    const n = s.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
    s = s.substring(i - 64);
    const tail = Array(16).fill(0);
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << (i % 4 << 3);
    tail[i >> 2] |= 0x80 << (i % 4 << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (let j = 0; j < 16; j++) tail[j] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function rhex(n) {
    const hex_chr = '0123456789abcdef';
    let s = '';
    for (let j = 0; j < 4; j++) s += hex_chr.charAt((n >> (j * 8 + 4)) & 0x0f) + hex_chr.charAt((n >> (j * 8)) & 0x0f);
    return s;
  }
  function hex(x) {
    return x.map(rhex).join('');
  }
  function add32(a, b) {
    return (a + b) & 0xffffffff;
  }
  // UTF-8 encode
  const utf8 = unescape(encodeURIComponent(string));
  return hex(md51(utf8));
}
