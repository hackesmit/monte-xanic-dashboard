// ── Extraction Chart ──
// Berry-to-wine tANT extraction comparison.

Charts.createExtractionChart = function(canvasId, berryData, wineData) {
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
    this._drawNoData(canvas, 'Cargue ambos archivos para ver la comparación');
    return;
  }

  const labels = pairs.map(p => p.berryLot);
  const berryVals = pairs.map(p => p.berryTANT);
  const wineVals = pairs.map(p => p.wineTANT);

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
};
