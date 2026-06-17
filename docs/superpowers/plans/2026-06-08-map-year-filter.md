# Calidad Map Year Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-select year picker to the Mapa view that filters every metric (Calidad, Brix, pH, tANT, A.T.) to a single vintage; default to the latest year with berry data, isolated from the global multi-select vintage chips.

**Architecture:** New `Filters.state.mapVintage` slice with two helpers (`buildMapVintageOptions`, `initMapVintage`); new `<select id="map-vintage-select">` in the map header; change handler in `events.js`; one-line swap in `app.js`'s map branch from the `Filters.state.vintages` Set lookup to `Filters.state.mapVintage`. `MapStore.aggregateBySection` already accepts a vintage param and filters when non-null — no change there.

**Tech Stack:** Vanilla JS ES modules, `node:test` for unit tests, vanilla HTML5 `<select>`.

**Spec:** `docs/superpowers/specs/2026-06-08-map-year-filter-design.md`

---

### Task 0: Set up worktree and verify baseline

**Files:**
- None modified

- [ ] **Step 0.1: Branch from latest main**

```bash
cd "/mnt/c/users/danie/xanic dashboard"
git fetch origin
git checkout -b feat/map-year-filter origin/main
```

- [ ] **Step 0.2: Capture baseline test count**

Run: `npm test 2>&1 | tail -5`
Expected: `tests N` where N is the current baseline (currently 435). Record.

- [ ] **Step 0.3: Confirm the cited lines still match the spec**

Run: `grep -nE "mapVintage|map-vintage-select" js/filters.js js/app.js js/events.js index.html`
Expected: zero matches (no existing implementation).

Run: `sed -n '407,411p' js/app.js`
Expected output contains: `const vintage = Filters.state.vintages.size === 1 ? [...Filters.state.vintages][0] : null;`

If line numbers shifted, follow the pattern (the "size === 1 ? pick : null" shape) rather than the literal numbers.

---

### Task 1: Add `mapVintage` to `Filters.state` and write failing tests

**Files:**
- Modify: `js/filters.js` lines 7-21 (the `state` object)
- Create: `tests/mt35-map-year-filter.test.mjs`

- [ ] **Step 1.1: Add the state field**

Open `js/filters.js`. Locate the `state` object (around line 7-21). Add the new field at the end, after `weatherForecastHorizon: 7`:

```javascript
  state: {
    vintages: new Set(),
    varieties: new Set(),
    origins: new Set(),
    lots: new Set(),
    grapeType: 'all',
    colorBy: 'variety',
    weatherLocation: 'VDG',
    weatherAggregation: 'day',
    weatherTimeframe: 'season',
    weatherCustomStart: null,
    weatherCustomEnd: null,
    weatherShowForecast: false,
    weatherForecastHorizon: 7,
    mapVintage: null,    // Single vintage for the Mapa view (#21 — separate
                         // from `vintages` Set to keep map's single-select
                         // independent of the global multi-select chips).
  },
```

- [ ] **Step 1.2: Create the test file with all six failing tests**

```javascript
// tests/mt35-map-year-filter.test.mjs
// MT.35 — Mapa view single-vintage filter.
// Filters.state.mapVintage is a single-number state slice (default null).
// Filters.initMapVintage picks the latest vintage from berryData; preserves
// a still-valid existing pick; resets when the pick disappears.
// MapStore.aggregateBySection's existing vintage filter must isolate the
// chosen year so a 2025 lot's quality doesn't bleed into 2026's section data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Filters } from '../js/filters.js';
import { DataStore } from '../js/dataLoader.js';
import { MapStore } from '../js/maps.js';

function seedBerries(rows) {
  DataStore.berryData = rows;
}

function resetMapVintage() {
  Filters.state.mapVintage = null;
}

test('MT.35 initMapVintage picks max year when multiple vintages exist', () => {
  resetMapVintage();
  seedBerries([
    { vintage: 2024, lotCode: 'X-1' },
    { vintage: 2025, lotCode: 'X-2' },
    { vintage: 2026, lotCode: 'X-3' },
  ]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, 2026);
});

test('MT.35 initMapVintage picks the only year when one exists', () => {
  resetMapVintage();
  seedBerries([{ vintage: 2025, lotCode: 'X-1' }]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, 2025);
});

test('MT.35 initMapVintage sets null when no berry data', () => {
  resetMapVintage();
  seedBerries([]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, null);
});

test('MT.35 initMapVintage preserves a valid existing pick', () => {
  Filters.state.mapVintage = 2024;
  seedBerries([
    { vintage: 2024, lotCode: 'X-1' },
    { vintage: 2026, lotCode: 'X-2' },
  ]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, 2024,
    'A valid existing pick must NOT be overwritten — that would surprise users mid-session.');
});

test('MT.35 initMapVintage resets to latest when current pick disappears', () => {
  Filters.state.mapVintage = 2020;
  seedBerries([
    { vintage: 2024, lotCode: 'X-1' },
    { vintage: 2026, lotCode: 'X-2' },
  ]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, 2026);
});

test('MT.35 MapStore.aggregateBySection filters by the passed vintage', () => {
  // Build rows with mixed vintages, all resolving to the same section. Pass
  // vintage=2026. Assert only 2026 rows contribute to the section aggregate.
  const rows = [
    { lotCode: 'CSMX-5A', fieldLot: 'CSMX-5A', vintage: 2025, brix: 20, variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)' },
    { lotCode: 'CSMX-5A', fieldLot: 'CSMX-5A', vintage: 2026, brix: 24, variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)' },
  ];
  MapStore.aggregateBySection(rows, 2026);
  const mxData = MapStore.sectionData['MX-5A'];
  assert.ok(mxData, 'MX-5A should have section data');
  assert.equal(mxData.brix, 24, 'Only the 2026 row (brix=24) should contribute — not the average of 20 and 24.');
});
```

- [ ] **Step 1.3: Run MT.35 — expect 5 failures, 1 pass**

Run: `npm test -- --test-name-pattern="MT\.35" 2>&1 | tail -20`
Expected: tests calling `Filters.initMapVintage()` fail with "Filters.initMapVintage is not a function". The MapStore filter test (test 6) may already pass — that's fine; it's a regression guard.

If `Filters.initMapVintage` happens to be undefined-tolerant in some environments, the failure may be `TypeError`. Either way, do NOT proceed until at least tests 1-5 fail for the right reason.

---

### Task 2: Implement `initMapVintage` and `buildMapVintageOptions`

**Files:**
- Modify: `js/filters.js` — add two methods after `init()` (or anywhere on the `Filters` object; place them adjacent to `buildVintageChips` for proximity).

- [ ] **Step 2.1: Read the current `buildVintageChips` to match style**

Run: `sed -n '55,68p' js/filters.js`
Expected: `buildVintageChips()` method body for reference.

- [ ] **Step 2.2: Add the two new methods**

Open `js/filters.js`. Find `buildVintageChips()` (around line 55). Immediately after its closing `},`, insert the two new methods:

```javascript
  // Populate the Mapa view's year <select> from the current berry data,
  // ordered descending so the newest year is first. Hides the picker when
  // no data is loaded yet so the header doesn't show an empty dropdown.
  buildMapVintageOptions() {
    const sel = document.getElementById('map-vintage-select');
    if (!sel) return;
    const years = DataStore.getUniqueValues('vintage')
      .map(Number).filter(Number.isFinite)
      .sort((a, b) => b - a);
    sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    sel.style.display = years.length ? '' : 'none';
    if (this.state.mapVintage != null) sel.value = String(this.state.mapVintage);
  },

  // Set state.mapVintage to a sensible default after data load. Preserve a
  // still-valid existing pick (don't surprise the user mid-session); reset
  // to the latest year when the pick is missing or stale.
  initMapVintage() {
    const years = DataStore.getUniqueValues('vintage').map(Number).filter(Number.isFinite);
    if (!years.length) { this.state.mapVintage = null; return; }
    if (this.state.mapVintage != null && years.includes(this.state.mapVintage)) return;
    this.state.mapVintage = Math.max(...years);
    const sel = document.getElementById('map-vintage-select');
    if (sel) sel.value = String(this.state.mapVintage);
  },
```

- [ ] **Step 2.3: Run MT.35 again — expect 6/6 pass**

Run: `npm test -- --test-name-pattern="MT\.35" 2>&1 | tail -10`
Expected: `tests 6`, `pass 6`, `fail 0`.

- [ ] **Step 2.4: Run the full suite to confirm no regressions**

Run: `npm test 2>&1 | tail -5`
Expected: baseline + 6 tests, 0 failures.

- [ ] **Step 2.5: Commit**

```bash
git add js/filters.js tests/mt35-map-year-filter.test.mjs
git commit -m "feat(filters): mapVintage state + init/build helpers"
```

---

### Task 3: Add the `<select>` to the map header

**Files:**
- Modify: `index.html` — map header block (around line 720-731)

- [ ] **Step 3.1: Read the existing block**

Run: `sed -n '720,732p' index.html`
You should see:

```html
    <!-- ═══════ MAP VIEW ═══════ -->
    <div id="view-map" class="view-panel">
      <div class="map-header">
        <div class="ranch-tabs" id="ranch-tabs"></div>
        <select id="map-metric-select" class="nav-select">
          <option value="calidad">Calidad</option>
          <option value="brix">Brix (°Bx)</option>
          <option value="pH">pH</option>
          <option value="tANT">tANT (ppm)</option>
          <option value="ta">A.T. (g/L)</option>
        </select>
      </div>
```

- [ ] **Step 3.2: Insert the new `<select>` immediately before `#map-metric-select`**

Use the Edit tool to add a new `<select>` element before `<select id="map-metric-select"`:

```html
    <!-- ═══════ MAP VIEW ═══════ -->
    <div id="view-map" class="view-panel">
      <div class="map-header">
        <div class="ranch-tabs" id="ranch-tabs"></div>
        <select id="map-vintage-select" class="nav-select" title="Vendimia" style="display:none">
          <!-- options injected by Filters.buildMapVintageOptions -->
        </select>
        <select id="map-metric-select" class="nav-select">
          <option value="calidad">Calidad</option>
          <option value="brix">Brix (°Bx)</option>
          <option value="pH">pH</option>
          <option value="tANT">tANT (ppm)</option>
          <option value="ta">A.T. (g/L)</option>
        </select>
      </div>
```

- [ ] **Step 3.3: Confirm the change**

Run: `grep -n "map-vintage-select" index.html`
Expected: one match showing the new `<select>`.

- [ ] **Step 3.4: Commit**

```bash
git add index.html
git commit -m "feat(html): add map-vintage-select to Mapa view header"
```

---

### Task 4: Wire the change handler in `events.js`

**Files:**
- Modify: `js/events.js` lines 46-49 area (existing map-metric handler)

- [ ] **Step 4.1: Read the existing map-controls block**

Run: `sed -n '45,52p' js/events.js`
Expected:

```javascript
    const mapMetric = document.getElementById('map-metric-select');
    if (mapMetric) mapMetric.addEventListener('change', () => MapStore.setMetric(mapMetric.value));
```

- [ ] **Step 4.2: Add the vintage handler immediately after**

Use the Edit tool to extend the block:

```javascript
    const mapMetric = document.getElementById('map-metric-select');
    if (mapMetric) mapMetric.addEventListener('change', () => MapStore.setMetric(mapMetric.value));

    // Mapa view's single-vintage picker. Writes Filters.state.mapVintage and
    // triggers a refresh — App.refresh() flows the new value into the map
    // branch via Filters.state.mapVintage (see app.js).
    const mapVintageSel = document.getElementById('map-vintage-select');
    if (mapVintageSel) mapVintageSel.addEventListener('change', () => {
      const parsed = parseInt(mapVintageSel.value, 10);
      Filters.state.mapVintage = Number.isFinite(parsed) ? parsed : null;
      App.refresh();
    });
```

- [ ] **Step 4.3: Confirm Filters and App are already imported in events.js**

Run: `grep -n "^import" js/events.js | head -10`
Expected: imports for `Filters` and `App` already present (they're used elsewhere in this file).

If `Filters` and `App` are not yet imported in `events.js`, add to the import list at the top of the file.

- [ ] **Step 4.4: Commit**

```bash
git add js/events.js
git commit -m "feat(events): wire map-vintage-select change handler"
```

---

### Task 5: Replace `app.js`'s map-branch vintage lookup with `Filters.state.mapVintage`

**Files:**
- Modify: `js/app.js` line 408 (the `vintage` const inside `case 'map'`)

- [ ] **Step 5.1: Read the current map branch**

Run: `sed -n '405,412p' js/app.js`
Expected:

```javascript
        const vintage = Filters.state.vintages.size === 1 ? [...Filters.state.vintages][0] : null;
        MapStore.currentVintage = vintage;
        MapStore.aggregateBySection(Object.values(latestByLot), vintage);
        MapStore.render();
```

- [ ] **Step 5.2: Replace the `vintage` lookup**

Use the Edit tool to swap one line:

```javascript
        const vintage = Filters.state.mapVintage;
        MapStore.currentVintage = vintage;
        MapStore.aggregateBySection(Object.values(latestByLot), vintage);
        MapStore.render();
```

- [ ] **Step 5.3: Run the full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: no regressions. MT.35 still 6/6.

- [ ] **Step 5.4: Commit**

```bash
git add js/app.js
git commit -m "feat(app): map view reads Filters.state.mapVintage"
```

---

### Task 6: Initialize the picker after data loads

**Files:**
- Modify: `js/app.js` `onDataLoaded` method (around line 251-255 area)

- [ ] **Step 6.1: Read `onDataLoaded`**

Run: `sed -n '251,260p' js/app.js`
Expected:

```javascript
  onDataLoaded() {
    this.initialized = true;
    this.hideDataLoader();

    Filters.init();
```

- [ ] **Step 6.2: Add the two helper calls**

`Filters.init()` already builds vintage chips for berry/wine. The map picker needs two extra calls. Insert them immediately after `Filters.init()`:

```javascript
  onDataLoaded() {
    this.initialized = true;
    this.hideDataLoader();

    Filters.init();
    Filters.buildMapVintageOptions();
    Filters.initMapVintage();
```

- [ ] **Step 6.3: Verify cache-then-Supabase reload also re-initializes**

Run: `grep -n "Filters\.buildVintageChips\|loadFromSupabase.*then\|loadMediciones\.then" js/app.js | head -10`
Background: the cache-then-Supabase flow at `app.js:41-54` calls `this.refresh()` after each async source resolves. Since `initMapVintage` preserves a still-valid pick and only resets when the pick disappears, **calling it once at `onDataLoaded` is enough** — subsequent refreshes don't need to re-init.

However, if `DataStore.getUniqueValues('vintage')` returns a longer list after Supabase load (the cache had only 2025; Supabase has 2025+2026), the picker dropdown options are stale. Add a `buildMapVintageOptions` call to the Supabase-load `.then`:

Run: `sed -n '40,55p' js/app.js`
Locate the `.then(loaded => { if (loaded && this.initialized) this.refresh(); ... })` block. Inside the same `.then`, before the existing `if (loaded && this.initialized) this.refresh();`, add:

```javascript
          if (loaded && this.initialized) {
            Filters.buildMapVintageOptions();
            Filters.initMapVintage();
          }
          if (loaded && this.initialized) this.refresh();
```

(Two `if` blocks — keep them separate for clarity; the runtime cost is one extra branch evaluation.)

- [ ] **Step 6.4: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: no regressions.

- [ ] **Step 6.5: Commit**

```bash
git add js/app.js
git commit -m "feat(app): initialize mapVintage picker on data load + Supabase refresh"
```

---

### Task 7: Demo-mode integration

**Files:**
- Modify: `js/app.js` `toggleDemoMode` (around line 879-896)

- [ ] **Step 7.1: Read `toggleDemoMode`**

Run: `sed -n '879,896p' js/app.js`
Expected output contains: `Filters.buildVintageChips?.()` and similar `.buildXChips?.()` calls.

- [ ] **Step 7.2: Add map-vintage re-init after the chip rebuilds**

Use the Edit tool to add two lines just before `this.refresh();`:

```javascript
    Filters.buildVintageChips?.();
    Filters.buildVarietyChips?.();
    Filters.buildOriginChips?.();
    Filters.buildLotChips?.();
    Filters.buildMapVintageOptions?.();
    Filters.initMapVintage?.();
    this.refresh();
```

The `?.` matches the surrounding style (defensive in case the methods aren't loaded yet during early demo toggling).

- [ ] **Step 7.3: Commit**

```bash
git add js/app.js
git commit -m "feat(app): re-init mapVintage picker when toggling demo mode"
```

---

### Task 8: Build verification + browser smoke

**Files:**
- None modified

- [ ] **Step 8.1: Production build**

Run: `npm run build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 8.2: Start dev server**

Run: `npm run dev > /tmp/dev.log 2>&1 &` (background) then `sleep 3 && curl -sI http://127.0.0.1:8080 | head -1`
Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 8.3: Open the Mapa view in demo mode**

Manually (or via Playwright MCP if available) navigate to `http://127.0.0.1:8080/?demo=1`. Set a fake session token in localStorage (`xanic_session_token = 'fake'`, `xanic_user_role = 'lab'`) and reload. Click "Demo" toggle. Click "Mapa" tab.

Expected:
- Top-right header: a new `<select>` showing the current year (e.g. `2026`) — visible to the left of the metric dropdown.
- Polygons still color the same as before the change (since demo data is single-year).

- [ ] **Step 8.4: Document observations**

Note in the PR body:
- Dropdown appears with one option in demo (demo emits only `currentYear` berry data).
- Polygons unchanged from pre-change baseline (the picker just made the implicit year filter explicit).

- [ ] **Step 8.5: Stop dev server**

Run: `kill $(lsof -ti:8080) 2>/dev/null; true`

---

### Task 9: Push + PR

**Files:**
- None modified

- [ ] **Step 9.1: Push the branch**

Run:

```bash
git push -u origin feat/map-year-filter
```

- [ ] **Step 9.2: Open the PR**

```bash
gh pr create --title "feat(map): single-year picker on Mapa view" --body "$(cat <<'EOF'
## Summary

Adds a single-select year picker to the Mapa view so users can isolate one vintage's quality (and chemistry) per polygon. Previously, the map branch's vintage lookup at `app.js:408` only filtered when exactly one global vintage chip was active — and those chips are hidden on the map view — so all years silently averaged together.

## Changes

- `js/filters.js` — new `state.mapVintage` (single number, default null) plus `buildMapVintageOptions()` and `initMapVintage()` helpers
- `index.html` — `<select id="map-vintage-select">` added to the map header next to the metric dropdown
- `js/events.js` — change handler writes `Filters.state.mapVintage` and triggers refresh
- `js/app.js` — map branch reads the new state slice; demo toggle and Supabase load both re-init the picker
- `tests/mt35-map-year-filter.test.mjs` — 6 unit tests: init picks max, picks only year, picks null, preserves valid pick, resets stale pick, MapStore.aggregateBySection isolates per vintage

## Test plan

- [x] \`npm test\` — green, +6 from MT.35
- [x] \`npm run build\` — clean
- [x] Browser smoke at \`/?demo=1\` → Mapa: picker visible, polygons unchanged

## References

- Spec: docs/superpowers/specs/2026-06-08-map-year-filter-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9.3: Wait for CI**

Run: `sleep 30 && gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus,statusCheckRollup --jq '{mergeable, mergeStateStatus, checks: [.statusCheckRollup[] | {name, conclusion}]}'`
Expected: `mergeable: "MERGEABLE"`, all checks `"SUCCESS"`.

- [ ] **Step 9.4: Squash-merge**

Run: `gh pr merge <PR_NUMBER> --squash --delete-branch`

---

## Self-review checklist

- [ ] `npm test` passes; total = baseline + 6
- [ ] `npm run build` succeeds
- [ ] `git diff main --stat` shows only the allowed files: `index.html`, `js/filters.js`, `js/events.js`, `js/app.js`, `tests/mt35-map-year-filter.test.mjs`
- [ ] No regressions on berry / wine / extraction / vintage / explorer / mediciones / prediccion views (those don't touch `mapVintage`)
- [ ] Demo mode toggles still show the picker on Mapa (Task 7)
- [ ] Cache-then-Supabase load doesn't strand the picker on a vintage no longer present (Task 6, Step 6.3)
