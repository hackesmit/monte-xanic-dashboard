// ── Chart Rendering ──

const Charts = {
  instances: {},
  showLines: false,
  hiddenSeries: new Set(),

  // Identify the last (most recent) data point per lot code (only for lots with 2+ points)
  _identifyLastPoints(data) {
    const lotCounts = {};
    const lastByLot = {};
    data.forEach(d => {
      if (!d.lotCode || d.daysPostCrush === null || d.daysPostCrush === undefined) return;
      lotCounts[d.lotCode] = (lotCounts[d.lotCode] || 0) + 1;
      if (!lastByLot[d.lotCode] || d.daysPostCrush > lastByLot[d.lotCode].daysPostCrush) {
        lastByLot[d.lotCode] = d;
      }
    });
    return new Set(
      Object.entries(lastByLot)
        .filter(([lot]) => (lotCounts[lot] || 0) >= 2)
        .map(([, d]) => d.sampleId)
    );
  },

  _getThemeColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  },

  destroy(id) {
    if (this.instances[id]) {
      this.instances[id].destroy();
      delete this.instances[id];
    }
  },

  // Safe Chart.js instantiation — one broken chart won't cascade-fail the view
  _createChart(canvasId, canvas, config) {
    try {
      this.instances[canvasId] = new Chart(canvas, config);
    } catch (err) {
      console.error(`[Charts] Error creating ${canvasId}:`, err);
      this._drawNoData(canvas, 'Error al renderizar gráfico');
    }
  },

  destroyAll() {
    Object.keys(this.instances).forEach(id => this.destroy(id));
  },

  // Remove orphaned chart instances whose canvas no longer exists in DOM
  _pruneOrphans() {
    for (const id of Object.keys(this.instances)) {
      if (!document.getElementById(id)) {
        this.instances[id].destroy();
        delete this.instances[id];
      }
    }
  },

  // Update theme colors on all existing charts in-place (no destroy/recreate)
  _applyThemeToCharts() {
    const gridColor = CONFIG.chartDefaults.gridColor;
    const tickColor = CONFIG.chartDefaults.tickColor;
    const titleColor = this._getThemeColor('--muted') || '#8A8A8A';
    const tipBg = this._getThemeColor('--card2') || '#1C1C1C';
    const tipTitle = this._getThemeColor('--gold-lt') || '#DDB96E';
    const tipBody = this._getThemeColor('--text') || '#D8D0C4';

    Object.values(this.instances).forEach(chart => {
      const scales = chart.options.scales || {};
      Object.values(scales).forEach(scale => {
        if (scale.grid) scale.grid.color = gridColor;
        if (scale.ticks) scale.ticks.color = tickColor;
        if (scale.title) scale.title.color = titleColor;
      });
      const tip = chart.options.plugins?.tooltip;
      if (tip) {
        tip.backgroundColor = tipBg;
        tip.titleColor = tipTitle;
        tip.bodyColor = tipBody;
      }
      chart.options.animation = { duration: 400, easing: 'easeOutQuart' };
      chart.update();
    });
  },

  axisOpts(xLabel, yLabel) {
    const mob = window.innerWidth <= 768;
    const tickSize = mob ? 7 : 9;
    const titleSize = mob ? 8 : 9;
    const maxTicks = mob ? 6 : undefined;
    const titleColor = this._getThemeColor('--muted') || '#8A8A8A';
    return {
      x: {
        title: { display: !!xLabel, text: xLabel, color: titleColor, font: { size: titleSize, family: 'Sackers Gothic Medium' } },
        ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: tickSize, family: 'Sackers Gothic Medium' }, maxTicksLimit: maxTicks },
        grid: { color: CONFIG.chartDefaults.gridColor }
      },
      y: {
        title: { display: !!yLabel, text: yLabel, color: titleColor, font: { size: titleSize, family: 'Sackers Gothic Medium' } },
        ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: tickSize, family: 'Sackers Gothic Medium' }, maxTicksLimit: maxTicks },
        grid: { color: CONFIG.chartDefaults.gridColor }
      }
    };
  },

  _mobileRadius() { return window.innerWidth <= 768 ? 3 : CONFIG.chartDefaults.pointRadius; },

  // Build tooltip that always shows Sample Id
  tooltipConfig() {
    return {
      callbacks: {
        title: (items) => {
          if (!items.length) return '';
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
          if (r._isLastPoint) lines.push('★ Punto final');
          return lines;
        }
      },
      backgroundColor: this._getThemeColor('--card2') || '#1C1C1C',
      borderColor: 'rgba(196,160,96,0.5)',
      borderWidth: 1,
      titleColor: this._getThemeColor('--gold-lt') || '#DDB96E',
      bodyColor: this._getThemeColor('--text') || '#D8D0C4',
      titleFont: { family: 'Sackers Gothic Medium', weight: '400', size: 11 },
      bodyFont: { family: 'Sackers Gothic Medium', weight: '300', size: 10 },
      padding: 10,
      displayColors: true
    };
  },

  // Group data by a field and return datasets
  groupScatterData(data, xField, yField, groupField) {
    // Pre-compute last points — only for lots with 2+ measurements
    const lotCounts = {};
    const lastByLot = {};
    data.forEach(d => {
      const x = d[xField]; const y = d[yField];
      if (x === null || y === null || x === undefined || y === undefined) return;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      const lot = d.lotCode || d.sampleId;
      if (!lot) return;
      lotCounts[lot] = (lotCounts[lot] || 0) + 1;
      if (!lastByLot[lot] || (d.daysPostCrush || 0) > (lastByLot[lot].dpc || 0)) {
        lastByLot[lot] = { sid: d.sampleId, dpc: d.daysPostCrush || 0 };
      }
    });
    // Only flag last point if lot has multiple measurements
    const lastSids = new Set(
      Object.entries(lastByLot)
        .filter(([lot]) => (lotCounts[lot] || 0) >= 2)
        .map(([, v]) => v.sid)
    );

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
        lotCode: d.lotCode,
        variety: d.variety,
        appellation: d.appellation,
        vintage: d.vintage,
        _isLastPoint: lastSids.has(d.sampleId)
      });
    });
    return groups;
  },

  // Create a scatter/line chart
  createScatter(canvasId, data, xField, yField, xLabel, yLabel) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (!data.length) { this._drawNoData(canvas, 'No hay datos para los filtros seleccionados'); return; }

    const colorBy = Filters.state.colorBy;
    const groupField = colorBy === 'origin' ? 'appellation' : 'variety';
    const resolveColor = colorBy === 'origin'
      ? (n) => CONFIG.resolveOriginColor(n)
      : (n) => CONFIG.varietyColors[n] || CONFIG._hashColor(n);
    const groups = this.groupScatterData(data, xField, yField, groupField);
    const lastPoints = this._identifyLastPoints(data);

    const datasets = Object.entries(groups).map(([name, pts]) => {
      const color = resolveColor(name);
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      // Per-point styling for last points
      const r = this._mobileRadius();
      const radii = sorted.map(() => r);
      const bgColors = sorted.map(p => lastPoints.has(p.sampleId) ? color : color + '99');
      const bdColors = sorted.map(p => lastPoints.has(p.sampleId) ? '#DDB96E' : color);
      const bdWidths = sorted.map(p => lastPoints.has(p.sampleId) ? 3 : 0.5);
      return {
        label: name,
        data: sorted,
        borderColor: color,
        backgroundColor: bgColors,
        pointBackgroundColor: bgColors,
        pointBorderColor: bdColors,
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

    this._createChart(canvasId, canvas, {
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
    if (!data.length) { this._drawNoData(canvas, 'No hay datos para los filtros seleccionados'); return; }

    const colorBy = Filters.state.colorBy;
    const groupField = colorBy === 'origin' ? 'appellation' : 'variety';
    const resolveColor = colorBy === 'origin'
      ? (n) => CONFIG.resolveOriginColor(n)
      : (n) => CONFIG.varietyColors[n] || CONFIG._hashColor(n);
    const groups = this.groupScatterData(data, xField, yField, groupField);

    const datasets = Object.entries(groups).map(([name, pts]) => {
      const color = resolveColor(name);
      return {
        label: name,
        data: pts,
        backgroundColor: color + 'AA',
        pointBackgroundColor: color + 'CC',
        pointBorderColor: color,
        pointRadius: this._mobileRadius() + 1,
        pointHoverRadius: CONFIG.chartDefaults.pointHoverRadius,
        borderWidth: 0,
        showLine: false,
        hidden: this.hiddenSeries.has(name)
      };
    });

    this._createChart(canvasId, canvas, {
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
    if (!data.length) { this._drawNoData(canvas, 'No hay datos para los filtros seleccionados'); return; }

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

    this._createChart(canvasId, canvas, {
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
    if (!data.length) { this._drawNoData(canvas, 'No hay datos para los filtros seleccionados'); return; }

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

    this._createChart(canvasId, canvas, {
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
    if (!data.length) { this._drawNoData(canvas, 'No hay datos para los filtros seleccionados'); return; }

    const counts = {};
    data.forEach(d => {
      if (d.appellation) {
        counts[d.appellation] = (counts[d.appellation] || 0) + 1;
      }
    });

    const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const values = labels.map(l => counts[l]);
    const colors = labels.map(l => CONFIG.resolveOriginColor(l));

    this._createChart(canvasId, canvas, {
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

  // Radar chart: per-origin chemistry profile comparison
  createOriginRadarChart(canvasId, data) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (!data.length) { this._drawNoData(canvas, 'No hay datos para los filtros seleccionados'); return; }

    const metrics = [
      { key: 'brix', label: 'Brix' },
      { key: 'pH', label: 'pH' },
      { key: 'ta', label: 'AT' },
      { key: 'tANT', label: 'tANT' },
      { key: 'berryFW', label: 'Peso Baya' }
    ];

    // Compute averages per origin per metric
    const byOrigin = {};
    data.forEach(d => {
      const o = d.appellation;
      if (!o) return;
      if (!byOrigin[o]) byOrigin[o] = {};
      metrics.forEach(m => {
        const val = d[m.key];
        if (typeof val === 'number' && !isNaN(val)) {
          if (!byOrigin[o][m.key]) byOrigin[o][m.key] = [];
          byOrigin[o][m.key].push(val);
        }
      });
    });

    const origins = Object.keys(byOrigin).filter(o =>
      metrics.some(m => byOrigin[o][m.key] && byOrigin[o][m.key].length > 0)
    );
    if (!origins.length) { this._drawNoData(canvas, 'No hay datos de origen disponibles'); return; }

    const avg = arr => arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    // Compute raw averages
    const rawAvgs = {};
    origins.forEach(o => {
      rawAvgs[o] = {};
      metrics.forEach(m => { rawAvgs[o][m.key] = avg(byOrigin[o][m.key]); });
    });

    // Normalize each metric to 0-100 across origins
    const mins = {}, maxs = {};
    metrics.forEach(m => {
      const vals = origins.map(o => rawAvgs[o][m.key]).filter(v => v !== null);
      mins[m.key] = Math.min(...vals);
      maxs[m.key] = Math.max(...vals);
    });
    const normalize = (val, key) => {
      if (val === null) return 0;
      const range = maxs[key] - mins[key];
      return range > 0 ? ((val - mins[key]) / range) * 100 : 50;
    };

    const datasets = origins.map(o => {
      const color = CONFIG.resolveOriginColor(o);
      return {
        label: Filters.shortenOrigin(o),
        data: metrics.map(m => parseFloat(normalize(rawAvgs[o][m.key], m.key).toFixed(1))),
        borderColor: color,
        backgroundColor: color + '22',
        pointBackgroundColor: color,
        pointBorderColor: color,
        pointRadius: 3,
        borderWidth: 2,
        fill: true
      };
    });

    this._createChart(canvasId, canvas, {
      type: 'radar',
      data: {
        labels: metrics.map(m => m.label),
        datasets
      },
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
          tooltip: {
            backgroundColor: '#1C1C1C',
            borderColor: 'rgba(196,160,96,0.5)',
            borderWidth: 1,
            titleColor: '#DDB96E',
            bodyColor: '#D8D0C4',
            callbacks: {
              label: (ctx) => {
                const origin = origins[ctx.datasetIndex];
                const metric = metrics[ctx.dataIndex];
                const rawVal = rawAvgs[origin] ? rawAvgs[origin][metric.key] : null;
                return `${Filters.shortenOrigin(origin)}: ${rawVal !== null ? rawVal.toFixed(2) : '—'}`;
              }
            }
          }
        },
        scales: {
          r: {
            angleLines: { color: CONFIG.chartDefaults.gridColor },
            grid: { color: CONFIG.chartDefaults.gridColor },
            ticks: { display: false },
            pointLabels: {
              color: CONFIG.chartDefaults.tickColor,
              font: { size: 10, family: 'Sackers Gothic Medium' }
            },
            suggestedMin: 0,
            suggestedMax: 100
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

    // Group ALL data by vintage for scatter + trend
    const byVintage = {};
    data.forEach(d => {
      const v = d.vintage;
      const x = d.daysPostCrush;
      const y = d[yField];
      if (!v || x === null || y === null || typeof x !== 'number' || typeof y !== 'number') return;
      if (!byVintage[v]) byVintage[v] = [];
      byVintage[v].push({ x, y, sampleId: d.sampleId, lotCode: d.lotCode, variety: d.variety, appellation: d.appellation, vintage: v });
    });

    const vintages = Object.keys(byVintage).map(Number).sort();
    if (!vintages.length) {
      this._drawNoData(canvas, 'No hay datos comparables entre vendimias');
      return;
    }

    const datasets = [];

    // Scatter datasets per vintage (individual samples)
    vintages.forEach(v => {
      const color = this._vintageColor(v);
      const pts = byVintage[v].sort((a, b) => a.x - b.x);
      datasets.push({
        label: String(v),
        data: pts,
        borderColor: color,
        backgroundColor: color + '66',
        pointRadius: this._mobileRadius(),
        pointHoverRadius: CONFIG.chartDefaults.pointHoverRadius,
        borderWidth: 0,
        showLine: false,
        fill: false
      });
    });

    // Trend lines per vintage (binned moving average, 5-day bins)
    if (vintages.length >= 2) {
      vintages.forEach(v => {
        const pts = byVintage[v];
        if (pts.length < 4) return;
        const binSize = 5;
        const bins = {};
        pts.forEach(p => {
          const bin = Math.round(p.x / binSize) * binSize;
          if (!bins[bin]) bins[bin] = [];
          bins[bin].push(p.y);
        });
        const trendPts = Object.keys(bins).map(Number).sort((a, b) => a - b)
          .filter(bin => bins[bin].length >= 2)
          .map(bin => ({ x: bin, y: parseFloat((bins[bin].reduce((a, b) => a + b, 0) / bins[bin].length).toFixed(2)) }));
        if (trendPts.length < 2) return;

        const color = this._vintageColor(v);
        datasets.push({
          label: `${v} tendencia`,
          data: trendPts,
          borderColor: color,
          backgroundColor: 'transparent',
          pointRadius: 0,
          borderWidth: 2.5,
          borderDash: [6, 3],
          showLine: true,
          tension: 0.4,
          fill: false
        });
      });
    }

    this._createChart(canvasId, canvas, {
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
              padding: 8,
              filter: (item) => !item.text.includes('tendencia')
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
  // Shared helper: build berry↔wine extraction pairs from berryToWine mapping
  _buildExtractionPairs(berryData, wineData) {
    const pairs = [];
    const mapping = CONFIG.berryToWine;
    const berryByLot = {};
    berryData.forEach(d => {
      if (!d.sampleId || d.tANT === null || typeof d.tANT !== 'number') return;
      const lotCode = d.lotCode;
      if (!berryByLot[lotCode] || (d.daysPostCrush || 0) > (berryByLot[lotCode].daysPostCrush || 0)) {
        berryByLot[lotCode] = d;
      }
    });
    const wineByCodigo = {};
    wineData.forEach(d => {
      if (d.codigoBodega && d.antoWX !== null && typeof d.antoWX === 'number') {
        wineByCodigo[d.codigoBodega] = d;
      }
    });
    Object.entries(mapping).forEach(([berryLot, wineLots]) => {
      const berry = berryByLot[berryLot];
      if (!berry || berry.tANT <= 0) return;
      wineLots.forEach(wl => {
        const wine = wineByCodigo[wl];
        if (wine) {
          const pct = (wine.antoWX / berry.tANT) * 100;
          pairs.push({
            berryLot, wineLot: wl,
            berryTANT: berry.tANT, wineTANT: wine.antoWX,
            variety: berry.variety, appellation: berry.appellation,
            pct: parseFloat(pct.toFixed(1))
          });
        }
      });
    });
    return pairs;
  },

  createExtractionChart(canvasId, berryData, wineData) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const pairs = this._buildExtractionPairs(berryData, wineData);

    if (pairs.length === 0) {
      this._drawNoData(canvas, 'Cargue ambos archivos para ver la comparación');
      return;
    }

    const labels = pairs.map(p => p.berryLot);
    const berryVals = pairs.map(p => p.berryTANT);
    const wineVals = pairs.map(p => p.wineTANT);

    this._createChart(canvasId, canvas, {
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
                if (idx !== undefined && pairs[idx]?.pct) {
                  return [`Extracción: ${pairs[idx].pct}%`];
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
    const mob = window.innerWidth <= 768;

    // On mobile, sort by data count (most data first) and limit visible items
    let sorted = items;
    if (mob) {
      const counts = {};
      const field = Filters.state.colorBy === 'origin' ? 'appellation' : 'variety';
      data.forEach(d => { const k = d[field]; if (k) counts[k] = (counts[k] || 0) + 1; });
      sorted = [...items].sort((a, b) => (counts[b.label] || 0) - (counts[a.label] || 0));
    }
    const maxVisible = mob ? 5 : Infinity;
    const visible = sorted.slice(0, maxVisible);
    const hidden = sorted.slice(maxVisible);

    let html = visible.map(item => {
      const dimmed = this.hiddenSeries.has(item.label) ? ' dimmed' : '';
      const safeLabel = item.label.replace(/'/g, "\\'");
      return `<div class="legend-item${dimmed}" role="button" tabindex="0" onclick="Charts.toggleSeries('${safeLabel}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();Charts.toggleSeries('${safeLabel}')}" title="${item.label.replace(/"/g, '&quot;')}">
        <div class="legend-dot" style="background:${item.color.replace(/[";]/g, '')}"></div>
        <span>${item.label}</span>
      </div>`;
    }).join('');

    if (hidden.length > 0) {
      html += `<div class="legend-item legend-expand" role="button" tabindex="0" onclick="this.parentElement.classList.toggle('legend-show-all')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.parentElement.classList.toggle('legend-show-all')}" style="cursor:pointer;color:var(--muted);font-style:italic">
        <span>+ ${hidden.length} m\u00e1s</span>
      </div>`;
      html += hidden.map(item => {
        const dimmed = this.hiddenSeries.has(item.label) ? ' dimmed' : '';
        const safeLabel = item.label.replace(/'/g, "\\'");
        return `<div class="legend-item legend-overflow${dimmed}" role="button" tabindex="0" onclick="Charts.toggleSeries('${safeLabel}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();Charts.toggleSeries('${safeLabel}')}" title="${item.label.replace(/"/g, '&quot;')}" style="display:none">
          <div class="legend-dot" style="background:${item.color.replace(/[";]/g, '')}"></div>
          <span>${item.label}</span>
        </div>`;
      }).join('');
    }
    container.innerHTML = html;
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

    this._createChart(canvasId, canvas, {
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

    this._createChart(canvasId, canvas, {
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

  // Harvest calendar: horizontal floating bars per variety + weather overlay
  createHarvestCalendar(canvasId, berryData, wineData, vintage) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (!vintage) { this._drawNoData(canvas, 'Seleccione una vendimia para ver el calendario'); return; }

    // Extract harvest events from berry data with crushDate
    const events = [];
    berryData.forEach(d => {
      if (!d.crushDate || !d.variety) return;
      const v = Number(d.vintage);
      if (v !== Number(vintage)) return;
      const day = typeof WeatherStore !== 'undefined' ? WeatherStore.dayOfSeason(d.crushDate) : null;
      if (!day || day < 1 || day > 150) return;
      events.push({ variety: d.variety, day, brix: d.brix, tANT: d.tANT, lotCode: d.lotCode, appellation: d.appellation });
    });

    if (!events.length) { this._drawNoData(canvas, 'Sin fechas de cosecha para esta vendimia'); return; }

    // Group by variety → earliest/latest day, averages
    const byVar = {};
    events.forEach(e => {
      if (!byVar[e.variety]) byVar[e.variety] = { days: [], brix: [], tANT: [], lots: new Set() };
      byVar[e.variety].days.push(e.day);
      if (typeof e.brix === 'number') byVar[e.variety].brix.push(e.brix);
      if (typeof e.tANT === 'number') byVar[e.variety].tANT.push(e.tANT);
      if (e.lotCode) byVar[e.variety].lots.add(e.lotCode);
    });

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const varieties = Object.keys(byVar).sort((a, b) => Math.min(...byVar[a].days) - Math.min(...byVar[b].days));
    const harvestMeta = varieties.map(v => ({
      variety: v,
      start: Math.min(...byVar[v].days),
      end: Math.max(...byVar[v].days),
      avgBrix: avg(byVar[v].brix),
      avgTANT: avg(byVar[v].tANT),
      lotCount: byVar[v].lots.size
    }));

    // Harvest bar dataset (floating bars)
    const harvestData = harvestMeta.map(h => [h.start, h.end]);
    const bgColors = varieties.map(v => (CONFIG.varietyColors[v] || '#888') + 'AA');
    const bdColors = varieties.map(v => CONFIG.varietyColors[v] || '#888');

    const datasets = [{
      label: 'Cosecha',
      data: harvestData,
      backgroundColor: bgColors,
      borderColor: bdColors,
      borderWidth: 1,
      borderSkipped: false,
      barPercentage: 0.7,
      yAxisID: 'y'
    }];

    // Weather overlay on secondary axis
    if (typeof WeatherStore !== 'undefined') {
      const weatherRows = WeatherStore.getRange(`${vintage}-07-01`, `${vintage}-10-31`);
      if (weatherRows.length) {
        // Temperature line
        const tempPts = weatherRows
          .filter(r => r.temp_avg !== null)
          .map(r => ({ x: WeatherStore.dayOfSeason(r.date), y: r.temp_avg }));
        if (tempPts.length) {
          datasets.push({
            type: 'line',
            label: 'Temp (°C)',
            data: tempPts,
            borderColor: 'rgba(96,168,192,0.5)',
            backgroundColor: 'transparent',
            pointRadius: 0,
            borderWidth: 1.5,
            tension: 0.3,
            yAxisID: 'y2',
            xAxisID: 'x',
            order: 1
          });
        }
        // Rainfall bars
        const rainPts = weatherRows
          .filter(r => r.rainfall_mm > 0)
          .map(r => ({ x: WeatherStore.dayOfSeason(r.date), y: r.rainfall_mm }));
        if (rainPts.length) {
          datasets.push({
            type: 'bar',
            label: 'Lluvia (mm)',
            data: rainPts,
            backgroundColor: 'rgba(96,168,192,0.15)',
            borderColor: 'rgba(96,168,192,0.3)',
            borderWidth: 1,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
            yAxisID: 'y2',
            xAxisID: 'x',
            order: 2
          });
        }
      }
    }

    // Month label formatter for x-axis
    const monthNames = ['Jul', 'Ago', 'Sep', 'Oct', 'Nov'];
    const dayToLabel = (day) => {
      const d = new Date(Date.UTC(vintage, 6, 1));
      d.setUTCDate(d.getUTCDate() + day - 1);
      return `${d.getUTCDate()} ${monthNames[d.getUTCMonth() - 6] || ''}`;
    };

    this._createChart(canvasId, canvas, {
      type: 'bar',
      data: { labels: varieties, datasets },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: CONFIG.chartDefaults.tickColor,
              font: { size: 9, family: 'Sackers Gothic Medium' },
              boxWidth: 10, padding: 8,
              filter: (item) => item.text !== 'Cosecha'
            }
          },
          tooltip: {
            backgroundColor: '#1C1C1C',
            borderColor: 'rgba(196,160,96,0.5)',
            borderWidth: 1,
            titleColor: '#DDB96E',
            bodyColor: '#D8D0C4',
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex;
                if (idx !== undefined && harvestMeta[idx]) return harvestMeta[idx].variety;
                return items[0].dataset.label || '';
              },
              label: (ctx) => {
                if (ctx.dataset.label === 'Cosecha') {
                  const h = harvestMeta[ctx.dataIndex];
                  if (!h) return '';
                  return [
                    `Día ${h.start} → ${h.end} (${h.end - h.start + 1} días)`,
                    `Lotes: ${h.lotCount}`,
                    h.avgBrix !== null ? `Brix promedio: ${h.avgBrix.toFixed(1)}` : '',
                    h.avgTANT !== null ? `tANT promedio: ${h.avgTANT.toFixed(0)} ppm` : ''
                  ].filter(Boolean);
                }
                if (ctx.dataset.label === 'Temp (°C)') return `Temp: ${ctx.raw.y?.toFixed(1)}°C (Día ${ctx.raw.x})`;
                if (ctx.dataset.label === 'Lluvia (mm)') return `Lluvia: ${ctx.raw.y?.toFixed(1)} mm (Día ${ctx.raw.x})`;
                return '';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: { display: true, text: 'Día de temporada (1 = 1 Jul)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
            ticks: {
              color: CONFIG.chartDefaults.tickColor,
              font: { size: 8, family: 'Sackers Gothic Medium' },
              callback: (val) => dayToLabel(val),
              stepSize: 15
            },
            grid: { color: CONFIG.chartDefaults.gridColor },
            min: Math.max(1, Math.min(...harvestMeta.map(h => h.start)) - 10),
            max: Math.max(...harvestMeta.map(h => h.end)) + 10
          },
          y: {
            ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
            grid: { color: 'transparent' }
          },
          y2: {
            position: 'right',
            title: { display: true, text: '°C / mm', color: '#6B6B6B', font: { size: 8, family: 'Sackers Gothic Medium' } },
            ticks: { color: 'rgba(96,168,192,0.6)', font: { size: 8, family: 'Sackers Gothic Medium' } },
            grid: { display: false },
            beginAtZero: true
          }
        },
        animation: { duration: 300 }
      }
    });
  },

  // Brix vs Temperature on sample date — scatter by variety/origin
  createTempCorrelation(canvasId, berryData) {
    if (typeof WeatherStore === 'undefined') return;
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colorBy   = Filters.state.colorBy;
    const groupField = colorBy === 'origin' ? 'appellation' : 'variety';
    const resolveColor = colorBy === 'origin'
      ? (n) => CONFIG.resolveOriginColor(n)
      : (n) => CONFIG.varietyColors[n] || CONFIG._hashColor(n);
    const groups    = {};

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

    this._createChart(canvasId, canvas, {
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
    if (typeof WeatherStore === 'undefined') return;
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colorBy   = Filters.state.colorBy;
    const groupField = colorBy === 'origin' ? 'appellation' : 'variety';
    const resolveColor = colorBy === 'origin'
      ? (n) => CONFIG.resolveOriginColor(n)
      : (n) => CONFIG.varietyColors[n] || CONFIG._hashColor(n);
    const groups    = {};

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

    this._createChart(canvasId, canvas, {
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
    ctx.fillStyle = this._getThemeColor('--muted') || '#6B6B6B';
    ctx.font = '11px "Sackers Gothic Medium"';
    ctx.textAlign = 'center';
    ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
  },

  // Show export format menu (PNG / PDF) anchored to button
  showExportMenu(canvasId, title, btn) {
    // Close any existing menu and its listener
    document.querySelectorAll('.chart-export-menu').forEach(m => m.remove());
    if (this._exportMenuHandler) {
      document.removeEventListener('click', this._exportMenuHandler);
      this._exportMenuHandler = null;
    }

    const menu = document.createElement('div');
    menu.className = 'chart-export-menu';
    menu.innerHTML =
      '<button data-fmt="png">PNG</button>' +
      '<button data-fmt="pdf">PDF</button>';
    menu.addEventListener('click', (e) => {
      const fmt = e.target.getAttribute('data-fmt');
      if (fmt === 'png') this.exportChart(canvasId, title);
      if (fmt === 'pdf') this.exportChartPDF(canvasId, title);
      menu.remove();
      if (this._exportMenuHandler) {
        document.removeEventListener('click', this._exportMenuHandler);
        this._exportMenuHandler = null;
      }
    });

    // Position relative to chart-card (which already has position: relative)
    const card = btn.closest('.chart-card');
    if (card) {
      menu.style.top = (btn.offsetTop + btn.offsetHeight + 4) + 'px';
      menu.style.right = '12px';
      menu.style.position = 'absolute';
      card.appendChild(menu);
    } else {
      btn.appendChild(menu);
    }

    // Close on outside click (next tick to avoid immediate close)
    setTimeout(() => {
      this._exportMenuHandler = (e) => {
        if (!menu.contains(e.target) && e.target !== btn) {
          menu.remove();
          document.removeEventListener('click', this._exportMenuHandler);
          this._exportMenuHandler = null;
        }
      };
      document.addEventListener('click', this._exportMenuHandler);
    }, 0);
  },

  // Export a chart canvas as PNG with branded background and watermark
  exportChart(canvasId, title) {
    const chart = this.instances[canvasId];
    const srcCanvas = document.getElementById(canvasId);
    if (!srcCanvas || !chart) return;

    const pad = 40;
    const titleH = 44;
    const watermarkH = 30;
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    if (!w || !h) return;

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

    // Draw chart via Chart.js native toBase64Image
    const chartImg = new Image();
    chartImg.onload = () => {
      ctx.drawImage(chartImg, pad, titleH + 8, w, h);

      // Watermark
      ctx.fillStyle = 'rgba(196,160,96,0.4)';
      ctx.font = '10px "Sackers Gothic Medium", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Monte Xanic \u2014 Vendimia', totalW - pad, totalH - 12);

      // Trigger download
      const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      const link = document.createElement('a');
      link.download = `monte-xanic-${safeName}.png`;
      link.href = tmp.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
    chartImg.src = chart.toBase64Image('image/png', 1);
  },

  exportChartPDF(canvasId, title) {
    if (typeof window.jspdf === 'undefined') {
      console.error('[Charts] jsPDF no disponible');
      return;
    }
    const chart = this.instances[canvasId];
    const srcCanvas = document.getElementById(canvasId);
    if (!srcCanvas || !chart) return;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();

    // Dark background
    pdf.setFillColor(22, 22, 22);
    pdf.rect(0, 0, pw, ph, 'F');

    // Title
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14);
    pdf.text(title, 15, 18);

    // Gold separator
    pdf.setDrawColor(196, 160, 96);
    pdf.setLineWidth(0.3);
    pdf.line(15, 22, pw - 15, 22);

    // Chart image
    const imgData = chart.toBase64Image('image/png', 1);
    const chartW = pw - 30;
    const chartH = ph - 50;
    pdf.addImage(imgData, 'PNG', 15, 26, chartW, chartH);

    // Watermark
    pdf.setTextColor(196, 160, 96);
    pdf.setFontSize(8);
    pdf.text('Monte Xanic \u2014 Vendimia', pw - 15, ph - 6, { align: 'right' });

    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    pdf.save(`monte-xanic-${safeName}.pdf`);
  },

  // ── Explorer Parameterized Charts ──────────────────────────────

  createExplorerChart(canvasId, data, xField, yField, xLabel, yLabel, groupField, colorResolver, opts) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (!data.length) { this._drawNoData(canvas, 'Sin datos para esta selección'); return; }

    const groups = this.groupScatterData(data, xField, yField, groupField);
    const showLine = opts && opts.showLine;

    const datasets = Object.entries(groups).map(([name, pts]) => {
      const color = colorResolver(name);
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      return {
        label: name,
        data: sorted,
        borderColor: color,
        backgroundColor: color + '99',
        pointBackgroundColor: color + '99',
        pointBorderColor: color,
        pointRadius: CONFIG.chartDefaults.pointRadius,
        pointHoverRadius: CONFIG.chartDefaults.pointHoverRadius,
        pointBorderWidth: 1,
        borderWidth: showLine ? CONFIG.chartDefaults.borderWidth : 0,
        showLine: !!showLine,
        tension: CONFIG.chartDefaults.tension,
        fill: false
      };
    });

    this._createChart(canvasId, canvas, {
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

  createExplorerBar(canvasId, data, valueField, label, groupField, colorResolver) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (!data.length) { this._drawNoData(canvas, 'Sin datos para esta selección'); return; }

    const byGroup = {};
    data.forEach(d => {
      const g = d[groupField] || 'Unknown';
      const val = d[valueField];
      if (typeof val === 'number' && !isNaN(val)) {
        if (!byGroup[g]) byGroup[g] = [];
        byGroup[g].push(val);
      }
    });

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const labels = Object.keys(byGroup).sort((a, b) => avg(byGroup[b]) - avg(byGroup[a]));
    const values = labels.map(g => parseFloat(avg(byGroup[g]).toFixed(2)));
    const bgColors = labels.map(g => colorResolver(g) + '66');
    const bdColors = labels.map(g => colorResolver(g));

    this._createChart(canvasId, canvas, {
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

  // ── Lazy rendering: only create charts visible in viewport ──
  _lazyQueue: [],
  _lazyObserver: null,

  _initLazyObserver() {
    if (this._lazyObserver) return;
    this._lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const canvasId = entry.target.id;
        const job = this._lazyQueue.find(j => j.id === canvasId);
        if (job) {
          // Verify canvas is still in an active view panel before rendering
          const panel = entry.target.closest('.view-panel');
          if (panel && !panel.classList.contains('active')) {
            this._lazyObserver.unobserve(entry.target);
            this._lazyQueue = this._lazyQueue.filter(j => j.id !== canvasId);
            return;
          }
          job.fn();
          this._lazyQueue = this._lazyQueue.filter(j => j.id !== canvasId);
          this._lazyObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '200px' });
  },

  _lazyRender(canvasId, renderFn) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    // If already visible or no IntersectionObserver, render immediately
    if (!('IntersectionObserver' in window)) { renderFn(); return; }
    this._initLazyObserver();
    // Remove any previous pending job for this canvas
    this._lazyQueue = this._lazyQueue.filter(j => j.id !== canvasId);
    this._lazyObserver.unobserve(canvas);
    // Check if already in viewport
    const rect = canvas.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200 && rect.bottom > -200) {
      renderFn();
    } else {
      this._lazyQueue.push({ id: canvasId, fn: renderFn });
      this._lazyObserver.observe(canvas);
    }
  },

  // Update all berry charts (lazy — only renders visible ones immediately)
  updateBerryCharts(data) {
    this.updateLegend(data);
    // Top charts render immediately
    this.createScatter('chartBrix', data, 'daysPostCrush', 'brix', 'Días Post-Envero', 'Brix (°Bx)');
    this.createScatter('chartAnt', data, 'daysPostCrush', 'tANT', 'Días Post-Envero', 'tANT (ppm ME)');
    this.createScatter('chartPH', data, 'daysPostCrush', 'pH', 'Días Post-Envero', 'pH');
    this.createScatter('chartTA', data, 'daysPostCrush', 'ta', 'Días Post-Envero', 'AT (g/L)');
    // Below-fold charts lazy-render on scroll
    this._lazyRender('chartWeight', () => this.createScatter('chartWeight', data, 'daysPostCrush', 'berryFW', 'Días Post-Envero', 'Peso Baya (g)'));
    this._lazyRender('chartScatter', () => this.createPureScatter('chartScatter', data, 'pH', 'brix', 'pH', 'Brix'));
    this._lazyRender('chartVarBrix', () => this.createBarChart('chartVarBrix', data, 'brix', 'Brix Promedio'));
    this._lazyRender('chartVarAnt', () => this.createBarChart('chartVarAnt', data, 'tANT', 'tANT Promedio'));
    this._lazyRender('chartOrigen', () => this.createDoughnut('chartOrigen', data));
    this._lazyRender('chartOriginBrix', () => this.createOriginBarChart('chartOriginBrix', data, 'brix', 'Brix Promedio'));
    this._lazyRender('chartOriginAnt', () => this.createOriginBarChart('chartOriginAnt', data, 'tANT', 'tANT Promedio'));
    this._lazyRender('chartOriginPH', () => this.createOriginBarChart('chartOriginPH', data, 'pH', 'pH Promedio'));
    this._lazyRender('chartOriginTA', () => this.createOriginBarChart('chartOriginTA', data, 'ta', 'AT Promedio'));
    this._lazyRender('chartOriginRadar', () => this.createOriginRadarChart('chartOriginRadar', data));
  },

  // ── Evolution Chart (WineXRay-style) ─────────────────────────

  // Build evolution data: merge berry + wine data for a lot using berryToWine mapping
  _buildEvolutionData(berryData, wineData) {
    const lots = {};
    // Berry points
    berryData.forEach(d => {
      if (!d.lotCode || d.daysPostCrush === null || d.daysPostCrush === undefined) return;
      if (!lots[d.lotCode]) lots[d.lotCode] = { variety: d.variety, appellation: d.appellation, points: [] };
      lots[d.lotCode].points.push({
        daysPostCrush: d.daysPostCrush,
        sampleId: d.sampleId,
        sampleDate: d.sampleDate,
        tANT: d.tANT, brix: d.brix, pH: d.pH, ta: d.ta,
        fANT: null, bANT: null, pTAN: null, iRPs: null, ipt: null,
        source: 'berry'
      });
    });
    // Wine points via berryToWine mapping
    const wineByCodigo = {};
    wineData.forEach(d => { if (d.codigoBodega) wineByCodigo[d.codigoBodega] = d; });

    Object.entries(CONFIG.berryToWine).forEach(([berryLot, wineLots]) => {
      wineLots.forEach(wl => {
        const w = wineByCodigo[wl];
        if (!w || w.daysPostCrush === null || w.daysPostCrush === undefined) return;
        const target = lots[berryLot];
        if (!target) return;
        target.points.push({
          daysPostCrush: w.daysPostCrush,
          sampleId: w.codigoBodega,
          sampleDate: w.fecha,
          tANT: w.antoWX, fANT: w.freeANT, bANT: w.boundANT,
          pTAN: w.pTAN, iRPs: w.iRPs, ipt: w.iptSpica,
          brix: w.brix, pH: w.pH, ta: w.at,
          source: 'wine'
        });
      });
    });
    // Sort points within each lot
    Object.values(lots).forEach(lot => lot.points.sort((a, b) => a.daysPostCrush - b.daysPostCrush));
    return lots;
  },

  createEvolutionChart(canvasId, data, compounds, berryData, wineData) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const lots = this._buildEvolutionData(berryData || data, wineData || []);
    if (!Object.keys(lots).length) {
      this._drawNoData(canvas, 'Sin datos de evolución disponibles');
      return;
    }

    const activeCompounds = compounds && compounds.length ? compounds : ['tANT'];
    const compoundMeta = {
      tANT: { label: 'tANT (ppm ME)', color: '#555555' },
      fANT: { label: 'fANT (ppm ME)', color: '#888888' },
      bANT: { label: 'bANT (ppm ME)', color: '#AAAAAA' },
      pTAN: { label: 'pTAN (ppm CE)', color: '#E07060' },
      iRPs: { label: 'iRPs (ppm CE)', color: '#60A8C0' },
      ipt:  { label: 'IPT', color: '#C4A060' }
    };

    const colorBy = Filters.state.colorBy;
    const resolveColor = colorBy === 'origin'
      ? (app) => CONFIG.resolveOriginColor(app)
      : (_, variety) => CONFIG.varietyColors[variety] || '#888';

    const datasets = [];
    const lotEntries = Object.entries(lots);

    lotEntries.forEach(([lotCode, lot]) => {
      const lotColor = resolveColor(lot.appellation, lot.variety);

      // One dataset per compound per lot
      activeCompounds.forEach((compound, ci) => {
        const pts = lot.points
          .filter(p => p[compound] !== null && p[compound] !== undefined && typeof p[compound] === 'number')
          .map(p => ({
            x: p.daysPostCrush, y: p[compound],
            sampleId: p.sampleId, variety: lot.variety, appellation: lot.appellation,
            source: p.source
          }));
        if (!pts.length) return;

        // Identify last point
        const lastIdx = pts.length - 1;
        const radii = pts.map(() => 4);
        const bdColors = pts.map((_, i) => i === lastIdx ? '#DDB96E' : lotColor);
        const bdWidths = pts.map((_, i) => i === lastIdx ? 3 : 0.5);

        datasets.push({
          label: `${lotCode} · ${compoundMeta[compound]?.label || compound}`,
          data: pts,
          borderColor: lotColor,
          backgroundColor: lotColor + '99',
          pointBackgroundColor: pts.map((_, i) => i === lastIdx ? lotColor : lotColor + '99'),
          pointBorderColor: bdColors,
          pointRadius: radii,
          pointBorderWidth: bdWidths,
          pointHoverRadius: 8,
          borderWidth: 2,
          showLine: true,
          tension: 0.3,
          fill: false,
          yAxisID: 'y',
          _lotCode: lotCode,
          borderDash: ci > 0 ? [5, 3] : []
        });
      });

      // Brix on secondary Y-axis (always shown, purple squares)
      const brixPts = lot.points
        .filter(p => p.brix !== null && p.brix !== undefined && typeof p.brix === 'number')
        .map(p => ({
          x: p.daysPostCrush, y: p.brix,
          sampleId: p.sampleId, variety: lot.variety, appellation: lot.appellation,
          source: p.source
        }));
      if (brixPts.length) {
        datasets.push({
          label: `${lotCode} · Brix`,
          data: brixPts,
          borderColor: '#9B59B6',
          backgroundColor: '#9B59B6CC',
          pointBackgroundColor: '#9B59B6',
          pointBorderColor: '#9B59B6',
          pointStyle: 'rect',
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 1.5,
          showLine: true,
          tension: 0.3,
          fill: false,
          yAxisID: 'y1',
          borderDash: [3, 3],
          _lotCode: lotCode
        });
      }
    });

    if (!datasets.length) {
      this._drawNoData(canvas, 'Sin datos de evolución para los compuestos seleccionados');
      return;
    }

    // Click to highlight a lot, double-click to reset
    const onClick = (evt) => {
      const chart = this.instances[canvasId];
      if (!chart) return;
      const elements = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
      if (!elements.length) return;
      const clickedDs = chart.data.datasets[elements[0].datasetIndex];
      const clickedLot = clickedDs._lotCode;
      if (!clickedLot) return;
      chart.data.datasets.forEach(ds => {
        if (ds._lotCode === clickedLot) {
          ds.borderColor = ds.borderColor.replace(/[0-9a-f]{2}$/i, '') || ds.borderColor;
          ds.borderWidth = ds.yAxisID === 'y1' ? 1.5 : 2;
        } else {
          ds.borderColor = (ds.borderColor.length === 7 ? ds.borderColor + '55' : ds.borderColor);
          ds.borderWidth = 1;
        }
      });
      chart.update();
    };
    const onDblClick = () => {
      const chart = this.instances[canvasId];
      if (!chart) return;
      chart.data.datasets.forEach(ds => {
        ds.borderColor = ds.borderColor.replace(/[0-9a-f]{2}$/i, '').slice(0, 7) || ds.borderColor;
        ds.borderWidth = ds.yAxisID === 'y1' ? 1.5 : 2;
      });
      chart.update();
    };

    this._createChart(canvasId, canvas, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: true },
        onClick,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: CONFIG.chartDefaults.tickColor,
              font: { size: 8, family: 'Sackers Gothic Medium' },
              boxWidth: 10,
              padding: 6,
              filter: (item) => !item.text.includes('Brix') || item.datasetIndex < 5
            }
          },
          tooltip: {
            ...this.tooltipConfig(),
            callbacks: {
              ...this.tooltipConfig().callbacks,
              label: (ctx) => {
                const r = ctx.raw;
                const lines = [];
                if (r.sampleId) lines.push(`Lote: ${r.sampleId}`);
                if (r.source) lines.push(`Fuente: ${r.source === 'berry' ? 'Baya' : 'Vino'}`);
                lines.push(`${ctx.dataset.label}: ${typeof r.y === 'number' ? r.y.toFixed(2) : r.y}`);
                lines.push(`DPE: ${r.x}`);
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Días Post-Envero', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
            ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
            grid: { color: CONFIG.chartDefaults.gridColor }
          },
          y: {
            position: 'left',
            title: { display: true, text: 'Fenólicos (ppm)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
            ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
            grid: { color: CONFIG.chartDefaults.gridColor }
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'Brix (°Bx)', color: '#9B59B6', font: { size: 9, family: 'Sackers Gothic Medium' } },
            ticks: { color: '#9B59B6', font: { size: 9, family: 'Sackers Gothic Medium' } },
            grid: { drawOnChartArea: false },
            min: 0,
            max: 30
          }
        },
        animation: { duration: 300 }
      }
    });

    // Attach double-click handler
    canvas.ondblclick = onDblClick;
  },

  updateEvolutionChart() {
    const canvas = document.getElementById('chartEvolution');
    if (!canvas) return;

    // Read selected compounds from UI
    const checkboxes = document.querySelectorAll('.evo-compound-toggle:checked');
    const compounds = Array.from(checkboxes).map(cb => cb.value);
    if (!compounds.length) compounds.push('tANT');

    const berryData = Filters.getFiltered();
    const wineData = DataStore.wineRecepcion;

    this.createEvolutionChart('chartEvolution', berryData, compounds, berryData, wineData);
  }
};
