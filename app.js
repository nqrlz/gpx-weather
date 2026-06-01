document.addEventListener('DOMContentLoaded', () => {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const fileInput    = document.getElementById('gpx-file');
  const dropZone     = document.getElementById('drop-zone');
  const fileNameEl   = document.getElementById('file-name');
  const datetimeIn   = document.getElementById('start-datetime');
  const speedIn      = document.getElementById('avg-speed');
  const analyzeBtn   = document.getElementById('analyze-btn');
  const loadingEl    = document.getElementById('loading');
  const loadingText  = document.getElementById('loading-text');
  const resultsEl    = document.getElementById('results-section');
  const summaryEl    = document.getElementById('tour-summary');
  const errorEl      = document.getElementById('error-msg');
  const stravaBtn    = document.getElementById('strava-btn');
  const stravaModal  = document.getElementById('strava-modal');
  const stravaList   = document.getElementById('strava-list');
  const stravaGreet  = document.getElementById('strava-greeting');
  const stravaTabs   = document.querySelectorAll('.modal-tab');
  const stravaLogoutBtn = document.getElementById('strava-logout');

  // ── Default start time = now (local) ─────────────────────────────────────
  const now = new Date();
  now.setSeconds(0, 0);
  // datetime-local expects YYYY-MM-DDTHH:MM in local time
  const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  datetimeIn.value = localISO;

  // ── State ─────────────────────────────────────────────────────────────────
  let trackPoints = null;   // populated by either GPX upload or Strava import
  let sourceLabel = null;   // human-readable origin (filename / Strava activity name)
  let mapInst     = null;

  // Map consent — Carto tile requests are gated behind an explicit click (DSGVO).
  // Persists only for the lifetime of this page load.
  let mapConsentGiven = false;
  let pendingMapData  = null;
  const mapConsentEl  = document.getElementById('map-consent');
  const mapEl         = document.getElementById('map');
  const mapConsentBtn = document.getElementById('map-consent-btn');

  mapConsentBtn.addEventListener('click', () => {
    mapConsentGiven = true;
    mapConsentEl.classList.add('hidden');
    mapEl.classList.remove('hidden');
    if (pendingMapData) {
      showMap(pendingMapData);
      pendingMapData = null;
    }
  });

  function showMap({ routeWithDist, weatherPoints }) {
    if (!mapInst) mapInst = initMap('map');
    renderMap(mapInst, routeWithDist, weatherPoints);
  }

  // ── Strava button visibility ──────────────────────────────────────────────
  if (typeof stravaConfigured === 'function' && stravaConfigured()) {
    stravaBtn.classList.remove('hidden');
  }

  // ── File handling ─────────────────────────────────────────────────────────
  function loadFile(file) {
    if (!file || !file.name.endsWith('.gpx')) {
      showError('Bitte eine gültige .gpx-Datei auswählen.');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        trackPoints = parseGPX(e.target.result);
        sourceLabel = file.name;
        fileNameEl.textContent = file.name;
        dropZone.classList.add('has-file');
        analyzeBtn.disabled = false;
        hideError();
      } catch (err) {
        showError(err.message);
      }
    };
    reader.onerror = () => showError('Datei konnte nicht gelesen werden.');
    reader.readAsText(file);
  }

  function loadTrackPoints(points, label) {
    trackPoints = points;
    sourceLabel = label;
    fileNameEl.textContent = label;
    dropZone.classList.add('has-file');
    analyzeBtn.disabled = false;
    hideError();
  }

  fileInput.addEventListener('change', e => loadFile(e.target.files[0]));

  // Drag & drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    loadFile(e.dataTransfer.files[0]);
  });

  // ── Analyse ───────────────────────────────────────────────────────────────
  analyzeBtn.addEventListener('click', async () => {
    if (!trackPoints) return;

    const speed     = parseFloat(speedIn.value);
    const startTime = new Date(datetimeIn.value);

    if (isNaN(speed) || speed < 1) {
      showError('Bitte eine gültige Geschwindigkeit (≥ 1 km/h) eingeben.');
      return;
    }
    if (isNaN(startTime.getTime())) {
      showError('Bitte ein gültiges Datum und Uhrzeit eingeben.');
      return;
    }

    hideError();
    setLoading(true, 'Strecke wird verarbeitet…');
    resultsEl.classList.add('hidden');

    try {
      // 1. Build route with cumulative distances
      const routeWithDist = buildRouteWithDistances(trackPoints);

      // 2. Sample N evenly-spaced weather points
      const { sampled, totalKm } = sampleRoutePoints(routeWithDist);

      // 3. Attach arrival times
      const timedPoints = addArrivalTimes(sampled, startTime, speed);

      // 4. Fetch weather (batched, with progress)
      setLoading(true, `Wetterdaten werden geladen (0 / ${timedPoints.length})…`);
      const weatherPoints = await fetchAllWeather(timedPoints, (done, total) => {
        setLoading(true, `Wetterdaten werden geladen (${done} / ${total})…`);
      });

      // 4b. Adjust arrival times based on slope (GPX elevation) and headwind
      adjustArrivalTimes(weatherPoints, startTime, speed);

      // 5. Render results
      const endTime   = timedPoints[timedPoints.length - 1].arrivalTime;
      const durationH = (endTime - startTime) / 3_600_000;

      summaryEl.innerHTML = `
        <div class="summary-item"><span class="label">Distanz</span><span class="value">${totalKm.toFixed(1)} km</span></div>
        <div class="summary-item"><span class="label">Fahrtdauer</span><span class="value">${formatDuration(durationH)}</span></div>
        <div class="summary-item"><span class="label">Ø Tempo</span><span class="value">${speed} km/h</span></div>
        <div class="summary-item"><span class="label">Ankunft</span><span class="value">${formatTime(endTime)}</span></div>
        <div class="summary-item"><span class="label">Wetterpunkte</span><span class="value">${weatherPoints.length}</span></div>
      `;

      // Map — only initialize (= load Carto tiles) if user has consented this session
      if (mapConsentGiven) {
        mapConsentEl.classList.add('hidden');
        mapEl.classList.remove('hidden');
        showMap({ routeWithDist, weatherPoints });
      } else {
        pendingMapData = { routeWithDist, weatherPoints };
        mapConsentEl.classList.remove('hidden');
        mapEl.classList.add('hidden');
      }

      // Charts
      renderAllCharts(weatherPoints);

      resultsEl.classList.remove('hidden');
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
      showError(`Fehler: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  });

  // ── Strava integration ────────────────────────────────────────────────────
  stravaBtn?.addEventListener('click', () => {
    // Try cached session first (valid for ~6h after the last OAuth)
    const cached = stravaLoadSession();
    if (cached) {
      hideError();
      setupStravaSession(cached);
      return;
    }
    // Otherwise: full OAuth round-trip
    try {
      stravaBeginAuth({
        startDateTime: datetimeIn.value,
        avgSpeed:      speedIn.value,
      });
    } catch (err) {
      showError(err.message);
    }
  });

  stravaLogoutBtn?.addEventListener('click', () => {
    stravaClearSession();
    stravaSession.accessToken = null;
    stravaSession.athleteId   = null;
    stravaSession.routes      = null;
    stravaSession.activities  = null;
    closeStravaModal();
  });

  // Close-by-backdrop and close-button delegation
  stravaModal?.addEventListener('click', e => {
    if (e.target.dataset.close) closeStravaModal();
  });

  function openStravaModal()  { stravaModal.classList.remove('hidden'); }
  function closeStravaModal() { stravaModal.classList.add('hidden'); }

  // Strava session state — kept in closure, cleared when modal closes / page reloads
  const stravaSession = {
    accessToken: null,
    athleteId:   null,
    routes:      null,    // lazy
    activities:  null,    // lazy
    activeTab:   'routes',
  };

  // Tab switching
  stravaTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (target === stravaSession.activeTab) return;
      stravaTabs.forEach(t => t.classList.toggle('active', t === tab));
      stravaSession.activeTab = target;
      renderStravaList();
    });
  });

  async function renderStravaList() {
    const { accessToken, athleteId, activeTab } = stravaSession;
    if (!accessToken) return;

    if (activeTab === 'routes') {
      if (!stravaSession.routes) {
        stravaList.innerHTML = '<div class="loading">Routen werden geladen…</div>';
        try {
          stravaSession.routes = await stravaListRoutes(accessToken, athleteId, 30);
        } catch (err) {
          if (handleStravaAuthError(err)) return;
          stravaList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
          return;
        }
      }
      renderRouteRows(stravaSession.routes);
    } else {
      if (!stravaSession.activities) {
        stravaList.innerHTML = '<div class="loading">Aktivitäten werden geladen…</div>';
        try {
          stravaSession.activities = await stravaListActivities(accessToken, 30);
        } catch (err) {
          if (handleStravaAuthError(err)) return;
          stravaList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
          return;
        }
      }
      renderActivityRows(stravaSession.activities);
    }
  }

  // If the API rejects our token, the cached session is dead — wipe it so
  // the next click triggers a fresh OAuth round-trip.
  function handleStravaAuthError(err) {
    const msg = String(err?.message || '');
    if (msg.includes('(401)') || msg.includes('(403)')) {
      stravaClearSession();
      closeStravaModal();
      showError('Strava-Zugriff abgelaufen — bitte erneut "Von Strava importieren" klicken.');
      return true;
    }
    return false;
  }

  function renderRouteRows(routes) {
    if (!routes.length) {
      stravaList.innerHTML = '<div class="empty">Keine geplanten Rad-Routen gefunden.</div>';
      return;
    }
    stravaList.innerHTML = '';
    routes.forEach(rt => {
      const created = new Date(rt.created_at);
      const dateStr = created.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const km   = (rt.distance / 1000).toFixed(1);
      const hm   = Math.round(rt.elevation_gain || 0);
      const btn = makeListItem(dateStr, rt.name, `${km} km · ${hm} hm`);
      btn.addEventListener('click', async () => {
        // rt.id is a number — for route IDs > 2^53 JS loses precision.
        // Strava also returns id_str as exact string identifier; prefer that.
        await selectAndLoad(btn,
          () => stravaGetRoutePoints(stravaSession.accessToken, rt.id_str || rt.id),
          rt.name
        );
      });
      stravaList.appendChild(btn);
    });
  }

  function renderActivityRows(activities) {
    if (!activities.length) {
      stravaList.innerHTML = '<div class="empty">Keine Rad-Aktivitäten gefunden.</div>';
      return;
    }
    stravaList.innerHTML = '';
    activities.forEach(a => {
      const date = new Date(a.start_date_local);
      const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const km   = (a.distance / 1000).toFixed(1);
      const hm   = Math.round(a.total_elevation_gain || 0);
      const btn = makeListItem(dateStr, a.name, `${km} km · ${hm} hm`);
      btn.addEventListener('click', async () => {
        await selectAndLoad(btn,
          () => stravaGetActivityPoints(stravaSession.accessToken, a.id_str || a.id),
          a.name
        );
      });
      stravaList.appendChild(btn);
    });
  }

  function makeListItem(dateStr, name, stats) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'activity-item';
    btn.innerHTML = `
      <span class="activity-date">${dateStr}</span>
      <span class="activity-name">${escapeHtml(name)}</span>
      <span class="activity-stats">${stats}</span>
    `;
    return btn;
  }

  async function selectAndLoad(btn, fetchPoints, name) {
    stravaList.querySelectorAll('.activity-item').forEach(el => el.disabled = true);
    try {
      const pts = await fetchPoints();
      loadTrackPoints(pts, `Strava — ${name}`);
      closeStravaModal();
    } catch (err) {
      showError(err.message);
      stravaList.querySelectorAll('.activity-item').forEach(el => el.disabled = false);
    }
  }

  // Open the Strava modal with a known-good session (either cached or fresh).
  function setupStravaSession({ access_token, athlete_id, athlete_firstname }) {
    if (!athlete_id) {
      showError('Strava-Session ungültig.');
      stravaClearSession();
      return;
    }
    stravaSession.accessToken = access_token;
    stravaSession.athleteId   = athlete_id;
    stravaSession.routes      = null;
    stravaSession.activities  = null;
    stravaSession.activeTab   = 'routes';

    stravaGreet.textContent = athlete_firstname
      ? `Hallo ${athlete_firstname} — wähle eine Tour zum Importieren.`
      : 'Wähle eine Tour zum Importieren.';
    stravaLogoutBtn.classList.remove('hidden');
    stravaTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'routes'));

    openStravaModal();
    renderStravaList(); // lazy-loads routes
  }

  // ── Handle OAuth callback on initial page load ────────────────────────────
  (async () => {
    if (typeof stravaDetectCallback !== 'function') return;
    const cb = stravaDetectCallback();
    if (!cb) return;

    if (cb.error) {
      showError(cb.error === 'access_denied'
        ? 'Strava-Zugriff wurde verweigert.'
        : `Strava-Login fehlgeschlagen: ${cb.error}`);
      return;
    }

    // Restore form values from before the redirect
    if (cb.formBackup) {
      if (cb.formBackup.startDateTime) datetimeIn.value = cb.formBackup.startDateTime;
      if (cb.formBackup.avgSpeed)      speedIn.value    = cb.formBackup.avgSpeed;
    }

    setLoading(true, 'Strava-Login wird abgeschlossen…');
    try {
      const session = await stravaExchangeCode(cb.code);
      if (!session.athlete_id) throw new Error('Strava lieferte keine Athleten-ID zurück.');
      // Persist for ~6h so the next click skips the redirect entirely
      stravaSaveSession(session);
      setLoading(false);
      setupStravaSession(session);
    } catch (err) {
      showError(err.message);
      setLoading(false);
    }
  })();

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setLoading(show, text = '') {
    loadingEl.classList.toggle('hidden', !show);
    analyzeBtn.disabled = show;
    if (text) loadingText.textContent = text;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  function hideError() {
    errorEl.classList.add('hidden');
  }

  // Re-compute arrival times accounting for slope and headwind.
  // Model is intentionally simple — it's a planning estimate, not a power model.
  //   slopeFactor = 1 - slopePct × 0.05        clamped to [0.3, 1.5]
  //   windFactor  = 1 - headwindKmh / 60       clamped to [0.5, 1.3]
  //   effSpeed    = baseSpeed × slopeFactor × windFactor
  function adjustArrivalTimes(weatherPoints, startTime, baseSpeed) {
    if (weatherPoints.length < 2) return;
    weatherPoints[0].arrivalTime = startTime;
    weatherPoints[0].slopePct = 0;
    weatherPoints[0].headwindKmh = 0;

    let cumMs = 0;
    for (let i = 1; i < weatherPoints.length; i++) {
      const a = weatherPoints[i - 1];
      const b = weatherPoints[i];
      const segKm = b.distKm - a.distKm;
      if (segKm <= 0) { b.arrivalTime = new Date(startTime.getTime() + cumMs); continue; }

      // Slope (only if both endpoints have elevation data)
      let slopePct = 0;
      if (a.ele != null && b.ele != null) {
        slopePct = ((b.ele - a.ele) / (segKm * 1000)) * 100;
      }

      // Headwind: wind direction (meteorological "from") vs travel bearing.
      // delta = 0 → pure headwind; delta = 180 → pure tailwind.
      const bearing = bearingDeg(a.lat, a.lon, b.lat, b.lon);
      const windDir = (a.windDirection ?? 0);
      const windSpd = (a.windSpeed ?? 0);
      const delta = (windDir - bearing) * Math.PI / 180;
      const headwind = windSpd * Math.cos(delta);

      const slopeFactor = Math.max(0.3, Math.min(1.5, 1 - slopePct * 0.05));
      const windFactor  = Math.max(0.5, Math.min(1.3, 1 - headwind / 60));
      const effSpeed    = baseSpeed * slopeFactor * windFactor;
      const segMs       = (segKm / effSpeed) * 3_600_000;

      cumMs += segMs;
      b.arrivalTime = new Date(startTime.getTime() + cumMs);
      b.slopePct    = slopePct;
      b.headwindKmh = headwind;
    }
  }

  function formatDuration(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }

  function formatTime(date) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }
});
