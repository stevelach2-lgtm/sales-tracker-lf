// POST /api/mockup-notify
// Login required. Body: { lead_id }.
// Writes the request with Steve's own token (RLS), signs the before photo,
// then POSTs the contract to MOCKUP_WEBHOOK_URL. The URL never goes to the phone.
// If the env var is missing, returns { notConfigured: true } and does not fail the lead.

import { requireUser } from './_auth.mjs';
import { v2, json, isUuid, stylePayload, signMockupBody, rest, SUPABASE_ANON_KEY } from './mockup-shared.mjs';

async function signPhoto(token, path) {
  const res = await rest('/storage/v1/object/sign/mockups/' + path.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST',
    token: token,
    apikey: SUPABASE_ANON_KEY,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 7200 })
  });
  if (!res.ok || !res.data) return '';
  const signed = res.data.signedURL || res.data.signedUrl || '';
  if (!signed) return '';
  if (/^https?:\/\//i.test(signed)) return signed;
  return process.env.SUPABASE_URL
    ? process.env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1' + signed
    : 'https://gktnrjtmuxhnxggqgpny.supabase.co/storage/v1' + signed;
}

const PHOTO_OPEN_ERROR = 'Could not open the photo';

async function handlePost(request, deps) {
  const authFn = (deps && deps.requireUser) || requireUser;
  const restFn = (deps && deps.rest) || rest;
  const signFn = (deps && deps.signPhoto) || signPhoto;
  const fetchFn = (deps && deps.fetch) || fetch;
  const auth = await authFn(request);
  if (!auth.user) return auth.response;
  let body = {};
  try { body = await request.json(); } catch (error) { body = {}; }
  const leadId = body.lead_id || body.leadId;
  if (!isUuid(leadId)) return json(400, { error: 'lead_id is required' });

  const webhook = (process.env.MOCKUP_WEBHOOK_URL || '').trim();
  if (!webhook) return json(200, { notConfigured: true, buttonLabel: 'Not set up yet' });

  const leadRes = await restFn('/rest/v1/leads?id=eq.' + leadId + '&select=id,user_id,mockup_before_path', {
    token: auth.token,
    apikey: SUPABASE_ANON_KEY
  });
  const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : null;
  if (!leadRes.ok || !lead) return json(404, { error: 'Lead not found' });

  const decision = v2.mockupRequestDecision({
    webhookConfigured: true,
    hasPhoto: !!lead.mockup_before_path,
    webhookOk: true
  });
  if (!decision.ok && decision.error === 'Add a photo of the house first') {
    await restFn('/rest/v1/leads?id=eq.' + leadId, {
      method: 'PATCH',
      token: auth.token,
      apikey: SUPABASE_ANON_KEY,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ mockup_status: 'failed', mockup_error: decision.error })
    });
    return json(200, { status: 'failed', error: decision.error });
  }

  const photoUrl = await signFn(auth.token, lead.mockup_before_path);
  if (!photoUrl) {
    await restFn('/rest/v1/leads?id=eq.' + leadId, {
      method: 'PATCH',
      token: auth.token,
      apikey: SUPABASE_ANON_KEY,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ mockup_status: 'failed', mockup_error: PHOTO_OPEN_ERROR })
    });
    return json(200, { status: 'failed', error: PHOTO_OPEN_ERROR });
  }

  const signingSecret = (process.env.MOCKUP_UPLOAD_SECRET || '').trim();
  if (!signingSecret) {
    await restFn('/rest/v1/leads?id=eq.' + leadId, {
      method: 'PATCH',
      token: auth.token,
      apikey: SUPABASE_ANON_KEY,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ mockup_status: 'failed', mockup_error: 'Mockup signing is not set up yet' })
    });
    return json(200, { status: 'failed', error: 'Mockup signing is not set up yet' });
  }

  const inserted = await restFn('/rest/v1/mockup_requests', {
    method: 'POST',
    token: auth.token,
    apikey: SUPABASE_ANON_KEY,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      lead_id: leadId,
      user_id: auth.user.id,
      status: 'requested',
      before_path: lead.mockup_before_path,
      style_notes: v2.MOCKUP_STYLE
    })
  });
  const requestRow = Array.isArray(inserted.data) ? inserted.data[0] : null;
  const requestId = requestRow && requestRow.id;
  if (!inserted.ok || !requestId) {
    const message = (inserted.data && inserted.data.message) || 'Could not save the request';
    return json(200, { status: 'failed', error: message });
  }

  const rawBody = JSON.stringify({
    lead_id: leadId,
    request_id: requestId,
    photo_url: photoUrl,
    style: stylePayload()
  });
  const signed = signMockupBody(rawBody, signingSecret);
  let webhookOk = false;
  let webhookError = 'Could not reach the mockup service';
  try {
    const sent = await fetchFn(webhook, {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }, signed.headers),
      body: rawBody,
      signal: AbortSignal.timeout(8000)
    });
    webhookOk = sent.ok;
    if (!sent.ok) webhookError = 'Mockup service returned ' + sent.status;
  } catch (error) {
    webhookOk = false;
  }

  if (!webhookOk) {
    await restFn('/rest/v1/mockup_requests?id=eq.' + requestId, {
      method: 'PATCH',
      token: auth.token,
      apikey: SUPABASE_ANON_KEY,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'failed', error: webhookError })
    });
    await restFn('/rest/v1/leads?id=eq.' + leadId, {
      method: 'PATCH',
      token: auth.token,
      apikey: SUPABASE_ANON_KEY,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ mockup_status: 'failed', mockup_error: webhookError })
    });
    return json(200, { status: 'failed', error: webhookError, request_id: requestId });
  }

  await restFn('/rest/v1/leads?id=eq.' + leadId, {
    method: 'PATCH',
    token: auth.token,
    apikey: SUPABASE_ANON_KEY,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ mockup_status: 'requested', mockup_error: null })
  });
  return json(200, { status: 'requested', request_id: requestId });
}

export async function POST(request) {
  return handlePost(request);
}

export { handlePost, PHOTO_OPEN_ERROR };

export default {
  async fetch(request) {
    if (!request || request.method !== 'POST') return json(405, { error: 'POST only' }, { Allow: 'POST' });
    return handlePost(request);
  }
};
