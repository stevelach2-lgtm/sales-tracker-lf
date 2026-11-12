// POST /api/mockup-upload
// Shared secret (MOCKUP_UPLOAD_SECRET), not a user login.
// See api/mockup-shared.mjs for the JSON body.
// Stores the after image in the private mockups bucket and sets the lead status.
// Needs SUPABASE_SERVICE_ROLE_KEY. If that or the secret is missing, responds
// 503 with a plain message instead of writing anything.

import { json, isUuid, secretOk, serviceKey, rest, v2 } from './mockup-shared.mjs';

function cleanStatus(value) {
  if (value == null || String(value).trim() === '') return '';
  return String(value).trim();
}

async function handlePost(request) {
  if (!(process.env.MOCKUP_UPLOAD_SECRET || '').trim() || !serviceKey()) {
    return json(503, { error: 'Not set up yet' });
  }
  if (!secretOk(request)) return json(401, { error: 'Unauthorized' });
  let body = {};
  try { body = await request.json(); } catch (error) { return json(400, { error: 'JSON body required' }); }
  const leadId = body.lead_id || body.leadId;
  const status = cleanStatus(body.status);
  const decision = v2.applyMockupUpload({
    secretOk: true,
    leadId: isUuid(leadId) ? leadId : '',
    status: status,
    hasImage: !!(body.image_base64 || body.imageBase64),
    error: body.error || body.reason || ''
  });
  if (decision.http !== 200) return json(decision.http, { error: decision.error });
  const imageB64 = body.image_base64 || body.imageBase64 || '';
  if (decision.status === 'ready' && v2.mockupImageTooLarge(imageB64)) {
    return json(413, { error: 'Image must be under 3 MB' });
  }

  const key = serviceKey();
  const leadRes = await rest('/rest/v1/leads?id=eq.' + leadId + '&select=id,user_id', {
    token: key,
    apikey: key
  });
  const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : null;
  if (!leadRes.ok || !lead || !lead.user_id) return json(404, { error: 'Lead not found' });

  let afterPath = null;
  if (decision.status === 'ready') {
    const contentType = body.content_type === 'image/png' ? 'image/png' : 'image/jpeg';
    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    let bytes;
    try {
      bytes = Buffer.from(String(imageB64), 'base64');
    } catch (error) {
      return json(400, { error: 'image_base64 is not valid' });
    }
    if (!bytes.length || bytes.length > v2.MOCKUP_IMAGE_MAX_BYTES) {
      return json(413, { error: 'Image must be under 3 MB' });
    }
    afterPath = lead.user_id + '/' + leadId + '/after.' + ext;
    const upload = await rest('/storage/v1/object/mockups/' + afterPath.split('/').map(encodeURIComponent).join('/'), {
      method: 'POST',
      token: key,
      apikey: key,
      headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
      body: bytes
    });
    if (!upload.ok) return json(502, { error: 'Could not store the image' });
  }

  const now = new Date().toISOString();
  const leadPatch = { mockup_status: decision.status, mockup_error: decision.error };
  if (afterPath) leadPatch.mockup_after_path = afterPath;
  const saved = await rest('/rest/v1/leads?id=eq.' + leadId, {
    method: 'PATCH',
    token: key,
    apikey: key,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(leadPatch)
  });
  if (!saved.ok) return json(502, { error: 'Could not update the lead' });

  const requestId = body.request_id || body.requestId;
  if (isUuid(requestId)) {
    const requestPatch = { status: decision.status, error: decision.error };
    if (decision.status === 'in_progress') requestPatch.started_at = now;
    if (decision.status === 'ready') {
      requestPatch.ready_at = now;
      requestPatch.after_path = afterPath;
    }
    await rest('/rest/v1/mockup_requests?id=eq.' + requestId, {
      method: 'PATCH',
      token: key,
      apikey: key,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(requestPatch)
    });
  }

  return json(200, { status: decision.status, path: afterPath });
}

export async function POST(request) {
  return handlePost(request);
}

export default {
  async fetch(request) {
    if (!request || request.method !== 'POST') return json(405, { error: 'POST only' }, { Allow: 'POST' });
    return handlePost(request);
  }
};
