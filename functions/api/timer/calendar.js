import { json, requireRole } from '../../lib/contentstation-auth.js';

const API = 'https://www.googleapis.com/calendar/v3';
let cachedToken = null;

/* Service account with domain-wide delegation for komedy.tv; impersonates GOOGLE_CAL_SUBJECT. */
function configured(env) {
  return Boolean(env.GOOGLE_CAL_SA_EMAIL && env.GOOGLE_CAL_SA_KEY && env.GOOGLE_CAL_ID);
}
function calendarId(env) {
  return encodeURIComponent(env.GOOGLE_CAL_ID);
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

async function signJwt(env) {
  const pem = env.GOOGLE_CAL_SA_KEY.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlStr(JSON.stringify({
    iss: env.GOOGLE_CAL_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    ...(env.GOOGLE_CAL_SUBJECT ? { sub: env.GOOGLE_CAL_SUBJECT } : {}),
    iat,
    exp: iat + 3600,
  }))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

async function accessToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await signJwt(env),
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    const err = new Error('reconnect_needed');
    err.status = 502;
    throw err;
  }
  cachedToken = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function gcal(env, path, init = {}) {
  const token = await accessToken(env);
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (r.status === 204) return {};
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(r.status === 404 ? 'not_shared' : (d.error && d.error.message) || `google_${r.status}`);
    err.status = r.status === 401 || r.status === 403 ? 502 : r.status;
    throw err;
  }
  return d;
}

function slimEvent(e) {
  return {
    id: e.id,
    title: e.summary || '(no title)',
    start: e.start && (e.start.dateTime || e.start.date),
    end: e.end && (e.end.dateTime || e.end.date),
    allDay: Boolean(e.start && e.start.date && !e.start.dateTime),
    recurring: Boolean(e.recurringEventId),
    block: Boolean(e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.focusBlock),
    link: e.htmlLink || null,
  };
}

const REPEAT_RULES = {
  daily: 'RRULE:FREQ=DAILY',
  everyOtherDay: 'RRULE:FREQ=DAILY;INTERVAL=2',
  weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'RRULE:FREQ=WEEKLY',
};

export async function onRequest(context) {
  const auth = await requireRole(context, []);
  if (!auth.ok) return auth.response;
  const { env, request } = context;
  if (!configured(env)) return json({ connected: false, events: [] });

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!from || !to) return json({ error: 'from_and_to_required' }, 400);
      const q = new URLSearchParams({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '100',
      });
      const d = await gcal(env, `/calendars/${calendarId(env)}/events?${q}`);
      const events = (d.items || []).filter((e) => e.status !== 'cancelled').map(slimEvent);
      return json({ connected: true, events });
    }

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const title = String(b.title || '').trim().slice(0, 200);
      if (!title || !b.start || !b.end || !b.timeZone) return json({ error: 'title_start_end_timeZone_required' }, 400);
      if (new Date(b.end) <= new Date(b.start)) return json({ error: 'end_before_start' }, 400);
      const event = {
        summary: title,
        start: { dateTime: b.start, timeZone: b.timeZone },
        end: { dateTime: b.end, timeZone: b.timeZone },
        extendedProperties: { private: { focusBlock: '1' } },
      };
      if (REPEAT_RULES[b.repeat]) event.recurrence = [REPEAT_RULES[b.repeat]];
      const d = await gcal(env, `/calendars/${calendarId(env)}/events`, { method: 'POST', body: JSON.stringify(event) });
      return json({ ok: true, event: slimEvent(d) });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return json({ connected: true, error: err.message || 'calendar_error' }, err.status || 500);
  }
}
