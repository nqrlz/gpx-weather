function parseGPX(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Ungültige GPX-Datei – konnte nicht geparst werden.');
  }

  const trkpts = doc.querySelectorAll('trkpt');
  if (trkpts.length === 0) {
    throw new Error('Keine Track-Punkte in der GPX-Datei gefunden.');
  }

  const points = Array.from(trkpts).map(pt => {
    const eleEl = pt.querySelector('ele');
    const ele = eleEl ? parseFloat(eleEl.textContent) : null;
    return {
      lat: parseFloat(pt.getAttribute('lat')),
      lon: parseFloat(pt.getAttribute('lon')),
      ele: ele != null && !isNaN(ele) ? ele : null,
    };
  }).filter(pt => !isNaN(pt.lat) && !isNaN(pt.lon));

  if (points.length < 2) {
    throw new Error('Die GPX-Datei enthält zu wenige gültige Punkte.');
  }

  return points;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function buildRouteWithDistances(points) {
  const result = [{ ...points[0], cumDist: 0 }];
  for (let i = 1; i < points.length; i++) {
    const prev = result[i - 1];
    const d = haversineKm(prev.lat, prev.lon, points[i].lat, points[i].lon);
    result.push({ ...points[i], cumDist: prev.cumDist + d });
  }
  return result;
}

function sampleRoutePoints(routeWithDist, intervalKm = 10, minPoints = 5, maxPoints = 30) {
  const totalKm = routeWithDist[routeWithDist.length - 1].cumDist;

  let n = Math.round(totalKm / intervalKm) + 1;
  n = Math.max(minPoints, Math.min(maxPoints, n));

  const sampled = [];
  for (let i = 0; i < n; i++) {
    const targetDist = (i / (n - 1)) * totalKm;

    // Binary search for the segment containing targetDist
    let lo = 0, hi = routeWithDist.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (routeWithDist[mid].cumDist <= targetDist) lo = mid;
      else hi = mid;
    }

    const p1 = routeWithDist[lo];
    const p2 = routeWithDist[hi];
    const span = p2.cumDist - p1.cumDist;
    const t = span === 0 ? 0 : (targetDist - p1.cumDist) / span;

    // Interpolate elevation when both endpoints have it
    let ele = null;
    if (p1.ele != null && p2.ele != null) ele = p1.ele + t * (p2.ele - p1.ele);
    else if (p1.ele != null) ele = p1.ele;
    else if (p2.ele != null) ele = p2.ele;

    sampled.push({
      lat: p1.lat + t * (p2.lat - p1.lat),
      lon: p1.lon + t * (p2.lon - p1.lon),
      ele,
      distKm: targetDist,
    });
  }

  return { sampled, totalKm };
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function addArrivalTimes(sampledPoints, startTime, avgSpeedKmh) {
  return sampledPoints.map(pt => ({
    ...pt,
    arrivalTime: new Date(startTime.getTime() + (pt.distKm / avgSpeedKmh) * 3_600_000),
  }));
}
