// POST /api/conditions
// Login required. Body: { appointmentAt, origin: {lat,lng}, dest: {lat,lng} }
// Coordinates only. MAPBOX_TOKEN stays on the server. Missing token is not an error:
// the response still returns weather and, when OSRM answers, a drive time without traffic.

import { json, requireUser } from './_auth.mjs';
import { buildConditions } from './conditions-core.mjs';

export const maxDuration = 30;

async function handlePost(request) {
  const auth = await requireUser(request);
  if (!auth.user) return auth.response;
  let body = {};
  try {
    body = await request.json();
  } catch (error) {
    body = {};
  }
  try {
    const result = await buildConditions(body, { mapboxToken: process.env.MAPBOX_TOKEN || '' });
    return json(200, result);
  } catch (error) {
    return json(200, {
      weather: null,
      drive: null,
      routeWeather: null,
      severity: 'clear',
      padMinutes: 0,
      padReason: '',
      leaveAt: null,
      updatedAt: new Date().toISOString(),
      degraded: 'unavailable'
    });
  }
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
