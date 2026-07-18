/**
 * Restore non-speech on-screen hooks/text after character remix.
 *
 * GhostCut OCR/ASR/burn are long-running — the browser drives those via the
 * GhostCut proxy. This module only does the short sync pieces:
 *   - build OCR / ASR / burn payloads
 *   - filter OCR − ASR → non-speech SRT
 *   - upload filtered SRT to R2 for GhostCut burn
 */

import { publicMediaUrl } from './character-remix.js';

export function ocrExtractPayload(videoUrl) {
  const masks = [
    {
      type: 'remove_only_ocr',
      start: 0,
      end: 99999,
      region: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
  ];
  const extra = {
    extra_inpaint_config: {
      auto_correct_on: false,
      strip_last_punct_on: false,
      // Keep scene/hook text (titles, stickers).
      scene_filter_on: false,
    },
  };
  return {
    urls: [videoUrl],
    needChineseOcclude: 14,
    videoInpaintLang: 'auto',
    lang: 'auto',
    videoInpaintMasks: JSON.stringify(masks),
    extraOptions: JSON.stringify(extra),
  };
}

export function asrExtractPayload(videoUrl, sourceLang = 'en') {
  return {
    urls: [videoUrl],
    needWanyin: 1,
    wyTaskType: 'ONLY_ASR',
    wyNeedText: 0,
    sourceLang,
  };
}

export function burnHooksPayload(videoUrl, srtUrl, lang = 'en') {
  const fontParam = {
    font_param: {
      style: 'tpl-31-1-T',
      font_size: 36,
      position: 0.22,
      subtitleLang: lang,
    },
  };
  return {
    urls: [videoUrl],
    sourceLang: lang,
    lang,
    needWanyin: 1,
    wyTaskType: 'NO_TTS',
    wyNeedText: 1,
    removeBgAudio: 0,
    wyVoiceParam: JSON.stringify(fontParam),
    extraOptions: JSON.stringify({
      customer_input_srt: {
        source: srtUrl,
        translation: srtUrl,
      },
    }),
  };
}

function normalizeCueText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSrt(text) {
  const blocks = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n\r?\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let i = 0;
    if (/^\d+$/.test(lines[0] || '')) i = 1;
    const timing = lines[i] || '';
    const m = timing.match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );
    if (!m) continue;
    const body = lines.slice(i + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start: m[1].replace('.', ','), end: m[2].replace('.', ','), text: body });
  }
  return cues;
}

function formatSrt(cues) {
  return cues
    .map((c, idx) => `${idx + 1}\n${c.start} --> ${c.end}\n${c.text}\n`)
    .join('\n');
}

function cueOverlapsSpeech(ocrCue, speechNorms) {
  const o = normalizeCueText(ocrCue.text);
  if (!o || o.length < 2) return true;
  for (const s of speechNorms) {
    if (!s) continue;
    if (o === s) return true;
    if (o.length >= 4 && s.includes(o)) return true;
    if (s.length >= 4 && o.includes(s)) return true;
    const ot = new Set(o.split(' ').filter((t) => t.length > 2));
    const st = new Set(s.split(' ').filter((t) => t.length > 2));
    if (!ot.size || !st.size) continue;
    let hit = 0;
    for (const t of ot) if (st.has(t)) hit += 1;
    if (hit / ot.size >= 0.7) return true;
  }
  return false;
}

/** Drop OCR lines that match ASR speech; keep hooks / titles / stickers. */
export function filterNonSpeechCues(ocrSrtText, asrSrtText) {
  const ocr = parseSrt(ocrSrtText);
  if (!ocr.length) return { cues: [], srt: '' };
  const speechNorms = parseSrt(asrSrtText).map((c) => normalizeCueText(c.text));
  const kept = speechNorms.length
    ? ocr.filter((c) => !cueOverlapsSpeech(c, speechNorms))
    : ocr;
  return { cues: kept, srt: formatSrt(kept) };
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
  return res.text();
}

/**
 * Fetch OCR (+ optional ASR) SRTs, filter, upload filtered SRT to R2.
 * Short-lived — safe for Cloudflare Pages Functions.
 */
export async function prepareHooksSrt(env, {
  ocrSrtUrl,
  asrSrtUrl = null,
  runId = 'hooks',
} = {}) {
  if (!ocrSrtUrl) return { ok: false, error: 'missing_ocr_srt_url' };
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };

  let ocrSrtText;
  try {
    ocrSrtText = await fetchText(ocrSrtUrl);
  } catch (err) {
    return { ok: false, error: err?.message || 'ocr_download_failed' };
  }

  let asrSrtText = '';
  if (asrSrtUrl) {
    try {
      asrSrtText = await fetchText(asrSrtUrl);
    } catch {
      asrSrtText = '';
    }
  }

  const filtered = filterNonSpeechCues(ocrSrtText, asrSrtText);
  if (!filtered.cues.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_non_speech_text',
      cueCount: 0,
    };
  }

  const srtKey = `character-remix/hooks/${Date.now()}_${String(runId).replace(/[^\w.-]+/g, '_').slice(0, 40)}.srt`;
  await bucket.put(srtKey, filtered.srt, {
    httpMetadata: { contentType: 'application/x-subrip; charset=utf-8' },
  });
  const url = publicMediaUrl(env, srtKey);
  if (!url) {
    return { ok: false, error: 'R2_PUBLIC_BASE_URL required for GhostCut SRT URL' };
  }
  return {
    ok: true,
    skipped: false,
    cueCount: filtered.cues.length,
    srtKey,
    srtUrl: url,
    mode: 'ghostcut_ocr_minus_asr_burn',
  };
}
