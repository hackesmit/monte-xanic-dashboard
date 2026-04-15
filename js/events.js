// ── Event Binding (CSP-safe — no inline handlers) ──

const Events = {
  bindAll() {
    this._bindNavigation();
    this._bindAuth();
    this._bindUIControls();
    this._bindUpload();
    this._bindExplorer();
    this._bindFilters();
    this._bindChartExports();
    this._bindTableSorting();
    this._bindEvolutionToggles();
    this._bindMapDelegation();
    this._bindExplorerDelegation();
    this._bindLegendDelegation();
    this._bindMediciones();
  },

  // ── Navigation (2 handlers) ──
  _bindNavigation() {
    const navTabs = document.getElementById('nav-tabs');
    if (navTabs) navTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-tab');
      if (btn && btn.dataset.view) App.setView(btn.dataset.view);
    });

    const mapMetric = document.getElementById('map-metric-select');
    if (mapMetric) mapMetric.addEventListener('change', () => MapStore.setMetric(mapMetric.value));

    const weatherValley = document.getElementById('weather-valley-select');
    if (weatherValley) weatherValley.addEventListener('change', () => {
      const loc = weatherValley.value;
      Filters.state.weatherLocation = loc;
      const names = { VDG: 'Valle de Guadalupe', VON: 'Valle de Ojos Negros', SV: 'San Vicente' };
      const title = document.getElementById('weather-section-title');
      if (title) title.textContent = `Clima durante la Vendimia — ${names[loc] || loc}`;
      // Directly re-render only the weather charts (skip full App.refresh)
      const vintages = WeatherStore.getVintagesFromData();
      const renderWeather = () => {
        Charts.createWeatherTimeSeries('chartWeatherTemp', vintages, loc);
        Charts.createRainfallChart('chartWeatherRain', vintages, loc);
        Charts.createGDDChart('chartGDD', vintages, loc);
      };
      renderWeather();
      // If no data for this valley, trigger a sync then re-render only if new data arrived
      const hasData = vintages.some(y => WeatherStore.getRange(`${y}-07-01`, `${y}-10-31`, loc).length > 0);
      if (!hasData && vintages.length) {
        WeatherStore.sync(vintages).then(() => {
          const nowHasData = vintages.some(y => WeatherStore.getRange(`${y}-07-01`, `${y}-10-31`, loc).length > 0);
          if (nowHasData) renderWeather();
        });
      }
    });
  },

  // ── Auth (1 handler — login form handled by Auth.bindForm()) ──
  _bindAuth() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => Auth.logout());
  },

  // ── UI Controls (8 handlers) ──
  _bindUIControls() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) themeBtn.addEventListener('click', () => App.toggleTheme());

    const helpBtn = document.getElementById('help-toggle-btn');
    if (helpBtn) helpBtn.addEventListener('click', () => App.toggleHelp());

    const helpClose = document.querySelector('.help-close');
    if (helpClose) helpClose.addEventListener('click', () => App.toggleHelp());

    const loaderClose = document.querySelector('.loader-close');
    if (loaderClose) loaderClose.addEventListener('click', () => App.hideDataLoader());

    const sheetClose = document.querySelector('.sheet-close');
    if (sheetClose) sheetClose.addEventListener('click', () => App.closeMobileFilters());

    const mobileToggle = document.getElementById('mobile-filter-toggle');
    if (mobileToggle) mobileToggle.addEventListener('click', () => App.toggleMobileFilters());

    // Mobile section toggles (2) — delegation
    document.querySelectorAll('.mobile-section-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        if (section) App.toggleMobileSection(section);
      });
    });
  },

  // ── Upload (3 handlers) ──
  _bindUpload() {
    const loaderBtn = document.querySelector('.loader-btn');
    const fileInput = document.getElementById('file-input');
    if (loaderBtn && fileInput) loaderBtn.addEventListener('click', () => fileInput.click());

    const dbUploadBtn = document.getElementById('db-upload-btn');
    const dbFileInput = document.getElementById('db-file-input');
    if (dbUploadBtn && dbFileInput) dbUploadBtn.addEventListener('click', () => dbFileInput.click());

    if (dbFileInput) {
      dbFileInput.addEventListener('change', () => {
        if (dbFileInput.files[0]) {
          UploadManager.handleUpload(dbFileInput.files[0], document.getElementById('db-upload-status'));
          dbFileInput.value = '';
        }
      });
    }
  },

  // ── Explorer (1 handler) ──
  _bindExplorer() {
    const addBtn = document.querySelector('.explorer-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => Explorer.addChart());
  },

  // ── Filters (15 handlers via delegation) ──
  _bindFilters() {
    // Grape type buttons (berry)
    document.querySelectorAll('.type-btn[data-grape-type]').forEach(btn => {
      btn.addEventListener('click', () => Filters.setGrapeType(btn.dataset.grapeType));
    });

    // Grape type buttons (wine)
    document.querySelectorAll('.type-btn[data-wine-grape-type]').forEach(btn => {
      btn.addEventListener('click', () => Filters.setWineGrapeType(btn.dataset.wineGrapeType));
    });

    // Clear filter buttons (covers both .clear-btn and .summary-clear)
    document.querySelectorAll('[data-clear]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.clear;
        if (action === 'all') Filters.clearAll();
        else if (action === 'all-wine') Filters.clearAllWine();
        else if (action === 'reload') App.reloadData();
        else if (action.startsWith('wine-')) Filters.clearWineFilter(action.slice(5));
        else Filters.clearFilter(action);
      });
    });

    // Color mode buttons
    document.querySelectorAll('.color-mode-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => Filters.setColorBy(btn.dataset.mode));
    });

    // Toggle lines buttons
    document.querySelectorAll('.line-toggle').forEach(btn => {
      btn.addEventListener('click', () => Charts.toggleLines());
    });
  },

  // ── Chart Export Buttons (19 handlers via delegation) ──
  _bindChartExports() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.chart-export-btn');
      if (!btn) return;
      const chartId = btn.dataset.chartId;
      const chartTitle = btn.dataset.chartTitle;
      if (!chartId || !chartTitle) return;
      if (btn.dataset.exportDirect) {
        Charts.exportChart(chartId, chartTitle);
      } else {
        Charts.showExportMenu(chartId, chartTitle, btn);
      }
    });
  },

  // ── Table Sorting (11 handlers — delegation on thead) ──
  _bindTableSorting() {
    const tbody = document.getElementById('berry-table-body');
    const thead = tbody && tbody.closest('table') && tbody.closest('table').querySelector('thead');
    if (thead) {
      thead.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (th) Tables.setSort(th.dataset.sort);
      });
    }
  },

  // ── Evolution Compound Toggles (6 checkboxes) ──
  _bindEvolutionToggles() {
    const container = document.querySelector('.evo-controls');
    if (container) {
      container.addEventListener('change', (e) => {
        if (e.target.classList.contains('evo-compound-toggle')) {
          Charts.updateEvolutionChart();
        }
      });
    }
  },

  // ── Map Delegation (3 handlers — SVG sections, detail close, ranch tabs) ──
  _bindMapDelegation() {
    const mapContainer = document.getElementById('map-svg-container');
    if (mapContainer) mapContainer.addEventListener('click', (e) => {
      const section = e.target.closest('[data-section]');
      if (section) MapStore.showDetail(section.dataset.section);
    });

    const detailPanel = document.getElementById('section-detail-panel');
    if (detailPanel) detailPanel.addEventListener('click', (e) => {
      if (e.target.closest('.detail-close')) MapStore.hideDetail();
    });

    const ranchTabs = document.getElementById('ranch-tabs');
    if (ranchTabs) ranchTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-ranch]');
      if (tab) MapStore.setRanch(tab.dataset.ranch);
    });
  },

  // ── Explorer Delegation (5 handlers — toggle, remove, source, type, render) ──
  _bindExplorerDelegation() {
    const container = document.getElementById('explorer-charts');
    if (!container) return;

    container.addEventListener('click', (e) => {
      // Legend item toggle
      const legendItem = e.target.closest('.explorer-legend .legend-item');
      if (legendItem) {
        const slotId = parseInt(legendItem.dataset.slot);
        const dsIdx = parseInt(legendItem.dataset.dsIndex);
        const cId = 'explorerChart_' + slotId;
        const chart = Charts.instances[cId];
        if (chart && !isNaN(dsIdx)) {
          const meta = chart.getDatasetMeta(dsIdx);
          meta.hidden = !meta.hidden;
          chart.update();
          legendItem.classList.toggle('dimmed', meta.hidden);
        }
        return;
      }

      const slot = e.target.closest('[data-slot]');
      if (!slot) return;
      const sid = parseInt(slot.dataset.slot);
      if (isNaN(sid)) return;

      if (e.target.closest('.explorer-line-toggle')) Explorer.toggleLines(sid);
      else if (e.target.closest('.explorer-expand-toggle')) Explorer.toggleExpand(sid);
      else if (e.target.closest('.explorer-toggle-btn')) Explorer.toggleConfig(sid);
      else if (e.target.closest('.explorer-remove-btn')) Explorer.removeChart(sid);
      else if (e.target.closest('.explorer-render-btn')) Explorer.renderSlot(sid);
    });

    container.addEventListener('change', (e) => {
      const slot = e.target.closest('[data-slot]');
      if (!slot) return;
      const sid = parseInt(slot.dataset.slot);
      if (isNaN(sid)) return;

      if (e.target.closest('.explorer-source-select')) Explorer.onSourceChange(sid);
      else if (e.target.closest('.explorer-type-select')) Explorer.onChartTypeChange(sid);
    });
  },

  // ── Legend Delegation (click + keyboard on legend items) ──
  _bindLegendDelegation() {
    document.addEventListener('click', (e) => {
      const item = e.target.closest('.legend-item[data-series]');
      if (item) { Charts.toggleSeries(item.dataset.series); return; }

      const expand = e.target.closest('[data-action="legend-expand"]');
      if (expand) expand.parentElement.classList.toggle('legend-show-all');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;

      const item = e.target.closest('.legend-item[data-series]');
      if (item) { e.preventDefault(); Charts.toggleSeries(item.dataset.series); return; }

      const expand = e.target.closest('[data-action="legend-expand"]');
      if (expand) { e.preventDefault(); expand.parentElement.classList.toggle('legend-show-all'); }
    });
  },

  _bindMediciones() {
    const form = document.getElementById('medicion-form');
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      Mediciones.submitForm();
    });

    const table = document.getElementById('mediciones-table');
    if (table) table.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) Mediciones.sortBy(th.dataset.sort);
    });
  }
};
