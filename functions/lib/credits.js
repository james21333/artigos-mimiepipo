/**
 * Friendly credit balances for Content Station (Josh naming).
 * cleaning*   → metadata strip account
 * videoAlter* → visual alter account
 */

import { ghostcutPost } from './ghostcut.js';
import { cloudconvertConfigured, getUserCredits } from './cloudconvert.js';

function sumVideoAlterPoints(data) {
  const assets = data?.body?.pointAssets;
  if (!Array.isArray(assets)) return null;
  let total = 0;
  let found = false;
  for (const a of assets) {
    if (a == null || a.pointBalance == null) continue;
    const n = Number(a.pointBalance);
    if (!Number.isFinite(n)) continue;
    total += n;
    found = true;
  }
  return found ? total : null;
}

export async function fetchCreditBalances(env) {
  const out = {
    cleaningCreditsLeft: null,
    videoAlterCreditsLeft: null,
    cleaningConfigured: cloudconvertConfigured(env),
    videoAlterConfigured: Boolean(env.GHOSTCUT_APP_KEY && env.GHOSTCUT_APP_SECRET),
    _ghostcut: null,
    _cloudconvert: null,
  };

  const tasks = [];

  if (out.videoAlterConfigured) {
    tasks.push(
      ghostcutPost(env, '/v-w-c/gateway/ve/point/query', {
        notZero: true,
        isValid: true,
      }).then((result) => {
        out.videoAlterCreditsLeft = sumVideoAlterPoints(result.data);
        out._ghostcut = result;
      }),
    );
  }

  if (out.cleaningConfigured) {
    tasks.push(
      getUserCredits(env).then((result) => {
        out.cleaningCreditsLeft = result.credits;
        out._cloudconvert = result;
      }),
    );
  }

  if (tasks.length) await Promise.all(tasks);
  return out;
}
