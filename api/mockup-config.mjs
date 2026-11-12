// GET /api/mockup-config
// Login required. Tells the phone whether Night mockup can run.
// Does not return the webhook URL or any secret.

import { json, requireUser } from './_auth.mjs';

function configured() {
  return !!(process.env.MOCKUP_WEBHOOK_URL || '').trim();
}

async function handleGet(request) {
  const auth = await requireUser(request);
  if (!auth.user) return auth.response;
  return json(200, { webhookConfigured: configured() });
}

export async function GET(request) {
  return handleGet(request);
}

export default {
  async fetch(request) {
    if (!request || request.method !== 'GET') return json(405, { error: 'GET only' }, { Allow: 'GET' });
    return handleGet(request);
  }
};
