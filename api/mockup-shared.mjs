// Night mockup contract shared by the notify and upload functions.
// Lights are always individual pinpoint lights, evenly spaced. Never a strip.
//
// Bob's webhook receives POST application/json:
// {
//   "lead_id": "uuid",
//   "request_id": "uuid",
//   "photo_url": "https://...signed, about 2 hours",
//   "style": {
//     "color": "warm white",
//     "lights": "individual pinpoint lights",
//     "spacing": "evenly spaced along the roofline and fascia",
//     "never": "continuous strip, rope, or glow line",
//     "notes": "Warm white, individual pinpoint lights, evenly spaced; never a continuous strip, rope, or glow line"
//   }
// }
// Bob calls back POST /api/mockup-upload with header Authorization: Bearer $MOCKUP_UPLOAD_SECRET
// (or X-Mockup-Secret). Body:
// {
//   "lead_id": "uuid",
//   "request_id": "uuid, optional",
//   "status": "in_progress" | "ready" | "failed",
//   "error": "reason, required when status is failed",
//   "image_base64": "required when status is ready",
//   "content_type": "image/jpeg" | "image/png"
// }

import { createRequire } from 'module';
import { timingSafeEqual } from 'crypto';
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
    color: 'warm white',
    lights: 'individual pinpoint lights',
    spacing: 'evenly spaced along the roofline and fascia',
    never: 'continuous strip, rope, or glow line',
    notes: v2.MOCKUP_STYLE
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

export { v2, json, isUuid, secretOk, stylePayload, serviceKey, rest, SUPABASE_URL, SUPABASE_ANON_KEY };
