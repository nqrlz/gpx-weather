const _charts = {};

function _destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function _xLabels(weatherPoints) {
  return weatherPoints.map(pt => {
    const km   = Math.round(pt.distKm);
    const time = pt.arrivalTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${km} km | ${time}`;
  });
}

const GRID     = 'rgba(10,10,10,0.06)';
const TICKCOL  = '#6b6b6b';
const TITLECOL = '#0a0a0a';
const MONO     = "'Geist Mono', ui-monospace, Menlo, monospace";

function _xAxis(labels) {
  return {
    ticks: {
      font: { size: 9, weight: '400', family: MONO },
      color: TICKCOL,
      maxRotation: 0,
      autoSkipPadding: 8,
      callback(val, idx) { return labels[idx].split(' | '); },
    },
    grid: { color: GRID, drawTicks: false },
    border: { display: false },
  };
}

function _yAxis(titleText, extras = {}) {
  return {
    title: { display: !!titleText, text: titleText, color: TITLECOL, font: { size: 10, weight: '500', family: MONO } },
    ticks: { font: { size: 9, family: MONO }, color: TICKCOL, padding: 4 },
    grid:  { color: GRID, drawTicks: false },
    border: { display: false },
    ...extras,
  };
}

function _baseOptions(labels) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 4, right: 8, bottom: 0, left: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0a0a0a',
        titleFont: { size: 10.5, family: MONO },
        bodyFont:  { size: 11, family: MONO },
        padding: 8,
        cornerRadius: 0,
        displayColors: false,
      },
    },
    scales: {
      x: _xAxis(labels),
    },
  };
}

function renderTemperatureChart(wpts) {
  _destroyChart('temp');
  const labels = _xLabels(wpts);
  const ctx = document.getElementById('chart-temp').getContext('2d');
  const opts = _baseOptions(labels);

  _charts.temp = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: wpts.map(p => p.temperature),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.08)',
        borderWidth: 1.5,
        fill: true,
        tension: 0.4,
        pointRadius: 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: '#ef4444',
        pointBorderWidth: 0,
      }],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        tooltip: { ...opts.plugins.tooltip, callbacks: { label: c => `${c.parsed.y?.toFixed(1)} °C` } },
      },
      scales: { x: opts.scales.x, y: _yAxis('°C') },
    },
  });
}

function renderPrecipChart(wpts) {
  _destroyChart('precip');
  const labels = _xLabels(wpts);
  const ctx = document.getElementById('chart-precip').getContext('2d');
  const opts = _baseOptions(labels);

  _charts.precip = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'mm',
          data: wpts.map(p => p.precipitation),
          backgroundColor: 'rgba(59,130,246,0.55)',
          borderWidth: 0,
          borderRadius: 2,
          barPercentage: 0.45,
          categoryPercentage: 0.7,
          yAxisID: 'y',
          order: 2,
        },
        {
          label: '%',
          data: wpts.map(p => p.precipProbability),
          type: 'line',
          borderColor: '#1d4ed8',
          backgroundColor: 'rgba(29,78,216,0.0)',
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 2.5,
          pointHoverRadius: 5,
          pointBackgroundColor: '#1d4ed8',
          pointBorderWidth: 0,
          yAxisID: 'y1',
          order: 1,
        },
      ],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { font: { size: 10, family: MONO }, color: TITLECOL, boxWidth: 10, boxHeight: 10, padding: 8 },
        },
        tooltip: { ...opts.plugins.tooltip, mode: 'index', intersect: false },
      },
      scales: {
        x: opts.scales.x,
        y:  _yAxis('mm', { position: 'left', beginAtZero: true }),
        y1: _yAxis('%',  { position: 'right', min: 0, max: 100, grid: { display: false }, border: { display: false } }),
      },
    },
  });
}

function renderWindChart(wpts) {
  _destroyChart('wind');
  const labels = _xLabels(wpts);
  const ctx = document.getElementById('chart-wind').getContext('2d');
  const opts = _baseOptions(labels);

  const colors = wpts.map(p => {
    const s = p.windSpeed ?? 0;
    if (s < 12) return 'rgba(34,197,94,0.65)';
    if (s < 29) return 'rgba(234,179,8,0.65)';
    if (s < 50) return 'rgba(249,115,22,0.65)';
    return 'rgba(239,68,68,0.65)';
  });

  _charts.wind = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: wpts.map(p => p.windSpeed),
        backgroundColor: colors,
        borderWidth: 0,
        borderRadius: 2,
        barPercentage: 0.5,
        categoryPercentage: 0.7,
      }],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        tooltip: {
          ...opts.plugins.tooltip,
          callbacks: {
            label(c) {
              const pt = wpts[c.dataIndex];
              const dirs = ['N','NNO','NO','ONO','O','OSO','SO','SSO','S','SSW','SW','WSW','W','WNW','NW','NNW'];
              const dir = dirs[Math.round((pt.windDirection ?? 0) / 22.5) % 16];
              return [`${(pt.windSpeed ?? 0).toFixed(0)} km/h`, `aus ${dir}`];
            },
          },
        },
      },
      scales: { x: opts.scales.x, y: _yAxis('km/h', { beginAtZero: true }) },
    },
  });
}

function renderUvChart(wpts) {
  _destroyChart('uv');
  const labels = _xLabels(wpts);
  const ctx = document.getElementById('chart-uv').getContext('2d');
  const opts = _baseOptions(labels);

  const colors = wpts.map(p => {
    const uv = p.uvIndex ?? 0;
    if (uv < 3)  return 'rgba(34,197,94,0.65)';
    if (uv < 6)  return 'rgba(234,179,8,0.65)';
    if (uv < 8)  return 'rgba(249,115,22,0.65)';
    if (uv < 11) return 'rgba(239,68,68,0.65)';
    return 'rgba(124,58,237,0.65)';
  });

  _charts.uv = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: wpts.map(p => p.uvIndex),
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 2,
          barPercentage: 0.5,
          categoryPercentage: 0.7,
        },
        {
          // Threshold line at UV 3: WHO/BfS empfehlen ab hier Sonnenschutz
          type: 'line',
          data: Array(wpts.length).fill(3),
          borderColor: '#6b6b6b',
          borderWidth: 1.2,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        tooltip: {
          ...opts.plugins.tooltip,
          filter: ctx => ctx.datasetIndex === 0,
          callbacks: {
            label(c) {
              const uv = c.parsed.y ?? 0;
              const risk = uv < 3 ? 'Niedrig' : uv < 6 ? 'Moderat' : uv < 8 ? 'Hoch' : uv < 11 ? 'Sehr hoch' : 'Extrem';
              return [`UV ${uv.toFixed(1)}`, risk];
            },
          },
        },
      },
      scales: { x: opts.scales.x, y: _yAxis('UV', { beginAtZero: true }) },
    },
  });
}

function renderAllCharts(weatherPoints) {
  renderTemperatureChart(weatherPoints);
  renderPrecipChart(weatherPoints);
  renderWindChart(weatherPoints);
  renderUvChart(weatherPoints);
}
