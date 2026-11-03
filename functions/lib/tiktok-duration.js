/** TikTok URL lists only keep clips of this length or shorter. */
export const MAX_LIST_VIDEO_SEC = 30;

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

export function isOverMaxListDuration(raw) {
  const sec = parseTikTokDurationSec(raw);
  return sec != null && sec > MAX_LIST_VIDEO_SEC;
}
