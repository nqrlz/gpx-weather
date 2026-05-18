// Public configuration — these values are NOT secrets.
// The Strava Client ID is a public identifier; the Client Secret lives only
// on the Cloudflare Worker.
//
// After deploying the worker, fill in both values below.
const CONFIG = {
  STRAVA_CLIENT_ID: '247283',
  WORKER_URL:       'https://gpx-wetter-strava.gpx-wetter.workers.dev',
};

function stravaConfigured() {
  return !!CONFIG.STRAVA_CLIENT_ID && !!CONFIG.WORKER_URL;
}
