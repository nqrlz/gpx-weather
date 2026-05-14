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

  // ── Default start time = now (local) ─────────────────────────────────────
  const now = new Date();
  now.setSeconds(0, 0);
  // datetime-local expects YYYY-MM-DDTHH:MM in local time
  const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  datetimeIn.value = localISO;

  // ── State ─────────────────────────────────────────────────────────────────
  let gpxText   = null;
  let mapInst   = null;

  // ── File handling ─────────────────────────────────────────────────────────
  function loadFile(file) {
    if (!file || !file.name.endsWith('.gpx')) {
      showError('Bitte eine gültige .gpx-Datei auswählen.');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      gpxText = e.target.result;
      fileNameEl.textContent = file.name;
      dropZone.classList.add('has-file');
      analyzeBtn.disabled = false;
      hideError();
    };
    reader.onerror = () => showError('Datei konnte nicht gelesen werden.');
    reader.readAsText(file);
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
    if (!gpxText) return;

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
    setLoading(true, 'GPX-Datei wird verarbeitet…');
    resultsEl.classList.add('hidden');

    try {
      // 1. Parse
      const trackPoints = parseGPX(gpxText);

      // 2. Build route with cumulative distances
      const routeWithDist = buildRouteWithDistances(trackPoints);

      // 3. Sample N evenly-spaced weather points
      const { sampled, totalKm } = sampleRoutePoints(routeWithDist);

      // 4. Attach arrival times
      const timedPoints = addArrivalTimes(sampled, startTime, speed);

      // 5. Fetch weather (batched, with progress)
      setLoading(true, `Wetterdaten werden geladen (0 / ${timedPoints.length})…`);
      const weatherPoints = await fetchAllWeather(timedPoints, (done, total) => {
        setLoading(true, `Wetterdaten werden geladen (${done} / ${total})…`);
      });

      // 5b. Adjust arrival times based on slope (GPX elevation) and headwind
      adjustArrivalTimes(weatherPoints, startTime, speed);

      // 6. Render results
      const endTime   = timedPoints[timedPoints.length - 1].arrivalTime;
      const durationH = (endTime - startTime) / 3_600_000;

      summaryEl.innerHTML = `
        <div class="summary-item"><span class="label">Distanz</span><span class="value">${totalKm.toFixed(1)} km</span></div>
        <div class="summary-item"><span class="label">Fahrtdauer</span><span class="value">${formatDuration(durationH)}</span></div>
        <div class="summary-item"><span class="label">Ø Tempo</span><span class="value">${speed} km/h</span></div>
        <div class="summary-item"><span class="label">Ankunft</span><span class="value">${formatTime(endTime)}</span></div>
        <div class="summary-item"><span class="label">Wetterpunkte</span><span class="value">${weatherPoints.length}</span></div>
      `;

      // Map
      if (!mapInst) mapInst = initMap('map');
      renderMap(mapInst, routeWithDist, weatherPoints);

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
