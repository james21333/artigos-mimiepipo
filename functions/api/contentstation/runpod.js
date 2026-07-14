import { json, requireSession } from '../../lib/contentstation-auth.js';

/** RunPod placeholder — deferred while RunPod site is down. */
export async function onRequest(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;

  return json(
    {
      status: 'coming_next',
      message: 'RunPod integration is deferred. Placeholder only.',
    },
    501,
  );
}
