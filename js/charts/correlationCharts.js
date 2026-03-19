// ── Correlation Charts ──
// Brix vs temperature and tANT vs rainfall scatter plots.

// Brix vs Temperature on sample date — scatter by variety/origin
Charts.createTempCorrelation = function(canvasId, berryData) {
  if (typeof WeatherStore === 'undefined') return;
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const resolveColor = this._resolveColorFn();
  const groupField = this._groupField();
  const groups = {};

  berryData.forEach(d => {
    if (typeof d.brix !== 'number' || !d.sampleDate) return;
    const temp = WeatherStore.getTempForDate(d.sampleDate, d.appellation);
    if (temp === null) return;
    const g = d[groupField] || 'Unknown';
    if (!groups[g]) groups[g] = [];
    groups[g].push({ x: temp, y: d.brix, sampleId: d.sampleId, variety: d.variety, appellation: d.appellation });
  });

  const datasets = Object.entries(groups).map(([name, pts]) => {
    const color = resolveColor(name);
    return {
      label: name, data: pts,
      backgroundColor: color + 'AA', pointBorderColor: color,
      pointRadius: CONFIG.chartDefaults.pointRadius + 1, borderWidth: 0, showLine: false,
      hidden: this.hiddenSeries.has(name)
    };
  });

  if (!datasets.some(d => d.data.length)) {
    this._drawNoData(canvas, 'Sin datos de temperatura para correlación');
    return;
  }

  this.instances[canvasId] = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: this.tooltipConfig() },
      scales: this.axisOpts('Temperatura media °C (día de muestreo)', 'Brix (°Bx)'),
      animation: { duration: 300 }
    }
  });
};

// tANT vs Cumulative Rainfall since July 1 — scatter by variety/origin
Charts.createRainCorrelation = function(canvasId, berryData) {
  if (typeof WeatherStore === 'undefined') return;
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const resolveColor = this._resolveColorFn();
  const groupField = this._groupField();
  const groups = {};

  berryData.forEach(d => {
    if (typeof d.tANT !== 'number' || !d.sampleDate) return;
    const rain = WeatherStore.getCumulativeRainfall(d.sampleDate, null, d.appellation);
    if (rain === null) return;
    const g = d[groupField] || 'Unknown';
    if (!groups[g]) groups[g] = [];
    groups[g].push({ x: rain, y: d.tANT, sampleId: d.sampleId, variety: d.variety, appellation: d.appellation });
  });

  const datasets = Object.entries(groups).map(([name, pts]) => {
    const color = resolveColor(name);
    return {
      label: name, data: pts,
      backgroundColor: color + 'AA', pointBorderColor: color,
      pointRadius: CONFIG.chartDefaults.pointRadius + 1, borderWidth: 0, showLine: false,
      hidden: this.hiddenSeries.has(name)
    };
  });

  if (!datasets.some(d => d.data.length)) {
    this._drawNoData(canvas, 'Sin datos de lluvia para correlación');
    return;
  }

  this.instances[canvasId] = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: this.tooltipConfig() },
      scales: this.axisOpts('Lluvia acumulada desde 1 Jul (mm)', 'tANT (ppm ME)'),
      animation: { duration: 300 }
    }
  });
};
