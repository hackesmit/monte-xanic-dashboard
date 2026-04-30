// ── Event Binding (CSP-safe — no inline handlers) ──
import { Auth } from './auth.js';
import { App } from './app.js';
import { Filters } from './filters.js';
import { Charts } from './charts.js';
import { Explorer } from './explorer.js';
import { MapStore } from './maps.js';
import { WeatherStore } from './weather.js';
import { UploadManager } from './upload.js';
import { Mediciones } from './mediciones.js';
import { Tables } from './tables.js';
import { BerryEdit } from './berryEdit.js';
import { WineEdit } from './wineEdit.js';
import { PrefermentEdit } from './prefermentEdit.js';
import { DataStore } from './dataLoader.js';

export const Events = {
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
    this._bindBerryEdit();
    this._bindWineEdit();
    this._bindPrefermentEdit();
    this._bindPageExport();
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

    // Shared weather chart renderer — reads current filter state
    const _renderWeatherCharts = () => {
      const vintages = WeatherStore.getVintagesFromData();
      const loc = Filters.state.weatherLocation || 'VDG';
      const agg = Filters.state.weatherAggregation || 'day';
      const tf = Filters.state.weatherTimeframe || 'season';
      const custom = (Filters.state.weatherCustomStart && Filters.state.weatherCustomEnd)
        ? { start: Filters.state.weatherCustomStart, end: Filters.state.weatherCustomEnd } : null;
      Charts.createWeatherTimeSeries('chartWeatherTemp', vintages, loc, agg, tf, custom);
      Charts.createRainfallChart('chartWeatherRain', vintages, loc, agg, tf, custom);
      Charts.createGDDChart('chartGDD', vintages, loc, agg);
      Charts.createValleyTempChart('chartValleyTemp',
        vintages.length ? Math.max(...vintages) : null, agg);
    };

    const _weatherTitleMap = {
      season: 'Clima durante la Vendimia',
      year: 'Clima Anual',
      '30d': 'Clima — Últimos 30 Días',
      custom: 'Clima — Rango Personalizado'
    };
    const _valleyNames = { VDG: 'Valle de Guadalupe', VON: 'Valle de Ojos Negros', SV: 'San Vicente' };

    const _updateWeatherTitle = () => {
      const tf = Filters.state.weatherTimeframe || 'season';
      const loc = Filters.state.weatherLocation || 'VDG';
      const title = document.getElementById('weather-section-title');
      if (title) title.textContent = `${_weatherTitleMap[tf] || _weatherTitleMap.season} — ${_valleyNames[loc] || loc}`;
    };

    // Valley selector
    const weatherValley = document.getElementById('weather-valley-select');
    if (weatherValley) weatherValley.addEventListener('change', () => {
      Filters.state.weatherLocation = weatherValley.value;
      _updateWeatherTitle();
      _renderWeatherCharts();
      // Sync if no data for this valley
      const vintages = WeatherStore.getVintagesFromData();
      const loc = weatherValley.value;
      const tf = Filters.state.weatherTimeframe || 'season';
      const hasData = vintages.some(y => {
        const { start, end } = WeatherStore.getDateRange(y, tf);
        return WeatherStore.getRange(start, end, loc).length > 0;
      });
      if (!hasData && vintages.length) {
        const rangeFn = tf === 'season' ? undefined : (year => WeatherStore.getDateRange(year, tf));
        WeatherStore.sync(vintages, rangeFn).then(() => _renderWeatherCharts());
      }
    });

    // Aggregation selector (day / week / month)
    const weatherAgg = document.getElementById('weather-agg-select');
    if (weatherAgg) weatherAgg.addEventListener('change', () => {
      Filters.state.weatherAggregation = weatherAgg.value;
      _renderWeatherCharts();
    });

    // Timeframe selector (season / year / 30d / custom)
    const weatherTf = document.getElementById('weather-timeframe-select');
    if (weatherTf) weatherTf.addEventListener('change', () => {
      const tf = weatherTf.value;
      Filters.state.weatherTimeframe = tf;
      const customWrap = document.getElementById('weather-custom-dates');
      if (customWrap) customWrap.style.display = tf === 'custom' ? 'inline-flex' : 'none';
      _updateWeatherTitle();
      // Sync extended range if needed, then render
      const vintages = WeatherStore.getVintagesFromData();
      if (tf === '30d') {
        const thisYear = new Date().getFullYear();
        WeatherStore.sync([thisYear], () => WeatherStore.getDateRange(null, '30d')).then(() => _renderWeatherCharts());
      } else if (tf === 'year' && vintages.length) {
        WeatherStore.sync(vintages, year => WeatherStore.getDateRange(year, 'year')).then(() => _renderWeatherCharts());
      } else {
        _renderWeatherCharts();
      }
    });

    // Custom date inputs
    const customStart = document.getElementById('weather-custom-start');
    const customEnd = document.getElementById('weather-custom-end');
    const onCustomDateChange = () => {
      Filters.state.weatherCustomStart = customStart?.value || null;
      Filters.state.weatherCustomEnd = customEnd?.value || null;
      if (Filters.state.weatherCustomStart && Filters.state.weatherCustomEnd) {
        const range = { start: Filters.state.weatherCustomStart, end: Filters.state.weatherCustomEnd };
        const year = parseInt(range.start.substring(0, 4));
        WeatherStore.sync([year], () => range).then(() => _renderWeatherCharts());
      }
    };
    if (customStart) customStart.addEventListener('change', onCustomDateChange);
    if (customEnd) customEnd.addEventListener('change', onCustomDateChange);

    // Forecast toggle + horizon (F8). On-demand API call — never auto-fetches.
    const forecastBtn = document.getElementById('weather-forecast-toggle');
    const horizonSel = document.getElementById('weather-forecast-horizon');
    const _forecastSyncAndRender = () => {
      const h = Filters.state.weatherForecastHorizon || 7;
      // Sync only the valleys needed: current selection, plus all three for the
      // Valley-comparison chart. Cache (1h TTL) dedupes redundant calls.
      const valleys = new Set([Filters.state.weatherLocation || 'VDG', 'VDG', 'VON', 'SV']);
      Promise.all([...valleys].map(v => WeatherStore.syncForecast(v, h)))
        .then(() => _renderWeatherCharts());
    };
    if (forecastBtn) forecastBtn.addEventListener('click', () => {
      const next = !Filters.state.weatherShowForecast;
      Filters.state.weatherShowForecast = next;
      forecastBtn.classList.toggle('active', next);
      forecastBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      forecastBtn.textContent = next ? 'Ocultar pronóstico' : 'Mostrar pronóstico';
      if (horizonSel) horizonSel.style.display = next ? 'inline-block' : 'none';
      if (next) _forecastSyncAndRender(); else _renderWeatherCharts();
    });
    if (horizonSel) horizonSel.addEventListener('change', () => {
      Filters.state.weatherForecastHorizon = parseInt(horizonSel.value, 10) || 7;
      if (Filters.state.weatherShowForecast) _forecastSyncAndRender();
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

    const demoBtn = document.getElementById('demo-toggle-btn');
    if (demoBtn) demoBtn.addEventListener('click', () => App.toggleDemoMode());

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

  // ── Upload (temp loader + 3 DB upload buttons) ──
  _bindUpload() {
    // Temp/in-memory loader (unchanged from before)
    const loaderBtn = document.querySelector('.loader-btn');
    const fileInput = document.getElementById('file-input');
    if (loaderBtn && fileInput) loaderBtn.addEventListener('click', () => fileInput.click());

    // Three explicit DB upload buttons → UploadManager.startUpload(parserId, file, statusEl)
    const UPLOAD_BUTTONS = [
      { btn: 'upload-btn-winexray',     input: 'upload-file-winexray',     parser: 'winexray'     },
      { btn: 'upload-btn-recepcion',    input: 'upload-file-recepcion',    parser: 'recepcion'    },
      { btn: 'upload-btn-prerecepcion', input: 'upload-file-prerecepcion', parser: 'prerecepcion' },
    ];

    for (const { btn, input, parser } of UPLOAD_BUTTONS) {
      const btnEl = document.getElementById(btn);
      const inputEl = document.getElementById(input);
      if (!btnEl || !inputEl) continue;

      btnEl.addEventListener('click', () => inputEl.click());

      inputEl.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const statusEl = document.getElementById('db-upload-status');
        await UploadManager.startUpload(parser, file, statusEl);
        // Reset input so the same file can be re-selected immediately
        e.target.value = '';
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
      else if (e.target.closest('.explorer-group-select')) Explorer.onGroupByChange(sid);
      else if (e.target.closest('.lot-checkbox')) {
        Explorer._toggleLotItem(sid, e.target.dataset.lot, e.target.checked);
      }
    });

    container.addEventListener('input', (e) => {
      if (e.target.closest('.lot-picker-search')) {
        const sid = parseInt(e.target.dataset.slot);
        if (!isNaN(sid)) Explorer._filterLotPicker(sid, e.target.value);
      }
    });

    container.addEventListener('click', (e) => {
      const allBtn = e.target.closest('.lot-picker-all');
      if (allBtn) {
        const sid = parseInt(allBtn.dataset.slot);
        if (!isNaN(sid)) Explorer._selectAllLots(sid);
        return;
      }
      const noneBtn = e.target.closest('.lot-picker-none');
      if (noneBtn) {
        const sid = parseInt(noneBtn.dataset.slot);
        if (!isNaN(sid)) Explorer._clearAllLots(sid);
        return;
      }
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

    // Row click → open edit modal (only on `.row-clickable` rows)
    const tbody = document.getElementById('med-table-body');
    if (tbody) tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.row-clickable');
      if (!tr) return;
      const code = tr.dataset.code;
      if (code) Mediciones.openEditModal(code);
    });

    // Modal close — close button, Cancel button, ESC (native via <dialog>),
    // backdrop click. Each path routes through closeEditModal so the
    // discard-confirm fires on dirty state.
    document.getElementById('med-edit-close')?.addEventListener('click',
      () => Mediciones.closeEditModal());
    document.getElementById('med-edit-cancel')?.addEventListener('click',
      () => Mediciones.closeEditModal());
    const modal = document.getElementById('med-edit-modal');
    if (modal) {
      modal.addEventListener('cancel', (e) => {
        // ESC fires this — intercept so we can run the dirty-discard check
        e.preventDefault();
        Mediciones.closeEditModal();
      });
      modal.addEventListener('click', (e) => {
        // Backdrop click: <dialog> reports e.target === modal when the
        // user clicks outside the form's bounding box.
        if (e.target === modal) Mediciones.closeEditModal();
      });
    }

    // Save + Delete buttons
    document.getElementById('med-edit-save')?.addEventListener('click',
      () => Mediciones.submitEdit());
    document.getElementById('med-edit-delete')?.addEventListener('click',
      () => Mediciones.submitDelete());

    // Live dirty tracking — every input inside the modal triggers a refresh
    document.getElementById('med-edit-form')?.addEventListener('input',
      () => Mediciones._refreshDirtyState());

    // Search input (debounced)
    const searchEl = document.getElementById('med-search');
    if (searchEl) {
      let t;
      searchEl.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => Mediciones.setSearch(searchEl.value), 200);
      });
    }
  },

  // ── Berry-row editing (Phase 10 / Stage 7.3) ──
  // Mirrors _bindMediciones structure: row click on .row-clickable opens
  // the modal with the matching DataStore.berryData row; modal close /
  // save / delete / live-dirty inputs all route through BerryEdit, which
  // delegates to RowEditor.
  _bindBerryEdit() {
    const tbody = document.getElementById('berry-table-body');
    if (tbody) tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.row-clickable');
      if (!tr) return;
      const sampleId   = tr.dataset.sampleId;
      const sampleDate = tr.dataset.sampleDate;
      const sampleSeq  = tr.dataset.sampleSeq;
      if (!sampleId || !sampleDate) return;
      const row = (DataStore.berryData || []).find(r =>
        String(r.sampleId)   === String(sampleId) &&
        String(r.sampleDate) === String(sampleDate) &&
        String(r.sampleSeq)  === String(sampleSeq)
      );
      if (row) BerryEdit.open(row);
    });

    document.getElementById('berry-edit-close')?.addEventListener('click',
      () => BerryEdit.close());
    document.getElementById('berry-edit-cancel')?.addEventListener('click',
      () => BerryEdit.close());

    const modal = document.getElementById('berry-edit-modal');
    if (modal) {
      modal.addEventListener('cancel', (e) => {
        e.preventDefault();
        BerryEdit.close();
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) BerryEdit.close();
      });
    }

    document.getElementById('berry-edit-save')?.addEventListener('click',
      () => BerryEdit.submit());
    document.getElementById('berry-edit-delete')?.addEventListener('click',
      () => BerryEdit.remove());

    document.getElementById('berry-edit-form')?.addEventListener('input',
      () => BerryEdit.refreshDirty());
  },

  // ── Wine-Recepción row editing (Phase 10 / Stage 7.4) ──
  _bindWineEdit() {
    const tbody = document.getElementById('wine-table-body');
    if (tbody) tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.row-clickable');
      if (!tr) return;
      const sampleId   = tr.dataset.sampleId;
      const sampleDate = tr.dataset.sampleDate;
      const sampleSeq  = tr.dataset.sampleSeq;
      if (!sampleId || !sampleDate) return;
      const row = (DataStore.wineRecepcion || []).find(r =>
        String(r.codigoBodega) === String(sampleId) &&
        String(r.fecha)        === String(sampleDate) &&
        String(r.sampleSeq)    === String(sampleSeq)
      );
      if (row) WineEdit.open(row);
    });

    document.getElementById('wine-edit-close')?.addEventListener('click',
      () => WineEdit.close());
    document.getElementById('wine-edit-cancel')?.addEventListener('click',
      () => WineEdit.close());

    const modal = document.getElementById('wine-edit-modal');
    if (modal) {
      modal.addEventListener('cancel', (e) => {
        e.preventDefault();
        WineEdit.close();
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) WineEdit.close();
      });
    }

    document.getElementById('wine-edit-save')?.addEventListener('click',
      () => WineEdit.submit());
    document.getElementById('wine-edit-delete')?.addEventListener('click',
      () => WineEdit.remove());

    document.getElementById('wine-edit-form')?.addEventListener('input',
      () => WineEdit.refreshDirty());
  },

  // ── Prefermentativos row editing (Phase 10 / Stage 7.5) ──
  // The preferment table is a merged dataset: wine_samples Must rows
  // (data-sample-id|date|seq) plus prefermentativos rows
  // (data-pref-code). Each shape routes to its own modal — wine_samples
  // Must rows reuse WineEdit; prefermentativos rows go to PrefermentEdit.
  _bindPrefermentEdit() {
    const tbody = document.getElementById('preferment-table-body');
    if (tbody) tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.row-clickable');
      if (!tr) return;

      const prefCode = tr.dataset.prefCode;
      if (prefCode) {
        const row = (DataStore.winePreferment || []).find(r =>
          String(r.reportCode) === String(prefCode)
        );
        if (row) PrefermentEdit.open(row);
        return;
      }

      const sampleId   = tr.dataset.sampleId;
      const sampleDate = tr.dataset.sampleDate;
      const sampleSeq  = tr.dataset.sampleSeq;
      if (!sampleId || !sampleDate) return;
      const row = (DataStore.winePreferment || []).find(r =>
        !r.reportCode &&
        String(r.codigoBodega) === String(sampleId) &&
        String(r.fecha)        === String(sampleDate) &&
        String(r.sampleSeq)    === String(sampleSeq)
      );
      if (row) WineEdit.open(row);
    });

    document.getElementById('pref-edit-close')?.addEventListener('click',
      () => PrefermentEdit.close());
    document.getElementById('pref-edit-cancel')?.addEventListener('click',
      () => PrefermentEdit.close());

    const modal = document.getElementById('pref-edit-modal');
    if (modal) {
      modal.addEventListener('cancel', (e) => {
        e.preventDefault();
        PrefermentEdit.close();
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) PrefermentEdit.close();
      });
    }

    document.getElementById('pref-edit-save')?.addEventListener('click',
      () => PrefermentEdit.submit());
    document.getElementById('pref-edit-delete')?.addEventListener('click',
      () => PrefermentEdit.remove());

    document.getElementById('pref-edit-form')?.addEventListener('input',
      () => PrefermentEdit.refreshDirty());
  },

  _bindPageExport() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.page-export-btn');
      if (!btn) return;
      const viewId = btn.dataset.view;
      const viewTitle = btn.dataset.viewTitle || viewId;

      document.querySelectorAll('.chart-export-menu').forEach(m => m.remove());
      const menu = document.createElement('div');
      menu.className = 'chart-export-menu';
      menu.innerHTML =
        '<button data-fmt="png">PNG</button>' +
        '<button data-fmt="pdf">PDF</button>';
      menu.addEventListener('click', (ev) => {
        const fmt = ev.target.getAttribute('data-fmt');
        if (fmt === 'png') Charts.exportPage(viewId, viewTitle);
        if (fmt === 'pdf') Charts.exportPagePDF(viewId, viewTitle);
        menu.remove();
      });
      menu.style.position = 'absolute';
      menu.style.top = (btn.offsetHeight + 4) + 'px';
      menu.style.right = '0';
      btn.appendChild(menu);

      setTimeout(() => {
        const handler = (ev) => {
          if (!menu.contains(ev.target) && ev.target !== btn) {
            menu.remove();
            document.removeEventListener('click', handler);
          }
        };
        document.addEventListener('click', handler);
      }, 0);
    });
  }
};
