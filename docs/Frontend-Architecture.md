# Frontend Architecture

## Module Overview

14 JavaScript files loaded as `<script>` tags in `index.html`. No module bundler. Each file declares a global singleton object. Load order matters.

**Load order (from index.html):**
1. `auth.js` - Auth singleton
2. `config.js` - CONFIG singleton
3. `dataLoader.js` - DataStore singleton
4. `upload.js` - UploadManager singleton
5. `weather.js` - WeatherStore singleton
6. `filters.js` - Filters singleton
7. `kpis.js` - KPIs singleton
8. `charts.js` - Charts singleton
9. `explorer.js` - Explorer singleton
10. `tables.js` - Tables singleton
11. `maps.js` - MapStore singleton
12. `mediciones.js` - Mediciones singleton
13. `events.js` - Events singleton (binds all handlers)
14. `app.js` - App singleton (orchestrates everything)

## State Ownership

| Module | State | Persistence |
|--------|-------|-------------|
| Auth | session token, role | localStorage |
| DataStore | berryData[], wineRecepcion[], winePreferment[], medicionesData[], supabase client | In-memory (reloaded from Supabase on init) |
| Filters | state { vintages, varieties, origins, lots, grapeType, colorBy, weatherLocation }, wineState | In-memory (resets on reload) |
| WeatherStore | data[], _byDate{}, _gddCache{} | In-memory + Supabase cache |
| Charts | instances{}, showLines, hiddenSeries | In-memory |
| MapStore | currentVintage, currentRanch, _aggregated{} | In-memory |
| App | currentView, initialized, _refreshInProgress | In-memory |

## Module Responsibilities

### config.js
Static configuration. No runtime state changes.
- Grape variety classification (red/white)
- Color palettes for varieties and origins
- Appellation normalization mappings
- Column mappings: WineXRay CSV -> Supabase, Supabase -> JS objects
- Sample exclusion rules (lab tests, experiments)

**Do not add:** Runtime state, API calls, DOM manipulation.

### dataLoader.js
Data access layer. All Supabase queries go through here.
- `initSupabase()` - Fetch credentials, create client
- `loadFromSupabase()` - Paginated fetch of wine_samples, prefermentativos
- `loadMediciones()` - Fetch mediciones_tecnicas
- `_rowToBerry()`, `_rowToWine()`, `_rowToPrefWine()`, `_rowToMedicion()` - Row mappers
- `_fetchAll()` - Generic paginated fetch (1000 rows/page)
- `getFilteredBerry()`, `getFilteredWineAdvanced()` - Filter application
- SheetJS parsing for upload flow

**Do not add:** Chart rendering, DOM updates, filter UI logic.

### filters.js
Filter state management and chip UI.
- `state` / `wineState` - Current filter selections
- `getFiltered()` - Returns filtered berry data
- `getFilteredWine()` / `getFilteredPreferment()` - Filtered wine data
- `clearAll()` / `clearAllWine()` - Reset all filters
- `syncChipUI()` - Rebuild filter chips from data
- Debounced refresh trigger (200ms on mobile)

**Do not add:** Data fetching, chart rendering, KPI calculations.

### charts.js
All Chart.js rendering. Largest module (~2272 lines).
- `updateBerryCharts()` - Scatter plots for Brix, pH, tANT, TA, Weight
- `createVintageComparison()` - Multi-vintage overlay charts
- `createHarvestCalendar()` - Floating bar chart with weather overlay
- `createWeatherTimeSeries()`, `createRainfallChart()`, `createGDDChart()` - Weather charts
- `createValleyTempChart()` - Multi-valley temperature comparison
- `createWinePhenolicsChart()` - Grouped bar (tANT/fANT/pTAN/IPT by variety)
- `createExtractionChart()`, `createExtractionPctChart()` - Berry-to-wine extraction
- `_lazyRender()` - IntersectionObserver-based deferred rendering
- Chart export (PNG/PDF) via canvas-to-image

**Do not add:** Data fetching, filter logic, table rendering.

### kpis.js
Pure calculation functions for KPI cards.
- `updateBerryKPIs()` - Avg Brix, pH, TA, tANT, berry weight
- `updateWineKPIs()` - Wine phenolics averages

**Do not add:** DOM creation beyond updating `.kpi-value` elements.

### tables.js
Table rendering and sorting for berry and wine views.
- `updateBerryTable()` - Berry data table with XSS-safe rendering
- `updateWineTable()` - Wine reception table
- `updatePrefermentTable()` - Pre-fermentation table
- Sort by column click

**Do not add:** Chart rendering, data fetching.

### weather.js
Open-Meteo API client and Supabase meteorology cache.
- `load()` - Query meteorology table
- `sync()` - Fill gaps by fetching from Open-Meteo API, upsert to Supabase
- `getRange()` - Get weather rows for date range + location
- `getCumulativeGDD()` - Growing degree days (base 10C, from Jul 1)
- `getCumulativeRainfall()` - Cumulative rain from Jul 1
- Valley coordinates: VDG (32.08, -116.62), VON (32.00, -116.25), SV (32.05, -116.45)

**Do not add:** Chart rendering, filter logic.

### upload.js
Client-side file parsing and server upload.
- `handleUpload()` - Entry point for drag-and-drop files
- `parseWineXRay()` - CSV parsing with normalization and validation
- `parseRecepcion()` - Excel parsing (two sheets: reception + prefermentativos)
- `upsertRows()` - POST to /api/upload
- Below-detection handling, lab sample filtering, variety/appellation normalization

**Do not add:** Supabase direct queries, chart rendering.

### mediciones.js
Mediciones Tecnicas view: form, table, KPIs, charts.
- `initDropdowns()` - Populate variety/origin selects from CONFIG
- `submitForm()` - Collect form data, POST to /api/upload
- `renderTable()` - Sortable table with health mini-bars
- `updateKPIs()` - Count, tonnage, avg weight, avg % madura
- `renderCharts()` - Tonnage bar, weight scatter, health stacked bar

### maps.js
SVG vineyard map visualization.
- `aggregateBySection()` - Group berry data by field section
- `render()` - Draw SVG map with color-coded metric values
- `setMetric()` - Switch between Brix, pH, tANT, TA display
- Ranch tabs: Monte Xanic, Kompali, etc.

**Status:** Active. Renders when "Mapa" tab selected.

### events.js
CSP-compliant event delegation. Zero inline handlers.
- `bindAll()` - Called once on init. Delegates all click/change/submit events.
- Handles: navigation, auth, UI controls, upload, explorer, filters, chart exports, table sorting, evolution toggles, map delegation, legend delegation, mediciones form/table.

**Do not add:** State management, data transformation, rendering logic.

### app.js
Application orchestrator.
- `init()` - Bootstrap: auth check, Supabase init, data load, weather sync
- `setView()` - Switch between views, manage filter panel visibility
- `refresh()` - Re-render current view with filtered data
- Concurrent refresh guard (`_refreshInProgress` / `_refreshPending`)
- Theme toggle (dark/light)

## How Filters Affect Views

```
Filters.state changed (chip click, type toggle, etc.)
  -> Filters._debouncedRefresh() (200ms on mobile)
  -> App.refresh()
  -> Filters.getFiltered() applies AND logic:
     - vintages: must be in set (or all if empty)
     - varieties: must be in set
     - origins: must be in set
     - lots: must be in set
     - grapeType: 'red', 'white', or 'all'
  -> Filtered data passed to Charts, Tables, KPIs for current view
```

Berry and wine views have separate filter states (`state` vs `wineState`).
Map view ignores filters (shows latest measurement per lot).
Mediciones view has no filter integration (shows all records).
