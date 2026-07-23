/**
 * Account tags for cleaned videos (Ready For Upload).
 * Durable index in R2 — avoids re-uploading video bytes to retag.
 *
 *   meta/accounts.json      → string[] account names
 *   meta/cleaned-tags.json  → { [cleanedKey]: accountName }
 */

const ACCOUNTS_KEY = 'meta/accounts.json';
const TAGS_KEY = 'meta/cleaned-tags.json';
const POSTED_KEY = 'meta/cleaned-posted.json';

export function sanitizeAccountName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const name = raw
    .trim()
    .replace(/[\/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  if (!name) return null;
  return name;
}

/** Natural order so "2-…" comes before "10-…". */
export function compareAccountNames(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  const ma = sa.match(/^(\d+)/);
  const mb = sb.match(/^(\d+)/);
  if (ma && mb) {
    const na = Number(ma[1]);
    const nb = Number(mb[1]);
    if (na !== nb) return na - nb;
  } else if (ma && !mb) {
    return -1;
  } else if (!ma && mb) {
    return 1;
  }
  return sa.localeCompare(sb, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function getBucket(env) {
  return env.MEDIA_BUCKET || null;
}

async function readJson(bucket, key, fallback) {
  try {
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    const text = await obj.text();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(bucket, key, value) {
  await bucket.put(key, JSON.stringify(value, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function listAccounts(env) {
  const bucket = getBucket(env);
  if (!bucket) return [];
  const list = await readJson(bucket, ACCOUNTS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .map((n) => sanitizeAccountName(n))
    .filter(Boolean)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .sort(compareAccountNames);
}

export async function createAccount(env, nameRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const name = sanitizeAccountName(nameRaw);
  if (!name) return { ok: false, error: 'Enter a valid account name.' };
  const list = await listAccounts(env);
  if (!list.some((n) => n.toLowerCase() === name.toLowerCase())) {
    list.push(name);
    list.sort(compareAccountNames);
    await writeJson(bucket, ACCOUNTS_KEY, list);
  }
  return { ok: true, name, accounts: await listAccounts(env) };
}

/**
 * Rename an account and retarget all video tags that used the old name.
 */
export async function renameAccount(env, fromRaw, toRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const from = sanitizeAccountName(fromRaw);
  const to = sanitizeAccountName(toRaw);
  if (!from) return { ok: false, error: 'Missing current account name.' };
  if (!to) return { ok: false, error: 'Enter a valid new account name.' };

  if (from.toLowerCase() === to.toLowerCase() && from !== to) {
    // Case-only change: still rewrite stored spelling.
  } else if (from === to) {
    return { ok: true, from, to, accounts: await accountSummaries(env), renamed: 0 };
  }

  const list = await listAccounts(env);
  const fromIdx = list.findIndex((n) => n.toLowerCase() === from.toLowerCase());
  if (fromIdx < 0) {
    // Allow rename if tags exist even when registry missed the name.
    const mapProbe = await readTagsMap(env);
    const hasTags = Object.values(mapProbe).some(
      (a) => sanitizeAccountName(a)?.toLowerCase() === from.toLowerCase(),
    );
    if (!hasTags) return { ok: false, error: 'Account not found.' };
  }

  const conflict = list.find(
    (n) => n.toLowerCase() === to.toLowerCase() && n.toLowerCase() !== from.toLowerCase(),
  );
  if (conflict) {
    return { ok: false, error: `“${conflict}” already exists.` };
  }

  const nextList = list.filter((n) => n.toLowerCase() !== from.toLowerCase());
  if (!nextList.some((n) => n.toLowerCase() === to.toLowerCase())) {
    nextList.push(to);
  }
  nextList.sort(compareAccountNames);
  await writeJson(bucket, ACCOUNTS_KEY, nextList);

  const map = await readTagsMap(env);
  let renamed = 0;
  for (const [key, value] of Object.entries(map)) {
    if (sanitizeAccountName(value)?.toLowerCase() === from.toLowerCase()) {
      map[key] = to;
      renamed += 1;
    }
  }
  await writeJson(bucket, TAGS_KEY, map);

  return {
    ok: true,
    from,
    to,
    renamed,
    accounts: await accountSummaries(env),
  };
}

export async function readTagsMap(env) {
  const bucket = getBucket(env);
  if (!bucket) return {};
  const map = await readJson(bucket, TAGS_KEY, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

export async function getTagForKey(env, key) {
  if (!key) return null;
  const map = await readTagsMap(env);
  const account = sanitizeAccountName(map[key]);
  return account || null;
}

/**
 * Set or clear account tag for a cleaned/ object key.
 * @param {string|null|undefined} accountRaw — null/'' clears tag
 */
export async function setVideoAccount(env, keyRaw, accountRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const key = String(keyRaw || '').trim();
  if (!key.startsWith('cleaned/') || key.includes('..')) {
    return { ok: false, error: 'Invalid cleaned video key.' };
  }

  const clear = accountRaw == null || String(accountRaw).trim() === '';
  const account = clear ? null : sanitizeAccountName(accountRaw);
  if (!clear && !account) return { ok: false, error: 'Enter a valid account name.' };

  if (account) {
    await createAccount(env, account);
  }

  const map = await readTagsMap(env);
  if (account) map[key] = account;
  else delete map[key];
  await writeJson(bucket, TAGS_KEY, map);

  return { ok: true, key, account, tags: map };
}

export async function keysForAccount(env, accountRaw) {
  const account = sanitizeAccountName(accountRaw);
  if (!account) return [];
  const map = await readTagsMap(env);
  return Object.entries(map)
    .filter(([, a]) => sanitizeAccountName(a) === account)
    .map(([k]) => k);
}

export async function accountSummaries(env) {
  const accounts = await listAccounts(env);
  const map = await readTagsMap(env);
  const counts = {};
  for (const a of accounts) counts[a] = 0;
  for (const a of Object.values(map)) {
    const name = sanitizeAccountName(a);
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
    if (!accounts.includes(name)) accounts.push(name);
  }
  accounts.sort(compareAccountNames);
  return accounts.map((name) => ({ name, count: counts[name] || 0 }));
}

export async function readPostedMap(env) {
  const bucket = getBucket(env);
  if (!bucket) return {};
  const map = await readJson(bucket, POSTED_KEY, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

export async function isVideoPosted(env, key) {
  if (!key) return false;
  const map = await readPostedMap(env);
  const entry = map[key];
  if (!entry) return false;
  if (entry === true) return true;
  return Boolean(entry && entry.posted);
}

export async function setVideoPosted(env, keyRaw, posted) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const key = String(keyRaw || '').trim();
  if (!key.startsWith('cleaned/') || key.includes('..')) {
    return { ok: false, error: 'Invalid cleaned video key.' };
  }

  const map = await readPostedMap(env);
  const want = Boolean(posted);
  if (want) {
    map[key] = { posted: true, postedAt: new Date().toISOString() };
  } else {
    delete map[key];
  }
  await writeJson(bucket, POSTED_KEY, map);
  return {
    ok: true,
    key,
    posted: want,
    postedAt: want ? map[key].postedAt : null,
  };
}
