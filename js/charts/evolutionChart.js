// ── Evolution Chart (WineXRay-style) ──
// Berry→wine phenolic evolution with dual Y-axis (phenolics + Brix).

// Build evolution data: merge berry + wine data for a lot using berryToWine mapping
Charts._buildEvolutionData = function(berryData, wineData) {
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
};

Charts.createEvolutionChart = function(canvasId, data, compounds, berryData, wineData) {
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
      const radii = pts.map((_, i) => i === lastIdx ? 7 : 4);
      const bdWidths = pts.map((_, i) => i === lastIdx ? 2 : 0.5);

      datasets.push({
        label: `${lotCode} · ${compoundMeta[compound]?.label || compound}`,
        data: pts,
        borderColor: lotColor,
        backgroundColor: lotColor + '99',
        pointBackgroundColor: pts.map((_, i) => i === lastIdx ? lotColor : lotColor + '99'),
        pointBorderColor: lotColor,
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

  this.instances[canvasId] = new Chart(canvas, {
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
};

Charts.updateEvolutionChart = function() {
  const canvas = document.getElementById('chartEvolution');
  if (!canvas) return;

  // Read selected compounds from UI
  const checkboxes = document.querySelectorAll('.evo-compound-toggle:checked');
  const compounds = Array.from(checkboxes).map(cb => cb.value);
  if (!compounds.length) compounds.push('tANT');

  const berryData = Filters.getFiltered();
  const wineData = DataStore.wineRecepcion;

  this.createEvolutionChart('chartEvolution', berryData, compounds, berryData, wineData);
};
