// GET /api/geocode?address=...
// Census geocoder has no CORS headers, so the browser cannot call it.
// This function calls Census server-side, retries a cleaned address when
// Census has no match, then falls back to Nominatim with an identifying
// User-Agent. Response: { lat, lng, matched } where matched is the
// matched address string, or null when nothing matched.

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'LeafFilterSalesTracker/1.0 (https://sales-tracker-lf.vercel.app; mileage geocoding)';
const DEFAULT_REFERER = 'https://sales-tracker-lf.vercel.app/';
const MAX_ADDRESS_LENGTH = 500;
const CENSUS_TIMEOUT_MS = 4500;
const NOMINATIM_TIMEOUT_MS = 4000;
const NOMINATIM_GAP_MS = 1100;

const STATE_AFTER = 'AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|Pennsylvania|New Jersey|New York|Delaware|Maryland|Ohio';

function tidy(value) {
  return String(value || '')
    .replace(/\s*\n+\s*/g, ', ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/^,\s*|\s*,\s*$/g, '')
    .trim();
}

function dropUnits(value) {
  let text = String(value || '');
  text = text.replace(
    /(?:^|[\s,])(?:apartment|apt|unit|suite|ste|building|bldg|floor|fl|room|rm|space|spc|lot)\.?\s*#?\s*[A-Za-z0-9-]+\b/gi,
    ' '
  );
  text = text.replace(/(?:^|[\s,])#\s*[A-Za-z0-9-]+\b/g, ' ');
  return tidy(text);
}

function replaceTownship(segment, mode) {
  if (mode === 'expand') {
    return segment.replace(/\b(?:twnshp|twsp|twp)\b\.?/gi, 'Township');
  }
  return segment.replace(/\b(?:twnshp|twsp|twp|township)\b\.?/gi, ' ');
}

function rewriteTownship(address, mode) {
  const raw = String(address || '');
  if (raw.includes(',')) {
    return raw.split(',').map((part, index) => (index === 0 ? part : replaceTownship(part, mode))).join(',');
  }
  const token = mode === 'expand' ? 'twnshp|twsp|twp' : 'twnshp|twsp|twp|township';
  const re = new RegExp(
    '\\b(?:' + token + ')\\b\\.?(?=\\s*(?:,|$|\\b(?:' + STATE_AFTER + ')\\b|\\d{5}\\b))',
    'gi'
  );
  return raw.replace(re, mode === 'expand' ? 'Township' : ' ');
}

function addressVariants(address) {
  const raw = String(address || '').trim();
  if (!raw) return [];
  const dropped = dropUnits(raw);
  const expanded = tidy(rewriteTownship(dropped, 'expand'));
  const stripped = tidy(rewriteTownship(dropped, 'strip'));
  const ordered = [raw, tidy(dropped), expanded, stripped];
  const seen = new Set();
  const unique = [];
  ordered.forEach(item => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });
  return unique;
}

function emptyResult() {
  return { lat: null, lng: null, matched: null };
}

function asCoords(lat, lng, matched) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln, matched: matched || null };
}

async function readJson(url, headers, timeoutMs) {
  const response = await fetch(url, {
    headers: Object.assign({ Accept: 'application/json', 'User-Agent': USER_AGENT }, headers || {}),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function censusLookup(address) {
  const url = CENSUS_URL + '?' + new URLSearchParams({
    benchmark: 'Public_AR_Current',
    format: 'json',
    address: address
  }).toString();
  const json = await readJson(url, null, CENSUS_TIMEOUT_MS);
  const match = json && json.result && Array.isArray(json.result.addressMatches)
    ? json.result.addressMatches[0]
    : null;
  if (!match || !match.coordinates) return null;
  return asCoords(match.coordinates.y, match.coordinates.x, match.matchedAddress || address);
}

async function nominatimLookup(address, referer) {
  const url = NOMINATIM_URL + '?' + new URLSearchParams({
    format: 'json',
    limit: '1',
    countrycodes: 'us',
    q: address
  }).toString();
  const json = await readJson(url, { Referer: referer || DEFAULT_REFERER }, NOMINATIM_TIMEOUT_MS);
  const row = Array.isArray(json) ? json[0] : null;
  if (!row) return null;
  return asCoords(row.lat, row.lon, row.display_name || address);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeAddress(address, options) {
  const variants = addressVariants(address);
  if (!variants.length) return emptyResult();
  const census = (options && options.censusLookup) || censusLookup;
  const nominatim = (options && options.nominatimLookup) || nominatimLookup;
  const referer = (options && options.referer) || DEFAULT_REFERER;
  let censusUp = true;

  for (let i = 0; i < variants.length; i++) {
    if (!censusUp) break;
    try {
      const hit = await census(variants[i]);
      if (hit) return hit;
    } catch (error) {
      const status = error && error.status;
      if (status && status >= 400 && status < 500) continue;
      censusUp = false;
    }
  }

  const cleaned = variants.length > 1 ? variants[variants.length - 1] : variants[0];
  const nominatimQueries = [];
  nominatimQueries.push(cleaned);
  if (cleaned.toLowerCase() !== variants[0].toLowerCase()) nominatimQueries.push(variants[0]);

  for (let i = 0; i < nominatimQueries.length; i++) {
    if (i > 0) await sleep(NOMINATIM_GAP_MS);
    try {
      const hit = await nominatim(nominatimQueries[i], referer);
      if (hit) return hit;
    } catch (error) {
      break;
    }
  }
  return emptyResult();
}

function requestAddress(req) {
  const query = req && req.query ? req.query.address : '';
  const fromQuery = Array.isArray(query) ? query[0] : query;
  if (fromQuery) return String(fromQuery).trim();
  const url = req && req.url ? String(req.url) : '';
  const mark = url.indexOf('?');
  if (mark === -1) return '';
  try {
    return new URLSearchParams(url.slice(mark + 1)).get('address') || '';
  } catch (error) {
    return '';
  }
}

function requestReferer(req) {
  const headers = (req && req.headers) || {};
  const host = headers['x-forwarded-host'] || headers.host;
  if (!host) return DEFAULT_REFERER;
  const proto = headers['x-forwarded-proto'] || 'https';
  const hostname = String(host).split(',')[0].trim();
  return proto + '://' + hostname + '/';
}

function sendJson(res, status, body, cache) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (cache) headers['Cache-Control'] = cache;
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    Object.keys(headers).forEach(key => res.setHeader(key, headers[key]));
    return res.status(status).json(body);
  }
  res.statusCode = status;
  Object.keys(headers).forEach(key => res.setHeader(key, headers[key]));
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  const method = (req && req.method) || 'GET';
  if (method !== 'GET') {
    if (typeof res.setHeader === 'function') res.setHeader('Allow', 'GET');
    return sendJson(res, 405, emptyResult(), 'no-store');
  }
  const address = requestAddress(req).trim();
  if (!address || address.length > MAX_ADDRESS_LENGTH) {
    return sendJson(res, 400, emptyResult(), 'no-store');
  }
  try {
    const result = await geocodeAddress(address, { referer: requestReferer(req) });
    const cache = result.matched ? 'public, max-age=86400' : 'no-store';
    return sendJson(res, 200, result, cache);
  } catch (error) {
    return sendJson(res, 200, emptyResult(), 'no-store');
  }
}

module.exports = handler;
module.exports.geocodeAddress = geocodeAddress;
module.exports.addressVariants = addressVariants;
