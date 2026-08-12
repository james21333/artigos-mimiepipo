/**
 * Named TikTok URL lists for autogenerate + per-account leftover tracking.
 * Default list: "GLP-1 List" (seeded with the original 66).
 *
 *   meta/tiktok-url-lists.json
 */

import { extractTikTokVideoId } from './tiktok-download-seen.js';
import { GLP1_SEED_URLS } from './tiktok-url-list-seed.js';

const LISTS_KEY = 'meta/tiktok-url-lists.json';
export const DEFAULT_LIST_ID = 'glp-1';
export const DEFAULT_LIST_NAME = 'GLP-1 List';

function slugifyListName(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || null;
}

function normalizeItem(urlRaw, extra = {}) {
  const url = String(urlRaw || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (!/tiktok\.com/i.test(url)) return null;
  const tiktokId = extractTikTokVideoId(url) || extra.tiktokId || null;
  return {
    url,
    tiktokId: tiktokId ? String(tiktokId).replace(/[^\d]/g, '') : null,
    addedAt: extra.addedAt || new Date().toISOString(),
    addedFrom: extra.addedFrom ? String(extra.addedFrom).slice(0, 40) : '',
  };
}

function itemKey(item) {
  const id = String(item?.tiktokId || '').replace(/[^\d]/g, '');
  if (id) return `id:${id}`;
  return `url:${String(item?.url || '').trim()}`;
}

async function readStore(bucket) {
  try {
    const obj = await bucket.get(LISTS_KEY);
    if (!obj) return { lists: [] };
    const data = JSON.parse(await obj.text());
    if (!data || typeof data !== 'object') return { lists: [] };
    return { lists: Array.isArray(data.lists) ? data.lists : [] };
  } catch {
    return { lists: [] };
  }
}

async function writeStore(bucket, store) {
  await bucket.put(LISTS_KEY, JSON.stringify(store, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

function summarizeList(list) {
  return {
    id: list.id,
    name: list.name,
    count: Array.isArray(list.items) ? list.items.length : 0,
  };
}

function seedGlp1() {
  const now = '2026-08-12T00:00:00.000Z';
  const items = [];
  const seen = new Set();
  for (const url of GLP1_SEED_URLS) {
    const item = normalizeItem(url, { addedAt: now, addedFrom: 'seed' });
    if (!item) continue;
    const k = itemKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(item);
  }
  return {
    id: DEFAULT_LIST_ID,
    name: DEFAULT_LIST_NAME,
    createdAt: now,
    items,
  };
}

export async function ensureUrlLists(env) {
  const bucket = env?.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'no_bucket', lists: [] };
  const store = await readStore(bucket);
  let changed = false;
  if (!store.lists.some((l) => l.id === DEFAULT_LIST_ID)) {
    store.lists.unshift(seedGlp1());
    changed = true;
  } else {
    const glp = store.lists.find((l) => l.id === DEFAULT_LIST_ID);
    if (glp && (!Array.isArray(glp.items) || glp.items.length === 0)) {
      const seeded = seedGlp1();
      glp.items = seeded.items;
      glp.name = glp.name || DEFAULT_LIST_NAME;
      changed = true;
    }
  }
  if (changed) await writeStore(bucket, store);
  return { ok: true, lists: store.lists };
}

export async function listUrlLists(env) {
  const ensured = await ensureUrlLists(env);
  if (!ensured.ok) return ensured;
  return {
    ok: true,
    defaultListId: DEFAULT_LIST_ID,
    lists: ensured.lists.map(summarizeList),
  };
}

export async function getUrlList(env, listIdRaw) {
  const ensured = await ensureUrlLists(env);
  if (!ensured.ok) return { ok: false, error: ensured.error };
  const id = String(listIdRaw || DEFAULT_LIST_ID).trim() || DEFAULT_LIST_ID;
  const list = ensured.lists.find((l) => l.id === id) || null;
  if (!list) return { ok: false, error: 'list_not_found' };
  return { ok: true, list };
}

export async function createUrlList(env, nameRaw) {
  const bucket = env?.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'no_bucket' };
  const name = String(nameRaw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  if (!name) return { ok: false, error: 'missing_name', message: 'Enter a list name.' };
  const ensured = await ensureUrlLists(env);
  if (!ensured.ok) return ensured;
  let id = slugifyListName(name);
  if (!id) return { ok: false, error: 'bad_name' };
  if (ensured.lists.some((l) => l.id === id)) {
    id = `${id}-${Date.now().toString(36).slice(-4)}`;
  }
  const list = {
    id,
    name,
    createdAt: new Date().toISOString(),
    items: [],
  };
  const next = { lists: [...ensured.lists, list] };
  await writeStore(bucket, next);
  return { ok: true, list: summarizeList(list), lists: next.lists.map(summarizeList) };
}

export async function addUrlsToList(env, listIdRaw, urls, { addedFrom, tiktokId } = {}) {
  const bucket = env?.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'no_bucket' };
  const ensured = await ensureUrlLists(env);
  if (!ensured.ok) return ensured;
  const id = String(listIdRaw || DEFAULT_LIST_ID).trim() || DEFAULT_LIST_ID;
  const list = ensured.lists.find((l) => l.id === id);
  if (!list) return { ok: false, error: 'list_not_found' };
  if (!Array.isArray(list.items)) list.items = [];
  const seen = new Set(list.items.map(itemKey));
  const incoming = Array.isArray(urls) ? urls : [urls];
  let added = 0;
  for (const raw of incoming) {
    const item = normalizeItem(raw, {
      addedFrom,
      tiktokId: tiktokId || undefined,
    });
    if (!item) continue;
    const k = itemKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    list.items.push(item);
    added += 1;
  }
  if (added) await writeStore(bucket, { lists: ensured.lists });
  return {
    ok: true,
    listId: list.id,
    added,
    count: list.items.length,
    lists: ensured.lists.map(summarizeList),
  };
}
