// Night mockup contract shared by the notify and upload functions.
// Style line, exact: warm-white individual pinpoint lights, evenly spaced about
// every 12 inches along the eaves and roofline, never a continuous strip.
//
// Bob's webhook receives POST application/json. The body string is signed.
// Headers:
//   X-Mockup-Signature: hex HMAC-SHA256 of the raw body, key MOCKUP_UPLOAD_SECRET
//   X-Mockup-Timestamp: unix milliseconds when the signature was made
// Bob verifies the signature against the raw body (do not re-stringify JSON)
// and rejects a timestamp more than 5 minutes off.
//
// {
//   "lead_id": "uuid",
//   "request_id": "uuid",
//   "photo_url": "https://...signed, about 2 hours",
//   "style": {
//     "color": "warm-white",
//     "lights": "individual pinpoint lights",
//     "spacing": "evenly spaced about every 12 inches along the eaves and roofline",
//     "never": "a continuous strip",
//     "notes": "<MOCKUP_STYLE>"
//   }
// }
//
// Bob calls back POST /api/mockup-upload with header Authorization: Bearer $MOCKUP_UPLOAD_SECRET
// (or X-Mockup-Secret). The image stays in the JSON body and must decode to 3 MB or less
// (Vercel drops larger function bodies before this code runs). 413 if it is over.
// Unknown status is 400. Body:
// {
//   "lead_id": "uuid",
//   "request_id": "uuid, optional",
//   "status": "in_progress" | "ready" | "failed",
//   "error": "reason, required when status is failed",
//   "image_base64": "required when status is ready",
//   "content_type": "image/jpeg" | "image/png"
// }

import { createRequire } from 'module';
import { createHmac, timingSafeEqual } from 'crypto';
import { SUPABASE_URL, SUPABASE_ANON_KEY, json } from './_auth.mjs';

const require = createRequire(import.meta.url);
const v2 = require('../lib/v2-logic.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID.test(String(value || ''));
}

function secretOk(request) {
  const expected = process.env.MOCKUP_UPLOAD_SECRET || '';
  if (!expected) return false;
  const header = request.headers.get('x-mockup-secret')
    || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function stylePayload() {
  return {
    color: 'warm-white',
    lights: 'individual pinpoint lights',
    spacing: 'evenly spaced about every 12 inches along the eaves and roofline',
    never: 'a continuous strip',
    notes: v2.MOCKUP_STYLE
  };
}

function signMockupBody(rawBody, secret, nowMs) {
  const timestamp = String(nowMs == null ? Date.now() : nowMs);
  const signature = createHmac('sha256', String(secret || '')).update(String(rawBody)).digest('hex');
  return {
    timestamp: timestamp,
    signature: signature,
    headers: {
      'X-Mockup-Signature': signature,
      'X-Mockup-Timestamp': timestamp
    }
  };
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

async function rest(path, options) {
  const headers = Object.assign({
    Accept: 'application/json',
    apikey: options.apikey,
    Authorization: 'Bearer ' + options.token
  }, options.headers || {});
  const response = await fetch(SUPABASE_URL.replace(/\/$/, '') + path, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (error) { data = text; }
  }
  return { ok: response.ok, status: response.status, data: data };
}

export { v2, json, isUuid, secretOk, stylePayload, signMockupBody, serviceKey, rest, SUPABASE_URL, SUPABASE_ANON_KEY };
