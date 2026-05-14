function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function weatherCodeToEmoji(code) {
  if (code === 0)                      return '☀️';
  if (code === 1)                      return '🌤️';
  if (code === 2)                      return '⛅';
  if (code === 3)                      return '☁️';
  if (code >= 45 && code <= 48)        return '🌫️';
  if (code >= 51 && code <= 55)        return '🌦️';
  if (code >= 56 && code <= 57)        return '🌧️';
  if (code >= 61 && code <= 65)        return '🌧️';
  if (code >= 66 && code <= 67)        return '🌨️';
  if (code >= 71 && code <= 77)        return '❄️';
  if (code >= 80 && code <= 82)        return '🌦️';
  if (code >= 85 && code <= 86)        return '❄️';
  if (code === 95)                     return '⛈️';
  if (code >= 96 && code <= 99)        return '⛈️';
  return '🌡️';
}

function weatherCodeToLabel(code) {
  if (code === 0)                      return 'Klarer Himmel';
  if (code === 1)                      return 'Überwiegend klar';
  if (code === 2)                      return 'Teilweise bewölkt';
  if (code === 3)                      return 'Bedeckt';
  if (code >= 45 && code <= 48)        return 'Nebel';
  if (code >= 51 && code <= 55)        return 'Nieselregen';
  if (code >= 56 && code <= 57)        return 'Gefrierender Nieselregen';
  if (code >= 61 && code <= 65)        return 'Regen';
  if (code >= 66 && code <= 67)        return 'Gefrierender Regen';
  if (code >= 71 && code <= 77)        return 'Schnee';
  if (code >= 80 && code <= 82)        return 'Regenschauer';
  if (code >= 85 && code <= 86)        return 'Schneeschauer';
  if (code === 95)                     return 'Gewitter';
  if (code >= 96 && code <= 99)        return 'Gewitter mit Hagel';
  return 'Unbekannt';
}

async function fetchWeatherForPoint(pt) {
  const { lat, lon, arrivalTime } = pt;

  const startDate = formatDate(arrivalTime);
  // Request two days to safely cover overnight arrivals
  const endDate = formatDate(new Date(arrivalTime.getTime() + 24 * 3_600_000));

  const params = new URLSearchParams({
    latitude:       lat.toFixed(5),
    longitude:      lon.toFixed(5),
    hourly:         'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,uv_index,weathercode',
    wind_speed_unit: 'kmh',
    start_date:     startDate,
    end_date:       endDate,
    timezone:       'auto',
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Wetter-API Fehler (${res.status})`);

  const data = await res.json();
  if (data.error) throw new Error(data.reason ?? 'Unbekannter API-Fehler');

  // Find the hour in the response closest to the arrival time
  const target = arrivalTime.getTime();
  let bestIdx = 0, bestDiff = Infinity;
  data.hourly.time.forEach((t, i) => {
    // Open-Meteo returns local times without tz offset; treat as local
    const diff = Math.abs(new Date(t).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  });

  const h = data.hourly;
  const code = h.weathercode?.[bestIdx] ?? 0;

  return {
    ...pt,
    temperature:      h.temperature_2m?.[bestIdx] ?? null,
    precipProbability: h.precipitation_probability?.[bestIdx] ?? 0,
    precipitation:    h.precipitation?.[bestIdx] ?? 0,
    windSpeed:        h.wind_speed_10m?.[bestIdx] ?? 0,
    windDirection:    h.wind_direction_10m?.[bestIdx] ?? 0,
    uvIndex:          h.uv_index?.[bestIdx] ?? 0,
    weatherCode:      code,
    emoji:            weatherCodeToEmoji(code),
    weatherLabel:     weatherCodeToLabel(code),
  };
}

async function fetchAllWeather(sampledPoints, onProgress) {
  const results = [];
  // Batch of 5 parallel requests to be polite to the free API
  const BATCH = 5;
  for (let i = 0; i < sampledPoints.length; i += BATCH) {
    const batch = sampledPoints.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(fetchWeatherForPoint));
    results.push(...batchResults);
    if (onProgress) onProgress(results.length, sampledPoints.length);
  }
  return results;
}
