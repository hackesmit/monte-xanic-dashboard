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
  },

  // ── Navigation (2 handlers) ──
  _bindNavigation() {
    const navSelect = document.getElementById('nav-select');
    if (navSelect) navSelect.addEventListener('change', () => App.setView(navSelect.value));

    const mapMetric = document.getElementById('map-metric-select');
    if (mapMetric) mapMetric.addEventListener('change', () => MapStore.setMetric(mapMetric.value));
  },

  // ── Auth (2 handlers) ──
  _bindAuth() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', (e) => Auth.handleSubmit(e));

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
  }
};
