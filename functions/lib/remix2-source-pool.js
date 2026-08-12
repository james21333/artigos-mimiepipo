/**
 * Autogenerate pool: one shared named URL list, leftovers per account
 * (list item not yet remixed for that account).
 */

import {
  compareAccountNames,
  listAccountCharacters,
  listAccounts,
  sanitizeAccountName,
} from './account-tags.js';
import {
  DEFAULT_LIST_ID,
  getUrlList,
} from './tiktok-url-lists.js';
import {
  ensureRemixUsedIndex,
  extractTikTokVideoId,
  listRemixUsedIds,
} from './remix2-account-used.js';

export async function listRemixSourcePools(env, listIdRaw) {
  const bucket = env?.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'no_bucket', accounts: [] };

  const listRes = await getUrlList(env, listIdRaw || DEFAULT_LIST_ID);
  if (!listRes.ok) {
    return { ok: false, error: listRes.error || 'list_not_found', accounts: [] };
  }
  const list = listRes.list;
  const items = Array.isArray(list.items) ? list.items : [];

  const names = await listAccounts(env);
  const characters = await listAccountCharacters(env);
  const out = [];

  for (const name of names) {
    const account = sanitizeAccountName(name);
    if (!account) continue;
    await ensureRemixUsedIndex(env, account);
    const usedIds = await listRemixUsedIds(env, account);
    const leftover = [];
    const remixed = [];
    for (const item of items) {
      const id =
        String(item.tiktokId || '').replace(/[^\d]/g, '') || extractTikTokVideoId(item.url);
      const rec = { url: item.url, tiktokId: id || null };
      if (id && usedIds.has(id)) remixed.push(rec);
      else leftover.push(rec);
    }
    const char = characters[account] || {};
    out.push({
      account,
      characterKey: char.defaultKey || null,
      characterUrl: char.publicUrl || char.downloadPath || null,
      poolCount: items.length,
      leftoverCount: leftover.length,
      remixedCount: remixed.length,
      leftover,
      remixed,
    });
  }

  out.sort((a, b) => compareAccountNames(a.account, b.account));
  return {
    ok: true,
    listId: list.id,
    listName: list.name,
    listCount: items.length,
    accounts: out,
  };
}
