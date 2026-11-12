const assert = require('node:assert/strict');
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

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}
