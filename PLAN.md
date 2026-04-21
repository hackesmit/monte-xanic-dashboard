# Plan — Phase 9: Explorer Enhancements, Weather Timeframes, Satellite Map

> **Last synced:** 2026-04-21 — Stage 5 (Quality Classification & True Quality Map) added after shipping on branch `feat/quality-classification`.

## Status: IN PROGRESS (Stages 0, 0b, 1, 2, 5 complete; Stage 3 satellite map and Stage 4 future analytics remain)

**Reference:** TASK.md (Phase 9 objectives and acceptance criteria)

---

## Architecture Overview

Phase 9 is organized into 5 stages plus a later Stage 5. **Stage 0 (Vite migration)** is complete — all subsequent stages benefit from ES modules, proper imports, and npm-managed dependencies. **Stage 0b (mobile hardening)** landed immediately after as a follow-on from REVIEW.md Rounds 20–24. **Stages 1–2** are complete. **Stage 5 (Quality Classification)** shipped on branch `feat/quality-classification`. **Stage 3** (satellite map) and **Stage 4** (future analytics foundations) remain.

---

## Stage 5 — Quality Classification & True Quality Map (F9) — COMPLETE

**Shipped:** 2026-04-21 on branch `feat/quality-classification` (pending merge). Spec: `docs/superpowers/specs/2026-04-21-quality-classification-design.md`. Plan: `docs/superpowers/plans/2026-04-21-quality-classification.md`.

**What shipped:** see TASK.md "What Shipped (Sub-project 4: Quality Classification & True Quality Map)" for the full breakdown and the known polyphenols/av/ag data-wiring follow-up. High-level:

1. `js/classification.js` — pure scoring engine covering rubric + valley resolution, A/B/C threshold bucketing, madurez ±3 overlay, partial-data guard at 60 Imp, per-variety peso overrides, percentile within cohort, tonnage-weighted section aggregation.
2. `CONFIG.rubrics` (7 rubrics) + `varietyRubricMap` + `valleyPatterns` + `sanitaryThresholds` + `madurezOverlay` + `gradeColors`.
3. `DataStore.joinBerryWithMediciones()` attaches `row.medicion` (snake_case contract) to berry rows; called from `_enrichData()` and `loadMediciones()`.
4. `maps.js` — new `calidad` metric (default) with discrete A+/A/B/C coloring, SVG `<title>` tooltip per-lot breakdown, detail-panel grade row with cohort percentile and expandable `<details>` desglose, discrete legend swap.
5. `mediciones.js` — new `Madurez Fenólica (opcional)` form select + table column. `api/upload.js` whitelist + MT.7 mirror updated.
6. `sql/migration_phenolic_maturity.sql` — nullable `phenolic_maturity TEXT CHECK (…)` on `mediciones_tecnicas`.
7. MT.11 (41 cases) green. `npm test` 181/181; `npm run test:e2e` 12/12; `npm run build` succeeds.

**Deferred by design:**
- Cohort-toggle UI (`vintage-variety` ↔ `variety-only`) — engine supports it via `scoreAll(lots, { cohort: 'variety-only' })`; wire into detail panel when ≥ 2 vintages of data exist.
- Grade column on berry / recepción / extracción tables — spec §11 defers until the map view has been validated in production.
- Bulk-edit Madurez for already-imported lots — today requires one-at-a-time edits via the mediciones form.
- Export grade breakdown in `Exportar Vista` (PNG / PDF) — spec §11 defers.

---

## Stage 0 — Vite Migration: CDN → npm + ES Modules — COMPLETE

**Goal:** Replace CDN `<script>` tags with npm packages, convert all frontend files to ES modules, add Vite as the dev server and build tool. Zero functional changes — the dashboard must behave identically before and after.

**Status:** Complete — merged to `main`. Review Rounds 18–19 closed.

### What's Done (2026-04-15 → 2026-04-16)

- Steps 0.1–0.7 complete: npm deps installed, vite.config.js created, all 15 JS files converted to ES modules, index.html updated (CDN tags removed, single `<script type="module">`), tests updated (MT.6 imports from source), vercel.json updated (buildCommand/outputDirectory/CSP tightened), CLAUDE.md updated, `"type": "module"` added to package.json
- `public/` directory created with `manifest.json` + PWA icons (icon-192, icon-512) for proper build output
- `public/theme-init.js` extracted from inline `<script>` (P1.1, CSP-compliant, `d9c7010`)
- Browser smoke test completed at 390 px viewport — dev server and production build both load with zero JS errors
- jsPDF v4.2.1, Chart.js v4.5.1, XLSX v0.18.5, Supabase JS v2.103.2 all API-compatible (verified in Node.js and browser)
- **Mobile hardening follow-on:** see Stage 0b below.

### Known residual risk (not blocking)

- Circular imports between `app.js` and `{auth,filters,charts,tables,events,upload}.js` (R18 P1.2). All current access is inside method bodies, so ES module live bindings resolve correctly at event time. Flagged for future `state.js` refactor; no current bug.
- 1.3 MB main bundle (R18 P2.3). Code-split `jspdf` and `xlsx` via dynamic `import()` in a follow-up; not a migration blocker.

---

## Stage 0b — Mobile Hardening — COMPLETE

**Goal:** Close the mobile-responsiveness gaps found in REVIEW.md Rounds 20–22. Raise every primary touch target to ≥ 44 px, eliminate off-screen controls at 320 / 390 px, and lock the fixes behind a browser-based regression suite so they can't silently drift.

**Status:** Complete — 17 of 20 punch-list corrections closed across `cb76a24` → `9c49feb`. Two items (C18, C19) deferred by design. One new observation (weather-forecast toggle inline sizing) logged in TASK.md.

### What shipped

See TASK.md "What Shipped (Sub-project 3: Mobile Hardening — Rounds 20–24)" for the per-correction breakdown and commit map. High-level:

1. **Repo hygiene** — `.gitignore` covers Playwright/superpowers scratch dirs; pre–Phase-8 planning docs archived under `docs/reviews/archive/` with RESOLVED headers; stray PNGs moved into gitignored archive.
2. **Mobile CSS pass** under `@media (max-width: 768px)` — login theme toggle, chart/table export buttons, explorer slot header wrap, `.btn-gold`, `.ranch-tab`, `.nav-tab` layout and font, `.kpi-row` auto-fit, `.form-group` input/select sizing + 16 px font (iOS auto-zoom prevention), `.table-scroll` affordance shadow, `#map-metric-select` height.
3. **Root-cause fix for login-toggle clipping** — `.login-card`'s `loginFadeIn` animation left an identity-matrix transform that captured fixed-positioned descendants. Split into opacity-only `loginCardFadeIn` for the card; slide preserved on inner elements.
4. **E2E regression suite** — `tests/e2e/mobile-responsive.spec.js` (Playwright) seeds a dev bypass token via `addInitScript`, iterates 320×568 and 390×844, asserts tap targets and overflow on every nav view. 12/12 pass. `npm run test:e2e` runs separately from `npm test` to keep node feedback ≤ 2 s.

### Follow-ups (not blocking)

- Weather forecast toggle (`#weather-forecast-toggle` / `#weather-forecast-horizon` in `index.html:644-649`) has inline `font-size:11px; padding:3px 10px` → ~18–20 px tall. Bump to 44 px if it's a primary control.
- Extend the e2e spec to cover real-data scenarios (long varietal names in tables, map section resolution, PDF/PNG export on mobile Safari) once data fixtures are available.

### Prior State (before migration)

- 4 CDN scripts: Chart.js 4.4.1, SheetJS 0.18.5, Supabase JS v2, jsPDF 2.5.1
- 15 app `<script>` tags loaded in dependency order (globals)
- Tests copy-paste logic from source files (can't import globals)
- API files (`api/*.js`) already use ES `import`/`export` — untouched by this migration
- `package.json` exists with `bcryptjs` + Playwright

### Step 0.1 — Install Vite and Move CDN Dependencies to npm

**Files:** `package.json`

1. `npm install --save-dev vite`
2. `npm install chart.js xlsx jspdf @supabase/supabase-js`
3. Update scripts:
   ```json
   {
     "dev": "vite",
     "build": "vite build",
     "preview": "vite preview",
     "start": "vite preview --port 8080",
     "test": "node --test tests/*.test.mjs"
   }
   ```

### Step 0.2 — Create Minimal Vite Config

**Files:** `vite.config.js` (new)

```js
import { defineConfig } from 'vite';
export default defineConfig({
  root: '.',
  build: { outDir: 'dist' },
  server: { port: 8080 }
});
```

Vite uses `index.html` as the entry point — no additional config needed. The `api/` directory is ignored by Vite (Vercel handles it separately).

### Step 0.3 — Convert Frontend JS Files to ES Modules

**Files:** All 15 files in `js/`

Each file currently exposes a global object (e.g., `const Charts = { ... }`). The migration for each file is:

1. Add `export` before the main object declaration:
   ```js
   // Before:  const Charts = { ... };
   // After:   export const Charts = { ... };
   ```

2. Add `import` statements at the top for any globals it references from other files:
   ```js
   // Example for explorer.js:
   import { Charts } from './charts.js';
   import { CONFIG } from './config.js';
   import { Filters } from './filters.js';
   import { DataStore } from './dataLoader.js';
   import { WeatherStore } from './weather.js';
   ```

**Dependency graph (determines import order):**

```
config.js        → (no app imports — standalone)
identity.js      → (no app imports — standalone)
auth.js          → (no app imports — standalone)
dataLoader.js    → config.js
weather.js       → config.js, dataLoader.js
upload.js        → config.js, identity.js, dataLoader.js
filters.js       → config.js, dataLoader.js
kpis.js          → config.js
charts.js        → config.js, filters.js, weather.js, dataLoader.js
explorer.js      → config.js, charts.js, filters.js, dataLoader.js, weather.js
tables.js        → config.js, filters.js, dataLoader.js
maps.js          → config.js, dataLoader.js
mediciones.js    → config.js, dataLoader.js
events.js        → (imports most modules — binds UI handlers)
app.js           → (imports everything — orchestrator)
```

3. Replace CDN globals with ES imports:
   ```js
   // Before (global):  const chart = new Chart(ctx, ...)
   // After:            import Chart from 'chart.js/auto';

   // Before:  XLSX.read(data, ...)
   // After:   import * as XLSX from 'xlsx';

   // Before:  const { jsPDF } = window.jspdf;
   // After:   import { jsPDF } from 'jspdf';

   // Before:  const sb = supabase.createClient(...)
   // After:   import { createClient } from '@supabase/supabase-js';
   ```

### Step 0.4 — Update index.html

**Files:** `index.html`

1. **Remove** the 4 CDN `<script defer>` tags (lines 13–16).
2. **Remove** all 15 app `<script>` tags (lines 935–949).
3. **Add** single module entry point:
   ```html
   <script type="module" src="/js/app.js"></script>
   ```
4. Keep the inline theme-restore script (line 11–12) — it must run synchronously before paint.

### Step 0.5 — Update Tests to Import from Source

**Files:** `tests/*.test.mjs`

Currently, tests copy-paste logic (e.g., MT.2 re-implements `_applyDaysJitter`, MT.6 re-implements `Identity`). After migration:

1. Tests import directly:
   ```js
   // Before: function _applyDaysJitter(x, d) { /* copy-pasted */ }
   // After:  import { _applyDaysJitter } from '../js/charts.js';
   ```

2. Functions that are currently private (not exported) need to be exported if they're tested. Add targeted exports for testable functions.

3. Tests that reference browser globals (e.g., `document`, `localStorage`) need lightweight mocks — same as current, but cleaner since we import the real module.

**Note:** MT.3 and MT.4 test API modules (`api/lib/verifyToken.js`, `api/lib/rateLimit.js`) — these already use ES imports and need no changes.

### Step 0.6 — Update Vercel Configuration

**Files:** `vercel.json`

1. Add Vite build command for Vercel:
   ```json
   {
     "buildCommand": "npm run build",
     "outputDirectory": "dist"
   }
   ```

2. Tighten CSP — remove CDN domains no longer needed:
   ```
   script-src 'self';
   ```
   (No more `https://cdnjs.cloudflare.com` or `https://cdn.jsdelivr.net` since libraries are bundled.)

### Step 0.7 — Update .gitignore and CLAUDE.md

**Files:** `.gitignore`, `CLAUDE.md`

1. `.gitignore`: `dist/` already present. No changes needed.
2. `CLAUDE.md`: Update convention:
   - ~~"No npm packages or build tools. CDN only."~~ → "Vite build. Dependencies managed via npm."
   - ~~"No frameworks. Vanilla JS ES6 only."~~ → "No frameworks. Vanilla JS ES modules only."
   - Add: "Run `npm run dev` for local development."

### Step 0.8 — Verify

1. `npm run dev` — dashboard loads, all views work, login works.
2. `npm test` — all 72 tests pass.
3. `npm run build` — production build succeeds, `dist/` output is correct.
4. Deploy to Vercel preview — confirm production behavior matches.

**Risk:** Low-Medium. This is a mechanical refactoring — no logic changes, no new features. The main risks are:
- **Missed global reference** — some file references a global that wasn't imported. Caught immediately at runtime (ReferenceError).
- **Circular imports** — unlikely given the clean dependency graph above, but possible between `filters.js` ↔ `dataLoader.js`. Resolvable by lazy initialization.
- **Supabase client init** — currently uses a UMD global. Straightforward ES import but must verify the npm package exports match.

**Mitigation:** Do the migration file-by-file, testing after each conversion. Start with leaf modules (config.js, identity.js) and work up to app.js.

---

## Stage 1 — Explorer Page Enhancements (F1, F2, F3, F4, F4b) — COMPLETE

**Shipped:** 2026-04-15 (commits `5f933e2`..`f506fe9`)
**Spec:** `docs/superpowers/specs/2026-04-15-explorer-enhancements-design.md`
**Plan:** `docs/superpowers/plans/2026-04-15-explorer-enhancements.md`

### What was built

| Feature | Files Modified | Key Commits |
|---------|---------------|-------------|
| F1: Per-slot line toggle | `explorer.js`, `events.js`, `styles.css` | `5f933e2` |
| F4-resize: Expand/compact | `explorer.js`, `events.js`, `styles.css` | `2fdcf50` |
| F4-legend: Legend bar | `explorer.js`, `events.js`, `styles.css` | `185d65e` |
| F2: Per-chart export | `explorer.js`, `charts.js`, `styles.css` | `7f500b9` |
| F3: Page-wide export | `charts.js`, `events.js`, `index.html`, `styles.css` | `d067072` |
| F4b: Lot picker | `explorer.js`, `events.js`, `config.js`, `styles.css` | `7b9213f` |
| Legend in exports | `charts.js` | `24a4af0`, `77faed6`, `f506fe9` |
| Fixes | `auth.js`, `explorer.js` | `d36b3b2`, `63b37b0`, `3c91e89` |

### Design decisions (deviations from original plan)

- **F4 redefined:** Original spec called for data tables under charts. Replaced with chart resize toggle + visible legend — more useful for the analysis workflow. Data tables already exist in dedicated table views.
- **F4b added:** Searchable lot picker with multi-select, filter, "Todo"/"Limpiar" — not in original spec but requested during implementation.
- **Legend in exports:** All export paths (per-chart PNG/PDF, page PNG/PDF) include color-coded legend read directly from Chart.js dataset instances.
- **Page export on all views:** Not just Explorer — "Exportar Vista" added to berry, wine, extraction, vintage, explorer, mediciones. Map view deferred (SVG-to-canvas).

### Step 1.4 — Explorer Data Tables (original F4, dropped)
2. In `_injectSlotDOM()`, add a `<div class="explorer-table-wrap" style="display:none">` below the canvas wrap, containing a `<table class="data-table">`.
3. New method `Explorer._renderTable(slot)`:
   - Get the same enriched data from `_getData` + `_computeDerived`.
   - Build table columns: groupBy field, X field, Y field (and optionally all available metrics).
   - Sort by Y field descending by default.
   - Reuse sortable column click pattern from `events.js:171-182`.
4. **Resizable tables:** Add a CSS `resize: vertical; overflow: auto; min-height: 100px; max-height: 500px` on `.explorer-table-wrap`. This gives the user a native browser drag handle to resize the table container. No custom drag implementation needed.
5. Toggle button switches `display: none/block` on the table wrap.

**Risk:** Low — reuses existing table patterns. CSS `resize: vertical` is well-supported.

---

## Stage 2 — Weather Time Aggregation & Timeframes (F5, F6) — COMPLETE

**Shipped:** 2026-04-16 (commit `b7d6b48`)

**Goal:** Let users control the temporal resolution and date range of weather charts.

### Step 2.1 — Time Aggregation Toggle (F5)

**Files:** `js/weather.js`, `js/charts.js`, `js/events.js`, `index.html`

1. Add a dropdown next to the valley selector in `index.html:607-613`:
   ```html
   <select id="weather-agg-select" class="nav-select">
     <option value="day">Día</option>
     <option value="week">Semana</option>
     <option value="month">Mes</option>
   </select>
   ```
2. Add `Filters.state.weatherAggregation = 'day'` in `filters.js`.
3. New method `WeatherStore.aggregate(data, mode)`:
   - `'day'` → return data as-is (current behavior).
   - `'week'` → group by ISO week number. Temperature fields = average, `rainfall_mm` = sum, `humidity_pct` = average.
   - `'month'` → group by `YYYY-MM`. Same aggregation logic.
   - Returns array of aggregated objects with a `periodLabel` field (e.g., "Sem 28" or "Ago 2025").
4. Modify chart functions (`createWeatherTempChart`, `createWeatherRainChart`, `createGDDChart`) to call `WeatherStore.aggregate()` before plotting.
   - For **GDD chart**: aggregation affects resolution of the cumulative line but the Y value is still cumulative sum. Show last-day-of-period GDD value.
   - X-axis labels: day of season (day mode), "Sem N" (week mode), "Jul/Ago/Sep/Oct" (month mode).
5. Bind `#weather-agg-select` change event in `events.js` → update state, re-render weather charts.

**Risk:** Medium — requires new aggregation logic. Test edge cases: partial weeks at start/end of season, months with missing data.

### Step 2.2 — Selectable Timeframes (F6)

**Files:** `js/weather.js`, `js/events.js`, `index.html`, `css/styles.css`

1. Add a timeframe selector in `index.html` near the weather section:
   ```html
   <select id="weather-timeframe-select" class="nav-select">
     <option value="season">Temporada (Jul–Oct)</option>
     <option value="year">Año Completo</option>
     <option value="30d">Últimos 30 Días</option>
     <option value="custom">Personalizado</option>
   </select>
   ```
2. When "Personalizado" is selected, show two date inputs (start/end).
3. Add `Filters.state.weatherTimeframe = 'season'` and `Filters.state.weatherCustomRange = null`.
4. Modify `WeatherStore.sync(vintages)` to accept an optional `{ start, end }` override:
   - `'season'` → Jul 1 – Oct 31 (current behavior).
   - `'year'` → Jan 1 – Dec 31 of the vintage year.
   - `'30d'` → today minus 30 days to today.
   - `'custom'` → user-provided start/end dates.
5. Modify `WeatherStore.getRange()` calls in chart functions to use the selected timeframe dates instead of hardcoded Jul 1 / Oct 31.
6. Bind events, re-sync if needed (new date range may require fetching data not yet cached).

**Risk:** Medium — extending sync range means more Open-Meteo API calls. The archive API supports full-year ranges. Cache logic (`_hasFullRange`) must handle variable ranges. Rate limit on Open-Meteo: 10,000 requests/day (not a concern for single-user dashboard).

---

## Stage 3 — Satellite Vineyard Map (F7)

**Goal:** Overlay vineyard quality heatmaps on a real-world satellite map with navigation between vineyards.

### Step 3.1 — Add Leaflet.js and Base Map

**Files:** `index.html`, `css/styles.css`

1. Add Leaflet CSS + JS from CDN in `index.html`:
   ```html
   <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
   ```
2. Add a map toggle in the map view header: "SVG" | "Satélite" buttons.
3. Add a `<div id="map-leaflet-container">` sibling to the existing `#map-svg-container`.
4. CSS: both containers same size, toggled via `display: none/block`.

### Step 3.2 — Configure Satellite Tiles and Vineyard Locations

**Files:** `js/maps.js`, `js/config.js`

1. Add per-ranch geographic coordinates to `CONFIG` (to be researched/provided by Daniel):
   ```js
   ranchCoordinates: {
     'MX':  { lat: 32.0808, lng: -116.6230, zoom: 16 },
     'K':   { lat: 32.0785, lng: -116.6180, zoom: 16 },
     'VA':  { lat: 32.0750, lng: -116.6100, zoom: 16 },
     'ON':  { lat: 31.9950, lng: -116.2500, zoom: 15 },
     'OLE': { lat: 32.0820, lng: -116.6250, zoom: 17 },
     '7L':  { lat: 32.0780, lng: -116.6200, zoom: 17 },
     'DUB': { lat: 32.0800, lng: -116.6220, zoom: 18 },
     'DA':  { lat: 32.0790, lng: -116.6210, zoom: 17 },
   }
   ```
   **NOTE:** These are placeholder coordinates. Daniel will need to provide or verify actual lat/lng for each ranch.

2. Add section-level polygon coordinates in `CONFIG.vineyardSectionsGeo` — GeoJSON-style `[lat, lng]` arrays for each section boundary. These can be derived from satellite imagery or field surveys.

3. Satellite tile provider: **Esri World Imagery** (free, no API key):
   ```
   https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
   ```
   Attribution: "Tiles &copy; Esri"

### Step 3.3 — Initialize Leaflet Map and Ranch Navigation

**Files:** `js/maps.js`

1. New method `MapStore.initLeaflet()`:
   - Create `L.map('map-leaflet-container')` with satellite tile layer.
   - Center on VDG overview (lat: 32.08, lng: -116.62, zoom: 13).
   - Add ranch markers with popups showing ranch name + section count.
2. Ranch tab click → `map.flyTo(ranchCoordinates[ranch], zoom)` for smooth navigation.
3. Add a "home" button control to zoom back to valley overview.

### Step 3.4 — Quality Polygon Overlays on Satellite

**Files:** `js/maps.js`

1. New method `MapStore.renderLeafletOverlay(ranch, metric)`:
   - For each section in the ranch with data:
     - Create `L.polygon(sectionGeoCoords, { fillColor, fillOpacity: 0.5, weight: 1, color: '#C4A050' })`.
     - Bind popup with section name, variety, metric value.
   - Use the same `getColor()` method for metric-based fill colors.
2. On metric dropdown change → clear and re-render overlays.
3. Section click on satellite → show same detail panel as SVG view.

### Step 3.5 — Toggle Between SVG and Satellite Views

**Files:** `js/maps.js`, `js/events.js`

1. Toggle buttons: "SVG" (default) and "Satélite".
2. State: `MapStore.viewMode = 'svg' | 'satellite'`.
3. On toggle:
   - Hide one container, show the other.
   - If switching to satellite for the first time, call `initLeaflet()` (lazy init).
   - Sync metric selection between both views.

**Risk:** High — this is the most complex stage. Key risks:
- **Geographic coordinates** must be researched or surveyed for each ranch and section. Without accurate coords, polygons won't align with satellite imagery. This is the primary blocker.
- **Leaflet.js CDN** (~40 KB gzipped) — acceptable for no-build constraint.
- **Mobile performance** — satellite tiles are heavier. Leaflet handles this well but test on mobile.
- **No offline support** — satellite tiles require internet.

**Mitigation:** Start with ranch-level markers only (Step 3.3) before attempting polygon overlays (Step 3.4). Polygon coords can be added incrementally as they're surveyed.

---

## Stage 4 — Future Analytics Foundations (F8, F9, F10) — DOCUMENTATION ONLY

**No code implementation in Phase 9.** These items are documented for future phases.

### F8 — Weather Forecast Integration (Future)

**Approach:**
- Open-Meteo offers a [Forecast API](https://open-meteo.com/en/docs) with 16-day forecasts (free tier).
- Endpoint: `https://api.open-meteo.com/v1/forecast` (same parameters as archive API).
- Implementation: add a `WeatherStore.syncForecast()` method that fetches forecast data and appends to the same data structure with an `isForecast: true` flag.
- Charts would render forecast data with dashed lines to distinguish from observed data.
- Accuracy drops significantly after 7 days; consider showing only 7-day forecast by default with option for 16-day.

### F9 — Lot Categorization: Monovarietal vs. Mix (Bookmarked)

**Approach (pending stakeholder thresholds):**
- New config structure `CONFIG.lotClassification`:
  ```js
  lotClassification: {
    monovarietal: {
      rules: [
        { field: 'tANT', op: '>=', value: TBD },
        { field: 'brix', op: 'between', value: [TBD, TBD] },
        // ... thresholds defined by higher-ups
      ],
      minRulesMatch: 'all' // or a number
    },
    mix: { rules: [/* inverse or different thresholds */] }
  }
  ```
- New module `js/classification.js` would evaluate each lot against rules and produce a label.
- Dashboard would show classification badges on lot cards and in table views.
- **Blocked on:** Stakeholder definition of chemical thresholds.

### F10 — Lot Performance Percentile Ranking (Future)

**Approach:**
- For each lot, query historical data for the same `(variety, appellation, section)` across all vintages.
- Compute percentile rank for key metrics (Brix, tANT, pH, TA) relative to historical distribution.
- Display as a percentile card or sparkline in lot detail views.
- Could feed into predictive models later (trend line extrapolation based on early-season measurements vs. historical trajectories).
- **Requires:** Multi-vintage data accumulation (at least 3 vintages for meaningful percentiles).

---

## Implementation Order

| Order | Stage | Estimated Complexity | Dependencies |
|-------|-------|---------------------|--------------|
| **1** | **Stage 0** — Vite migration | Low–Medium | None — do first |
| **2** | **Stage 1** — Explorer enhancements | Low–Medium | Stage 0 |
| **3** | **Stage 2** — Weather aggregation & timeframes | Medium | Stage 0 |
| — | **Stage 3** — Satellite map | High | **Future** — idea, not priority. Requires ranch/section coordinates |
| — | **Stage 4** — Future foundations | Documentation only | Stakeholder input |

**Stage 0 must complete first.** All subsequent stages benefit from ES modules and npm packages.

**Recommended build order within Stage 0:** 0.1 → 0.2 → 0.3 (leaf modules first: config → identity → auth → dataLoader → weather → upload → filters → kpis → charts → explorer → tables → maps → mediciones → events → app) → 0.4 → 0.5 → 0.6 → 0.7 → 0.8.

**Recommended build order within Stage 1:** 1.1 → 1.2 → 1.4 → 1.3 (dashboard export is easiest once individual exports work and tables are in place).

**Recommended build order within Stage 2:** 2.1 → 2.2 (aggregation is simpler and self-contained; timeframes require sync changes).

---

## New Tests to Add

| ID | Scope | Stage |
|----|-------|-------|
| MT.8 | Weather aggregation logic (day/week/month) — unit test `WeatherStore.aggregate()` | Stage 2 |
| MT.9 | Explorer export (verify canvas compositing produces valid data URL) | Stage 1 |
| MT.10 | Lot classification engine (when F9 rules are defined) | Stage 4 (future) |

---

## Files Modified Summary

| File | Stages | Nature of Changes |
|------|--------|-------------------|
| `package.json` | 0 | Add vite, chart.js, xlsx, jspdf, @supabase/supabase-js |
| `vite.config.js` | 0 | **NEW** — minimal Vite config |
| `index.html` | 0, 1, 2 | Remove CDN/script tags, add module entry, new buttons/dropdowns |
| `js/*.js` (all 15) | 0 | Add import/export, replace CDN globals with ES imports |
| `tests/*.test.mjs` | 0 | Import from source instead of copy-pasting logic |
| `vercel.json` | 0 | Add buildCommand/outputDirectory, tighten CSP |
| `CLAUDE.md` | 0 | Update conventions (npm + Vite) |
| `.gitignore` | 0 | Verify dist/ coverage |
| `js/explorer.js` | 1 | Line toggle, export btn, table toggle, exportAll method |
| `js/charts.js` | 1, 2 | Dashboard export compositing, aggregation in weather charts |
| `js/weather.js` | 2 | `aggregate()` method, variable-range sync |
| `js/config.js` | 2, 4 | Aggregation config, future stubs |
| `js/events.js` | 1, 2 | New event bindings for toggles and selectors |
| `js/filters.js` | 2 | New state fields (weatherAggregation, weatherTimeframe) |
| `css/styles.css` | 1, 2 | Explorer table resize, toggle buttons |

---

## Prior Completed Work

<details>
<summary>Phases 1–8 (all complete)</summary>

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Deploy Online (Vercel) | Done |
| 2 | Database Migration (Supabase) | Done |
| 3 | Meteorology Integration | Done |
| 4 | Authentication (bcrypt + HMAC, 2h tokens) | Done |
| 4b | Data & Visualization Overhaul | Done |
| 4c | Stability, Security & Viz Improvements | Done |
| 5 | Vineyard Quality Map (SVG) | Done |
| 6 | Polish (login, PDF, mobile, trends, radar, harvest calendar) | Done |
| — | Security Hardening (server upload, rate limits, token blacklist) | Done |
| — | Review Rounds 1–10 (all findings triaged) | Done |
| — | Waves 1–7 (all review findings resolved) | Done |
| 7 | Mediciones Tecnicas (form, table, charts) | Done |
| — | Remove always-on lot-line plugin from scatter charts | Done |
| 8 | Deterministic Berry Identity & Pipeline Hardening | Done |

</details>
