// ── Main Application Logic ──

const App = {
  currentView: 'berry',
  initialized: false,
  theme: 'dark',

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },

  async init() {
    if (this.initialized) return;
    this.restoreTheme();

    // Always show dashboard first — never show data loader as first screen
    this.hideDataLoader();

    // 1 — Try localStorage cache (instant render)
    if (DataStore.loadCache()) {
      this.onDataLoaded();
      // Refresh from Supabase in background; silently update if new data arrives
      DataStore.initSupabase().then(() => {
        DataStore.loadFromSupabase().then(loaded => {
          if (loaded && this.initialized) this.refresh();
          this._updateDbStatus();
        }).catch(err => {
          console.error('Supabase load failed:', err);
          this._showOfflineToast();
        });

        // Weather: load from Supabase meteorology table now that connection is ready
        WeatherStore.load().then(hasCache => {
          const vintages = WeatherStore.getVintagesFromData();
          if (!vintages.length) return;
          WeatherStore.sync(vintages).then(() => {
            if (this.currentView === 'vintage') this.refresh();
          });
          if (hasCache && this.currentView === 'vintage') this.refresh();
        });
      }).catch(err => {
        console.error('Supabase init failed:', err);
        this._showOfflineToast();
      });
    } else {
      // 2 — Try Supabase (first visit or stale cache)
      await DataStore.initSupabase();
      const supaLoaded = await DataStore.loadFromSupabase();
      DataStore.loadMediciones();
      this._updateDbStatus();
      if (supaLoaded) {
        this.onDataLoaded();
      } else {
        // 3 — Fall back to pre-extracted JSON files (legacy / offline)
        const jsonLoaded = await DataStore.loadFromJSON();
        if (jsonLoaded) {
          this.onDataLoaded();
        } else {
          // Show empty dashboard — upload is accessible via "Recargar Datos"
          this.onDataLoaded();
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
    Events.bindAll();

    // File input handler (legacy loader — upload panel handled by Events)
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

    // Mobile FAB + backdrop
    const fab = document.getElementById('mobile-fab');
    const backdrop = document.getElementById('mobile-backdrop');
    if (fab) fab.addEventListener('click', () => this.openMobileFilters());
    if (backdrop) backdrop.addEventListener('click', () => this.closeMobileFilters());

    // Cleanup on resize (close sheet if going to desktop)
    window.addEventListener('resize', () => {
      if (!this._isMobile()) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && sidebar.classList.contains('sheet-open')) {
          this.closeMobileFilters();
        }
      }
    });
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
    const modal = document.getElementById('data-loader');
    if (modal) modal.style.display = 'flex';
    Auth.applyRole();
  },

  hideDataLoader() {
    const modal = document.getElementById('data-loader');
    if (modal) modal.style.display = 'none';
    document.getElementById('dashboard-content')?.style.removeProperty('display');
  },

  _hideSpinner() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'none';
  },

  _showOfflineToast() {
    const raw = localStorage.getItem('xanic_data_cache');
    let ts = '';
    if (raw) {
      try {
        const cache = JSON.parse(raw);
        if (cache.ts) ts = new Date(cache.ts).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      } catch (_) {}
    }
    const msg = ts
      ? `Usando datos en caché (última actualización: ${ts})`
      : 'Usando datos en caché';
    const toast = document.getElementById('offline-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 6000);
  },

  onDataLoaded() {
    this.hideDataLoader();
    this._hideSpinner();
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
        if (this.currentView === 'vintage' || this.currentView === 'berry' || this.currentView === 'explorer') this.refresh();
      });
      // If we already had cached weather, re-render immediately
      if (hasCache && (this.currentView === 'vintage' || this.currentView === 'berry' || this.currentView === 'explorer')) {
        this.refresh();
      }
    });
  },

  setView(view) {
    this.currentView = view;

    // Close bottom sheet if open
    if (this._isMobile()) {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar && sidebar.classList.contains('sheet-open')) {
        this.closeMobileFilters();
      }
    }

    // Disconnect lazy observer from previous view to prevent stale renders
    if (Charts._lazyObserver) {
      Charts._lazyObserver.disconnect();
      Charts._lazyQueue = [];
    }
    Charts._pruneOrphans();

    // Sync nav tabs
    document.querySelectorAll('#nav-tabs .nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Show/hide view panels
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `view-${view}`);
    });

    // Show/hide relevant sidebar sections
    const berryFilters = document.getElementById('berry-filters');
    const wineFilters = document.getElementById('wine-filters');
    if (berryFilters) berryFilters.style.display = (view === 'berry' || view === 'vintage' || view === 'extraction' || view === 'explorer' || view === 'map' || view === 'mediciones') ? '' : 'none';
    if (wineFilters) wineFilters.style.display = (view === 'wine') ? '' : 'none';
    // Map view uses its own ranch/metric selectors — hide all filters
    if (view === 'map' || view === 'mediciones') {
      if (berryFilters) berryFilters.style.display = 'none';
      if (wineFilters) wineFilters.style.display = 'none';
    }

    // Re-sync filter chip UI to reflect preserved state
    Filters.syncChipUI();

    this.refresh();
  },

  _refreshPending: false,

  refresh() {
    if (!this.initialized) return;
    if (this._refreshInProgress) { this._refreshPending = true; return; }
    this._refreshInProgress = true;
    try {

    const filteredBerry = Filters.getFiltered();
    // pH outlier filter applied consistently across KPIs, charts, and table
    const cleanBerry = filteredBerry.filter(d => !(typeof d.pH === 'number' && (d.pH < 2.5 || d.pH > 5.0)));

    switch (this.currentView) {
      case 'berry':
        KPIs.updateBerryKPIs(cleanBerry);
        Charts.updateBerryCharts(cleanBerry);
        Tables.updateBerryTable(cleanBerry);
        Charts._lazyRender('chartBrixTemp', () => Charts.createTempCorrelation('chartBrixTemp', cleanBerry));
        Charts._lazyRender('chartTantRain', () => Charts.createRainCorrelation('chartTantRain', cleanBerry));
        Charts._lazyRender('chartEvolution', () => Charts.updateEvolutionChart());
        break;

      case 'wine': {
        const filteredWine = Filters.getFilteredWine();
        const filteredPreferment = Filters.getFilteredPreferment();
        KPIs.updateWineKPIs(filteredWine);
        Charts.createWinePhenolicsChart('chartWinePhenolics', filteredWine);
        Tables.updateWineTable(filteredWine);
        Tables.updatePrefermentTable(filteredPreferment);
        break;
      }

      case 'extraction': {
        const filteredWineExt = Filters.getFilteredWine();
        Charts.createExtractionChart('chartExtraction', cleanBerry, filteredWineExt);
        Charts.createExtractionPctChart('chartExtractionPct', cleanBerry, filteredWineExt);
        this.updateExtractionTable();
        break;
      }

      case 'vintage': {
        this._updateVintageUI(cleanBerry);
        Charts.createVintageComparison('chartVintageBrix', cleanBerry, 'brix', 'Brix (°Bx)');
        Charts.createVintageComparison('chartVintageAnt', cleanBerry, 'tANT', 'tANT (ppm ME)');
        Charts.createVintageComparison('chartVintagePH', cleanBerry, 'pH', 'pH');
        Charts.createVintageComparison('chartVintageTA', cleanBerry, 'ta', 'AT (g/L)');
        this.updateVintageSummary(cleanBerry);
        this.updateVintageVarietalTable(cleanBerry);
        const activeVintages = [...Filters.state.vintages];
        const calVintage = activeVintages.length === 1 ? activeVintages[0] : (activeVintages.length ? Math.max(...activeVintages) : null);
        Charts.createHarvestCalendar('chartHarvestCal', cleanBerry, Filters.getFilteredWine(), calVintage, Filters.state.weatherLocation || 'VDG');
        const latestBerryVintage = cleanBerry.length ? Math.max(...new Set(cleanBerry.map(d => d.vintage).filter(Boolean))) : null;
        const valleyVintage = activeVintages.length === 1 ? activeVintages[0] : (activeVintages.length ? Math.max(...activeVintages) : latestBerryVintage);
        Charts.createValleyTempChart('chartValleyTemp', valleyVintage);
        const weatherVintages = WeatherStore.getVintagesFromData();
        const weatherLoc = Filters.state.weatherLocation || 'VDG';
        Charts.createWeatherTimeSeries('chartWeatherTemp', weatherVintages, weatherLoc);
        Charts.createRainfallChart('chartWeatherRain', weatherVintages, weatherLoc);
        Charts.createGDDChart('chartGDD', weatherVintages, weatherLoc);
        break;
      }

      case 'map': {
        // Bridge berry data → MapStore format (latest measurement per lot)
        const latestByLot = {};
        for (const d of cleanBerry) {
          if (!d.lotCode) continue;
          const prev = latestByLot[d.lotCode];
          if (!prev || (d.daysPostCrush || 0) > (prev.daysPostCrush || 0)) {
            latestByLot[d.lotCode] = {
              fieldLot: d.lotCode, vintageYear: d.vintage,
              brix: d.brix, pH: d.pH, ta: d.ta, tANT: d.tANT,
              berryAvgWeight: d.berryFW, berryFW: d.berryFW
            };
          }
        }
        const vintage = Filters.state.vintages.size === 1 ? [...Filters.state.vintages][0] : null;
        MapStore.currentVintage = vintage;
        MapStore.aggregateBySection(Object.values(latestByLot), vintage);
        MapStore.render();
        break;
      }

      case 'explorer':
        Explorer.init();
        Explorer.refreshAll();
        break;

      case 'mediciones':
        Mediciones.initDropdowns();
        Mediciones.refresh();
        break;
    }

    this._updateFilterFAB();
    this._updateFilterSummary();

    } finally {
      this._refreshInProgress = false;
      if (this._refreshPending) {
        this._refreshPending = false;
        this.refresh();
      }
    }
  },

  // ── Vintage UI helpers ──

  _updateVintageUI(data) {
    const years = [...new Set(data.map(d => d.vintage).filter(Boolean))].map(Number).sort();

    // Update section label with active filter context
    const sectionLabel = document.getElementById('vintage-section-label');
    if (sectionLabel) {
      let label;
      if (years.length >= 2) {
        label = 'Comparación ' + years.join(' vs ');
      } else if (years.length === 1) {
        label = 'Vendimia ' + years[0];
      } else {
        label = 'Comparación entre Vendimias';
      }
      const filterParts = [];
      if (Filters.state.varieties.size) filterParts.push(...Filters.state.varieties);
      if (Filters.state.origins.size) filterParts.push(...Filters.state.origins);
      if (filterParts.length) label += ` (filtrado: ${filterParts.join(', ')})`;
      sectionLabel.textContent = label;
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
    const filteredBerry = Filters.getFiltered();
    filteredBerry.forEach(d => {
      if (!d.sampleId || d.tANT === null || typeof d.tANT !== 'number') return;
      const lotCode = d.lotCode;
      if (!berryByLot[lotCode] || (d.daysPostCrush || 0) > (berryByLot[lotCode].daysPostCrush || 0)) {
        berryByLot[lotCode] = d;
      }
    });

    const wineByCodigo = {};
    const filteredWineExt = Filters.getFilteredWine();
    filteredWineExt.forEach(d => {
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

  // ── Mobile helpers ──
  _isMobile() { return window.innerWidth <= 768; },
  _savedScrollY: 0,

  toggleMobileFilters() {
    // Legacy — now handled by FAB
    this.openMobileFilters();
  },

  openMobileFilters() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('mobile-backdrop');
    if (!sidebar) return;

    // Show correct filter section
    const berryFilters = document.getElementById('berry-filters');
    const wineFilters = document.getElementById('wine-filters');
    if (berryFilters) berryFilters.style.display = (this.currentView === 'wine') ? 'none' : '';
    if (wineFilters) wineFilters.style.display = (this.currentView === 'wine') ? '' : 'none';

    sidebar.classList.add('sheet-open');
    if (backdrop) backdrop.classList.add('open');

    // Lock body scroll (iOS-safe)
    this._savedScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${this._savedScrollY}px`;
  },

  closeMobileFilters() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('mobile-backdrop');
    if (!sidebar) return;

    // Slide-down animation before removing
    sidebar.classList.add('sheet-closing');
    if (backdrop) backdrop.classList.remove('open');

    const onEnd = () => {
      sidebar.classList.remove('sheet-open', 'sheet-closing');
      sidebar.removeEventListener('animationend', onEnd);

      // Restore scroll
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      window.scrollTo(0, this._savedScrollY);

      this.refresh();
    };
    sidebar.addEventListener('animationend', onEnd);
  },

  _updateFilterFAB() {
    if (!this._isMobile()) return;
    const badge = document.getElementById('fab-badge');
    if (!badge) return;

    let count = 0;
    if (this.currentView === 'wine') {
      count += Filters.wineState.varieties.size;
      count += Filters.wineState.origins.size;
      if (Filters.wineState.grapeType !== 'all') count++;
    } else {
      count += Filters.state.vintages.size;
      count += Filters.state.varieties.size;
      count += Filters.state.origins.size;
      count += Filters.state.lots.size;
      if (Filters.state.grapeType !== 'all') count++;
    }
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
  },

  _updateFilterSummary() {
    if (!this._isMobile()) return;

    const isWine = this.currentView === 'wine';
    const berrySum = document.getElementById('filter-summary-berry');
    const wineSum = document.getElementById('filter-summary-wine');
    const summaryEl = isWine ? wineSum : berrySum;
    const textEl = isWine
      ? document.getElementById('summary-text-wine')
      : document.getElementById('summary-text-berry');

    // Hide non-active summary
    if (berrySum && !isWine) berrySum.style.display = '';
    if (berrySum && isWine) berrySum.style.display = 'none';
    if (wineSum && isWine) wineSum.style.display = '';
    if (wineSum && !isWine) wineSum.style.display = 'none';

    if (!summaryEl || !textEl) return;

    const parts = [];
    if (isWine) {
      if (Filters.wineState.grapeType === 'red') parts.push('Tintas');
      else if (Filters.wineState.grapeType === 'white') parts.push('Blancas');
      Filters.wineState.varieties.forEach(v => parts.push(v.length > 12 ? v.slice(0, 10) + '…' : v));
      Filters.wineState.origins.forEach(v => parts.push(v.length > 12 ? v.slice(0, 10) + '…' : v));
    } else {
      Filters.state.vintages.forEach(v => parts.push(String(v)));
      if (Filters.state.grapeType === 'red') parts.push('Tintas');
      else if (Filters.state.grapeType === 'white') parts.push('Blancas');
      Filters.state.varieties.forEach(v => parts.push(v.length > 12 ? v.slice(0, 10) + '…' : v));
      Filters.state.origins.forEach(v => parts.push(v.length > 12 ? v.slice(0, 10) + '…' : v));
    }

    if (parts.length === 0) {
      textEl.textContent = 'Sin filtros activos';
      summaryEl.querySelector('.summary-clear').style.display = 'none';
    } else {
      const maxShow = 3;
      let text = parts.slice(0, maxShow).join(' · ');
      if (parts.length > maxShow) text += ` + ${parts.length - maxShow} más`;
      textEl.textContent = text;
      summaryEl.querySelector('.summary-clear').style.display = '';
    }
  },

  toggleMobileSection(groupId) {
    const group = document.getElementById(groupId);
    if (!group) return;
    const wasExpanded = group.classList.contains('expanded');
    group.classList.toggle('expanded');

    // After expanding, re-trigger lazy observer for charts inside
    if (!wasExpanded && Charts._lazyObserver) {
      group.querySelectorAll('canvas').forEach(c => {
        const job = Charts._lazyQueue.find(j => j.id === c.id);
        if (job) {
          Charts._lazyObserver.unobserve(c);
          Charts._lazyObserver.observe(c);
        }
      });
    }
  },

  // ── Theme Toggle ──

  _syncThemeIcons() {
    const isLight = this.theme === 'light';
    const darkIcon = document.querySelector('.theme-icon-dark');
    const lightIcon = document.querySelector('.theme-icon-light');
    if (darkIcon) darkIcon.style.display = isLight ? 'none' : '';
    if (lightIcon) lightIcon.style.display = isLight ? '' : 'none';
  },

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.theme);
    localStorage.setItem('xanic_theme', this.theme);
    this._syncThemeIcons();

    if (this.initialized) {
      this.updateChartTheme();
      Charts._applyThemeToCharts();
    }
  },

  restoreTheme() {
    const saved = localStorage.getItem('xanic_theme');
    this.theme = saved === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.theme);
    this.updateChartTheme();
    this._syncThemeIcons();
  },

  updateChartTheme() {
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
