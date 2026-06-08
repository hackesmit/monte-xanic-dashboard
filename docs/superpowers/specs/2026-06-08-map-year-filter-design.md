# Calidad map — year filter

**Status:** Approved 2026-06-08
**Touches:** `index.html`, `js/filters.js`, `js/events.js`, `js/app.js`, `tests/mt35-map-year-filter.test.mjs` (new)
**Companion plan:** to be written by `superpowers:writing-plans` after spec approval

## Problem

The Mapa view (`view-map`) currently has no UI for choosing a vintage. Section aggregation in `js/app.js:408` reads `Filters.state.vintages` (the multi-select Set used by berry/wine views) and only applies a year filter when exactly one chip happens to be active:

```js
const vintage = Filters.state.vintages.size === 1 ? [...Filters.state.vintages][0] : null;
```

In practice, vintage chips are *hidden* on the map view (`app.js:309-311`), so users almost always see `size === 0 → vintage = null`, meaning **all years are mixed together** in the section aggregate. A 2025 lot's quality grade pollutes the same section's 2026 picture (and vice versa), defeating the purpose of seeing "what does this block look like this season?"

KPI cards at the top of the map (Muestras, Secciones, Brix Prom., etc.) are computed inside `MapStore.aggregateBySection` from the same data, so they're affected identically.

## Non-goals

- No multi-year compare on the map. The user's stated intent is "one year's quality shouldn't carry over to the next" — single-select only.
- No "All years" escape hatch. Cross-year averaging is wrong for every metric on this view; an explicit option for it would be a foot-gun.
- No change to global vintage chips' behavior on berry/wine/extraction views — those stay multi-select.
- No URL-param sync of the picker (future enhancement; not blocking).
- No localStorage persistence — re-default to latest each visit.

## Key decisions

1. **State isolation.** Add `Filters.state.mapVintage` (single number, default `null`) as a new state slice. Do **not** reuse `Filters.state.vintages`. Reason: the global chips are multi-select and shared across views; coupling the map's picker to them would either force the map into multi-select (against intent) or surprise users when navigating away from the map. A separate slice is one variable; the cost is trivial.
2. **Default = latest vintage with berry data.** On data load, pick `max(DataStore.getUniqueValues('vintage'))`. Re-pick on every `onDataLoaded` so cache-then-Supabase load doesn't strand the user on stale state. If the picked year leaves the dataset (rare), reset to the new latest.
3. **No "All years" option.** Picker is always a single concrete year.
4. **UI placement:** new `<select>` immediately to the **left** of `#map-metric-select` in the map header. Same `.nav-select` class — inherits all existing styling.

## Architecture

### State

`js/filters.js` adds a single field and two helpers:

```js
state: {
  ...existing fields...,
  mapVintage: null,   // single number; null only before initMapVintage runs
},

// Populate the year <select> from current berry data, ordered desc.
buildMapVintageOptions() {
  const sel = document.getElementById('map-vintage-select');
  if (!sel) return;
  const years = DataStore.getUniqueValues('vintage')
    .map(Number).filter(Number.isFinite)
    .sort((a, b) => b - a);
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  sel.style.display = years.length ? '' : 'none';
},

// Re-default to latest if current pick has no data; otherwise preserve.
initMapVintage() {
  const years = DataStore.getUniqueValues('vintage').map(Number).filter(Number.isFinite);
  if (!years.length) { this.state.mapVintage = null; return; }
  if (this.state.mapVintage != null && years.includes(this.state.mapVintage)) return;
  this.state.mapVintage = Math.max(...years);
  const sel = document.getElementById('map-vintage-select');
  if (sel) sel.value = String(this.state.mapVintage);
},
```

### HTML

`index.html:723-734` (the map header block) gets one new `<select>` immediately before `#map-metric-select`:

```html
<select id="map-vintage-select" class="nav-select" title="Vendimia" style="display:none">
  <!-- options injected by Filters.buildMapVintageOptions -->
</select>
```

`display:none` initial state hides it until `buildMapVintageOptions` finds at least one year.

### Refresh wiring

`js/app.js` map-view branch (currently around line 408):

```js
// BEFORE
const vintage = Filters.state.vintages.size === 1 ? [...Filters.state.vintages][0] : null;

// AFTER
const vintage = Filters.state.mapVintage;
```

`onDataLoaded` calls `Filters.buildMapVintageOptions()` and `Filters.initMapVintage()` once after data load (alongside the existing `buildVintageChips` call). When data reloads (cache-then-Supabase, or demo toggle), the same two calls re-run and either preserve or reset the picker value as appropriate.

### Event

`js/events.js` binds a change handler in `_bindMap` (or the existing map-controls block where `map-metric-select` is bound):

```js
const mapVintageSel = document.getElementById('map-vintage-select');
if (mapVintageSel) mapVintageSel.addEventListener('change', () => {
  Filters.state.mapVintage = parseInt(mapVintageSel.value, 10) || null;
  App.refresh();
});
```

### Aggregate

`MapStore.aggregateBySection` already filters when given a non-null `vintage`:

```js
const filtered = vintage ? data.filter(d => d.vintage === vintage) : data;
```

No change here. The fix is the **caller** now passes a concrete year instead of `null`.

## Data flow

1. Cold start → `loadCache()` or `loadFromSupabase()` populates `DataStore.berryData`
2. `App.onDataLoaded` → `Filters.buildVintageChips()` (existing) + `Filters.buildMapVintageOptions()` (new) + `Filters.initMapVintage()` (new)
3. `initMapVintage` writes `state.mapVintage = max(years)` and sets the `<select>.value`
4. User navigates to Mapa → `App.refresh()` runs map branch with the populated `mapVintage`
5. User picks a different year from the dropdown → event handler updates state + refreshes
6. Subsequent reload (e.g. cache-then-Supabase) re-runs `initMapVintage` which preserves the current pick if still valid

## Tests (new)

`tests/mt35-map-year-filter.test.mjs`:

1. **`initMapVintage` picks max year when multiple vintages exist.** Seed `DataStore.berryData = [{vintage: 2024}, {vintage: 2025}, {vintage: 2026}]`. Call `Filters.initMapVintage()`. Assert `Filters.state.mapVintage === 2026`.
2. **`initMapVintage` picks the only year when one exists.** Seed with `[{vintage: 2025}]`. Assert `state.mapVintage === 2025`.
3. **`initMapVintage` sets null when no berry data.** Seed `[]`. Assert `state.mapVintage === null`.
4. **`initMapVintage` preserves a valid existing pick.** Set `state.mapVintage = 2024`. Seed with `[{vintage: 2024}, {vintage: 2026}]`. Call. Assert `state.mapVintage === 2024` (not 2026).
5. **`initMapVintage` resets when current pick disappears.** Set `state.mapVintage = 2020`. Seed with `[{vintage: 2024}, {vintage: 2026}]`. Call. Assert `state.mapVintage === 2026`.
6. **`MapStore.aggregateBySection` filters by passed vintage.** Build a rows array with mixed vintages, pass `vintage = 2026`, assert only 2026 rows contribute to any `sectionData` entry. (Regression guard so the new state slice actually flows through.)

## Risks

- **R1 — `getUniqueValues('vintage')` returns mixed-type values.** Berry rows from Supabase have INT, but cached/JSON-imported rows might be strings (the audit found this pattern at `mediciones.js:601` and `prediction.js:411`). Mitigation: `buildMapVintageOptions` and `initMapVintage` cast via `Number()` and filter `Number.isFinite`. The `<select>` value comes back as a string and we `parseInt` it in the change handler.
- **R2 — Demo mode emits only the current year today.** Picker shows a single option in demo. Acceptable — not visually surprising; future demo work could extend historical-year berries.
- **R3 — Filter chip UI on the map view.** The hidden global vintage chips remain hidden; no UI conflict. If a future change unhides them, the two systems would coexist but `MapStore` would read `mapVintage` only.

## Out of scope

- Multi-year compare on the map (e.g., split-pane 2025 vs 2026)
- URL-param persistence of the picker
- localStorage persistence across sessions
- Per-ranch year override (one year applies to all ranches simultaneously)

## Deliverables

- 1 PR touching `index.html`, `js/filters.js`, `js/events.js`, `js/app.js`, `tests/mt35-map-year-filter.test.mjs`
- All tests green; build clean
- Browser smoke: dropdown visible on Mapa, picker change updates polygons + KPI cards without reload
