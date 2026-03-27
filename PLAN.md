# Plan — Workflow 3: Visualization Improvements

## Status: ALL ITEMS IMPLEMENTED

All 4 visualization tasks (V1–V4) have been implemented. Two bugs (duplicate nav option, unreachable switch case) were found and fixed during verification.

---

## Implemented Items

| Task | Description | Status |
|------|-------------|--------|
| V1 | Replace doughnut with horizontal bar (Muestras por Origen) | DONE — `charts.js:435` |
| V2 | Extraction % chart with quality bands | DONE — `charts.js:695` |
| V3 | Wine phenolics chart (Fenólicos por Varietal) | DONE — `charts.js:816` |
| V4 | Sample count (n=) in varietal bar labels | DONE — `charts.js:312` |

## Bug Fixes (found during verification)

| Bug | Fix |
|-----|-----|
| Duplicate `<option value="map">Mapa</option>` in nav-select | Removed second duplicate in `index.html` |
| Unreachable duplicate `case 'map':` in `App.refresh()` | Removed dead code block in `app.js` (first case uses filtered data correctly) |

---

## Acceptance Criteria (all met)

- [x] V1: Origin distribution shows as horizontal bar (not doughnut), sorted by count descending
- [x] V2: Extraction view has a % bar chart color-coded by quality band
- [x] V3: Wine view has at least one chart showing phenolics by variety
- [x] V4: Varietal bar chart labels include sample count (n=)
- [x] All new charts handle empty data with Spanish "Sin datos" message
- [x] All new charts are mobile responsive (`maintainAspectRatio: false`)
- [x] All new charts support PNG export (export buttons in index.html)
- [x] All new charts respect dark/light theme via `_applyThemeToCharts()`

## Files Modified (this session)

| File | Changes |
|------|---------|
| `index.html` | Removed duplicate Mapa nav option |
| `js/app.js` | Removed unreachable duplicate `case 'map':` block |

## Open Items (REVIEW.md — not in scope)

| ID | Severity | Category |
|----|----------|----------|
| 4.1 | Critical | Security (client-only upload auth) — needs server-side endpoint |
| 4.4 | Medium | Security (ephemeral rate limit) — needs Supabase/KV |
| 4.5 | Medium | Security (no token revocation) — needs token blacklist |

## Remaining Work

- [ ] Visual verification via browser
- [ ] Commit Workflow 3 changes
- [ ] Delete `test-diag.js` and `test-results/` (diagnostic artifacts)
