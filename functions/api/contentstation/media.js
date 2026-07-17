import { json, requireSession } from '../../lib/contentstation-auth.js';
import { createR2PresignedPut, createR2PresignedGet } from '../../lib/r2-presign.js';

/**
 * R2 media API (binding: MEDIA_BUCKET → content-station-media).
 *
 * GET  ?action=list[&prefix=][&cursor=][&limit=]
 * GET  ?action=get&key=…          → stream object (auth required)
 * GET  ?action=meta&key=…         → object metadata + download URL path
 * POST multipart/form-data        → upload file (field "file", optional "key"/"prefix")
 * POST application/json           → { action: "delete"|"sign-put"|"multipart-*", … }
 * DELETE ?key=…                   → delete object
 *
 * Large files: Workers body limit (~100MB). Use action "sign-put" for a direct-to-R2
 * S3 presigned PUT, or binding multipart-init / multipart-part / multipart-complete.
 */

const MAX_LIST = 200;
const MAX_DIRECT_UPLOAD = 95 * 1024 * 1024; // stay under Workers body limit
const KEY_RE = /^[a-zA-Z0-9/_.\-]+$/;
const PREFIX_DEFAULT = 'media/';

function getBucket(env) {
  return env.MEDIA_BUCKET || null;
}

function sanitizeKey(raw, { allowTrailingSlash = false } = {}) {
  if (!raw || typeof raw !== 'string') return null;
  let key = raw.trim().replace(/^\/+/, '').replace(/\\/g, '/');
  if (!key || key.includes('..')) return null;
  if (allowTrailingSlash && key.endsWith('/')) {
    const base = key.slice(0, -1);
    if (!base || !KEY_RE.test(base)) return null;
    return `${base}/`;
  }
  if (!KEY_RE.test(key)) return null;
  return key;
}

function downloadPath(key) {
  return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
}

function publicUrl(env, key) {
  const base = (env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/${key}`;
}

function objectSummary(env, obj) {
  const key = obj.key;
  return {
    key,
    size: obj.size,
    uploaded: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
    httpEtag: obj.httpEtag || obj.etag || null,
    contentType: obj.httpMetadata?.contentType || null,
    downloadPath: downloadPath(key),
    publicUrl: publicUrl(env, key),
  };
}

/**
 * Prefer the public R2_PUBLIC_BASE_URL (durable, no expiry, works for any external
 * fetcher including GhostCut's China-side download step); otherwise fall back to a
 * long-lived S3 presigned GET.
 *
 * R2_PUBLIC_BASE_URL should be set to the bucket's r2.dev URL (enable via
 * `wrangler r2 bucket dev-url enable <bucket>`) or a custom domain attached to the
 * bucket. Without it, GhostCut can fail with DownloadFailureError on larger videos —
 * either because the presigned S3 URL's signed-query-string form isn't reachable/
 * accepted from their fetcher, or because it expires before their job queue gets to it.
 */
async function fetchableUrl(env, key) {
  const pub = publicUrl(env, key);
  if (pub) return { url: pub, kind: 'public' };
  const signed = await createR2PresignedGet(env, { key, expiresIn: 21600 });
  if (signed.ok) return { url: signed.url, kind: 'presigned-get', expiresIn: signed.expiresIn };
  return { url: null, kind: null, error: signed };
}

async function listObjects(env, bucket, url) {
  const prefix = sanitizeKey(url.searchParams.get('prefix') || PREFIX_DEFAULT, {
    allowTrailingSlash: true,
  });
  if (url.searchParams.get('prefix') && !prefix) {
    return json({ error: 'invalid_prefix' }, 400);
  }
  const limit = Math.min(
    MAX_LIST,
    Math.max(1, Number(url.searchParams.get('limit') || 50) || 50),
  );
  const cursor = url.searchParams.get('cursor') || undefined;
  const listed = await bucket.list({
    prefix: prefix || undefined,
    limit,
    cursor,
    include: ['httpMetadata', 'customMetadata'],
  });
  return json({
    status: 'ok',
    bucket: env.R2_BUCKET_NAME || 'content-station-media',
    binding: 'MEDIA_BUCKET',
    prefix: prefix || '',
    truncated: Boolean(listed.truncated),
    cursor: listed.truncated ? listed.cursor : null,
    objects: (listed.objects || []).map((o) => objectSummary(env, o)),
  });
}

async function getMeta(env, bucket, url) {
  const key = sanitizeKey(url.searchParams.get('key'));
  if (!key) return json({ error: 'invalid_key' }, 400);
  const head = await bucket.head(key);
  if (!head) return json({ error: 'not_found', key }, 404);
  const summary = objectSummary(env, head);
  const fetchable = await fetchableUrl(env, key);
  return json({
    status: 'ok',
    object: {
      ...summary,
      fetchUrl: fetchable.url || summary.publicUrl,
      fetchUrlKind: fetchable.kind,
    },
  });
}

async function streamGet(bucket, url) {
  const key = sanitizeKey(url.searchParams.get('key'));
  if (!key) return json({ error: 'invalid_key' }, 400);
  const obj = await bucket.get(key);
  if (!obj) return json({ error: 'not_found', key }, 404);
  const headers = new Headers();
  headers.set('Cache-Control', 'private, no-store');
  headers.set(
    'Content-Type',
    obj.httpMetadata?.contentType || 'application/octet-stream',
  );
  if (obj.size != null) headers.set('Content-Length', String(obj.size));
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
  const filename = key.split('/').pop() || 'file';
  headers.set('Content-Disposition', `${disposition}; filename="${filename}"`);
  return new Response(obj.body, { status: 200, headers });
}

async function deleteKey(bucket, key) {
  const safe = sanitizeKey(key);
  if (!safe) return json({ error: 'invalid_key' }, 400);
  await bucket.delete(safe);
  return json({ status: 'ok', deleted: safe });
}

async function uploadForm(env, bucket, request) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('multipart/form-data')) {
    return json(
      {
        error: 'expected_multipart',
        message: 'Upload with multipart/form-data field "file". For >95MB use multipart-init flow.',
      },
      400,
    );
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return json({ error: 'missing_file', message: 'Expected form field "file".' }, 400);
  }

  const size = file.size ?? 0;
  if (size > MAX_DIRECT_UPLOAD) {
    return json(
      {
        error: 'file_too_large',
        message: `Direct upload max is ${MAX_DIRECT_UPLOAD} bytes. Use multipart chunked upload.`,
        maxBytes: MAX_DIRECT_UPLOAD,
        size,
      },
      413,
    );
  }

  const prefixRaw = form.get('prefix');
  const keyRaw = form.get('key');
  let key;
  if (keyRaw && typeof keyRaw === 'string' && keyRaw.trim()) {
    key = sanitizeKey(keyRaw);
  } else {
    const name = (file.name || 'upload.bin').replace(/[^a-zA-Z0-9._\-]+/g, '_');
    const prefix =
      sanitizeKey(typeof prefixRaw === 'string' ? prefixRaw : PREFIX_DEFAULT, {
        allowTrailingSlash: true,
      }) || PREFIX_DEFAULT;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    key = sanitizeKey(`${prefix.replace(/\/?$/, '/')}${stamp}_${name}`);
  }
  if (!key) return json({ error: 'invalid_key' }, 400);

  const contentType = file.type || 'application/octet-stream';
  const put = await bucket.put(key, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: {
      originalName: String(file.name || ''),
      uploadedAt: new Date().toISOString(),
    },
  });

  const summary = objectSummary(env, put || { key, size, httpMetadata: { contentType } });
  const fetchable = await fetchableUrl(env, key);
  return json({
    status: 'ok',
    object: {
      ...summary,
      fetchUrl: fetchable.url || summary.publicUrl,
      fetchUrlKind: fetchable.kind,
    },
  });
}

async function handleJson(env, bucket, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const action = body.action || 'delete';

  if (action === 'delete') {
    return deleteKey(bucket, body.key);
  }

  if (action === 'sign-put') {
    let key;
    if (body.key) {
      key = sanitizeKey(body.key);
    } else {
      const name = String(body.filename || 'upload.bin').replace(/[^a-zA-Z0-9._\-]+/g, '_');
      const prefix =
        sanitizeKey(body.prefix || PREFIX_DEFAULT, { allowTrailingSlash: true }) || PREFIX_DEFAULT;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      key = sanitizeKey(`${prefix.replace(/\/?$/, '/')}${stamp}_${name}`);
    }
    if (!key) return json({ error: 'invalid_key' }, 400);
    const signed = await createR2PresignedPut(env, {
      key,
      contentType: body.contentType || 'application/octet-stream',
      expiresIn: Math.min(3600, Math.max(60, Number(body.expiresIn) || 3600)),
    });
    if (!signed.ok) return json(signed, 503);
    const fetchable = await fetchableUrl(env, key);
    return json({
      status: 'ok',
      ...signed,
      downloadPath: downloadPath(key),
      publicUrl: publicUrl(env, key),
      fetchUrl: fetchable.url || publicUrl(env, key),
      fetchUrlKind: fetchable.kind,
      note: 'PUT the file bytes directly to url with the returned headers (browser/CORS may require R2 CORS rules). After PUT, use fetchUrl (or publicUrl) for processing.',
    });
  }

  if (action === 'sign-get') {
    const key = sanitizeKey(body.key);
    if (!key) return json({ error: 'invalid_key' }, 400);
    const fetchable = await fetchableUrl(env, key);
    if (!fetchable.url) {
      return json(fetchable.error || { error: 'sign_get_failed', message: 'Could not create fetch URL.' }, 503);
    }
    return json({
      status: 'ok',
      key,
      fetchUrl: fetchable.url,
      fetchUrlKind: fetchable.kind,
      expiresIn: fetchable.expiresIn || null,
      publicUrl: publicUrl(env, key),
    });
  }

  if (action === 'multipart-init') {
    const key = sanitizeKey(body.key);
    if (!key) return json({ error: 'invalid_key' }, 400);
    const contentType = body.contentType || 'application/octet-stream';
    const multipart = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType },
      customMetadata: {
        originalName: String(body.originalName || ''),
        uploadedAt: new Date().toISOString(),
      },
    });
    return json({
      status: 'ok',
      key: multipart.key,
      uploadId: multipart.uploadId,
    });
  }

  if (action === 'multipart-complete') {
    const key = sanitizeKey(body.key);
    const uploadId = body.uploadId;
    const parts = body.parts;
    if (!key || !uploadId || !Array.isArray(parts) || !parts.length) {
      return json({ error: 'invalid_multipart_complete' }, 400);
    }
    const multipart = bucket.resumeMultipartUpload(key, uploadId);
    const obj = await multipart.complete(
      parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
    );
    return json({ status: 'ok', object: objectSummary(env, obj) });
  }

  if (action === 'multipart-abort') {
    const key = sanitizeKey(body.key);
    const uploadId = body.uploadId;
    if (!key || !uploadId) return json({ error: 'invalid_multipart_abort' }, 400);
    const multipart = bucket.resumeMultipartUpload(key, uploadId);
    await multipart.abort();
    return json({ status: 'ok', aborted: true, key, uploadId });
  }

  return json({ error: 'unknown_action', action }, 400);
}

async function uploadPart(bucket, request, url) {
  const key = sanitizeKey(url.searchParams.get('key') || '');
  const uploadId = url.searchParams.get('uploadId');
  const partNumber = Number(url.searchParams.get('partNumber'));
  if (!key || !uploadId || !Number.isFinite(partNumber) || partNumber < 1) {
    return json({ error: 'invalid_multipart_part' }, 400);
  }
  const multipart = bucket.resumeMultipartUpload(key, uploadId);
  const part = await multipart.uploadPart(partNumber, request.body);
  return json({ status: 'ok', partNumber: part.partNumber, etag: part.etag });
}

export async function onRequest(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  const bucket = getBucket(context.env);
  if (!bucket) {
    return json(
      {
        status: 'unconfigured',
        message:
          'R2 binding MEDIA_BUCKET is missing. Enable R2 in Cloudflare Dashboard, create bucket content-station-media, and deploy wrangler.toml with [[r2_buckets]].',
        binding: 'MEDIA_BUCKET',
        bucketName: 'content-station-media',
      },
      503,
    );
  }

  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const action = url.searchParams.get('action') || '';

  try {
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    if (method === 'GET' || method === 'HEAD') {
      if (action === 'get') return streamGet(bucket, url);
      if (action === 'meta') return getMeta(env, bucket, url);
      return listObjects(env, bucket, url);
    }

    if (method === 'DELETE') {
      return deleteKey(bucket, url.searchParams.get('key'));
    }

    if (method === 'PUT' && action === 'multipart-part') {
      return uploadPart(bucket, request, url);
    }

    if (method === 'POST') {
      const ct = request.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        return handleJson(env, bucket, request);
      }
      return uploadForm(env, bucket, request);
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return json({ error: 'media_error', message }, 500);
  }
}
