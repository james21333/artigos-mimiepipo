/**
 * Account tags for Ready For Upload.
 * Durable index in R2 — avoids re-uploading video bytes to retag.
 *
 *   meta/accounts.json      → string[] account names
 *   meta/cleaned-tags.json  → { [mediaKey]: accountName }
 *   meta/cleaned-posted.json → { [mediaKey]: { posted, postedAt } }
 *   meta/account-characters.json → {
 *     [accountName]: {
 *       defaultKey: string,
 *       history: [{ key, uploadedAt }]  // newest first, capped
 *     }
 *   }
 *
 * Tagable keys: cleaned/*, character-remix-2-og/{jobId}/final.mp4, facefusion-remix/*
 * Character images: account-characters/{slug}/… (and legacy characters/)
 */

const ACCOUNTS_KEY = 'meta/accounts.json';
const ARCHIVED_ACCOUNTS_KEY = 'meta/archived-accounts.json';
const TAGS_KEY = 'meta/cleaned-tags.json';
const POSTED_KEY = 'meta/cleaned-posted.json';
const CHARACTERS_KEY = 'meta/account-characters.json';

const REMIX2_FINAL_RE = /^character-remix-2-og\/[^/]+\/final\.mp4$/i;
const MAX_CHARACTER_HISTORY = 24;

export const ACCOUNT_CHARACTERS_PREFIX = 'account-characters/';

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

/** Keys that may be tagged for an account (cleaned + Remix 2 + FaceFusion). */
export function isTaggableMediaKey(keyRaw) {
  const key = String(keyRaw || '').trim();
  if (!key || key.includes('..')) return false;
  if (key.startsWith('cleaned/')) return true;
  if (key.startsWith('facefusion-remix/')) return true;
  return REMIX2_FINAL_RE.test(key);
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
  const archived = await archivedNameSet(env);
  return list
    .map((n) => sanitizeAccountName(n))
    .filter(Boolean)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .filter((n) => !archived.has(n.toLowerCase()))
    .sort(compareAccountNames);
}

async function readArchivedList(env) {
  const bucket = getBucket(env);
  if (!bucket) return [];
  const list = await readJson(bucket, ARCHIVED_ACCOUNTS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .map((n) => sanitizeAccountName(n))
    .filter(Boolean)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .sort(compareAccountNames);
}

async function archivedNameSet(env) {
  const list = await readArchivedList(env);
  return new Set(list.map((n) => n.toLowerCase()));
}

export async function listArchivedAccounts(env) {
  return readArchivedList(env);
}

export async function createAccount(env, nameRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const name = sanitizeAccountName(nameRaw);
  if (!name) return { ok: false, error: 'Enter a valid account name.' };
  const archived = await archivedNameSet(env);
  if (archived.has(name.toLowerCase())) {
    return {
      ok: false,
      error: `“${name}” is archived. Unarchive it from Archived accounts first.`,
    };
  }
  const raw = await readJson(bucket, ACCOUNTS_KEY, []);
  const next = Array.isArray(raw)
    ? raw.map((n) => sanitizeAccountName(n)).filter(Boolean)
    : [];
  if (!next.some((n) => n.toLowerCase() === name.toLowerCase())) {
    next.push(name);
    next.sort(compareAccountNames);
    await writeJson(bucket, ACCOUNTS_KEY, next);
  }
  return { ok: true, name, accounts: await listAccounts(env) };
}

/** Safe R2 folder segment for an account name. */
export function accountSlug(nameRaw) {
  const name = sanitizeAccountName(nameRaw);
  if (!name) return null;
  return name.replace(/[^a-zA-Z0-9._\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'account';
}

function publicUrlForKey(env, key) {
  const base = String(env?.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base || !key) return null;
  return `${base}/${key}`;
}

function downloadPathForKey(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

function isCharacterImageKey(keyRaw) {
  const key = String(keyRaw || '').trim();
  if (!key || key.includes('..')) return false;
  return (
    key.startsWith(ACCOUNT_CHARACTERS_PREFIX) ||
    key.startsWith('characters/') ||
    /^character-remix-2-og\/[^/]+\/character\.(jpg|jpeg|png|webp)$/i.test(key)
  );
}

async function readCharactersMap(env) {
  const bucket = getBucket(env);
  if (!bucket) return {};
  const map = await readJson(bucket, CHARACTERS_KEY, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

async function writeCharactersMap(env, map) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  await writeJson(bucket, CHARACTERS_KEY, map);
  return { ok: true };
}

function normalizeCharacterEntry(raw) {
  if (!raw || typeof raw !== 'object') return { defaultKey: null, history: [] };
  const history = Array.isArray(raw.history)
    ? raw.history
        .map((h) => {
          if (!h) return null;
          if (typeof h === 'string') return { key: h, uploadedAt: null };
          const key = String(h.key || '').trim();
          if (!key) return null;
          return { key, uploadedAt: h.uploadedAt || null };
        })
        .filter(Boolean)
    : [];
  const defaultKey = String(raw.defaultKey || raw.key || '').trim() || null;
  return { defaultKey, history };
}

function enrichCharacterPayload(env, account, entry) {
  const { defaultKey, history } = normalizeCharacterEntry(entry);
  const hist = [];
  const seen = new Set();
  for (const h of history) {
    if (!h.key || seen.has(h.key)) continue;
    seen.add(h.key);
    hist.push({
      key: h.key,
      uploadedAt: h.uploadedAt || null,
      downloadPath: downloadPathForKey(h.key),
      publicUrl: publicUrlForKey(env, h.key),
    });
  }
  return {
    account,
    defaultKey,
    downloadPath: defaultKey ? downloadPathForKey(defaultKey) : null,
    publicUrl: defaultKey ? publicUrlForKey(env, defaultKey) : null,
    history: hist.slice(0, MAX_CHARACTER_HISTORY),
  };
}

export async function getAccountCharacter(env, accountRaw) {
  const account = sanitizeAccountName(accountRaw);
  if (!account) return { ok: false, error: 'Enter a valid account name.' };
  const map = await readCharactersMap(env);
  // Case-insensitive lookup
  let entry = map[account];
  if (!entry) {
    const hit = Object.keys(map).find((k) => k.toLowerCase() === account.toLowerCase());
    if (hit) entry = map[hit];
  }
  return { ok: true, ...enrichCharacterPayload(env, account, entry) };
}

/**
 * Set (or clear) the default character image for an account.
 * Adds key to history (newest first). Pass empty key to clear default only.
 */
export async function setAccountCharacter(env, accountRaw, keyRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const account = sanitizeAccountName(accountRaw);
  if (!account) return { ok: false, error: 'Enter a valid account name.' };

  const clear = keyRaw == null || String(keyRaw).trim() === '';
  const key = clear ? null : String(keyRaw).trim();
  if (!clear && !isCharacterImageKey(key)) {
    return { ok: false, error: 'Invalid character image key.' };
  }

  await createAccount(env, account);

  const map = await readCharactersMap(env);
  const existingKey =
    Object.keys(map).find((k) => k.toLowerCase() === account.toLowerCase()) || account;
  const prev = normalizeCharacterEntry(map[existingKey]);

  if (clear) {
    map[account] = { defaultKey: null, history: prev.history };
    if (existingKey !== account) delete map[existingKey];
    await writeJson(bucket, CHARACTERS_KEY, map);
    return { ok: true, ...enrichCharacterPayload(env, account, map[account]) };
  }

  const uploadedAt = new Date().toISOString();
  const history = [{ key, uploadedAt }, ...prev.history.filter((h) => h.key !== key)].slice(
    0,
    MAX_CHARACTER_HISTORY,
  );
  map[account] = { defaultKey: key, history };
  if (existingKey !== account) delete map[existingKey];
  await writeJson(bucket, CHARACTERS_KEY, map);
  return { ok: true, ...enrichCharacterPayload(env, account, map[account]) };
}

export async function listAccountCharacters(env) {
  const accounts = await listAccounts(env);
  const map = await readCharactersMap(env);
  const out = {};
  for (const name of accounts) {
    const hit =
      map[name] ||
      map[Object.keys(map).find((k) => k.toLowerCase() === name.toLowerCase()) || ''];
    out[name] = enrichCharacterPayload(env, name, hit);
  }
  return out;
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
  const archived = await archivedNameSet(env);
  if (archived.has(to.toLowerCase()) && to.toLowerCase() !== from.toLowerCase()) {
    return { ok: false, error: `“${to}” is archived. Unarchive or pick another name.` };
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

  // Migrate default character + history under the new account name.
  const charMap = await readCharactersMap(env);
  const fromCharKey = Object.keys(charMap).find((k) => k.toLowerCase() === from.toLowerCase());
  if (fromCharKey) {
    const entry = charMap[fromCharKey];
    delete charMap[fromCharKey];
    const toConflict = Object.keys(charMap).find((k) => k.toLowerCase() === to.toLowerCase());
    if (toConflict) delete charMap[toConflict];
    charMap[to] = entry;
    await writeJson(bucket, CHARACTERS_KEY, charMap);
  }

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
 * Set or clear account tag for a tagable media key.
 * @param {string|null|undefined} accountRaw — null/'' clears tag
 */
export async function setVideoAccount(env, keyRaw, accountRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const key = String(keyRaw || '').trim();
  if (!isTaggableMediaKey(key)) {
    return { ok: false, error: 'Invalid video key (cleaned, Remix 2 final, or FaceFusion only).' };
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

function entryIsPosted(entry) {
  if (!entry) return false;
  if (entry === true) return true;
  return Boolean(entry && entry.posted);
}

export async function accountSummaries(env) {
  const accounts = await listAccounts(env);
  const archived = await archivedNameSet(env);
  const map = await readTagsMap(env);
  const postedMap = await readPostedMap(env);
  const charMap = await readCharactersMap(env);
  const counts = {};
  for (const a of accounts) counts[a] = 0;
  // Count only videos not marked Posted (Ready list = still left to upload).
  for (const [key, a] of Object.entries(map)) {
    const name = sanitizeAccountName(a);
    if (!name) continue;
    if (archived.has(name.toLowerCase())) continue;
    if (!accounts.some((n) => n.toLowerCase() === name.toLowerCase())) {
      accounts.push(name);
      counts[name] = counts[name] || 0;
    }
    if (entryIsPosted(postedMap[key])) continue;
    const canon = accounts.find((n) => n.toLowerCase() === name.toLowerCase()) || name;
    counts[canon] = (counts[canon] || 0) + 1;
  }
  accounts.sort(compareAccountNames);
  return accounts.map((name) => {
    const charHit =
      charMap[name] ||
      charMap[Object.keys(charMap).find((k) => k.toLowerCase() === name.toLowerCase()) || ''];
    const character = enrichCharacterPayload(env, name, charHit);
    return {
      name,
      count: counts[name] || 0,
      archived: false,
      characterKey: character.defaultKey || null,
      characterUrl: character.publicUrl || null,
      characterDownloadPath: character.downloadPath || null,
    };
  });
}

export async function archivedAccountSummaries(env) {
  const accounts = await listArchivedAccounts(env);
  const map = await readTagsMap(env);
  const postedMap = await readPostedMap(env);
  const charMap = await readCharactersMap(env);
  const counts = {};
  for (const a of accounts) counts[a] = 0;
  for (const [key, a] of Object.entries(map)) {
    const name = sanitizeAccountName(a);
    if (!name) continue;
    const canon = accounts.find((n) => n.toLowerCase() === name.toLowerCase());
    if (!canon) continue;
    if (entryIsPosted(postedMap[key])) continue;
    counts[canon] = (counts[canon] || 0) + 1;
  }
  return accounts.map((name) => {
    const charHit =
      charMap[name] ||
      charMap[Object.keys(charMap).find((k) => k.toLowerCase() === name.toLowerCase()) || ''];
    const character = enrichCharacterPayload(env, name, charHit);
    return {
      name,
      count: counts[name] || 0,
      archived: true,
      characterKey: character.defaultKey || null,
      characterUrl: character.publicUrl || null,
      characterDownloadPath: character.downloadPath || null,
    };
  });
}

/**
 * Move an active account into the archived registry (keeps tags + character).
 * Archived accounts are hidden from Autogenerate / account pickers.
 */
export async function archiveAccount(env, nameRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const name = sanitizeAccountName(nameRaw);
  if (!name) return { ok: false, error: 'Missing account name.' };

  const rawActive = await readJson(bucket, ACCOUNTS_KEY, []);
  const active = Array.isArray(rawActive)
    ? rawActive.map((n) => sanitizeAccountName(n)).filter(Boolean)
    : [];
  const idx = active.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  const archived = await readArchivedList(env);

  if (idx < 0 && !archived.some((n) => n.toLowerCase() === name.toLowerCase())) {
    // Allow archive from tag-only orphan names.
    const map = await readTagsMap(env);
    const hasTags = Object.values(map).some(
      (a) => sanitizeAccountName(a)?.toLowerCase() === name.toLowerCase(),
    );
    if (!hasTags) return { ok: false, error: 'Account not found.' };
  }

  const nextActive = active.filter((n) => n.toLowerCase() !== name.toLowerCase());
  const nextArchived = archived.filter((n) => n.toLowerCase() !== name.toLowerCase());
  nextArchived.push(name);
  nextArchived.sort(compareAccountNames);
  await writeJson(bucket, ACCOUNTS_KEY, nextActive);
  await writeJson(bucket, ARCHIVED_ACCOUNTS_KEY, nextArchived);

  return {
    ok: true,
    name,
    accounts: await accountSummaries(env),
    archivedAccounts: await archivedAccountSummaries(env),
  };
}

/** Restore an archived account to the active Ready / Autogenerate lists. */
export async function unarchiveAccount(env, nameRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const name = sanitizeAccountName(nameRaw);
  if (!name) return { ok: false, error: 'Missing account name.' };

  const archived = await readArchivedList(env);
  const hit = archived.find((n) => n.toLowerCase() === name.toLowerCase());
  if (!hit) return { ok: false, error: 'Archived account not found.' };

  const rawActive = await readJson(bucket, ACCOUNTS_KEY, []);
  const active = Array.isArray(rawActive)
    ? rawActive.map((n) => sanitizeAccountName(n)).filter(Boolean)
    : [];
  if (active.some((n) => n.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `“${name}” is already active.` };
  }

  const nextArchived = archived.filter((n) => n.toLowerCase() !== name.toLowerCase());
  active.push(hit);
  active.sort(compareAccountNames);
  await writeJson(bucket, ACCOUNTS_KEY, active);
  await writeJson(bucket, ARCHIVED_ACCOUNTS_KEY, nextArchived);

  return {
    ok: true,
    name: hit,
    accounts: await accountSummaries(env),
    archivedAccounts: await archivedAccountSummaries(env),
  };
}

/**
 * Permanently remove an account from active + archived registries.
 * Untags its videos and drops character metadata (media files stay in R2).
 */
export async function deleteAccount(env, nameRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const name = sanitizeAccountName(nameRaw);
  if (!name) return { ok: false, error: 'Missing account name.' };

  const rawActive = await readJson(bucket, ACCOUNTS_KEY, []);
  const active = Array.isArray(rawActive)
    ? rawActive.map((n) => sanitizeAccountName(n)).filter(Boolean)
    : [];
  const archived = await readArchivedList(env);
  const inActive = active.some((n) => n.toLowerCase() === name.toLowerCase());
  const inArchived = archived.some((n) => n.toLowerCase() === name.toLowerCase());

  const map = await readTagsMap(env);
  let untagged = 0;
  for (const [key, value] of Object.entries(map)) {
    if (sanitizeAccountName(value)?.toLowerCase() === name.toLowerCase()) {
      delete map[key];
      untagged += 1;
    }
  }

  if (!inActive && !inArchived && untagged === 0) {
    return { ok: false, error: 'Account not found.' };
  }

  await writeJson(
    bucket,
    ACCOUNTS_KEY,
    active.filter((n) => n.toLowerCase() !== name.toLowerCase()),
  );
  await writeJson(
    bucket,
    ARCHIVED_ACCOUNTS_KEY,
    archived.filter((n) => n.toLowerCase() !== name.toLowerCase()),
  );
  if (untagged) await writeJson(bucket, TAGS_KEY, map);

  const charMap = await readCharactersMap(env);
  const charKey = Object.keys(charMap).find((k) => k.toLowerCase() === name.toLowerCase());
  if (charKey) {
    delete charMap[charKey];
    await writeJson(bucket, CHARACTERS_KEY, charMap);
  }

  return {
    ok: true,
    name,
    untagged,
    accounts: await accountSummaries(env),
    archivedAccounts: await archivedAccountSummaries(env),
  };
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
  if (!isTaggableMediaKey(key)) {
    return { ok: false, error: 'Invalid video key (cleaned, Remix 2 final, or FaceFusion only).' };
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

/**
 * Drop account tag + posted flag for a media key (best-effort).
 * Used when an admin deletes the underlying R2 object.
 */
export async function clearMediaListMetadata(env, keyRaw) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };
  const key = String(keyRaw || '').trim();
  if (!key || key.includes('..')) return { ok: false, error: 'Invalid key.' };

  let clearedTag = false;
  let clearedPosted = false;

  const tags = await readTagsMap(env);
  if (Object.prototype.hasOwnProperty.call(tags, key)) {
    delete tags[key];
    await writeJson(bucket, TAGS_KEY, tags);
    clearedTag = true;
  }

  const posted = await readPostedMap(env);
  if (Object.prototype.hasOwnProperty.call(posted, key)) {
    delete posted[key];
    await writeJson(bucket, POSTED_KEY, posted);
    clearedPosted = true;
  }

  return { ok: true, key, clearedTag, clearedPosted };
}
