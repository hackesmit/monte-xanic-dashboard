// ── Main Application Logic ──

const App = {
  currentView: 'berry',
  initialized: false,
  theme: 'dark',

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },

  async init() {
    if (this.initialized) return;
    this.restoreTheme();

    // 1 — Try localStorage cache (instant render)
    if (DataStore.loadCache()) {
      this.onDataLoaded();
      // Refresh from Supabase in background; silently update if new data arrives
      DataStore.initSupabase().then(() => {
        DataStore.loadFromSupabase().then(loaded => {
          if (loaded && this.initialized) this.refresh();
          this._updateDbStatus();
        }).catch(err => console.error('Supabase load failed:', err));
      }).catch(err => console.error('Supabase init failed:', err));
    } else {
      // 2 — Try Supabase (first visit or stale cache)
      await DataStore.initSupabase();
      const supaLoaded = await DataStore.loadFromSupabase();
      this._updateDbStatus();
      if (supaLoaded) {
        this.onDataLoaded();
      } else {
        // 3 — Fall back to pre-extracted JSON files (legacy / offline)
        const jsonLoaded = await DataStore.loadFromJSON();
        if (jsonLoaded) {
          this.onDataLoaded();
        } else {
          this.showDataLoader();
        }
      }
    }
    this.bindGlobalEvents();
  },

  // Update the DB status badge in the header
  _updateDbStatus() {
    const badge = document.getElementById('db-status-badge');
    if (!badge) return;
    if (DataStore.supabase) {
      badge.textContent = 'DB ✓';
      badge.title = 'Conectado a Supabase';
      badge.className = 'db-badge db-badge-ok';
    } else {
      badge.textContent = 'DB —';
      badge.title = 'Sin conexión a base de datos (modo local)';
      badge.className = 'db-badge db-badge-off';
    }
  },

  bindGlobalEvents() {
    // File input handler
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
    }

    // Drag and drop
    const loaderCard = document.getElementById('loader-card');
    if (loaderCard) {
      loaderCard.addEventListener('dragover', (e) => {
        e.preventDefault();
        loaderCard.classList.add('dragover');
      });
      loaderCard.addEventListener('dragleave', () => {
        loaderCard.classList.remove('dragover');
      });
      loaderCard.addEventListener('drop', (e) => {
        e.preventDefault();
        loaderCard.classList.remove('dragover');
        this.handleFiles(e.dataTransfer.files);
      });
    }
  },

  async handleFiles(fileList) {
    const files = Array.from(fileList);
    const statusEl = document.getElementById('loader-status');

    for (const file of files) {
      const name = file.name.toLowerCase();
      try {
        // Try WineXRay format first (CSV or any file) — auto-detect by headers
        if (statusEl) statusEl.innerHTML += `<div class="loader-file-item"><span class="pending">⏳</span> Procesando ${this._esc(file.name)}...</div>`;

        if (name.endsWith('.csv') || name.includes('result') || name.includes('winexray') || name.includes('export')) {
          // Likely WineXRay — try unified processing
          const result = await DataStore.processWineXRayFile(file);
          if (result.berry > 0 || result.wine > 0) {
            if (statusEl) statusEl.lastElementChild.innerHTML = `<span class="check">✓</span> ${this._esc(file.name)} — ${result.berry} bayas, ${result.wine} vinos`;
          } else {
            if (statusEl) statusEl.lastElementChild.innerHTML = `<span style="color:var(--flag-error)">✗</span> ${this._esc(file.name)} — No se encontraron datos`;
          }
        } else if (name.includes('berry') || name.includes('corrected') || name.includes('combined')) {
          const count = await DataStore.processBerryFile(file);
          if (statusEl) statusEl.lastElementChild.innerHTML = `<span class="check">✓</span> ${this._esc(file.name)} — ${count} registros de bayas`;
        } else if (name.includes('recep') || name.includes('tanque') || name.includes('tank') || name.includes('rg-lab')) {
          const count = await DataStore.processWineFile(file);
          if (statusEl) statusEl.lastElementChild.innerHTML = `<span class="check">✓</span> ${this._esc(file.name)} — ${count} registros de vino`;
        } else {
          // Unknown file — try WineXRay first, then berry, then wine
          try {
            const wb = await DataStore.loadFile(file);
            const sheetName = wb.SheetNames[0];
            const rows = DataStore.sheetToArray(wb, sheetName);
            if (DataStore.isWineXRayFormat(rows[0])) {
              const result = await DataStore.processWineXRayFile(file);
              if (statusEl) statusEl.lastElementChild.innerHTML = `<span class="check">✓</span> ${this._esc(file.name)} — ${result.berry} bayas, ${result.wine} vinos`;
            } else {
              const count = await DataStore.processBerryFile(file);
              if (count > 0) {
                if (statusEl) statusEl.lastElementChild.innerHTML = `<span class="check">✓</span> ${this._esc(file.name)} — ${count} registros`;
              } else {
                const wCount = await DataStore.processWineFile(file);
                if (statusEl) statusEl.lastElementChild.innerHTML = `<span class="check">✓</span> ${this._esc(file.name)} — ${wCount} registros`;
              }
            }
          } catch (e2) {
            if (statusEl) statusEl.lastElementChild.innerHTML = `<span style="color:var(--flag-error)">✗</span> ${this._esc(file.name)} — Error: ${this._esc(e2.message)}`;
          }
        }
      } catch (err) {
        if (statusEl) statusEl.innerHTML += `<div class="loader-file-item"><span style="color:var(--flag-error)">✗</span> ${this._esc(file.name)} — Error: ${this._esc(err.message)}</div>`;
      }
    }

    if (DataStore.loaded.berry || DataStore.loaded.wine) {
      DataStore.cacheData();
      setTimeout(() => this.onDataLoaded(), 500);
    }
  },

  showDataLoader() {
    document.getElementById('data-loader')?.classList.add('active');
    document.getElementById('dashboard-content')?.style.setProperty('display', 'none');
  },

  hideDataLoader() {
    document.getElementById('data-loader')?.classList.remove('active');
    document.getElementById('dashboard-content')?.style.removeProperty('display');
  },

  onDataLoaded() {
    this.hideDataLoader();
    this.initialized = true;
    Filters.init();
    this.setView('berry');
    this.refresh();

    // Load weather in background after dashboard is visible
    WeatherStore.load().then(hasCache => {
      const vintages = WeatherStore.getVintagesFromData();
      if (!vintages.length) return;
      // Sync any missing harvest-season days from Open-Meteo
      WeatherStore.sync(vintages).then(() => {
        // Re-render whichever view is active (weather charts only draw if visible)
        if (this.currentView === 'vintage' || this.currentView === 'berry') this.refresh();
      });
      // If we already had cached weather, re-render immediately
      if (hasCache && (this.currentView === 'vintage' || this.currentView === 'berry')) {
        this.refresh();
      }
    });
  },

  setView(view) {
    this.currentView = view;

    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === view);
    });

    // Show/hide view panels
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `view-${view}`);
    });

    // Show/hide relevant sidebar sections
    const berryFilters = document.getElementById('berry-filters');
    const wineFilters = document.getElementById('wine-filters');
    if (berryFilters) berryFilters.style.display = (view === 'berry' || view === 'vintage' || view === 'extraction') ? '' : 'none';
    if (wineFilters) wineFilters.style.display = (view === 'wine') ? '' : 'none';

    this.refresh();
  },

  refresh() {
    if (!this.initialized) return;

    const filteredBerry = Filters.getFiltered();

    switch (this.currentView) {
      case 'berry':
        KPIs.updateBerryKPIs(filteredBerry);
        Charts.updateBerryCharts(filteredBerry);
        Tables.updateBerryTable(filteredBerry);
        Charts.createTempCorrelation('chartBrixTemp', filteredBerry);
        Charts.createRainCorrelation('chartTantRain', filteredBerry);
        break;

      case 'wine':
        const filteredWine = Filters.getFilteredWine();
        const filteredPreferment = Filters.getFilteredPreferment();
        KPIs.updateWineKPIs(filteredWine);
        Tables.updateWineTable(filteredWine);
        Tables.updatePrefermentTable(filteredPreferment);
        break;

      case 'extraction':
        Charts.createExtractionChart('chartExtraction', filteredBerry, Filters.getFilteredWine());
        this.updateExtractionTable();
        break;

      case 'vintage':
        this._updateVintageUI(filteredBerry);
        Charts.createVintageComparison('chartVintageBrix', filteredBerry, 'brix', 'Brix (°Bx)');
        Charts.createVintageComparison('chartVintageAnt', filteredBerry, 'tANT', 'tANT (ppm ME)');
        Charts.createVintageComparison('chartVintagePH', filteredBerry, 'pH', 'pH');
        Charts.createVintageComparison('chartVintageTA', filteredBerry, 'ta', 'AT (g/L)');
        this.updateVintageSummary(filteredBerry);
        this.updateVintageVarietalTable(filteredBerry);
        Charts.createWeatherTimeSeries('chartWeatherTemp', WeatherStore.getVintagesFromData());
        Charts.createRainfallChart('chartWeatherRain', WeatherStore.getVintagesFromData());
        break;
    }

  },

  // ── Vintage UI helpers ──

  _updateVintageUI(data) {
    const years = [...new Set(data.map(d => d.vintage).filter(Boolean))].map(Number).sort();

    // Update section label
    const sectionLabel = document.getElementById('vintage-section-label');
    if (sectionLabel) {
      if (years.length >= 2) {
        sectionLabel.textContent = 'Comparación ' + years.join(' vs ');
      } else if (years.length === 1) {
        sectionLabel.textContent = 'Vendimia ' + years[0];
      } else {
        sectionLabel.textContent = 'Comparación entre Vendimias';
      }
    }

    // Update legend dots
    const dotsContainer = document.getElementById('vintage-legend-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = years.map(y => {
        const color = Charts._vintageColor(y);
        return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted)">
          <div style="width:12px;height:12px;background:${color};border-radius:50%"></div> ${y}
        </div>`;
      }).join('');
    }

    // Update header tagline with detected years
    const tagline = document.getElementById('header-tagline');
    if (tagline && years.length) {
      tagline.textContent = 'Seguimiento de Maduración y Fenólicos — Vendimia ' + years.join(' & ');
    }
  },

  // ── Vintage Summary Tables ──

  updateVintageSummary(data) {
    const body = document.getElementById('vintage-summary-body');
    const thead = document.getElementById('vintage-summary-head');
    if (!body) return;

    const avg = (arr) => {
      const valid = arr.filter(x => typeof x === 'number' && !isNaN(x));
      return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };

    // Dynamically detect all vintage years, sorted ascending
    const years = [...new Set(data.map(d => d.vintage).filter(Boolean))].map(Number).sort();
    if (!years.length) { body.innerHTML = ''; return; }

    // Group data by vintage
    const dataByYear = {};
    years.forEach(y => { dataByYear[y] = data.filter(d => Number(d.vintage) === y); });

    // Build dynamic header
    if (thead) {
      let headerHtml = '<tr><th>Parámetro</th>';
      years.forEach(y => {
        const color = Charts._vintageColor(y);
        headerHtml += `<th style="text-align:center"><span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:50%;vertical-align:middle;margin-right:4px"></span>${y}</th>`;
      });
      // Diff columns between the two most recent vintages
      if (years.length >= 2) {
        headerHtml += '<th style="text-align:center">Diferencia</th>';
        headerHtml += '<th style="text-align:center">Cambio %</th>';
      }
      headerHtml += '</tr>';
      thead.innerHTML = headerHtml;
    }

    const metrics = [
      { name: 'Brix Promedio', field: 'brix', dec: 1, unit: '°Bx' },
      { name: 'pH Promedio', field: 'pH', dec: 2, unit: '' },
      { name: 'Acidez Total', field: 'ta', dec: 1, unit: 'g/L' },
      { name: 'tANT Promedio', field: 'tANT', dec: 0, unit: 'ppm' },
      { name: 'Peso Baya', field: 'berryFW', dec: 2, unit: 'g' },
      { name: 'Muestras', field: '_count', dec: 0, unit: '' },
      { name: 'Lotes Únicos', field: '_lots', dec: 0, unit: '' }
    ];

    const fmt = (v, dec) => v !== null && v !== undefined ? (dec === 0 ? Math.round(v) : v.toFixed(dec)) : '—';

    body.innerHTML = metrics.map(m => {
      // Compute value for each vintage year
      const vals = {};
      years.forEach(y => {
        const yd = dataByYear[y];
        if (m.field === '_count') {
          vals[y] = yd.length;
        } else if (m.field === '_lots') {
          vals[y] = new Set(yd.map(d => d.sampleId)).size;
        } else {
          vals[y] = avg(yd.map(d => d[m.field]));
        }
      });

      let row = `<td style="text-align:left;font-weight:400;color:var(--gold-lt)">${m.name}${m.unit ? ' <span style="color:var(--muted);font-weight:300">(' + m.unit + ')</span>' : ''}</td>`;

      years.forEach(y => {
        const color = Charts._vintageColor(y);
        row += `<td style="color:${color}">${fmt(vals[y], m.dec)}</td>`;
      });

      // Diff between the two most recent vintages
      if (years.length >= 2) {
        const prev = years[years.length - 2];
        const curr = years[years.length - 1];
        const vPrev = vals[prev];
        const vCurr = vals[curr];
        const diff = (vPrev !== null && vCurr !== null) ? vCurr - vPrev : null;
        const pct = (vPrev !== null && vCurr !== null && vPrev !== 0) ? ((diff / Math.abs(vPrev)) * 100) : null;
        const diffClass = diff !== null ? (diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-neutral') : '';
        const sign = diff !== null && diff > 0 ? '+' : '';
        row += `<td class="${diffClass}">${diff !== null ? sign + fmt(diff, m.dec) : '—'}</td>`;
        row += `<td class="${diffClass}">${pct !== null ? sign + pct.toFixed(1) + '%' : '—'}</td>`;
      }

      return `<tr>${row}</tr>`;
    }).join('');
  },

  updateVintageVarietalTable(data) {
    const body = document.getElementById('vintage-varietal-body');
    const thead = document.getElementById('vintage-varietal-head');
    if (!body) return;

    const avg = (arr) => {
      const valid = arr.filter(x => typeof x === 'number' && !isNaN(x));
      return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    const fmt = (v, dec) => v !== null && v !== undefined ? (dec === 0 ? Math.round(v) : v.toFixed(dec)) : '—';

    // Dynamically detect all vintage years, sorted ascending
    const years = [...new Set(data.map(d => d.vintage).filter(Boolean))].map(Number).sort();
    if (!years.length) { body.innerHTML = ''; return; }

    // Build dynamic header: Varietal | Brix Y1 | Brix Y2 | ... | pH Y1 | ... | n Y1 | n Y2 | ...
    const paramCols = [
      { label: 'Brix', field: 'brix', dec: 1 },
      { label: 'pH', field: 'pH', dec: 2 },
      { label: 'tANT', field: 'tANT', dec: 0 },
      { label: 'AT', field: 'ta', dec: 1 },
      { label: 'n', field: '_count', dec: 0 }
    ];

    if (thead) {
      let headerHtml = '<tr><th>Varietal</th>';
      paramCols.forEach(p => {
        years.forEach(y => {
          headerHtml += `<th style="text-align:center">${p.label} ${y}</th>`;
        });
      });
      headerHtml += '</tr>';
      thead.innerHTML = headerHtml;
    }

    // Group data by variety and vintage
    const varieties = [...new Set(data.map(d => d.variety).filter(Boolean))].sort();

    body.innerHTML = varieties.map(v => {
      const color = CONFIG.varietyColors[v] || '#888';
      const byYear = {};
      years.forEach(y => { byYear[y] = data.filter(d => d.variety === v && Number(d.vintage) === y); });

      let row = `<td style="text-align:left"><span class="badge badge-variety" style="border-color:${color}55;color:${color}">${v}</span></td>`;

      paramCols.forEach(p => {
        years.forEach(y => {
          const vintColor = Charts._vintageColor(y);
          let val;
          if (p.field === '_count') {
            val = byYear[y].length || null;
          } else {
            val = avg(byYear[y].map(d => d[p.field]));
          }
          row += `<td style="color:${vintColor}">${p.field === '_count' ? (val || '—') : fmt(val, p.dec)}</td>`;
        });
      });

      return `<tr>${row}</tr>`;
    }).join('');
  },

  // ── Extraction Table ──

  updateExtractionTable() {
    const container = document.getElementById('extraction-table-body');
    if (!container) return;

    const mapping = CONFIG.berryToWine;
    const berryByLot = {};
    DataStore.berryData.forEach(d => {
      if (!d.sampleId || d.tANT === null || typeof d.tANT !== 'number') return;
      const lotCode = d.lotCode;
      if (!berryByLot[lotCode] || (d.daysPostCrush || 0) > (berryByLot[lotCode].daysPostCrush || 0)) {
        berryByLot[lotCode] = d;
      }
    });

    const wineByCodigo = {};
    DataStore.wineRecepcion.forEach(d => {
      if (d.codigoBodega) wineByCodigo[d.codigoBodega] = d;
    });

    const rows = [];
    Object.entries(mapping).forEach(([berryLot, wineLots]) => {
      const berry = berryByLot[berryLot];
      if (!berry) return;
      wineLots.forEach(wl => {
        const wine = wineByCodigo[wl];
        const berryTANT = berry.tANT;
        const wineTANT = wine?.antoWX;
        const extraction = (wineTANT && berryTANT) ? ((wineTANT / berryTANT) * 100) : null;
        rows.push({ berryLot, wineLot: wl, variety: berry.variety, appellation: berry.appellation, berryTANT, wineTANT, extraction });
      });
    });

    container.innerHTML = rows.map(r => {
      const varColor = CONFIG.varietyColors[r.variety] || '#888';
      const extColor = r.extraction ? (r.extraction > 60 ? '#7EC87A' : r.extraction > 40 ? '#C4A060' : '#E05050') : '';
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${r.berryLot}</td>
        <td>${r.wineLot}</td>
        <td><span class="badge badge-variety" style="border-color:${varColor}55;color:${varColor}">${r.variety || '—'}</span></td>
        <td>${r.appellation || '—'}</td>
        <td>${r.berryTANT !== null ? Math.round(r.berryTANT) : '—'}</td>
        <td>${r.wineTANT !== null && r.wineTANT !== undefined ? Math.round(r.wineTANT) : '—'}</td>
        <td style="color:${extColor};font-weight:400">${r.extraction !== null ? r.extraction.toFixed(1) + '%' : '—'}</td>
      </tr>`;
    }).join('');
  },

  // ── Mobile Filter Toggle ──

  toggleMobileFilters() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('mobile-filter-toggle');
    if (!sidebar || !btn) return;
    const expanded = sidebar.classList.toggle('filters-expanded');
    btn.textContent = expanded ? 'Filtros \u25B2' : 'Filtros \u25BC';
  },

  // ── Theme Toggle ──

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.theme);
    localStorage.setItem('xanic_theme', this.theme);

    // Toggle icon visibility
    const darkIcon = document.querySelector('.theme-icon-dark');
    const lightIcon = document.querySelector('.theme-icon-light');
    if (this.theme === 'light') {
      if (darkIcon) darkIcon.style.display = 'none';
      if (lightIcon) lightIcon.style.display = '';
    } else {
      if (darkIcon) darkIcon.style.display = '';
      if (lightIcon) lightIcon.style.display = 'none';
    }

    // Re-render charts for new theme colors
    if (this.initialized) {
      this.updateChartTheme();
      this.refresh();
    }
  },

  restoreTheme() {
    const saved = localStorage.getItem('xanic_theme');
    if (saved === 'light') {
      this.theme = 'light';
      document.documentElement.setAttribute('data-theme', 'light');
      const darkIcon = document.querySelector('.theme-icon-dark');
      const lightIcon = document.querySelector('.theme-icon-light');
      if (darkIcon) darkIcon.style.display = 'none';
      if (lightIcon) lightIcon.style.display = '';
    }
  },

  updateChartTheme() {
    // Update Chart.js global defaults for the current theme
    const isLight = this.theme === 'light';
    CONFIG.chartDefaults.gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
    CONFIG.chartDefaults.tickColor = isLight ? '#7A7A7A' : '#4A4A4A';
  },

  // ── Help Modal ──

  toggleHelp() {
    const modal = document.getElementById('help-modal');
    if (!modal) return;
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
  },

  // Reload data (clear cache and show loader)
  reloadData() {
    DataStore.clearCache();
    DataStore.berryData = [];
    DataStore.wineRecepcion = [];
    DataStore.winePreferment = [];
    DataStore.loaded = { berry: false, wine: false };
    this.initialized = false;
    Charts.destroyAll();
    const loaderStatus = document.getElementById('loader-status');
    if (loaderStatus) loaderStatus.innerHTML = '';
    this.showDataLoader();
  }
};

// Initialize on DOM ready — auth gate before app
document.addEventListener('DOMContentLoaded', async () => {
  const authed = await Auth.init();
  if (authed) App.init();
});
