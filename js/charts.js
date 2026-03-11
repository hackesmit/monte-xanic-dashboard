// ── Chart Rendering ──

const Charts = {
  instances: {},
  showLines: false,  // Toggle: scatter only by default
  hiddenSeries: new Set(),

  destroy(id) {
    if (this.instances[id]) {
      this.instances[id].destroy();
      delete this.instances[id];
    }
  },

  destroyAll() {
    Object.keys(this.instances).forEach(id => this.destroy(id));
  },

  axisOpts(xLabel, yLabel) {
    return {
      x: {
        title: { display: !!xLabel, text: xLabel, color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
        ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
        grid: { color: CONFIG.chartDefaults.gridColor }
      },
      y: {
        title: { display: !!yLabel, text: yLabel, color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
        ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
        grid: { color: CONFIG.chartDefaults.gridColor }
      }
    };
  },

  // Build tooltip that always shows Sample Id
  tooltipConfig() {
    return {
      callbacks: {
        title: (items) => {
          if (items.length && items[0].raw && items[0].raw.sampleId) {
            return items[0].raw.sampleId;
          }
          return items[0]?.dataset?.label || '';
        },
        label: (ctx) => {
          const r = ctx.raw;
          const lines = [];
          if (r.sampleId) lines.push(`Lote: ${r.sampleId}`);
          if (r.variety) lines.push(`Varietal: ${r.variety}`);
          if (r.appellation) lines.push(`Origen: ${r.appellation}`);
          lines.push(`${ctx.dataset.label || 'Y'}: ${typeof r.y === 'number' ? r.y.toFixed(2) : r.y}`);
          if (r.x !== undefined) lines.push(`X: ${typeof r.x === 'number' ? r.x.toFixed(1) : r.x}`);
          return lines;
        }
      },
      backgroundColor: '#1C1C1C',
      borderColor: 'rgba(196,160,96,0.5)',
      borderWidth: 1,
      titleColor: '#DDB96E',
      bodyColor: '#D8D0C4',
      titleFont: { family: 'Sackers Gothic Medium', weight: '400', size: 11 },
      bodyFont: { family: 'Sackers Gothic Medium', weight: '300', size: 10 },
      padding: 10,
      displayColors: true
    };
  },

  // Group data by a field and return datasets
  groupScatterData(data, xField, yField, groupField) {
    const groups = {};
    data.forEach(d => {
      const x = d[xField];
      const y = d[yField];
      const g = d[groupField] || 'Unknown';
      if (x === null || y === null || x === undefined || y === undefined) return;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (!groups[g]) groups[g] = [];
      groups[g].push({
        x, y,
        sampleId: d.sampleId,
        variety: d.variety,
        appellation: d.appellation,
        vintage: d.vintage
      });
    });
    return groups;
  },

  // Create a scatter/line chart
  createScatter(canvasId, data, xField, yField, xLabel, yLabel) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colorBy = Filters.state.colorBy;
    const groupField = colorBy === 'origin' ? 'appellation' : 'variety';
    const colors = colorBy === 'origin' ? CONFIG.originColors : CONFIG.varietyColors;
    const groups = this.groupScatterData(data, xField, yField, groupField);

    const datasets = Object.entries(groups).map(([name, pts]) => {
      const color = colors[name] || '#888888';
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      return {
        label: name,
        data: sorted,
        borderColor: color,
        backgroundColor: color + '99',
        pointBackgroundColor: color + 'CC',
        pointBorderColor: color,
        pointRadius: CONFIG.chartDefaults.pointRadius,
        pointHoverRadius: CONFIG.chartDefaults.pointHoverRadius,
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
  },

  // Create a pure scatter chart (no lines, e.g. Brix vs pH)
  createPureScatter(canvasId, data, xField, yField, xLabel, yLabel) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colorBy = Filters.state.colorBy;
    const groupField = colorBy === 'origin' ? 'appellation' : 'variety';
    const colors = colorBy === 'origin' ? CONFIG.originColors : CONFIG.varietyColors;
    const groups = this.groupScatterData(data, xField, yField, groupField);

    const datasets = Object.entries(groups).map(([name, pts]) => {
      const color = colors[name] || '#888888';
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
  },

  // Create horizontal bar chart (varietal comparison)
  createBarChart(canvasId, data, valueField, label) {
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

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
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
  },

  // Create horizontal bar chart grouped by origin
  createOriginBarChart(canvasId, data, valueField, label) {
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

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const origins = Object.keys(byOrigin).sort((a, b) => avg(byOrigin[b]) - avg(byOrigin[a]));
    const values = origins.map(o => parseFloat(avg(byOrigin[o]).toFixed(2)));
    const shortLabels = origins.map(o => Filters.shortenOrigin(o));
    const bgColors = origins.map(o => (CONFIG.originColors[o] || '#888') + '66');
    const bdColors = origins.map(o => CONFIG.originColors[o] || '#888');

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
  },

  // Create doughnut chart (origin distribution)
  createDoughnut(canvasId, data) {
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
    const colors = labels.map(l => CONFIG.originColors[l] || '#888');

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
  },

  // Vintage comparison chart: overlay N vintages for same plots
  createVintageComparison(canvasId, data, yField, yLabel) {
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
      // No matching data
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#6B6B6B';
      ctx.font = '11px "Sackers Gothic Medium"';
      ctx.textAlign = 'center';
      ctx.fillText('No hay datos comparables entre vendimias', canvas.width / 2, canvas.height / 2);
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
  },

  // Extraction comparison: berry tANT vs wine tANT
  createExtractionChart(canvasId, berryData, wineData) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Build extraction pairs using berry→wine mapping
    const pairs = [];
    const mapping = CONFIG.berryToWine;

    // Group berry data by lot (last measurement before harvest)
    const berryByLot = {};
    berryData.forEach(d => {
      if (!d.sampleId || d.tANT === null || typeof d.tANT !== 'number') return;
      const lotCode = d.lotCode;
      if (!berryByLot[lotCode] || (d.daysPostCrush || 0) > (berryByLot[lotCode].daysPostCrush || 0)) {
        berryByLot[lotCode] = d;
      }
    });

    // Build wine lookup by code
    const wineByCodigo = {};
    wineData.forEach(d => {
      if (d.codigoBodega && d.antoWX !== null && typeof d.antoWX === 'number') {
        wineByCodigo[d.codigoBodega] = d;
      }
    });

    // Match berry→wine
    Object.entries(mapping).forEach(([berryLot, wineLots]) => {
      const berry = berryByLot[berryLot];
      if (!berry) return;
      wineLots.forEach(wl => {
        const wine = wineByCodigo[wl];
        if (wine) {
          pairs.push({
            berryLot,
            wineLot: wl,
            berryTANT: berry.tANT,
            wineTANT: wine.antoWX,
            variety: berry.variety,
            extraction: wine.antoWX && berry.tANT ? ((wine.antoWX / berry.tANT) * 100).toFixed(1) : null
          });
        }
      });
    });

    if (pairs.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#6B6B6B';
      ctx.font = '11px "Sackers Gothic Medium"';
      ctx.textAlign = 'center';
      ctx.fillText('Cargue ambos archivos para ver la comparación', canvas.width / 2, canvas.height / 2);
      return;
    }

    const labels = pairs.map(p => p.berryLot);
    const berryVals = pairs.map(p => p.berryTANT);
    const wineVals = pairs.map(p => p.wineTANT);
    const bgBerry = pairs.map(p => (CONFIG.varietyColors[p.variety] || '#888') + '88');
    const bgWine = pairs.map(p => (CONFIG.varietyColors[p.variety] || '#888') + 'CC');

    this.instances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'tANT Baya (ppm)',
            data: berryVals,
            backgroundColor: 'rgba(196,160,96,0.5)',
            borderColor: '#C4A060',
            borderWidth: 1
          },
          {
            label: 'tANT Vino (ppm)',
            data: wineVals,
            backgroundColor: 'rgba(220,20,60,0.5)',
            borderColor: '#DC143C',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: CONFIG.chartDefaults.tickColor,
              font: { size: 9, family: 'Sackers Gothic Medium' }
            }
          },
          tooltip: {
            backgroundColor: '#1C1C1C',
            borderColor: 'rgba(196,160,96,0.5)',
            borderWidth: 1,
            titleColor: '#DDB96E',
            bodyColor: '#D8D0C4',
            callbacks: {
              afterBody: (items) => {
                const idx = items[0]?.dataIndex;
                if (idx !== undefined && pairs[idx]?.extraction) {
                  return [`Extracción: ${pairs[idx].extraction}%`];
                }
                return [];
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 8, family: 'Sackers Gothic Medium' }, maxRotation: 45 },
            grid: { color: 'transparent' }
          },
          y: {
            title: { display: true, text: 'tANT (ppm)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
            ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
            grid: { color: CONFIG.chartDefaults.gridColor }
          }
        },
        animation: { duration: 300 }
      }
    });
  },

  // Toggle line/scatter mode
  toggleLines() {
    this.showLines = !this.showLines;
    document.querySelectorAll('.line-toggle').forEach(btn => {
      btn.classList.toggle('active', this.showLines);
    });
    App.refresh();
  },

  // Toggle a series visibility via legend click
  toggleSeries(seriesName) {
    if (this.hiddenSeries.has(seriesName)) {
      this.hiddenSeries.delete(seriesName);
    } else {
      this.hiddenSeries.add(seriesName);
    }
    App.refresh();
  },

  // Update legend bar
  updateLegend(data) {
    const container = document.getElementById('legend-bar');
    if (!container) return;
    const items = Filters.getLegendItems(data);
    container.innerHTML = items.map(item => {
      const dimmed = this.hiddenSeries.has(item.label) ? ' dimmed' : '';
      return `<div class="legend-item${dimmed}" onclick="Charts.toggleSeries('${item.label}')" title="${item.label}">
        <div class="legend-dot" style="background:${item.color}"></div>
        <span>${item.label}</span>
      </div>`;
    }).join('');
  },

  // ── Weather Charts ─────────────────────────────────────────────

  // Vintage colours shared across all weather charts
  _vintageColor(year) {
    const map = {
      2022: '#E06070',
      2023: '#9B59B6',
      2024: '#60A8C0',
      2025: '#C4A060',
      2026: '#7EC87A',
      2027: '#E0A050',
      2028: '#50C8B0',
      2029: '#C870C8'
    };
    return map[year] || '#888';
  },

  // Temperature time series: daily mean °C, all vintages overlaid
  createWeatherTimeSeries(canvasId, vintages) {
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
  },

  // Rainfall scatter: each rainy day as a dot (x = day-of-season, y = mm)
  createRainfallChart(canvasId, vintages) {
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
  },

  // Brix vs Temperature on sample date — scatter by variety/origin
  createTempCorrelation(canvasId, berryData) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colorBy   = Filters.state.colorBy;
    const groupField = colorBy === 'origin' ? 'appellation' : 'variety';
    const colors    = colorBy === 'origin' ? CONFIG.originColors : CONFIG.varietyColors;
    const groups    = {};

    berryData.forEach(d => {
      if (typeof d.brix !== 'number' || !d.sampleDate) return;
      const temp = WeatherStore.getTempForDate(d.sampleDate);
      if (temp === null) return;
      const g = d[groupField] || 'Unknown';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ x: temp, y: d.brix, sampleId: d.sampleId, variety: d.variety, appellation: d.appellation });
    });

    const datasets = Object.entries(groups).map(([name, pts]) => {
      const color = colors[name] || '#888';
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
  },

  // tANT vs Cumulative Rainfall since July 1 — scatter by variety/origin
  createRainCorrelation(canvasId, berryData) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colorBy   = Filters.state.colorBy;
    const groupField = colorBy === 'origin' ? 'appellation' : 'variety';
    const colors    = colorBy === 'origin' ? CONFIG.originColors : CONFIG.varietyColors;
    const groups    = {};

    berryData.forEach(d => {
      if (typeof d.tANT !== 'number' || !d.sampleDate) return;
      const rain = WeatherStore.getCumulativeRainfall(d.sampleDate);
      if (rain === null) return;
      const g = d[groupField] || 'Unknown';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ x: rain, y: d.tANT, sampleId: d.sampleId, variety: d.variety, appellation: d.appellation });
    });

    const datasets = Object.entries(groups).map(([name, pts]) => {
      const color = colors[name] || '#888';
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
  },

  _drawNoData(canvas, msg) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#6B6B6B';
    ctx.font = '11px "Sackers Gothic Medium"';
    ctx.textAlign = 'center';
    ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
  },

  // Export a chart canvas as PNG with dark background and watermark
  exportChart(canvasId, title) {
    const chart = this.instances[canvasId];
    const srcCanvas = document.getElementById(canvasId);
    if (!srcCanvas) return;

    const pad = 40;
    const titleH = 44;
    const watermarkH = 30;
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const totalW = w + pad * 2;
    const totalH = h + titleH + watermarkH + pad;

    const tmp = document.createElement('canvas');
    tmp.width = totalW;
    tmp.height = totalH;
    const ctx = tmp.getContext('2d');

    // Dark background
    ctx.fillStyle = '#161616';
    ctx.fillRect(0, 0, totalW, totalH);

    // Title
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '16px "Sackers Gothic Medium", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, pad, pad + 6);

    // Separator line
    ctx.strokeStyle = 'rgba(196,160,96,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, titleH + 4);
    ctx.lineTo(totalW - pad, titleH + 4);
    ctx.stroke();

    // Draw chart image
    if (chart) {
      // Temporarily render chart to image to get clean output
      const chartImg = new Image();
      chartImg.onload = () => {
        ctx.drawImage(chartImg, pad, titleH + 8, w, h);
        drawWatermark();
      };
      chartImg.src = srcCanvas.toDataURL('image/png');
    } else {
      ctx.drawImage(srcCanvas, pad, titleH + 8, w, h);
      drawWatermark();
    }

    function drawWatermark() {
      ctx.fillStyle = 'rgba(196,160,96,0.4)';
      ctx.font = '10px "Sackers Gothic Medium", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Monte Xanic \u2014 Vendimia', totalW - pad, totalH - 12);

      // Trigger download
      const link = document.createElement('a');
      const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      link.download = `monte-xanic-${safeName}.png`;
      link.href = tmp.toDataURL('image/png');
      link.click();
    }
  },

  // Update all berry charts
  updateBerryCharts(data) {
    const clean = data.filter(d => !(typeof d.pH === 'number' && (d.pH < 2.5 || d.pH > 5.0)));

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
  }
};
