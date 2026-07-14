import { json, requireSession } from '../../lib/contentstation-auth.js';

/**
 * R2 media stub — not wired yet.
 * Next step: bind an R2 bucket in wrangler / Pages and implement upload/list.
 */
export async function onRequest(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  return json(
    {
      status: 'stub',
      message: 'R2 media storage is planned but not connected yet.',
      nextSteps: [
        'Create an R2 bucket in Cloudflare',
        'Bind it to Pages project mimi-pipo',
        'Set R2_* env vars (see README)',
        'Implement upload/list in this route',
      ],
    },
    501,
  );
}
