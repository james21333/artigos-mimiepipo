/**
 * Stitch Creator — TikTok (light GhostCut remix) on top + Stitch Maker B-roll on bottom.
 *
 * Layout: 1080×1920. Top 75% = cleaned TikTok. Bottom 25% = stitch clip from a random
 * start offset; loops from the beginning if the stitch clip runs out.
 *
 * GET  ?action=list[&limit=][&account=]
 * POST { action: "compose", topKey, bottomKey, account?, tiktokUrl?, title? }
 *   → Fast Panda ffmpeg compose (no AI auth)
 */
import { json, requireRole, ROLES, mediaKeyAllowed } from '../../lib/contentstation-auth.js';
import { remix2R2Payload, remix2WorkerConfigured, workerFetch } from '../../lib/character-remix-2-og.js';
import { sanitizeAccountName } from '../../lib/account-tags.js';

const PREFIX = 'stitch-creator/';

function downloadPath(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

function publicUrl(env, key) {
  const base = (env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/${key}` : null;
}

function newJobId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function listCreatorFinals(env, { limit = 50, account = '' } = {}) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return { ok: false, error: 'MEDIA_BUCKET not bound' };
  const wantLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const wantAccount = String(account || '').trim();
  const objects = [];
  let cursor;
  for (let round = 0; round < 30 && objects.length < wantLimit; round += 1) {
    const listed = await bucket.list({
      prefix: PREFIX,
      delimiter: '/',
      limit: 100,
      cursor,
    });
    for (const folder of listed.delimitedPrefixes || []) {
      if (objects.length >= wantLimit) break;
      const m = /^stitch-creator\/([^/]+)\/$/.exec(folder);
      if (!m) continue;
      const jobId = m[1];
      const key = `${PREFIX}${jobId}/final.mp4`;
      let head;
      try {
        head = await bucket.head(key);
      } catch {
        head = null;
      }
      if (!head) continue;
      let meta = { ...(head.customMetadata || {}) };
      let uploaded = head.uploaded ? new Date(head.uploaded).toISOString() : null;
      try {
        const side = await bucket.get(`${PREFIX}${jobId}/meta.json`);
        if (side) {
          const jsonBody = JSON.parse(await side.text());
          if (jsonBody && typeof jsonBody === 'object') {
            meta = { ...meta, ...jsonBody };
            if (jsonBody.uploadedAt) uploaded = String(jsonBody.uploadedAt);
          }
        }
      } catch {
        /* ignore */
      }
      const acct = String(meta.account || '').trim() || null;
      if (wantAccount && acct !== wantAccount) continue;
      objects.push({
        key,
        jobId,
        size: head.size ?? null,
        uploaded,
        downloadPath: downloadPath(key),
        publicUrl: publicUrl(env, key),
        account: acct,
        title: meta.title || null,
        tiktokUrl: meta.tiktokUrl || null,
        bottomKey: meta.bottomKey || null,
        topKey: meta.topKey || null,
        stitchStartSec: meta.stitchStartSec ?? null,
      });
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  objects.sort((a, b) => {
    const ta = a.uploaded ? Date.parse(a.uploaded) : 0;
    const tb = b.uploaded ? Date.parse(b.uploaded) : 0;
    return tb - ta || String(b.key).localeCompare(String(a.key));
  });
  return { ok: true, objects };
}

export async function onRequest(context) {
  const auth = await requireRole(context, [ROLES.KENNETH]);
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  if (method === 'GET' || method === 'HEAD') {
    const action = url.searchParams.get('action') || 'list';
    if (action === 'list') {
      const result = await listCreatorFinals(env, {
        limit: url.searchParams.get('limit') || 50,
        account: url.searchParams.get('account') || '',
      });
      if (!result.ok) return json({ ok: false, error: result.error }, 503);
      return json({ ok: true, ...result });
    }
    return json({ error: 'unknown_action' }, 400);
  }

  if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const action = body.action || 'compose';
  if (action !== 'compose') return json({ error: 'unknown_action' }, 400);

  if (!remix2WorkerConfigured(env)) {
    return json({ ok: false, error: 'remix2_unconfigured', message: 'Compose worker isn’t configured.' }, 503);
  }

  const topKey = String(body.topKey || '').trim();
  const bottomKey = String(body.bottomKey || '').trim();
  if (!topKey || !bottomKey) {
    return json({ ok: false, error: 'missing_keys', message: 'topKey and bottomKey required.' }, 400);
  }
  if (!mediaKeyAllowed(auth.role, topKey) || !mediaKeyAllowed(auth.role, bottomKey)) {
    return json({ ok: false, error: 'forbidden', message: 'Media key not allowed for this role.' }, 403);
  }

  const account = sanitizeAccountName(body.account) || null;
  const jobId = newJobId();
  const outputKey = `${PREFIX}${jobId}/final.mp4`;
  const r2 = remix2R2Payload(env);

  const result = await workerFetch(env, '/stitch-compose', {
    method: 'POST',
    body: {
      topKey,
      bottomKey,
      outputKey,
      r2,
      account: account || undefined,
      tiktokUrl: body.tiktokUrl || undefined,
      title: body.title || undefined,
      jobId,
    },
    timeoutMs: 300000,
  });

  if (!result.ok) {
    return json(
      {
        ok: false,
        error: result.data?.error || 'compose_failed',
        message:
          result.data?.detail ||
          result.data?.message ||
          `Compose failed (HTTP ${result.status}).`,
        jobId,
      },
      result.status && result.status >= 400 ? result.status : 502,
    );
  }

  const data = result.data || {};
  return json({
    ok: true,
    jobId: data.jobId || jobId,
    key: data.outputKey || outputKey,
    downloadPath: downloadPath(data.outputKey || outputKey),
    publicUrl: publicUrl(env, data.outputKey || outputKey),
    account,
    stitchStartSec: data.stitchStartSec ?? null,
    durationSec: data.durationSec ?? null,
    message: data.message || 'Stitch creator final ready.',
  });
}
