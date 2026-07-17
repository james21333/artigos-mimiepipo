/**
 * Track which pre-clean downloads (tiktok/…) produced which cleaned/ outputs.
 * Lets us delete originals later only after a cleaned copy exists.
 *
 *   meta/download-clean-map.json
 *   → {
 *       [sourceKey]: {
 *         cleanedKey, workId, account, cleanedAt
 *       }
 *     }
 */

const MAP_KEY = 'meta/download-clean-map.json';

export function sanitizeSourceKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().replace(/^\/+/, '').replace(/\\/g, '/');
  if (!key || key.includes('..')) return null;
  if (!/^(tiktok|media)\//.test(key)) return null;
  if (!/^[a-zA-Z0-9/_.\-]+$/.test(key)) return null;
  return key;
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

export async function readCleanSourceMap(env) {
  const bucket = getBucket(env);
  if (!bucket) return {};
  const map = await readJson(bucket, MAP_KEY, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

/**
 * Record that a download was cleaned into cleaned/.
 * Idempotent upsert for the source key.
 */
export async function recordCleanedSource(
  env,
  { sourceKey: sourceRaw, cleanedKey, workId, account } = {},
) {
  const bucket = getBucket(env);
  if (!bucket) return { ok: false, error: 'Storage isn’t available.' };

  const sourceKey = sanitizeSourceKey(sourceRaw);
  const cleaned = String(cleanedKey || '').trim();
  if (!sourceKey) return { ok: false, error: 'Invalid source key.' };
  if (!cleaned.startsWith('cleaned/') || cleaned.includes('..')) {
    return { ok: false, error: 'Invalid cleaned key.' };
  }

  const map = await readCleanSourceMap(env);
  map[sourceKey] = {
    cleanedKey: cleaned,
    workId: workId ? String(workId) : null,
    account: account ? String(account).slice(0, 80) : null,
    cleanedAt: new Date().toISOString(),
  };
  await writeJson(bucket, MAP_KEY, map);
  return { ok: true, sourceKey, entry: map[sourceKey], map };
}

export async function getCleanedForSource(env, sourceRaw) {
  const sourceKey = sanitizeSourceKey(sourceRaw);
  if (!sourceKey) return null;
  const map = await readCleanSourceMap(env);
  return map[sourceKey] || null;
}
