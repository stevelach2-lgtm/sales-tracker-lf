const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHmac } = require('crypto');
const test = require('node:test');

test('geocode refuses a request that is not signed in', async () => {
  const { handleGet } = await import('../api/geocode.mjs');
  const res = await handleGet(new Request('https://sales-tracker-lf.vercel.app/api/geocode?address=1%20Main%20St'));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'Sign in required');
});

test('conditions filters wind, pads rain, and skips Mapbox when the token is missing', async () => {
  const { buildConditions } = await import('../api/conditions-core.mjs');
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    if (String(url).includes('api.weather.gov/alerts')) {
      return jsonResponse({
        features: [
          { properties: { event: 'Wind Advisory' } },
          { properties: { event: 'Flood Warning' } }
        ]
      });
    }
    if (String(url).includes('api.weather.gov/points')) {
      return jsonResponse({ properties: { forecastHourly: 'https://api.weather.gov/hourly' } });
    }
    if (String(url).includes('api.weather.gov/hourly')) {
      return jsonResponse({
        properties: {
          periods: [{
            startTime: '2026-11-12T16:00:00+00:00',
            temperature: 41,
            probabilityOfPrecipitation: { value: 70 },
            shortForecast: 'Rain and windy'
          }]
        }
      });
    }
    if (String(url).includes('router.project-osrm.org')) {
      return jsonResponse({
        routes: [{
          duration: 34 * 60,
          distance: 22 * 1609.344,
          geometry: { type: 'LineString', coordinates: [[-74.82, 39.9], [-75.1, 40.05]] }
        }]
      });
    }
    throw new Error('unexpected ' + url);
  };

  const result = await buildConditions({
    appointmentAt: '2026-11-12T16:00:00.000Z',
    origin: { lat: 39.9, lng: -74.82 },
    dest: { lat: 40.05, lng: -75.1 }
  }, { fetch: fetchFn, mapboxToken: '' });

  assert.equal(calls.some(url => url.includes('api.mapbox.com')), false);
  assert.equal(result.drive.minutes, 34);
  assert.equal(result.drive.traffic, false);
  assert.equal(result.degraded, 'no_traffic');
  assert.equal(result.severity, 'rain');
  assert.equal(result.padMinutes, 10);
  assert.equal(result.weather.summary.includes('wind'), false);
  assert.equal(result.weather.warnings.some(label => /flood/i.test(label)), true);
  assert.equal(result.weather.warnings.some(label => /wind/i.test(label)), false);
  assert.equal(result.leaveAt != null, true);
});

test('conditions uses Mapbox driving-traffic when the token is set', async () => {
  const { buildConditions } = await import('../api/conditions-core.mjs');
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    if (String(url).includes('api.mapbox.com')) {
      assert.equal(String(url).includes('driving-traffic'), true);
      assert.equal(String(url).includes('access_token=test-token'), true);
      return jsonResponse({
        routes: [{
          duration: 20 * 60,
          distance: 10 * 1609.344,
          geometry: { type: 'LineString', coordinates: [[-74.8, 39.9], [-74.9, 39.95]] }
        }]
      });
    }
    if (String(url).includes('/alerts')) return jsonResponse({ features: [] });
    if (String(url).includes('/points')) return jsonResponse({ properties: { forecastHourly: 'https://api.weather.gov/hourly' } });
    if (String(url).includes('/hourly')) {
      return jsonResponse({
        properties: {
          periods: [{
            startTime: '2026-11-12T16:00:00+00:00',
            temperature: 60,
            probabilityOfPrecipitation: { value: 10 },
            shortForecast: 'Sunny'
          }]
        }
      });
    }
    throw new Error('unexpected ' + url);
  };
  const result = await buildConditions({
    appointmentAt: '2026-11-12T16:00:00.000Z',
    origin: { lat: 39.9, lng: -74.8 },
    dest: { lat: 39.95, lng: -74.9 }
  }, { fetch: fetchFn, mapboxToken: 'test-token' });
  assert.equal(result.drive.traffic, true);
  assert.equal(result.drive.minutes, 20);
  assert.equal(result.padMinutes, 0);
  assert.equal(calls.some(url => url.includes('project-osrm.org')), false);
});

test('mockup upload rejects a missing secret and a ready image without bytes', async () => {
  const { POST: uploadPost } = await import('../api/mockup-upload.mjs');
  const previousSecret = process.env.MOCKUP_UPLOAD_SECRET;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.MOCKUP_UPLOAD_SECRET = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  const missing = await uploadPost(new Request('https://sales-tracker-lf.vercel.app/api/mockup-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lead_id: '11111111-1111-4111-8111-111111111111', status: 'ready', image_base64: 'aGk=' })
  }));
  assert.equal(missing.status, 503);
  const body = await missing.json();
  assert.equal(body.error, 'Not set up yet');
  process.env.MOCKUP_UPLOAD_SECRET = previousSecret;
  process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

test('geocode success is cached privately', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'geocode.mjs'), 'utf8');
  assert.match(source, /private, max-age=86400/);
  assert.equal(source.includes('public, max-age'), false);
});

test('webhook signature is HMAC-SHA256 of timestamp dot raw body', async () => {
  const { signMockupBody } = await import('../api/mockup-shared.mjs');
  const raw = '{"lead_id":"abc","photo_url":"https://example.test/p"}';
  const secret = 'shared-secret';
  const signed = signMockupBody(raw, secret, 1700000000000);
  const expected = createHmac('sha256', secret).update('1700000000000.' + raw).digest('hex');
  assert.notEqual(expected, createHmac('sha256', secret).update(raw).digest('hex'));
  assert.equal(signed.signature, expected);
  assert.equal(signed.headers['X-Mockup-Signature'], expected);
  assert.equal(signed.headers['X-Mockup-Timestamp'], '1700000000000');
});

test('a failed before-photo signature is saved as Couldn\'t make', async () => {
  const { handlePost, PHOTO_OPEN_ERROR } = await import('../api/mockup-notify.mjs');
  const leadId = '11111111-1111-4111-8111-111111111111';
  const previousHook = process.env.MOCKUP_WEBHOOK_URL;
  process.env.MOCKUP_WEBHOOK_URL = 'https://example.test/hook';
  const patches = [];
  try {
    const res = await handlePost(new Request('https://sales-tracker-lf.vercel.app/api/mockup-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ lead_id: leadId })
    }), {
      requireUser: async () => ({ user: { id: '22222222-2222-4222-8222-222222222222' }, token: 'token', response: null }),
      signPhoto: async () => '',
      rest: async (url, options) => {
        if (options && options.method === 'PATCH') patches.push(JSON.parse(options.body));
        if (String(url).includes('/rest/v1/leads')) {
          return { ok: true, data: [{ id: leadId, user_id: '22222222-2222-4222-8222-222222222222', mockup_before_path: 'user/lead/before.jpg' }] };
        }
        return { ok: true, data: [] };
      }
    });
    const body = await res.json();
    assert.equal(body.status, 'failed');
    assert.equal(body.error, PHOTO_OPEN_ERROR);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].mockup_status, 'failed');
    assert.equal(patches[0].mockup_error, PHOTO_OPEN_ERROR);
  } finally {
    if (previousHook == null) delete process.env.MOCKUP_WEBHOOK_URL;
    else process.env.MOCKUP_WEBHOOK_URL = previousHook;
  }
});

test('the outgoing webhook sends the sender key and signs timestamp dot body', async () => {
  const { handlePost } = await import('../api/mockup-notify.mjs');
  const { WEBHOOK_SENDER_HEADER } = await import('../api/mockup-shared.mjs');
  const leadId = '11111111-1111-4111-8111-111111111111';
  const previousHook = process.env.MOCKUP_WEBHOOK_URL;
  const previousSecret = process.env.MOCKUP_UPLOAD_SECRET;
  const previousKey = process.env.MOCKUP_WEBHOOK_KEY;
  process.env.MOCKUP_WEBHOOK_URL = 'https://example.test/hook';
  process.env.MOCKUP_UPLOAD_SECRET = 'shared-secret';
  process.env.MOCKUP_WEBHOOK_KEY = 'grok-sender-key';
  let captured = null;
  let inserted = null;
  try {
    const res = await handlePost(new Request('https://sales-tracker-lf.vercel.app/api/mockup-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ lead_id: leadId })
    }), {
      requireUser: async () => ({ user: { id: '22222222-2222-4222-8222-222222222222' }, token: 'token', response: null }),
      signPhoto: async () => 'https://signed.example/photo.jpg',
      fetch: async (url, options) => {
        captured = { url: url, headers: options.headers, body: options.body };
        return { ok: true, status: 200 };
      },
      rest: async (url, options) => {
        if (String(url).includes('/rest/v1/mockup_requests') && options && options.method === 'POST') {
          inserted = JSON.parse(options.body);
          return { ok: true, data: [inserted] };
        }
        if (String(url).includes('/rest/v1/leads') && (!options || options.method !== 'PATCH')) {
          return { ok: true, data: [{ id: leadId, user_id: '22222222-2222-4222-8222-222222222222', mockup_before_path: 'user/lead/before.jpg' }] };
        }
        return { ok: true, data: [] };
      }
    });
    const body = await res.json();
    assert.equal(body.status, 'requested');
    assert.equal(inserted.status, 'requested');
    assert.equal(inserted.lead_id, leadId);
    assert.equal(inserted.request_id, inserted.id);
    assert.match(inserted.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(captured.url, 'https://example.test/hook');
    assert.equal(WEBHOOK_SENDER_HEADER, 'Authorization');
    assert.equal(captured.headers[WEBHOOK_SENDER_HEADER], 'Bearer grok-sender-key');
    const payload = JSON.parse(captured.body);
    assert.equal(payload.lead_id, leadId);
    assert.equal(payload.request_id, inserted.request_id);
    assert.equal(payload.photo_url, 'https://signed.example/photo.jpg');
    assert.equal(payload.timestamp, captured.headers['X-Mockup-Timestamp']);
    const expected = createHmac('sha256', 'shared-secret').update(payload.timestamp + '.' + captured.body).digest('hex');
    assert.equal(captured.headers['X-Mockup-Signature'], expected);
    assert.match(captured.body, /warm-white individual pinpoint lights, evenly spaced about every 12 inches/);
    assert.equal(captured.body.includes('grok-sender-key'), false);
  } finally {
    if (previousHook == null) delete process.env.MOCKUP_WEBHOOK_URL;
    else process.env.MOCKUP_WEBHOOK_URL = previousHook;
    if (previousSecret == null) delete process.env.MOCKUP_UPLOAD_SECRET;
    else process.env.MOCKUP_UPLOAD_SECRET = previousSecret;
    if (previousKey == null) delete process.env.MOCKUP_WEBHOOK_KEY;
    else process.env.MOCKUP_WEBHOOK_KEY = previousKey;
  }
});

test('mockup upload rejects an unknown status with 400', async () => {
  const { POST: uploadPost } = await import('../api/mockup-upload.mjs');
  const previousSecret = process.env.MOCKUP_UPLOAD_SECRET;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.MOCKUP_UPLOAD_SECRET = 'shared-secret';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  try {
    const res = await uploadPost(new Request('https://sales-tracker-lf.vercel.app/api/mockup-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer shared-secret' },
      body: JSON.stringify({
        lead_id: '11111111-1111-4111-8111-111111111111',
        status: 'done',
        image_base64: 'YQ=='
      })
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Unknown status');
  } finally {
    if (previousSecret == null) delete process.env.MOCKUP_UPLOAD_SECRET;
    else process.env.MOCKUP_UPLOAD_SECRET = previousSecret;
    if (previousKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}
