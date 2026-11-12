// POST /api/mockup-notify
// Login required. Body: { lead_id }.
// Writes the request with Steve's own token (RLS), signs the before photo,
// then POSTs the contract to MOCKUP_WEBHOOK_URL. The URL never goes to the phone.
// If the env var is missing, returns { notConfigured: true } and does not fail the lead.

import { requireUser } from './_auth.mjs';
import { v2, json, isUuid, stylePayload, rest, SUPABASE_ANON_KEY } from './mockup-shared.mjs';

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

async function handlePost(request) {
  const auth = await requireUser(request);
  if (!auth.user) return auth.response;
  let body = {};
  try { body = await request.json(); } catch (error) { body = {}; }
  const leadId = body.lead_id || body.leadId;
  if (!isUuid(leadId)) return json(400, { error: 'lead_id is required' });

  const webhook = (process.env.MOCKUP_WEBHOOK_URL || '').trim();
  if (!webhook) return json(200, { notConfigured: true, buttonLabel: 'Not set up yet' });

  const leadRes = await rest('/rest/v1/leads?id=eq.' + leadId + '&select=id,user_id,mockup_before_path', {
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
    await rest('/rest/v1/leads?id=eq.' + leadId, {
      method: 'PATCH',
      token: auth.token,
      apikey: SUPABASE_ANON_KEY,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ mockup_status: 'failed', mockup_error: decision.error })
    });
    return json(200, { status: 'failed', error: decision.error });
  }

  const photoUrl = await signPhoto(auth.token, lead.mockup_before_path);
  if (!photoUrl) return json(200, { status: 'failed', error: 'Could not open the photo' });

  const inserted = await rest('/rest/v1/mockup_requests', {
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

  let webhookOk = false;
  let webhookError = 'Could not reach the mockup service';
  try {
    const sent = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        lead_id: leadId,
        request_id: requestId,
        photo_url: photoUrl,
        style: stylePayload()
      }),
      signal: AbortSignal.timeout(8000)
    });
    webhookOk = sent.ok;
    if (!sent.ok) webhookError = 'Mockup service returned ' + sent.status;
  } catch (error) {
    webhookOk = false;
  }

  if (!webhookOk) {
    await rest('/rest/v1/mockup_requests?id=eq.' + requestId, {
      method: 'PATCH',
      token: auth.token,
      apikey: SUPABASE_ANON_KEY,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'failed', error: webhookError })
    });
    await rest('/rest/v1/leads?id=eq.' + leadId, {
      method: 'PATCH',
      token: auth.token,
      apikey: SUPABASE_ANON_KEY,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ mockup_status: 'failed', mockup_error: webhookError })
    });
    return json(200, { status: 'failed', error: webhookError, request_id: requestId });
  }

  await rest('/rest/v1/leads?id=eq.' + leadId, {
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

export default {
  async fetch(request) {
    if (!request || request.method !== 'POST') return json(405, { error: 'POST only' }, { Allow: 'POST' });
    return handlePost(request);
  }
};
