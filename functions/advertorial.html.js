import { renderAdvertorial } from './lib/advertorial-config.js';

async function serveAdvertorial(context) {
  const templateRes = await context.env.ASSETS.fetch(
    new URL('/advertorial.template.html', context.request.url),
  );
  if (!templateRes.ok) {
    return new Response('Advertorial template missing.', { status: 500 });
  }
  const template = await templateRes.text();
  const url = new URL(context.request.url);
  const html = renderAdvertorial(template, url.searchParams);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function onRequestGet(context) {
  return serveAdvertorial(context);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (context.request.method === 'HEAD') {
    const res = await serveAdvertorial(context);
    return new Response(null, {
      status: res.status,
      headers: res.headers,
    });
  }
  return serveAdvertorial(context);
}
