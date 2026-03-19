// ── Vintage & Weather Charts ──
// Vintage comparison, temperature time series, and rainfall scatter.

// Vintage comparison chart: overlay N vintages for same plots
Charts.createVintageComparison = function(canvasId, data, yField, yLabel) {
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Group by lot code and vintage
  const byLot = {};
  data.forEach(d => {
    const lot = d.lotCode;
    const v = d.vintage;
    const x = d.daysPostCrush;
    const y = d[yField];
    if (!lot || !v || x === null || y === null || typeof x !== 'number' || typeof y !== 'number') return;
    const key = lot;
    if (!byLot[key]) byLot[key] = {};
    if (!byLot[key][v]) byLot[key][v] = [];
    byLot[key][v].push({ x, y, sampleId: d.sampleId, variety: d.variety, appellation: d.appellation, vintage: v });
  });

  // Only keep lots that appear in 2+ vintages
  const datasets = [];

  Object.entries(byLot).forEach(([lot, vintages]) => {
    const vkeys = Object.keys(vintages).sort();
    if (vkeys.length < 2) return;
    vkeys.forEach(v => {
      const color = this._vintageColor(Number(v));
      const pts = vintages[v].sort((a, b) => a.x - b.x);
      datasets.push({
        label: `${lot} (${v})`,
        data: pts,
        borderColor: color,
        backgroundColor: color + '88',
        pointRadius: CONFIG.chartDefaults.pointRadius,
        pointHoverRadius: CONFIG.chartDefaults.pointHoverRadius,
        borderWidth: this.showLines ? 2 : 0,
        showLine: this.showLines,
        tension: 0.3,
        fill: false
      });
    });
  });

  if (datasets.length === 0) {
    this._drawNoData(canvas, 'No hay datos comparables entre vendimias');
    return;
  }

  this.instances[canvasId] = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: CONFIG.chartDefaults.tickColor,
            font: { size: 9, family: 'Sackers Gothic Medium' },
            boxWidth: 10,
            padding: 8
          }
        },
        tooltip: this.tooltipConfig()
      },
      scales: this.axisOpts('Días Post-Envero', yLabel),
      animation: { duration: 300 }
    }
  });
};

// Temperature time series: daily mean °C, all vintages overlaid
Charts.createWeatherTimeSeries = function(canvasId, vintages) {
  if (typeof WeatherStore === 'undefined') return;
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const datasets = [];
  for (const year of vintages) {
    const rows = WeatherStore.getRange(`${year}-07-01`, `${year}-10-31`);
    if (!rows.length) continue;
    const color = this._vintageColor(year);
    const pts   = rows
      .filter(r => r.temp_avg !== null)
      .map(r => ({ x: WeatherStore.dayOfSeason(r.date), y: r.temp_avg }));
    datasets.push({
      label: String(year),
      data:  pts,
      borderColor:     color,
      backgroundColor: 'transparent',
      pointRadius:     1.5,
      pointHoverRadius: 5,
      borderWidth:     1.5,
      showLine:        true,
      tension:         0.3,
      fill:            false
    });
  }

  if (!datasets.length) {
    this._drawNoData(canvas, 'Sin datos de temperatura disponibles');
    return;
  }

  this.instances[canvasId] = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' }, boxWidth: 12, padding: 10 }
        },
        tooltip: {
          backgroundColor: '#1C1C1C', borderColor: 'rgba(196,160,96,0.5)', borderWidth: 1,
          titleColor: '#DDB96E', bodyColor: '#D8D0C4',
          callbacks: {
            title: (items) => `Día ${items[0].raw.x} temporada ${items[0].dataset.label}`,
            label: (ctx)   => `Temp: ${ctx.raw.y?.toFixed(1)}°C`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Día de temporada (1 = 1 Jul)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
          ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
          grid:  { color: CONFIG.chartDefaults.gridColor }
        },
        y: {
          title: { display: true, text: 'Temperatura media (°C)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
          ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
          grid:  { color: CONFIG.chartDefaults.gridColor }
        }
      },
      animation: { duration: 300 }
    }
  });
};

// Rainfall scatter: each rainy day as a dot (x = day-of-season, y = mm)
Charts.createRainfallChart = function(canvasId, vintages) {
  if (typeof WeatherStore === 'undefined') return;
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const datasets = [];
  for (const year of vintages) {
    const rows = WeatherStore.getRange(`${year}-07-01`, `${year}-10-31`);
    if (!rows.length) continue;
    const color = this._vintageColor(year);
    const pts   = rows
      .filter(r => r.rainfall_mm !== null && r.rainfall_mm > 0)
      .map(r => ({ x: WeatherStore.dayOfSeason(r.date), y: r.rainfall_mm }));
    if (!pts.length) continue;
    datasets.push({
      label:           String(year),
      data:            pts,
      backgroundColor: color + 'BB',
      borderColor:     color,
      pointRadius:     5,
      pointHoverRadius: 8,
      showLine:        false
    });
  }

  if (!datasets.length) {
    this._drawNoData(canvas, 'Sin eventos de lluvia registrados');
    return;
  }

  this.instances[canvasId] = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' }, boxWidth: 12, padding: 10 }
        },
        tooltip: {
          backgroundColor: '#1C1C1C', borderColor: 'rgba(196,160,96,0.5)', borderWidth: 1,
          titleColor: '#DDB96E', bodyColor: '#D8D0C4',
          callbacks: {
            title: (items) => `Día ${items[0].raw.x} temporada ${items[0].dataset.label}`,
            label: (ctx)   => `Lluvia: ${ctx.raw.y?.toFixed(1)} mm`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Día de temporada (1 = 1 Jul)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
          ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
          grid:  { color: CONFIG.chartDefaults.gridColor }
        },
        y: {
          title: { display: true, text: 'Precipitación (mm)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
          ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
          grid:  { color: CONFIG.chartDefaults.gridColor }
        }
      },
      animation: { duration: 300 }
    }
  });
};
