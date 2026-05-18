# gpx-wetter — Strava OAuth Worker

Minimaler Cloudflare Worker, der ausschließlich den OAuth-Code-Tausch übernimmt.
Das Strava Client Secret bleibt damit auf dem Worker und gelangt nie ins Frontend.

## Einmal-Setup

### 1. Strava-App anlegen

1. https://www.strava.com/settings/api öffnen, eingeloggt sein
2. **Create & Manage Your App** → ausfüllen:
   - Application Name: z.B. `gpx wetter`
   - Category: `Visualizer`
   - Website: `https://nqrlz.github.io/gpx-weather/`
   - **Authorization Callback Domain**: `nqrlz.github.io`
3. **Client ID** und **Client Secret** notieren

### 2. Cloudflare-Account

Kostenlos: https://dash.cloudflare.com/sign-up

### 3. Wrangler installieren (Node ≥ 18)

```bash
npm install -g wrangler
```

### 4. Worker deployen

```bash
cd worker
wrangler login                              # öffnet Browser
wrangler secret put STRAVA_CLIENT_ID        # ID aus Schritt 1 einfügen
wrangler secret put STRAVA_CLIENT_SECRET    # Secret aus Schritt 1 einfügen
wrangler deploy
```

Im Output steht eine URL wie `https://gpx-wetter-strava.<account>.workers.dev` —
diese in `config.js` (im Hauptverzeichnis) als `WORKER_URL` eintragen.

## Free Tier

Cloudflare Workers Free: **100 000 Requests pro Tag**. Pro Strava-Import braucht
der Worker genau **1 Request** (den Token-Tausch) — das reicht für tausende
Imports pro Tag.

## Updates

Bei Code-Änderungen am Worker einfach `wrangler deploy` erneut ausführen.
