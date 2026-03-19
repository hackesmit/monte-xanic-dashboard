// ── Chart Utilities & Shared State ──
// Defines the Charts global object with shared helpers.
// Other chart files extend this object with their methods.

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

  // Resolve color function and group field based on current colorBy state
  _resolveColorFn() {
    return Filters.state.colorBy === 'origin'
      ? (n) => CONFIG.resolveOriginColor(n)
      : (n) => CONFIG.varietyColors[n] || CONFIG._hashColor(n);
  },

  _groupField() {
    return Filters.state.colorBy === 'origin' ? 'appellation' : 'variety';
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
      return `<div class="legend-item${dimmed}" onclick="Charts.toggleSeries('${item.label.replace(/'/g, "\\'")}')" title="${item.label.replace(/"/g, '&quot;')}">
        <div class="legend-dot" style="background:${item.color.replace(/[";]/g, '')}"></div>
        <span>${item.label}</span>
      </div>`;
    }).join('');
  },

  // Vintage colours shared across all charts
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

  _drawNoData(canvas, msg) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this._getThemeColor('--muted') || '#6B6B6B';
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

      const link = document.createElement('a');
      const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      link.download = `monte-xanic-${safeName}.png`;
      link.href = tmp.toDataURL('image/png');
      link.click();
    }
  }
};
