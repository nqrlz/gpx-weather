// Strava OAuth + API client.
//
// Auth flow (PKCE-less, since we have a backend for the code exchange):
//   1. User clicks "Import von Strava" → stravaBeginAuth()
//      - random state stored in sessionStorage
//      - full-page redirect to https://www.strava.com/oauth/authorize
//   2. Strava redirects back to our origin with ?code=...&state=...
//      - on page load we detect this via stravaDetectCallback()
//   3. Frontend POSTs the code to the worker → access_token
//   4. Frontend calls Strava API directly with the access_token

const STRAVA_AUTH_URL  = 'https://www.strava.com/oauth/authorize';
const STRAVA_API       = 'https://www.strava.com/api/v3';
const STATE_KEY        = 'gpxwetter.stravaState';
const FORM_KEY         = 'gpxwetter.formBackup';
const SESSION_KEY      = 'gpxwetter.stravaSession';
const TOKEN_BUFFER_MS  = 5 * 60_000;  // refresh 5 min before expiry

const CYCLING_TYPES = new Set([
  'Ride', 'VirtualRide', 'EBikeRide', 'GravelRide', 'MountainBikeRide', 'Handcycle',
]);

function _randomState() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function stravaBeginAuth(formBackup) {
  if (!stravaConfigured()) {
    throw new Error('Strava-Integration ist nicht konfiguriert.');
  }
  const state = _randomState();
  sessionStorage.setItem(STATE_KEY, state);
  if (formBackup) {
    sessionStorage.setItem(FORM_KEY, JSON.stringify(formBackup));
  }

  const redirectUri = window.location.origin + window.location.pathname;
  const url = new URL(STRAVA_AUTH_URL);
  url.searchParams.set('client_id',        CONFIG.STRAVA_CLIENT_ID);
  url.searchParams.set('response_type',    'code');
  url.searchParams.set('redirect_uri',     redirectUri);
  url.searchParams.set('approval_prompt',  'auto');
  url.searchParams.set('scope',            'read_all,activity:read_all');
  url.searchParams.set('state',            state);

  window.location.href = url.toString();
}

function stravaDetectCallback() {
  const params = new URLSearchParams(window.location.search);
  const error  = params.get('error');
  const code   = params.get('code');
  const state  = params.get('state');
  if (!code && !error) return null;

  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  // Always clean the query string, even on error
  const cleanUrl = new URL(window.location.href);
  ['code', 'scope', 'state', 'error'].forEach(k => cleanUrl.searchParams.delete(k));
  window.history.replaceState({}, '', cleanUrl.toString());

  if (error) return { error };
  if (!expectedState || state !== expectedState) {
    return { error: 'state_mismatch' };
  }

  // Restore form data the user had before being redirected
  let formBackup = null;
  const raw = sessionStorage.getItem(FORM_KEY);
  if (raw) {
    sessionStorage.removeItem(FORM_KEY);
    try { formBackup = JSON.parse(raw); } catch {}
  }

  return { code, formBackup };
}

function stravaSaveSession(data) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {}
}

function stravaLoadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.access_token || !data.athlete_id || !data.expires_at) return null;
    if (data.expires_at * 1000 < Date.now() + TOKEN_BUFFER_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function stravaClearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function stravaExchangeCode(code) {
  const r = await fetch(`${CONFIG.WORKER_URL}/strava/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.error || `Token-Tausch fehlgeschlagen (${r.status})`);
  }
  return data; // { access_token, expires_at, athlete_firstname }
}

async function stravaListActivities(accessToken, perPage = 30) {
  const url = new URL(`${STRAVA_API}/athlete/activities`);
  url.searchParams.set('per_page', String(perPage));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Aktivitäten konnten nicht geladen werden (${r.status})`);
  const all = await r.json();
  // Keep only cycling-flavored activities and the GPS-bearing ones
  return all.filter(a =>
    (CYCLING_TYPES.has(a.type) || CYCLING_TYPES.has(a.sport_type))
    && Array.isArray(a.start_latlng) && a.start_latlng.length === 2
  );
}

async function stravaListRoutes(accessToken, athleteId, perPage = 30) {
  const url = new URL(`${STRAVA_API}/athletes/${athleteId}/routes`);
  url.searchParams.set('per_page', String(perPage));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Routen konnten nicht geladen werden (${r.status})`);
  const all = await r.json();
  // Strava route type: 1 = ride, 2 = run. We want rides only.
  return all.filter(rt => rt.type === 1);
}

// Both fetchers return a unified trackPoints[] array so the caller doesn't
// need to know whether the source was a streams endpoint or a GPX export.

async function stravaGetActivityPoints(accessToken, activityId) {
  const url = new URL(`${STRAVA_API}/activities/${activityId}/streams`);
  url.searchParams.set('keys', 'latlng,altitude,time');
  url.searchParams.set('key_by_type', 'true');
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Aktivitätsdaten konnten nicht geladen werden (${r.status})`);
  const streams = await r.json();
  return _streamsToTrackPoints(streams);
}

async function stravaGetRoutePoints(accessToken, routeId) {
  // The /export_gpx endpoint is unreliable for newer route IDs (returns 404
  // even when the route exists and is accessible). We use /routes/{id} to
  // get the route metadata + encoded polyline and decode it locally.
  // Polylines don't carry elevation, so slope-adjusted timing won't be
  // available for Strava-imported routes — only for uploaded GPX files.
  const url = `${STRAVA_API}/routes/${routeId}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error('Strava route fetch failed:', { url, status: r.status, body });
    throw new Error(`Route konnte nicht geladen werden (${r.status}) — ${body.slice(0, 200) || 'keine Antwort'}`);
  }
  const route = await r.json();
  const polyline = route?.map?.polyline || route?.map?.summary_polyline;
  if (!polyline) {
    throw new Error('Diese Route enthält keinen Streckenverlauf.');
  }
  const points = _decodePolyline(polyline);
  if (points.length < 2) {
    throw new Error('Streckenverlauf zu kurz.');
  }
  return points;
}

// Google Encoded Polyline decoder — Strava uses this format for `map.polyline`.
// Standard algorithm, decimicrodegree precision.
function _decodePolyline(str) {
  let index = 0, lat = 0, lng = 0;
  const out = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    out.push({ lat: lat / 1e5, lon: lng / 1e5, ele: null });
  }
  return out;
}

function _streamsToTrackPoints(streams) {
  const coords = streams?.latlng?.data || [];
  const eles   = streams?.altitude?.data;
  if (coords.length < 2) {
    throw new Error('Diese Aktivität enthält keine GPS-Daten.');
  }
  return coords.map((latlon, i) => ({
    lat: latlon[0],
    lon: latlon[1],
    ele: eles ? eles[i] : null,
  }));
}
