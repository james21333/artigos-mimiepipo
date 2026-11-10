/** Default TikTok URL list cap (seconds). */
export const MAX_LIST_VIDEO_SEC = 30;

/** Optional “allow longer” cap when adding to lists. */
export const MAX_LIST_VIDEO_SEC_LONG = 120;

/** Optional mid-range filter: 55s–1:30. */
export const MID_RANGE_MIN_SEC = 55;
export const MID_RANGE_MAX_SEC = 90;

/**
 * TikTok `duration` is seconds. Some payloads use milliseconds (>= 10000).
 * Returns seconds, or null when missing.
 */
export function parseTikTokDurationSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 10000) return n / 1000;
  return n;
}

/**
 * durationMode:
 *   default   → reject > 30s
 *   long120   → reject > 120s (up to 2 minutes)
 *   mid55_90  → only keep 55s–90s inclusive
 */
export function normalizeListDurationMode(raw) {
  const m = String(raw || '')
    .trim()
    .toLowerCase();
  if (m === 'long120' || m === 'long' || m === 'allow_long') return 'long120';
  if (m === 'mid55_90' || m === 'mid' || m === '55_90') return 'mid55_90';
  return 'default';
}

export function listDurationLimits(mode) {
  const m = normalizeListDurationMode(mode);
  if (m === 'mid55_90') {
    return { mode: m, minSec: MID_RANGE_MIN_SEC, maxSec: MID_RANGE_MAX_SEC };
  }
  if (m === 'long120') {
    return { mode: m, minSec: null, maxSec: MAX_LIST_VIDEO_SEC_LONG };
  }
  return { mode: 'default', minSec: null, maxSec: MAX_LIST_VIDEO_SEC };
}

/**
 * @returns {null | { reason: string, minSec?: number, maxSec?: number }}
 * null → accept (including unknown duration)
 */
export function listDurationRejectInfo(raw, mode = 'default') {
  const sec = parseTikTokDurationSec(raw);
  if (sec == null) return null;
  const limits = listDurationLimits(mode);
  if (limits.mode === 'mid55_90') {
    if (sec < limits.minSec || sec > limits.maxSec) {
      return { reason: 'out_of_range', minSec: limits.minSec, maxSec: limits.maxSec, durationSec: sec };
    }
    return null;
  }
  if (sec > limits.maxSec) {
    return { reason: 'too_long', maxSec: limits.maxSec, durationSec: sec };
  }
  return null;
}

export function isOverMaxListDuration(raw, mode = 'default') {
  return listDurationRejectInfo(raw, mode) != null;
}
