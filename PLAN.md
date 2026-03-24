# Plan — Phase 5: Vineyard Quality Map — Fix Remaining Review Issues

TASK.md goal is complete in structure: nav option, `#view-map` DOM, `<script>` tag, routing in `app.js`, CSS, CONFIG entries, and `maps.js` all wired up. The map renders for MX, K, and VA ranches.

REVIEW.md (Round 2) identified 7 remaining issues. This plan addresses all of them.

---

## Stage 1 — Priority 1 Fixes (correctness bugs)

### 1a. `cleanupLabSamples` — wrap in try/finally
**File:** `js/upload.js` lines 319–377

**Problem:** If any `await` throws, `_uploading` stays `true` forever.

**Fix:** Wrap the body (lines 323–376) in `try { ... } finally { this._uploading = false; }` and remove the standalone `this._uploading = false` on line 375.

### 1b. Remove `pctAcceptable` KPI — it's never computed
**Files:** `js/maps.js` line 395, `index.html` line 604

**Problem:** `getRanchKPIs` computes `avgPctAcceptable` from a field that doesn't exist on berry data. The "% Aceptable" KPI card always shows "—".

**Fix:**
- `js/maps.js`: Remove `avgPctAcceptable` from `getRanchKPIs` return object (line 395). Remove `el('map-kpi-acceptable', ...)` from `_updateKPIs` (line 437).
- `index.html`: Remove the `map-kpi-acceptable` KPI card (line 604).

---

## Stage 2 — Priority 2 Improvements

### 2a. Replace "Tonelaje" KPI with "Muestras" (sample count)
**Files:** `js/maps.js` lines 67, 372, 432; `index.html` line 599

**Problem:** Berry data has no `tonnage` field — the "Tonelaje" KPI always shows `0.0`.

**Fix:**
- `index.html`: Change label from "Tonelaje" to "Muestras".
- `js/maps.js` `_updateKPIs`: Display total lot count instead of tonnage. Rename the return field.

### 2b. Replace "Ton" column in detail lot table with "tANT"
**File:** `js/maps.js` line 338

**Problem:** Lot table shows "Ton" column with tonnage, which berry data doesn't have.

**Fix:** Replace `<th>Ton</th>` with `<th>tANT</th>` and render `lot.tANT` instead of `lot.tonnage`.

### 2c. Fix Kompali suffix regex — strip `-\d+` before named suffixes
**File:** `js/maps.js` line 35

**Problem:** Lot codes like `KCS-S8-2-CONT` → `S8-2` (after `-CONT` strip) → `K-S8-2` instead of `K-S8`. The named suffix is stripped first, but the numeric sub-lot suffix remains.

**Fix:** Change line 35 to strip numeric sub-lot AFTER named suffixes:
```js
section = section.replace(/-(CONT|BIO|MAT|ABA|BIOTEKSA|R|RALEO|ALIVIO)$/i, '').replace(/-\d+$/, '');
```
This ensures `S8-1-CONT` → `S8-1` → `S8`, and `S8-2` → `S8`.

### 2d. Add missing `vineyardSections` entries for ON, OLE, 7L, DUB, DA
**File:** `js/config.js` after line 690

**Problem:** `fieldLotToSection` maps to section IDs like `ON-3`, `OLE-1`, `7L-2`, `DUB-1`, `DA-L13` but `vineyardSections` has no entries for these ranches. Clicking their tabs shows "Sin secciones".

**Fix:** Add section entries for each ranch. Data from PLAN.md Step 1 tables + `fieldLotToSection` keys:

```
ON:  ON-1 (Merlot), ON-2 (Malbec), ON-3 (CS), ON-4 (Syrah), ON-5 (Tempranillo), ON-6 (Grenache)
OLE: OLE-1 (CS), OLE-2 (CS), OLE-3 (Viognier)
7L:  7L-1 (Chenin Blanc), 7L-2 (Syrah)
DUB: DUB-1 (Malbec / Syrah)
DA:  DA-L5 (Syrah), DA-L13 (Syrah)
```

Also add `_layoutGrid` support for these (already handled by the `default` case in `_getLayout`).

### 2e. Avoid re-rendering ranch tabs on every `render()` call
**File:** `js/maps.js` lines 407–416, 420–421

**Problem:** `render()` always calls `_renderRanchTabs()` which rebuilds innerHTML, causing flash/repaint.

**Fix:** Track last-rendered ranch list. Only rebuild tabs when the set of ranch codes changes. Always update the `active` class without full re-render:
```js
render() {
  this._updateTabActive();  // just toggle .active class
  this.generateSVG(this.currentRanch, 'map-svg-container');
  this.renderLegend('map-color-scale');
  this._updateKPIs();
}
```
Move the full tab HTML generation to an `init()` or first-render check.

---

## Stage 3 — Verification

Manual checks (from REVIEW.md):
1. Navigate to Mapa → MX sections render with Brix colors
2. Switch metric → map recolors correctly
3. Click section → detail panel shows Brix, pH, AT, tANT, Peso Baya
4. Switch to ON, OLE, 7L, DUB, DA → sections render (not "Sin secciones")
5. Console: `MapStore.resolveSection('CSMX-5B-1')` → `MX-5B`
6. Console: `MapStore.resolveSection('KCS-S8-2-CONT')` → `K-S8` (after fix 2c)
7. Disconnect Supabase → call `cleanupLabSamples()` → `_uploading` resets (after fix 1a)
8. Mobile 375px → stacked layout, scrollable tabs, touch targets

---

## Files to modify

| File | Changes |
|---|---|
| `js/upload.js` | try/finally around `cleanupLabSamples` body |
| `js/maps.js` | Remove pctAcceptable, replace tonnage with sample count, fix lot table column, fix suffix regex order, optimize tab rendering |
| `js/config.js` | Add vineyardSections for ON, OLE, 7L, DUB, DA |
| `index.html` | Remove "% Aceptable" KPI card, rename "Tonelaje" → "Muestras" |
| `css/styles.css` | No changes needed |

## Files to avoid

- `js/charts.js`, `js/filters.js`, `js/dataLoader.js`, `js/weather.js` — unrelated
- `api/*` — no backend changes
