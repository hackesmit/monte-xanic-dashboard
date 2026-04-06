# CSP Inline Handler Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all 71 inline event handlers from `index.html` and bind them via `addEventListener` in JS, so the strict CSP (`script-src 'self'` without `'unsafe-inline'`) works on Vercel. Also fix the `connect-src` CSP gap that blocks the weather API.

**Architecture:** One new file `js/events.js` owns all DOM event binding. It uses **event delegation** on `document.body` for repetitive patterns (export buttons, table sorting, filter buttons) and **direct binding** for unique controls (nav-select, login form, theme toggle). Data attributes (`data-chart-id`, `data-chart-title`, `data-action`, etc.) replace inline parameters. Loaded as a `<script>` in `index.html` after all other JS files.

**Tech Stack:** Vanilla JS ES6, no dependencies. Event delegation via `closest()`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `js/events.js` | **Create** | All DOM event binding — single `Events.bindAll()` entry point |
| `index.html` | **Modify** | Remove 71 inline handlers, add `data-*` attributes, add `<script src="js/events.js">` |
| `js/app.js` | **Modify** | Call `Events.bindAll()` from `bindGlobalEvents()`, remove duplicate bindings |
| `vercel.json` | **Modify** | Fix `connect-src` to include `archive-api.open-meteo.com` |

---

## Handler Migration Strategy

71 inline handlers across 9 categories. Strategy per category:

| Category | Count | Strategy | Selector |
|----------|-------|----------|----------|
| Chart export buttons | 19 | Delegation on `body` via `.chart-export-btn` | `data-chart-id`, `data-chart-title` |
| Filter buttons | 15 | Delegation on `.sidebar` via `data-action` | `data-action="clear-all"`, `data-action="grape-type"` + `data-value` |
| Table sorting | 11 | Delegation on `thead` via `data-sort` | Already has `data-sort` |
| Evolution toggles | 6 | Delegation on `.evo-compound-toggles` | Already has `value` attr on checkbox |
| UI controls | 8 | Direct binding by `id` or unique class | Existing IDs |
| Navigation selects | 2 | Direct binding by `id` | `#nav-select`, `#map-metric-select` |
| Auth | 2 | Direct binding by `id` | `#login-form`, logout button ID |
| Upload triggers | 3 | Direct binding by `id` / class | Existing IDs |
| Explorer | 1 | Direct binding by class | `.explorer-add-btn` |
| Color mode | 2 | Delegation via `.color-mode-btn` | Already has `data-mode` |
| Toggle lines | 2 | Delegation via `.line-toggle` | Class-based |
| Mobile sections | 2 | Delegation via `.mobile-section-toggle` | `data-section` |

---

## Task 1: Create `js/events.js` with delegation core + navigation/auth/UI bindings

**Files:**
- Create: `js/events.js`

This task builds the event binding module with all non-chart, non-filter handlers.

- [ ] **Step 1: Create `js/events.js` with the Events object and bindAll()**

```js
// ── Event Binding (CSP-safe — no inline handlers) ──

const Events = {
  bindAll() {
    this._bindNavigation();
    this._bindAuth();
    this._bindUIControls();
    this._bindUpload();
    this._bindExplorer();
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
  }
};
```

- [ ] **Step 2: Verify syntax**

Run: `node -c js/events.js`
Expected: no output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add js/events.js
git commit -m "feat: create js/events.js with navigation, auth, UI, upload bindings"
```

---

## Task 2: Add filter and chart delegation to `js/events.js`

**Files:**
- Modify: `js/events.js`

Adds the high-volume delegation handlers: filters (15), chart exports (19), table sorting (11), evolution toggles (6), color mode (2), toggle lines (2).

- [ ] **Step 1: Add filter, chart, and table binding methods**

Append these methods inside the `Events` object (before the closing `};`):

```js
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

    // Clear filter buttons
    document.querySelectorAll('.clear-btn[data-clear]').forEach(btn => {
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
      if (chartId && chartTitle) {
        Charts.showExportMenu(chartId, chartTitle, btn);
      }
    });
  },

  // ── Table Sorting (11 handlers — delegation on thead) ──
  _bindTableSorting() {
    const thead = document.querySelector('#berry-table thead');
    if (thead) {
      thead.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (th) Tables.setSort(th.dataset.sort);
      });
    }
  },

  // ── Evolution Compound Toggles (6 checkboxes) ──
  _bindEvolutionToggles() {
    const container = document.querySelector('.evo-compound-toggles');
    if (container) {
      container.addEventListener('change', (e) => {
        if (e.target.classList.contains('evo-compound-toggle')) {
          Charts.updateEvolutionChart();
        }
      });
    }
  },
```

- [ ] **Step 2: Update `bindAll()` to call the new methods**

Replace the `bindAll()` method:

```js
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
```

- [ ] **Step 3: Verify syntax**

Run: `node -c js/events.js`
Expected: no output (clean parse)

- [ ] **Step 4: Commit**

```bash
git add js/events.js
git commit -m "feat: add filter, chart export, table sort, evolution delegated bindings"
```

---

## Task 3: Update `index.html` — remove inline handlers + add data attributes

**Files:**
- Modify: `index.html`

This is the largest task. Remove every `onclick=`, `onchange=`, `onsubmit=` attribute and add `data-*` attributes where the handler needs parameters. Also add `<script src="js/events.js">` and missing `id` attributes.

- [ ] **Step 1: Add `<script src="js/events.js"></script>` after the last JS script tag**

Find the last `<script src="js/...">` line and add `events.js` after it (but before `</body>`). It must load after `app.js`, `charts.js`, `filters.js`, `tables.js`, etc.

- [ ] **Step 2: Remove inline handlers and add data attributes — Auth section (lines 31, 110)**

Login form — remove `onsubmit`:
```html
<!-- BEFORE -->
<form id="login-form" onsubmit="Auth.handleSubmit(event)">
<!-- AFTER -->
<form id="login-form">
```

Logout button — remove `onclick`, add `id`:
```html
<!-- BEFORE -->
<button class="help-toggle" onclick="Auth.logout()" title="Cerrar sesion" ...>
<!-- AFTER -->
<button class="help-toggle" id="logout-btn" title="Cerrar sesion" ...>
```

- [ ] **Step 3: Remove inline handlers — Data loader buttons (lines 48, 58)**

```html
<!-- BEFORE -->
<button class="loader-close" onclick="App.hideDataLoader()">&times;</button>
<!-- AFTER -->
<button class="loader-close">&times;</button>
```

```html
<!-- BEFORE -->
<button class="loader-btn" onclick="document.getElementById('file-input').click()">Seleccionar Archivos</button>
<!-- AFTER -->
<button class="loader-btn">Seleccionar Archivos</button>
```

- [ ] **Step 4: Remove inline handlers — Upload inputs (lines 71, 73)**

DB file input — remove `onchange`:
```html
<!-- BEFORE -->
<input type="file" id="db-file-input" ... onchange="UploadManager.handleUpload(this.files[0], document.getElementById('db-upload-status')); this.value=''">
<!-- AFTER -->
<input type="file" id="db-file-input" ...>
```

DB upload button — remove `onclick`, add `id`:
```html
<!-- BEFORE -->
<button ... onclick="document.getElementById('db-file-input').click()">
<!-- AFTER -->
<button ... id="db-upload-btn">
```

- [ ] **Step 5: Remove inline handlers — Header UI buttons (lines 105, 109, 110)**

Theme toggle — remove `onclick` (already has `id="theme-toggle-btn"`):
```html
<!-- BEFORE -->
<button class="theme-toggle" onclick="App.toggleTheme()" ...>
<!-- AFTER -->
<button class="theme-toggle" ...>
```

Help toggle — remove `onclick`, add `id`:
```html
<!-- BEFORE -->
<button class="help-toggle" onclick="App.toggleHelp()" title="Ayuda" ...>?</button>
<!-- AFTER -->
<button class="help-toggle" id="help-toggle-btn" title="Ayuda" ...>?</button>
```

- [ ] **Step 6: Remove inline handlers — Sidebar nav + mobile (lines 120, 122, 131)**

Sheet close — remove `onclick`:
```html
<!-- BEFORE -->
<button class="sheet-close" onclick="App.closeMobileFilters()" ...>&times;</button>
<!-- AFTER -->
<button class="sheet-close" ...>&times;</button>
```

Nav select — remove `onchange`:
```html
<!-- BEFORE -->
<select class="nav-select" id="nav-select" onchange="App.setView(this.value)">
<!-- AFTER -->
<select class="nav-select" id="nav-select">
```

Mobile filter toggle — remove `onclick`:
```html
<!-- BEFORE -->
<button class="mobile-filter-toggle" id="mobile-filter-toggle" onclick="App.toggleMobileFilters()">
<!-- AFTER -->
<button class="mobile-filter-toggle" id="mobile-filter-toggle">
```

- [ ] **Step 7: Remove inline handlers — Berry filter buttons (lines 138–176)**

Clear all — remove `onclick`, add `data-clear`:
```html
<!-- BEFORE -->
<button class="clear-btn clear-all-btn" onclick="Filters.clearAll()">Limpiar Todo</button>
<!-- AFTER -->
<button class="clear-btn clear-all-btn" data-clear="all">Limpiar Todo</button>
```

Grape type buttons — remove `onclick`, add `data-grape-type`:
```html
<!-- BEFORE -->
<button class="type-btn" id="btn-type-all" onclick="Filters.setGrapeType('all')">Todas</button>
<button class="type-btn" id="btn-type-red" onclick="Filters.setGrapeType('red')">Tintas</button>
<button class="type-btn" id="btn-type-white" onclick="Filters.setGrapeType('white')">Blancas</button>
<!-- AFTER -->
<button class="type-btn" id="btn-type-all" data-grape-type="all">Todas</button>
<button class="type-btn" id="btn-type-red" data-grape-type="red">Tintas</button>
<button class="type-btn" id="btn-type-white" data-grape-type="white">Blancas</button>
```

Clear filter buttons — remove `onclick`, add `data-clear`:
```html
<button class="clear-btn" data-clear="varieties">Limpiar</button>
<button class="clear-btn" data-clear="origins">Limpiar</button>
<button class="clear-btn" data-clear="lots">Limpiar</button>
```

Reload data button — remove `onclick`, add `data-clear`:
```html
<button class="clear-btn" data-clear="reload" style="color:var(--flag-warning);border-color:rgba(224,144,48,0.3)">
```

- [ ] **Step 8: Remove inline handlers — Wine filter buttons (lines 185–206)**

Same pattern as berry filters:
```html
<button class="clear-btn clear-all-btn" data-clear="all-wine">Limpiar Todo</button>

<button class="type-btn" id="btn-wine-type-all" data-wine-grape-type="all">Todas</button>
<button class="type-btn" id="btn-wine-type-red" data-wine-grape-type="red">Tintas</button>
<button class="type-btn" id="btn-wine-type-white" data-wine-grape-type="white">Blancas</button>

<button class="clear-btn" data-clear="wine-varieties">Limpiar</button>
<button class="clear-btn" data-clear="wine-origins">Limpiar</button>
```

- [ ] **Step 9: Remove inline handlers — Summary clear buttons (lines 219, 425)**

```html
<!-- Berry summary -->
<button class="summary-clear" data-clear="all">Limpiar</button>

<!-- Wine summary -->
<button class="summary-clear" data-clear="all-wine">Limpiar</button>
```

Note: `summary-clear` buttons also need to match the `.clear-btn[data-clear]` or `.summary-clear[data-clear]` selector. Update `_bindFilters` to also select `.summary-clear[data-clear]` elements — OR add class `clear-btn` to them. Simplest: change the selector in events.js to `[data-clear]` instead of `.clear-btn[data-clear]`.

- [ ] **Step 10: Remove inline handlers — Color mode + toggle lines (lines 235–239)**

Color mode buttons — remove `onclick` (already have `data-mode`):
```html
<button class="color-mode-btn active" data-mode="variety">Por Varietal</button>
<button class="color-mode-btn" data-mode="origin">Por Origen</button>
```

Toggle lines — remove `onclick`:
```html
<button class="chart-toggle line-toggle">Conectar Lineas</button>
```

- [ ] **Step 11: Remove inline handlers — All chart export buttons (19 buttons)**

Each export button: remove `onclick`, add `data-chart-id` and `data-chart-title`:
```html
<!-- Pattern — repeat for all 19 -->
<!-- BEFORE -->
<button class="chart-export-btn" onclick="Charts.showExportMenu('chartBrix', 'Brix', this)">&#x2913;</button>
<!-- AFTER -->
<button class="chart-export-btn" data-chart-id="chartBrix" data-chart-title="Brix">&#x2913;</button>
```

Full list of chart export buttons to update:

| Line | data-chart-id | data-chart-title |
|------|---------------|------------------|
| 249 | chartBrix | Brix |
| 255 | chartAnt | Antocianinas Totales |
| 261 | chartPH | pH |
| 267 | chartTA | Acidez Total |
| 276 | chartWeight | Peso por Baya |
| 282 | chartScatter | Brix vs pH |
| 295 | chartVarBrix | Brix por Varietal |
| 301 | chartVarAnt | tANT por Varietal |
| 311 | chartOrigen | Muestras por Origen |
| 344 | chartOriginRadar | Perfil Quimico por Origen |
| 369 | chartEvolution | Evolucion Fenolica |
| 378 | chartBrixTemp | Brix vs Temperatura |
| 384 | chartTantRain | tANT vs Lluvia Acumulada |
| 552 | chartVintageBrix | Vendimias Brix |
| 558 | chartVintageAnt | Vendimias tANT |
| 564 | chartVintagePH | Vendimias pH |
| 570 | chartVintageTA | Vendimias Acidez Total |
| 596 | chartHarvestCal | Calendario de Cosecha |
| 607 | chartWeatherTemp | Temperatura Media Diaria |
| 613 | chartWeatherRain | Eventos de Lluvia |

Two buttons use `exportChart()` instead of `showExportMenu()` (lines 439, 504, 510). These need different data attributes:
```html
<!-- Line 439: uses exportChart directly (PNG only) -->
<button class="chart-export-btn" data-chart-id="chartWinePhenolics" data-chart-title="Fenolicos por Varietal" data-export-direct="true">&#x2913; PNG</button>

<!-- Line 504 -->
<button class="chart-export-btn" data-chart-id="chartExtraction" data-chart-title="Extraccion tANT Baya vs Vino" data-export-direct="true">&#x2913;</button>

<!-- Line 510 -->
<button class="chart-export-btn" data-chart-id="chartExtractionPct" data-chart-title="Tasa de Extraccion" data-export-direct="true">&#x2913; PNG</button>
```

Update `_bindChartExports()` in events.js to handle `data-export-direct`:
```js
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
```

- [ ] **Step 12: Remove inline handlers — Mobile section toggles (lines 290, 354)**

Add `data-section`:
```html
<!-- BEFORE -->
<button class="mobile-section-toggle" onclick="App.toggleMobileSection('section-varietal-origin')">
<!-- AFTER -->
<button class="mobile-section-toggle" data-section="section-varietal-origin">

<!-- BEFORE -->
<button class="mobile-section-toggle" onclick="App.toggleMobileSection('section-evolution-climate')">
<!-- AFTER -->
<button class="mobile-section-toggle" data-section="section-evolution-climate">
```

- [ ] **Step 13: Remove inline handlers — Evolution compound checkboxes (lines 359–364)**

Remove `onchange` from each checkbox (leave `value` and `checked` attributes as-is):
```html
<input type="checkbox" class="evo-compound-toggle" value="tANT" checked>
<input type="checkbox" class="evo-compound-toggle" value="fANT">
<input type="checkbox" class="evo-compound-toggle" value="bANT">
<input type="checkbox" class="evo-compound-toggle" value="pTAN">
<input type="checkbox" class="evo-compound-toggle" value="iRPs">
<input type="checkbox" class="evo-compound-toggle" value="ipt">
```

- [ ] **Step 14: Remove inline handlers — Table sort headers (lines 401–411)**

Remove `onclick` (keep `data-sort` which already exists):
```html
<th data-sort="sampleId">Sample ID <span class="sort-arrow"></span></th>
<th data-sort="sampleDate">Fecha <span class="sort-arrow"></span></th>
<th data-sort="vintage">Vendimia <span class="sort-arrow"></span></th>
<th data-sort="variety">Varietal <span class="sort-arrow"></span></th>
<th data-sort="appellation">Origen <span class="sort-arrow"></span></th>
<th data-sort="brix">Brix <span class="sort-arrow"></span></th>
<th data-sort="pH">pH <span class="sort-arrow"></span></th>
<th data-sort="ta">AT <span class="sort-arrow"></span></th>
<th data-sort="tANT">tANT <span class="sort-arrow"></span></th>
<th data-sort="berryFW">g/Baya <span class="sort-arrow"></span></th>
<th data-sort="daysPostCrush">DPE <span class="sort-arrow"></span></th>
```

- [ ] **Step 15: Remove inline handlers — Map metric select (line 646)**

```html
<!-- BEFORE -->
<select id="map-metric-select" class="nav-select" onchange="MapStore.setMetric(this.value)">
<!-- AFTER -->
<select id="map-metric-select" class="nav-select">
```

- [ ] **Step 16: Remove inline handlers — Explorer + Help close (lines 639, 684)**

```html
<!-- BEFORE -->
<button class="explorer-add-btn" onclick="Explorer.addChart()">+ Agregar Grafica</button>
<!-- AFTER -->
<button class="explorer-add-btn">+ Agregar Grafica</button>

<!-- BEFORE -->
<button class="help-close" onclick="App.toggleHelp()">&times;</button>
<!-- AFTER -->
<button class="help-close">&times;</button>
```

- [ ] **Step 17: Remove inline handlers — Vintage toggle lines (line 545)**

```html
<!-- BEFORE -->
<button class="chart-toggle line-toggle" onclick="Charts.toggleLines()" style="font-size:9px">
<!-- AFTER -->
<button class="chart-toggle line-toggle" style="font-size:9px">
```

- [ ] **Step 18: Verify zero inline handlers remain**

Run: `grep -c 'onclick=\|onchange=\|onsubmit=\|onkeydown=' index.html`
Expected: `0`

- [ ] **Step 19: Commit**

```bash
git add index.html
git commit -m "refactor: remove all 71 inline event handlers from index.html, add data-* attributes"
```

---

## Task 4: Wire `Events.bindAll()` into `app.js` and deduplicate

**Files:**
- Modify: `js/app.js:79-117`

`bindGlobalEvents()` in `app.js` already binds file input, drag/drop, FAB, backdrop, and resize. Move the call to `Events.bindAll()` here and remove handlers that are now in `events.js`.

- [ ] **Step 1: Add `Events.bindAll()` call at the top of `bindGlobalEvents()`**

```js
  bindGlobalEvents() {
    Events.bindAll();

    // File input handler (legacy loader — kept here, upload panel handled by Events)
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
    }
    // ... rest of existing drag/drop, FAB, backdrop, resize handlers unchanged ...
  },
```

Note: The `file-input` handler in `app.js` is for the legacy loader card (different from `db-file-input` in the upload panel). Keep it. `Events._bindUpload()` handles `db-file-input` and `db-upload-btn`.

- [ ] **Step 2: Verify syntax**

Run: `node -c js/app.js`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: wire Events.bindAll() into App.bindGlobalEvents()"
```

---

## Task 5: Fix CSP in `vercel.json`

**Files:**
- Modify: `vercel.json:11`

Two CSP fixes:
1. `connect-src`: add `https://archive-api.open-meteo.com` (weather API actually used)
2. No other CSP changes needed — removing inline handlers means `'unsafe-inline'` is NOT required in `script-src`

- [ ] **Step 1: Update the CSP header**

Change `connect-src` from:
```
connect-src 'self' https://*.supabase.co https://api.open-meteo.com
```
to:
```
connect-src 'self' https://*.supabase.co https://archive-api.open-meteo.com
```

The old `https://api.open-meteo.com` is not used anywhere — weather.js uses `archive-api`. Remove the stale entry.

- [ ] **Step 2: Verify the full CSP value**

Final CSP should be:
```
default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co https://archive-api.open-meteo.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none';
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "fix: CSP connect-src — use archive-api.open-meteo.com (actual weather API)"
```

---

## Task 6: Update `_bindFilters` selector to also cover summary-clear buttons

**Files:**
- Modify: `js/events.js`

The summary clear buttons (lines 219, 425 in index.html) use class `summary-clear` not `clear-btn`. Update the selector to match any `[data-clear]` element.

- [ ] **Step 1: Update selector in `_bindFilters()`**

Change:
```js
    document.querySelectorAll('.clear-btn[data-clear]').forEach(btn => {
```
to:
```js
    document.querySelectorAll('[data-clear]').forEach(btn => {
```

- [ ] **Step 2: Verify syntax**

Run: `node -c js/events.js`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add js/events.js
git commit -m "fix: [data-clear] selector covers both clear-btn and summary-clear buttons"
```

---

## Task 7: Verify locally and deploy check

- [ ] **Step 1: Run syntax check on all modified JS files**

```bash
node -c js/events.js && node -c js/app.js && echo "All JS syntax OK"
```
Expected: `All JS syntax OK`

- [ ] **Step 2: Verify zero inline handlers in index.html**

```bash
grep -cE 'onclick=|onchange=|onsubmit=' index.html
```
Expected: `0`

- [ ] **Step 3: Verify events.js is loaded in index.html**

```bash
grep 'events.js' index.html
```
Expected: `<script src="js/events.js"></script>`

- [ ] **Step 4: Start local server and test**

```bash
npm start
```

Open `http://localhost:8080` and verify:
- View switching (nav-select) works
- Filter buttons work (grape type, clear, color mode)
- Chart export menus open
- Table sorting works
- Theme toggle works
- Mobile bottom sheet opens/closes
- Evolution compound toggles update chart
- Map metric selector works

- [ ] **Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: complete CSP-safe inline handler migration — 71 handlers moved to js/events.js"
```

---

## Risk Notes

1. **`this` in export buttons**: Inline `onclick` passes `this` (the button element). The delegation handler passes `btn` (found via `closest()`). These are identical — `closest('.chart-export-btn')` returns the same element that would have been `this` in the inline handler.

2. **Load order**: `events.js` must load after all other JS files since it references `App`, `Auth`, `Filters`, `Charts`, `Tables`, `MapStore`, `Explorer`, `UploadManager`. Place the `<script>` tag last.

3. **DOMContentLoaded**: `Events.bindAll()` is called from `App.bindGlobalEvents()` which runs inside `App.init()` which runs inside a `DOMContentLoaded` listener. All DOM elements exist at bind time.

4. **Chip click handlers**: Filter chips (variety, origin, lot) are dynamically created in `filters.js` with inline `addEventListener` calls. They are NOT inline HTML handlers and are NOT affected by this migration. Do not touch them.

5. **Legend keyboard handlers**: Chart legend items are dynamically created in `charts.js` with `addEventListener`. NOT affected.
