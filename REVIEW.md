# Code Review — Uncommitted Changes (Round 2)

> Reviewing diff: `index.html`, `js/app.js`, `js/charts.js`, `PLAN.md`, `package.json` (staged), `.claude/settings.local.json`
> Scope: 3 new chart functions, 1 chart replacement (doughnut → bar), 2 duplicate removals, minor HTML additions

---

## Priority 1 Issues

### 1a. Duplicated extraction pair-building logic — divergence risk
**Files:** `js/charts.js:695–732` (new) vs `js/charts.js:580–618` (existing)

`createExtractionPctChart` copy-pastes ~40 lines of berry↔wine pair matching from `createExtractionChart`. The two copies already differ:
- **New** checks `berry.tANT > 0` before pushing a pair (line 722) — correct, prevents division by zero.
- **Original** does NOT check `berry.tANT > 0` — so `berry.tANT === 0` gets through and produces `Infinity%` in the extraction tooltip (line 614: `((wine.antoWX / berry.tANT) * 100).toFixed(1)`).

The original chart has a latent bug that the new chart avoids. Any future fix to one copy risks being missed in the other. Extract to a shared `_buildExtractionPairs(berryData, wineData)` helper.

### 1b. Extraction % values can exceed 100% — unclamped
**File:** `js/charts.js:723`

```js
const pct = (wine.antoWX / berry.tANT) * 100;
```

If wine tANT exceeds berry tANT (possible due to measurement timing or concentration), `pct` > 100. The chart x-axis is hard-capped at `max: 100` (line 803), so bars would be clipped without visual indication that data overflows. Consider either:
- Removing `max: 100` to let Chart.js auto-scale, or
- Clamping values with `Math.min(pct, 100)` and marking overflow visually.

---

## Priority 2 Improvements

### 2a. Good fix: duplicate `<option value="map">` removed
**File:** `index.html:121` (deleted line)

The committed code had two `<option value="map">Mapa</option>` entries (lines 119 and 121). The diff correctly removes the duplicate. This is a bug fix — the duplicate caused two "Mapa" entries in the mobile view selector.

### 2b. Good fix: duplicate `case 'map'` block removed
**File:** `js/app.js:358–364` (deleted block)

The committed code had two `case 'map'` blocks in the `refresh()` switch. The second (simpler) one at line 354 was unreachable because JS falls through to the first match. The retained block at line 333 has the full implementation with berry→MapStore bridging. Correct removal.

### 2c. Wine phenolics chart: sparse data may produce misleading averages
**File:** `js/charts.js:822–826`

The compounds use keys `antoWX`, `freeANT`, `pTAN`, `iptSpica`. Data filtering is correct (only non-NaN numbers included). However, `freeANT` and `pTAN` may have very few measurements for some varieties. Consider showing `n=` in the tooltip like the berry bar charts already do, so users know when an average is based on 1–2 measurements.

### 2d. Untracked test artifacts should be gitignored
**Files:** `test-diag.js`, `test-results/`

Playwright test scripts and screenshots. Should be added to `.gitignore`:
```
test-diag.js
test-results/
```

### 2e. `stepSize: 1` on origin count chart x-axis
**File:** `js/charts.js:459`

Forces integer tick marks. Works well for small counts, but if a vineyard has hundreds of samples, Chart.js will attempt to render every integer on the axis. Remove `stepSize: 1` and let Chart.js auto-scale.

### 2f. `package.json` adds `@playwright/test` as devDependency (staged)
**File:** `package.json`

Appropriate for testing. Note CLAUDE.md says "Never introduce npm packages or build tools" — this is dev-only and doesn't affect the CDN-only production build. Acceptable, but confirm intentional.

### 2g. `createDoughnut` renamed — stale reference in TASK.md
**File:** `TASK.md:65`

`createDoughnut()` was renamed to `createOriginCountBar()`. No JS references remain, but TASK.md still mentions the old name.

---

## Missing Tests

No automated tests for the new chart functions. Manual verification checklist:

1. **Bayas** → origin chart renders as horizontal bar (not doughnut), sorted descending
2. **Vino** → "Fenólicos por Varietal" grouped bar shows tANT/fANT/pTAN/IPT per variety
3. **Extracción** → both "tANT: Baya vs Vino" and "Tasa de Extracción (%)" charts render
4. Filter by variety → all three new charts respond to filter changes
5. Empty state → each chart shows Spanish "no data" message
6. Mobile selector → only one "Mapa" option appears (duplicate removed)

---

## Notes

- **Diff size:** ~443 insertions / 408 deletions across 6 files. Most additions are new chart code; deletions are PLAN.md simplification and REVIEW.md rewrite.
- **Duplicate removals (2a, 2b):** Both are genuine bug fixes — duplicate nav option and unreachable switch case. No behavior change since JS used the first match anyway, but cleaner.
- **No destructive changes:** The `createDoughnut` → `createOriginCountBar` rename removes the old method but nothing else called it.
- **`.claude/settings.local.json`:** 77 new permission lines. Local editor config — no project impact.
- **PLAN.md:** Detailed action plan replaced with completion summary. Appropriate since all items are resolved; old plan is in git history.
