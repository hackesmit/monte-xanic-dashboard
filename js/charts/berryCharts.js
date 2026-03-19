// ── Berry Charts ──
// Scatter, bar, doughnut, and origin charts for berry data.

// Create a scatter/line chart
Charts.createScatter = function(canvasId, data, xField, yField, xLabel, yLabel) {
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const resolveColor = this._resolveColorFn();
  const groups = this.groupScatterData(data, xField, yField, this._groupField());
  const lastPoints = this._identifyLastPoints(data);

  const datasets = Object.entries(groups).map(([name, pts]) => {
    const color = resolveColor(name);
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    const radii = sorted.map(p => lastPoints.has(p.sampleId) ? CONFIG.chartDefaults.pointRadius + 3 : CONFIG.chartDefaults.pointRadius);
    const bgColors = sorted.map(p => lastPoints.has(p.sampleId) ? color : color + '99');
    const bdWidths = sorted.map(p => lastPoints.has(p.sampleId) ? 2 : 0.5);
    return {
      label: name,
      data: sorted,
      borderColor: color,
      backgroundColor: bgColors,
      pointBackgroundColor: bgColors,
      pointBorderColor: color,
      pointRadius: radii,
      pointHoverRadius: CONFIG.chartDefaults.pointHoverRadius,
      pointBorderWidth: bdWidths,
      borderWidth: this.showLines ? CONFIG.chartDefaults.borderWidth : 0,
      showLine: this.showLines,
      tension: CONFIG.chartDefaults.tension,
      fill: false,
      hidden: this.hiddenSeries.has(name)
    };
  });

  this.instances[canvasId] = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: this.tooltipConfig()
      },
      scales: this.axisOpts(xLabel, yLabel),
      animation: { duration: 300 }
    }
  });
};

// Create a pure scatter chart (no lines, e.g. Brix vs pH)
Charts.createPureScatter = function(canvasId, data, xField, yField, xLabel, yLabel) {
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const resolveColor = this._resolveColorFn();
  const groups = this.groupScatterData(data, xField, yField, this._groupField());

  const datasets = Object.entries(groups).map(([name, pts]) => {
    const color = resolveColor(name);
    return {
      label: name,
      data: pts,
      backgroundColor: color + 'AA',
      pointBackgroundColor: color + 'CC',
      pointBorderColor: color,
      pointRadius: CONFIG.chartDefaults.pointRadius + 1,
      pointHoverRadius: CONFIG.chartDefaults.pointHoverRadius,
      borderWidth: 0,
      showLine: false,
      hidden: this.hiddenSeries.has(name)
    };
  });

  this.instances[canvasId] = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: this.tooltipConfig()
      },
      scales: this.axisOpts(xLabel, yLabel),
      animation: { duration: 300 }
    }
  });
};

// Create horizontal bar chart (varietal comparison)
Charts.createBarChart = function(canvasId, data, valueField, label) {
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const byVar = {};
  data.forEach(d => {
    const v = d.variety;
    const val = d[valueField];
    if (v && typeof val === 'number' && !isNaN(val)) {
      if (!byVar[v]) byVar[v] = [];
      byVar[v].push(val);
    }
  });

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const labels = Object.keys(byVar).sort((a, b) => avg(byVar[b]) - avg(byVar[a]));
  const values = labels.map(v => parseFloat(avg(byVar[v]).toFixed(2)));
  const bgColors = labels.map(v => (CONFIG.varietyColors[v] || '#888') + '66');
  const bdColors = labels.map(v => CONFIG.varietyColors[v] || '#888');

  this.instances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: bgColors,
        borderColor: bdColors,
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1C1C1C',
          borderColor: 'rgba(196,160,96,0.5)',
          borderWidth: 1,
          titleColor: '#DDB96E',
          bodyColor: '#D8D0C4',
          callbacks: {
            label: (ctx) => `${label}: ${ctx.parsed.x}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
          grid: { color: CONFIG.chartDefaults.gridColor }
        },
        y: {
          ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
          grid: { color: 'transparent' }
        }
      },
      animation: { duration: 300 }
    }
  });
};

// Create horizontal bar chart grouped by origin
Charts.createOriginBarChart = function(canvasId, data, valueField, label) {
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const byOrigin = {};
  data.forEach(d => {
    const o = d.appellation;
    const val = d[valueField];
    if (o && typeof val === 'number' && !isNaN(val)) {
      if (!byOrigin[o]) byOrigin[o] = [];
      byOrigin[o].push(val);
    }
  });

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const origins = Object.keys(byOrigin).sort((a, b) => avg(byOrigin[b]) - avg(byOrigin[a]));
  const values = origins.map(o => parseFloat(avg(byOrigin[o]).toFixed(2)));
  const shortLabels = origins.map(o => Filters.shortenOrigin(o));
  const bgColors = origins.map(o => CONFIG.resolveOriginColor(o) + '66');
  const bdColors = origins.map(o => CONFIG.resolveOriginColor(o));

  this.instances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: shortLabels,
      datasets: [{
        label,
        data: values,
        backgroundColor: bgColors,
        borderColor: bdColors,
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1C1C1C',
          borderColor: 'rgba(196,160,96,0.5)',
          borderWidth: 1,
          titleColor: '#DDB96E',
          bodyColor: '#D8D0C4',
          callbacks: {
            title: (items) => origins[items[0].dataIndex] || items[0].label,
            label: (ctx) => `${label}: ${ctx.parsed.x}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
          grid: { color: CONFIG.chartDefaults.gridColor }
        },
        y: {
          ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
          grid: { color: 'transparent' }
        }
      },
      animation: { duration: 300 }
    }
  });
};

// Create doughnut chart (origin distribution)
Charts.createDoughnut = function(canvasId, data) {
  this.destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const counts = {};
  data.forEach(d => {
    if (d.appellation) {
      counts[d.appellation] = (counts[d.appellation] || 0) + 1;
    }
  });

  const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const values = labels.map(l => counts[l]);
  const colors = labels.map(l => CONFIG.resolveOriginColor(l));

  this.instances[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + 'CC'),
        borderColor: '#161616',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'right',
          labels: {
            color: CONFIG.chartDefaults.tickColor,
            font: { size: 9, family: 'Sackers Gothic Medium' },
            boxWidth: 10,
            padding: 10
          }
        },
        tooltip: {
          backgroundColor: '#1C1C1C',
          borderColor: 'rgba(196,160,96,0.5)',
          borderWidth: 1,
          titleColor: '#DDB96E',
          bodyColor: '#D8D0C4'
        }
      },
      animation: { duration: 300 }
    }
  });
};

// Update all berry charts
Charts.updateBerryCharts = function(data) {
  const clean = data.filter(d => !(typeof d.pH === 'number' && (d.pH < CONFIG.thresholds.phMin || d.pH > CONFIG.thresholds.phMax)));

  this.updateLegend(data);
  this.createScatter('chartBrix', clean, 'daysPostCrush', 'brix', 'Días Post-Envero', 'Brix (°Bx)');
  this.createScatter('chartAnt', clean, 'daysPostCrush', 'tANT', 'Días Post-Envero', 'tANT (ppm ME)');
  this.createScatter('chartPH', clean, 'daysPostCrush', 'pH', 'Días Post-Envero', 'pH');
  this.createScatter('chartTA', clean, 'daysPostCrush', 'ta', 'Días Post-Envero', 'AT (g/L)');
  this.createScatter('chartWeight', clean, 'daysPostCrush', 'berryFW', 'Días Post-Envero', 'Peso Baya (g)');
  this.createPureScatter('chartScatter', clean, 'pH', 'brix', 'pH', 'Brix');
  this.createBarChart('chartVarBrix', clean, 'brix', 'Brix Promedio');
  this.createBarChart('chartVarAnt', clean, 'tANT', 'tANT Promedio');
  this.createDoughnut('chartOrigen', data);
  this.createOriginBarChart('chartOriginBrix', clean, 'brix', 'Brix Promedio');
  this.createOriginBarChart('chartOriginAnt', clean, 'tANT', 'tANT Promedio');
  this.createOriginBarChart('chartOriginPH', clean, 'pH', 'pH Promedio');
  this.createOriginBarChart('chartOriginTA', clean, 'ta', 'AT Promedio');
};
