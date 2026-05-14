let _map = null;
let _mapLayers = [];

function initMap(containerId) {
  if (_map) { _map.remove(); _map = null; }
  _map = L.map(containerId);
  // CyclOSM: cycling-focused style — shows roads, forest paths, cycle paths distinctly
  L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Style: <a href="https://www.cyclosm.org" target="_blank">CyclOSM</a>',
    subdomains: 'abc',
    maxZoom: 20,
  }).addTo(_map);
  return _map;
}

function precipToColor(prob) {
  if (prob < 20) return '#22c55e';
  if (prob < 40) return '#eab308';
  if (prob < 60) return '#f97316';
  if (prob < 80) return '#ef4444';
  return '#7c3aed';
}

function windSpeedToColor(speed) {
  if (speed < 12) return '#22c55e';
  if (speed < 29) return '#eab308';
  if (speed < 50) return '#f97316';
  return '#ef4444';
}

function windSpeedToArrowSize(speed) {
  if (speed < 12) return 22;
  if (speed < 29) return 30;
  if (speed < 50) return 40;
  return 50;
}

// Wind direction = where wind comes FROM (meteorological convention).
// Arrow should point where wind is GOING → rotate by windDirection + 180°.
function createWindArrowIcon(windDirection, windSpeed) {
  const rotate = (windDirection + 180) % 360;
  const color  = windSpeedToColor(windSpeed);
  const sz     = windSpeedToArrowSize(windSpeed);
  const half   = sz / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="-12 -22 24 44">
    <g transform="rotate(${rotate})">
      <line x1="0" y1="20" x2="0" y2="-10" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
      <polygon points="0,-22 -7,-8 7,-8" fill="${color}"/>
    </g>
  </svg>`;

  // Anchor offsets shift the visual position relative to the lat/lon point.
  // We push the arrow ~50px to the right and ~10px up so it sits next to the
  // emoji marker, never overlapping it, regardless of zoom level.
  return L.divIcon({
    html: svg,
    className: 'wind-arrow-icon',
    iconSize:   [sz, sz],
    iconAnchor: [half - 50, half + 10],
  });
}

function windDirLabel(deg) {
  const dirs = ['N','NNO','NO','ONO','O','OSO','SO','SSO','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function renderMap(map, routeWithDist, weatherPoints) {
  _mapLayers.forEach(l => map.removeLayer(l));
  _mapLayers = [];

  const trackLatLons = routeWithDist.map(p => [p.lat, p.lon]);

  // Colored segments — follow the actual GPX track between consecutive weather points
  for (let i = 0; i < weatherPoints.length - 1; i++) {
    const a = weatherPoints[i];
    const b = weatherPoints[i + 1];
    const avgProb = (a.precipProbability + b.precipProbability) / 2;

    // Collect original track points whose cumulative distance falls in [a.distKm, b.distKm]
    const between = routeWithDist
      .filter(p => p.cumDist >= a.distKm && p.cumDist <= b.distKm)
      .map(p => [p.lat, p.lon]);

    // Prepend/append the exact sample points to avoid gaps between segments
    const segLatLons = [[a.lat, a.lon], ...between, [b.lat, b.lon]];

    const seg = L.polyline(segLatLons, {
      color:   precipToColor(avgProb),
      weight:  5,
      opacity: 0.9,
      lineJoin: 'round',
      lineCap:  'round',
    }).addTo(map);
    _mapLayers.push(seg);
  }

  // Emoji markers + wind arrows at each weather point
  weatherPoints.forEach(pt => {
    const timeStr  = pt.arrivalTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const distStr  = pt.distKm < 0.5 ? 'Start' : `${Math.round(pt.distKm)} km`;
    const temp     = pt.temperature != null ? `${pt.temperature.toFixed(1)}°C` : '–';
    const precip   = `${pt.precipProbability ?? 0}% | ${(pt.precipitation ?? 0).toFixed(1)} mm`;
    const wind     = `${(pt.windSpeed ?? 0).toFixed(0)} km/h aus ${windDirLabel(pt.windDirection ?? 0)}`;
    const uv       = (pt.uvIndex ?? 0).toFixed(1);

    // Weather emoji marker
    const emojiIcon = L.divIcon({
      html: `<div class="weather-marker">
               <span class="weather-emoji">${pt.emoji}</span>
               <span class="weather-label">${distStr}</span>
             </div>`,
      className:  '',
      iconSize:   [64, 48],
      iconAnchor: [32, 24],
    });

    const slopeRow = pt.slopePct != null && Math.abs(pt.slopePct) > 0.3
      ? `Steigung: ${pt.slopePct > 0 ? '+' : ''}${pt.slopePct.toFixed(1)}%<br>` : '';
    const headRow = pt.headwindKmh != null && Math.abs(pt.headwindKmh) > 1
      ? `${pt.headwindKmh > 0 ? 'Gegenwind' : 'Rückenwind'}: ${Math.abs(pt.headwindKmh).toFixed(0)} km/h<br>` : '';

    const marker = L.marker([pt.lat, pt.lon], { icon: emojiIcon })
      .bindPopup(`<div class="popup-content">
        <strong>${distStr} – ${timeStr} Uhr</strong>
        ${pt.emoji} ${pt.weatherLabel}<br>
        Temperatur: ${temp}<br>
        Niederschlag: ${precip}<br>
        Wind: ${wind}<br>
        UV-Index: ${uv}<br>
        ${slopeRow}${headRow}
      </div>`, { maxWidth: 240 })
      .addTo(map);
    _mapLayers.push(marker);

    // Wind arrow — offset slightly so it doesn't overlap the emoji
    const windIcon   = createWindArrowIcon(pt.windDirection ?? 0, pt.windSpeed ?? 0);
    const windMarker = L.marker([pt.lat, pt.lon], { icon: windIcon })
      .bindTooltip(`💨 ${(pt.windSpeed ?? 0).toFixed(0)} km/h aus ${windDirLabel(pt.windDirection ?? 0)}`, { direction: 'top' })
      .addTo(map);
    _mapLayers.push(windMarker);
  });

  // Defer fitBounds so the container has its final CSS size
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(trackLatLons).pad(0.1));
  }, 50);
}
