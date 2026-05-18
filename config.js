// Public configuration — these values are NOT secrets.
// The Strava Client ID is a public identifier; the Client Secret lives only
// on the Cloudflare Worker.
//
// After deploying the worker, fill in both values below.
const CONFIG = {
  STRAVA_CLIENT_ID: '',                          // e.g. '123456'
  WORKER_URL:       '',                          // e.g. 'https://gpx-wetter-strava.<account>.workers.dev'
};

function stravaConfigured() {
  return !!CONFIG.STRAVA_CLIENT_ID && !!CONFIG.WORKER_URL;
}
