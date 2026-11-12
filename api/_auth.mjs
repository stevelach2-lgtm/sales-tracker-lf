// Shared login check for Vercel functions. The anon key is the same public key
// already shipped in index.html. It cannot read other people's rows.
// SUPABASE_SERVICE_ROLE_KEY is optional and is only used by /api/mockup-upload.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gktnrjtmuxhnxggqgpny.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrdG5yanRtdXhobnhnZ3FncG55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTM3NjUsImV4cCI6MjA5MDQ4OTc2NX0.oTH6Gd1O2fRH5eaJsVSk2hSTVZmXCApf2_SNPQ5Qb-o';

function json(status, body, extra) {
  return Response.json(body, {
    status: status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, extra || {})
  });
}

function bearer(request) {
  const header = (request && request.headers && request.headers.get('authorization')) || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

async function requireUser(request, deps) {
  const token = bearer(request);
  if (!token) return { user: null, token: '', response: json(401, { error: 'Sign in required' }) };
  const fetchFn = (deps && deps.fetch) || fetch;
  const url = (deps && deps.supabaseUrl) || SUPABASE_URL;
  const anon = (deps && deps.anonKey) || SUPABASE_ANON_KEY;
  let response;
  try {
    response = await fetchFn(url.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: anon }
    });
  } catch (error) {
    return { user: null, token: '', response: json(401, { error: 'Sign in required' }) };
  }
  if (!response || !response.ok) return { user: null, token: '', response: json(401, { error: 'Sign in required' }) };
  const user = await response.json();
  if (!user || !user.id) return { user: null, token: '', response: json(401, { error: 'Sign in required' }) };
  return { user: user, token: token, response: null };
}

export { SUPABASE_URL, SUPABASE_ANON_KEY, json, bearer, requireUser };
