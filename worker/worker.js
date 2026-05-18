// Cloudflare Worker — Strava OAuth code exchange proxy for gpx-wetter.
//
// The only secret-bearing operation: trade an authorization code for an
// access token. The client_secret stays on the worker, never reaches the
// browser. The returned access_token is short-lived (~6h) and used directly
// by the frontend to call the Strava API.

const ALLOWED_ORIGINS = [
  'https://nqrlz.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/strava/exchange' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const code = body.code;
        if (!code || typeof code !== 'string') {
          return json({ error: 'Missing or invalid `code`' }, 400, cors);
        }
        if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
          return json({ error: 'Worker not configured (missing secrets)' }, 500, cors);
        }

        const resp = await fetch('https://www.strava.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: env.STRAVA_CLIENT_ID,
            client_secret: env.STRAVA_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
          }),
        });

        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data) {
          return json({ error: 'Strava token exchange failed', details: data }, 502, cors);
        }

        // Only return what the frontend needs — never expose the refresh_token.
        return json({
          access_token: data.access_token,
          expires_at: data.expires_at,
          athlete_id: data.athlete?.id || null,
          athlete_firstname: data.athlete?.firstname || null,
        }, 200, cors);
      } catch (e) {
        return json({ error: 'Exchange failed', details: String(e) }, 500, cors);
      }
    }

    return json({ error: 'Not found' }, 404, cors);
  },
};
