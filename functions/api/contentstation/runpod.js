import { json, requireSession } from '../../lib/contentstation-auth.js';

/**
 * RunPod Serverless proxy (session required).
 *
 * Auth: Authorization: Bearer RUNPOD_API_KEY
 * Base: https://api.runpod.ai/v2/{endpointId}/…
 *
 * GET  ?action=config
 * GET  ?action=health[&endpointId=]
 * GET  ?action=status&jobId=…[&endpointId=]
 * POST { action: "run"|"runsync"|"cancel"|"purge-queue", endpointId?, input?, jobId? }
 */

const RUNPOD_BASE = 'https://api.runpod.ai/v2';

function endpointId(env, override) {
  const id = (override || env.RUNPOD_ENDPOINT_ID || '').trim();
  return id || null;
}

function configured(env) {
  return Boolean(env.RUNPOD_API_KEY);
}

async function runpodFetch(env, path, { method = 'GET', body } = {}) {
  const key = env.RUNPOD_API_KEY;
  if (!key) {
    return {
      ok: false,
      status: 503,
      data: {
        status: 'unconfigured',
        message:
          'RUNPOD_API_KEY is not set. Add it to secrets/.env and run scripts/set-cloudflare-pages-secrets.sh',
      },
    };
  }

  const url = `${RUNPOD_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function configPayload(env) {
  return {
    status: configured(env) ? 'ok' : 'unconfigured',
    configured: configured(env),
    hasEndpointId: Boolean(env.RUNPOD_ENDPOINT_ID),
    endpointId: env.RUNPOD_ENDPOINT_ID ? String(env.RUNPOD_ENDPOINT_ID) : null,
    templateId: env.RUNPOD_TEMPLATE_ID ? String(env.RUNPOD_TEMPLATE_ID) : null,
    apiBase: RUNPOD_BASE,
    message: configured(env)
      ? 'RunPod API key present. Use health / run / status.'
      : 'Set RUNPOD_API_KEY (and optionally RUNPOD_ENDPOINT_ID) in secrets/.env, then re-run set-cloudflare-pages-secrets.sh.',
  };
}

export async function onRequest(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

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
    const action = url.searchParams.get('action') || 'config';

    if (action === 'config') {
      return json(configPayload(env), configured(env) ? 200 : 503);
    }

    if (!configured(env)) {
      return json(configPayload(env), 503);
    }

    const ep = endpointId(env, url.searchParams.get('endpointId'));
    if (!ep) {
      return json(
        {
          error: 'missing_endpoint',
          message: 'Provide endpointId query param or set RUNPOD_ENDPOINT_ID.',
        },
        400,
      );
    }

    if (action === 'health') {
      const result = await runpodFetch(env, `/${ep}/health`);
      return json(result.data, result.ok ? 200 : result.status || 502);
    }

    if (action === 'status') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'missing_jobId' }, 400);
      const result = await runpodFetch(env, `/${ep}/status/${encodeURIComponent(jobId)}`);
      return json(result.data, result.ok ? 200 : result.status || 502);
    }

    return json({ error: 'unknown_action', action }, 400);
  }

  if (method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (!configured(env)) {
    return json(configPayload(env), 503);
  }

  let body = {};
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
  }

  const action = body.action || 'run';
  const ep = endpointId(env, body.endpointId);
  if (!ep) {
    return json(
      {
        error: 'missing_endpoint',
        message: 'Provide endpointId in body or set RUNPOD_ENDPOINT_ID.',
      },
      400,
    );
  }

  if (action === 'run' || action === 'runsync') {
    const input = body.input;
    if (input === undefined) {
      return json({ error: 'missing_input', message: 'Body must include input object.' }, 400);
    }
    const payload = { input };
    if (body.webhook) payload.webhook = body.webhook;
    if (body.policy) payload.policy = body.policy;
    const result = await runpodFetch(env, `/${ep}/${action}`, {
      method: 'POST',
      body: payload,
    });
    return json(result.data, result.ok ? 200 : result.status || 502);
  }

  if (action === 'cancel') {
    const jobId = body.jobId;
    if (!jobId) return json({ error: 'missing_jobId' }, 400);
    const result = await runpodFetch(env, `/${ep}/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      body: {},
    });
    return json(result.data, result.ok ? 200 : result.status || 502);
  }

  if (action === 'purge-queue') {
    const result = await runpodFetch(env, `/${ep}/purge-queue`, {
      method: 'POST',
      body: {},
    });
    return json(result.data, result.ok ? 200 : result.status || 502);
  }

  return json({ error: 'unknown_action', action }, 400);
}
