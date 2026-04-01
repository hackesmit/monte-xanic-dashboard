# Plan — Round 7 User-Testing Bug Fixes

## Status: WAVE 1 IN PROGRESS — 11 DYNAMIC HANDLERS REMAIN

**Source:** First production data update by winery staff (2026-03-31). Nine issues + 1 critical SyntaxError discovered.
**Diagnostics:** REVIEW.md Sections 14–17
**Task tracking:** TASK.md
**Branch:** `feature/csp-inline-handler-migration`

### Critical fix applied this session
- **17.7 FIXED:** `api/upload.js` had duplicate `const supabaseUrl` declaration (lines 48 + 87) — fatal SyntaxError that killed the entire upload endpoint. All uploads silently failed. Removed duplicate, reused vars from blacklist block.

---

## Wave 1 — CSP Fix + Export Repair (blocks everything else)

### Wave 1a — Static inline handler migration ✅ DONE (commit 31a7062)
- Created `js/events.js` — 166 lines, 71 `addEventListener` bindings replacing all `index.html` inline handlers
- Navigation, auth, UI controls, upload, explorer, filters, chart exports, table sorting, evolution toggles
- Event delegation used for chart exports (document-level click) and evolution toggles (container change)

### Wave 1b — index.html cleanup ✅ DONE (commits 31a7062 + 2287b96)
- All `onclick=`, `onchange=`, `onsubmit=` removed from `index.html` (verified: 0 matches)
- `data-*` attributes added for delegation (view, grape-type, clear, mode, chart-id, chart-title, etc.)
- `<script src="js/events.js">` added
- Nav dropdown replaced with tap-friendly button tabs (`#nav-tabs` container)

### Wave 1c — App wiring ✅ DONE (commit 31a7062)
- `Events.bindAll()` called at `js/app.js:80`

### Wave 1d — CSP connect-src ✅ DONE (commit 31a7062)
- `vercel.json` CSP `connect-src` updated: added `https://archive-api.open-meteo.com`

### Wave 1e — Dynamic inline handlers in JS ❌ NOT STARTED
**11 inline handlers remain in 3 JS files** — all in template literal strings that build HTML at runtime. Still blocked by CSP on Vercel.

| File | Line | Handler | What it does |
|------|------|---------|-------------- |
| `js/maps.js` | 162 | `onclick="MapStore.showDetail('${sectionId}')"` | SVG section click → show detail panel |
| `js/maps.js` | 241 | `onclick="MapStore.hideDetail()"` | Detail panel close button |
| `js/maps.js` | 352 | `onclick="MapStore.setRanch('${code}')"` | Ranch tab button click |
| `js/explorer.js` | 207 | `onclick="Explorer.toggleConfig(${sid})"` | Toggle config panel |
| `js/explorer.js` | 209 | `onclick="Explorer.removeChart(${sid})"` | Remove chart slot |
| `js/explorer.js` | 214 | `onchange="Explorer.onSourceChange(${sid})"` | Source select change |
| `js/explorer.js` | 230 | `onchange="Explorer.onChartTypeChange(${sid})"` | Chart type select change |
| `js/explorer.js` | 239 | `onclick="Explorer.renderSlot(${sid})"` | Render/update chart |
| `js/charts.js` | 1059 | `onclick="Charts.toggleSeries('${safeLabel}')"` | Legend item click → toggle series |
| `js/charts.js` | 1066 | `onclick="this.parentElement.classList.toggle('legend-show-all')"` | Legend "expand" click |
| `js/charts.js` | 1072 | `onclick="Charts.toggleSeries('${safeLabel}')"` | Overflow legend item click |

**Fix approach:** Event delegation on parent containers. Each file gets delegated listeners:
- `maps.js` — delegate on `#map-container` for clicks on `[data-section]`, `.detail-close`, `[data-ranch]`
- `explorer.js` — delegate on `#explorer-container` for clicks on `.explorer-toggle-btn`, `.explorer-remove-btn`, `.explorer-render-btn` and change on `.explorer-select`
- `charts.js` — delegate on `.legend-bar` parents for clicks on `.legend-item` (use `data-series` attr)

Remove all `onclick=`/`onchange=`/`onkeydown=` from template strings. Replace with `data-*` attributes.

### Wave 1f — Export fix ❌ NOT STARTED
| Task | Files | Description |
|------|-------|-------------|
| 1f-i | `js/charts.js` | Add jsPDF load guard: check `window.jspdf` before calling, show Spanish toast if missing |
| 1f-ii | `js/charts.js` | Add `onerror` handler on `new Image()` in PNG export path |
| 1f-iii | `js/charts.js` | Spanish error toasts on all export failure paths |

**Validation:** Deploy to Vercel preview → all views navigate, weather loads, map works, explorer works, legend clicks work, export buttons produce files.

---

## Wave 2 — Lot Connection + Legends + Colors

| Task | Files | Description |
|------|-------|-------------|
| 2a | `js/charts.js` | **Per-lot line segments in scatter charts:** Within each variety/origin dataset, sort points by `lotCode` then `daysPostCrush`. Draw thin semi-transparent lines connecting points of the same `lotCode`. Only the true last point per lot gets golden `#DDB96E` border. |
| 2b | `js/charts.js` | **Enable Chart.js native legends** on scatter charts (`legend: { display: true }`). Remove or keep HTML legend bar as secondary. Native legend renders inside canvas → visible in PNG/PDF exports. |
| 2c | `js/config.js` | **Redistribute varietal colors.** Target ≥30 CIELAB ΔE between any two colors. Specific fixes: Cab Franc → distinct blue-red, Tempranillo → warm orange, Marselan → deep rose, whites spread across green/gold/coral/blue spectrum. |
| 2d | `index.html` | **Add 4 missing export buttons** for origin comparison charts (`chartOriginBrix`, `chartOriginAnt`, `chartOriginPH`, `chartOriginTA`) — use `data-chart-id` and `data-chart-title` attrs (CSP-safe, delegated via `events.js`) |

**Validation:** Upload test data with 3+ measurements per lot → verify lines connect same-lot points. Export PNG → verify legend + colors visible. Compare any two varietal colors visually.

---

## Wave 3 — Weather: GDD Chart + Location Filter

| Task | Files | Description |
|------|-------|-------------|
| 3a | `index.html` | Add valley selector dropdown (VDG / VON / SV) in weather section header. Add GDD chart container `<canvas id="chartGDD">` with export button. |
| 3b | `js/filters.js` | Add `state.weatherLocation` (default `'VDG'`). Add change handler that triggers weather chart re-render. |
| 3c | `js/charts.js` | **GDD cumulative chart:** Line chart showing GDD accumulation from Jul 1 through current date, one line per valley (or single line for selected valley). Uses `WeatherStore.getCumulativeGDD()`. X-axis: day of season. Y-axis: cumulative GDD (°C). |
| 3d | `js/charts.js` | **Pass location to all weather charts:** `createWeatherTimeSeries()`, `createRainfallChart()`, harvest calendar overlay — all must pass `Filters.state.weatherLocation` to `WeatherStore.getRange()`. |
| 3e | `js/charts.js` | Update weather section header text dynamically based on selected valley. |

**Validation:** Switch valley dropdown → all weather charts update. GDD chart shows accumulation curve. Header reflects selected valley.

---

## Wave 4 — Data Integrity + Cleanup

| Task | Files | Description |
|------|-------|-------------|
| 4a | `sql/migration_sample_seq.sql`, `js/upload.js`, `api/upload.js`, `js/charts.js` | **Same-day duplicate handling (DECISION CONFIRMED: Option B — `sample_seq`):** (1) SQL migration: add `sample_seq INTEGER NOT NULL DEFAULT 1` to `wine_samples`, drop old unique on `(sample_id, sample_date)`, create new unique on `(sample_id, sample_date, sample_seq)`, set existing rows to seq=1. (2) `upload.js`: group parsed rows by `(sample_id, sample_date)`, sort deterministically within group (by source time if available, else by value fingerprint: tANT→pH→berry_weight), assign seq=1,2,3. (3) `api/upload.js`: change conflict key to `'sample_id,sample_date,sample_seq'`. (4) `charts.js`: add `+ (sample_seq - 1) * 0.15` day offset to `daysPostCrush` for display. Tooltip shows real value. Re-uploads are idempotent (same batch → same sort → same seqs → upsert overwrites). |
| 4b | `js/charts.js` | **Cross-lot jitter for overlapping points:** Add ±0.2 day deterministic offset based on hash of `sampleId` to prevent pixel stacking for different lots on same day. (Same-lot same-day overlap handled by 4a's `sample_seq` offset.) Tooltip still shows true `daysPostCrush`. |
| 4c | `js/app.js` | **Extraction table respects filters** (14.1): Pass `cleanBerry` and `filteredWineExt` instead of raw `DataStore` data. |
| 4d | `api/config.js` | **Add blacklist check** (14.2): Verify token against `token_blacklist` table before returning Supabase credentials. |
| 4e | `.vercelignore` | Add `PLAN.md`, `TASK.md`, `REVIEW.md`, `REPORTE_DASHBOARD.txt` |

**Validation:** Upload CSV with same-day duplicate measurements → both preserved. Filter by variety → extraction table matches charts. Revoke token → `/api/config` returns 401.

---

## Wave 5 — Security Hardening (parallel, lower priority)

| Task | Files | Description |
|------|-------|-------------|
| 5a | `api/lib/verifyToken.js` (new) | Extract shared token verification (HMAC + expiry + blacklist check) used by all 4 API endpoints (14.3) |
| 5b | `api/upload.js` | Use server-side `tableConfig.conflict` instead of client-provided value (14.9) |
| 5c | `api/upload.js`, `api/verify.js`, `api/logout.js`, `api/config.js` | Add rate limiting to all authenticated endpoints (14.8) |
| 5d | `css/styles.css` | Delete ~70 lines dead CSS (14.5): `.brand-*` block, `.extraction-grid` block |

---

## Dependencies

```
Wave 1a–d ✅  ──► Wave 1e (dynamic handlers) ──► Wave 1f (export fix)
                                                       │
                                                       ▼
                                              Wave 2 (lots + legends + colors)
                                                       │
                                                       ▼
                                              Wave 3 (weather GDD + location)

Wave 4 (data integrity) can run in parallel after Wave 1
Wave 5 (security) can run in parallel after Wave 1
```

- **Wave 1e MUST complete next** — 11 dynamic handlers still break maps, explorer, and legend interactions on Vercel
- Wave 1f (export) depends on 1e (chart export buttons and legend clicks must work first)
- Waves 2 and 3 depend on Wave 1 complete (export and charts must work)
- Wave 4 can start after Wave 1 (data fixes independent of chart changes)
- Wave 5 is independent, lowest priority

---

## User Decisions — Resolved

**16.3 — Duplicate date handling:** ✅ DECIDED — Option B (`sample_seq` integer column).
- Row-order-within-batch + deterministic sort. Idempotent on re-upload.
- Future multi-source upload architecture (dedicated paths per source) eliminates the separate-file edge case.
- See REVIEW.md 16.3 for full edge case analysis.

---

## After This

Phase 7 (Mediciones Tecnicas con Evidencia Fotografica) remains the next major feature — architecture designed, awaiting user decision after Round 7 stabilization.
