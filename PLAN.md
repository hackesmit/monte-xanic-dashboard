# Plan — Round 7+ User-Testing Bug Fixes & Stabilization

## Status: WAVES 1–2 COMPLETE (uncommitted) — WAVE 3 NEXT — 11 open items across Waves 3–5

**Source:** First production data update by winery staff (2026-03-31). Nine issues + 1 critical SyntaxError discovered. Subsequent code reviews (Rounds 8–9) found additional items.
**Diagnostics:** REVIEW.md Sections 14–18
**Task tracking:** TASK.md
**Branch:** `feature/csp-inline-handler-migration`

---

## Completed Work

### Wave 1 — CSP Fix + Export Repair ✅ COMMITTED (31a7062, 2287b96, bb288a5)
- Created `js/events.js` — 237 lines, all event delegation
- 71 static inline handlers migrated from `index.html`
- 11 dynamic inline handlers migrated from `maps.js`, `explorer.js`, `charts.js`
- Nav dropdown → tap-friendly button tabs
- CSP `connect-src` updated for `archive-api.open-meteo.com`
- Export fix: jsPDF guard, Image onerror, try/catch, 7 Spanish error toasts
- `api/upload.js` duplicate `const supabaseUrl` SyntaxError fixed
- **Zero inline handlers remain in codebase**

### Wave 2 — Lot Connection + Legends + Colors ✅ CODE DONE — NOT YET COMMITTED
- 2a: `_lotLinePlugin` Chart.js plugin draws thin semi-transparent lines connecting same-lot points. `_identifyLastPoints` returns `lotCode→maxDPC` map. Only true last point per lot gets golden border + larger radius.
- 2b: Native Chart.js legends on scatter charts (bottom position, themed, onClick → `toggleSeries()`). Visible in PNG/PDF exports. HTML legend bar kept for mobile.
- 2c: 10 varietal colors redistributed: Cab Franc→indigo, Tempranillo→orange, Marselan→deep rose, Grenache→true red, Caladoc→lavender, Malbec→blue, Petit Verdot→teal, whites→green/gold/coral/cyan.
- 2d: 4 export buttons added to origin comparison charts with CSP-safe `data-*` attrs.

**Files with uncommitted changes:** `index.html`, `js/charts.js`, `js/config.js`, `PLAN.md`, `REVIEW.md`, `TASK.md`

---

## Next Steps (in order)

### Step 0 — Commit + Push Wave 2 (immediate)
Commit uncommitted Wave 2 changes, push branch to remote.

### Wave 3 — Weather: GDD Chart + Location Filter

| Task | Files | Description |
|------|-------|-------------|
| 3a | `index.html` | Add valley selector dropdown (VDG / VON / SV) in weather section header. Add GDD chart container `<canvas id="chartGDD">` with export button. |
| 3b | `js/filters.js` | Add `state.weatherLocation` (default `'VDG'`). Add change handler that triggers weather chart re-render. |
| 3c | `js/charts.js` | **GDD cumulative chart:** Line chart showing GDD accumulation from Jul 1 through current date, one line per valley (or single line for selected valley). Uses `WeatherStore.getCumulativeGDD()`. X-axis: day of season. Y-axis: cumulative GDD (°C). |
| 3d | `js/charts.js` | **Pass location to all weather charts:** `createWeatherTimeSeries()`, `createRainfallChart()`, harvest calendar overlay — all must pass `Filters.state.weatherLocation` to `WeatherStore.getRange()`. |
| 3e | `js/charts.js` | Update weather section header text dynamically based on selected valley. |

**Validation:** Switch valley dropdown → all weather charts update. GDD chart shows accumulation curve. Header reflects selected valley.

### Wave 4 — Data Integrity + Quick Fixes

| Task | Files | Description | Effort |
|------|-------|-------------|--------|
| 4a | `sql/migration_sample_seq.sql`, `js/upload.js`, `api/upload.js`, `js/charts.js` | **Same-day duplicate handling:** Add `sample_seq` column, new unique on `(sample_id, sample_date, sample_seq)`, deterministic seq assignment in upload, `+ (sample_seq - 1) * 0.15` day offset in charts. | Medium |
| 4b | `js/charts.js` | **Cross-lot jitter:** ±0.2 day deterministic hash offset for different lots on same day. | Low |
| 4c | `js/app.js` | **Extraction table respects filters** (14.1): Pass filtered data instead of raw DataStore. | Low |
| 4d | `api/config.js` | **Add blacklist check** (17.1): Verify token against `token_blacklist` before returning Supabase credentials. | Low |
| 4e | `.vercelignore` | Add `PLAN.md`, `TASK.md`, `REVIEW.md`, `REPORTE_DASHBOARD.txt` (17.3). | Trivial |
| 4f | `js/events.js`, `js/auth.js` | **Fix duplicate login listener** (18.1+18.2): Remove `#login-form` submit from `Events._bindAuth()`. Remove `#login-btn` click from `Auth.bindForm()`. | Trivial |

**Validation:** Upload CSV with same-day duplicates → both preserved. Filter variety → extraction table matches charts. Revoke token → `/api/config` returns 401. Logout → re-login → exactly 1x POST to `/api/login`.

### Wave 5 — Security Hardening + Cleanup

| Task | Files | Description | Effort |
|------|-------|-------------|--------|
| 5a | `api/lib/verifyToken.js` (new) | Extract shared token verification (HMAC + expiry + blacklist) used by all 4 API endpoints (14.3). | Medium |
| 5b | `api/upload.js` | Use server-side `tableConfig.conflict` instead of client-provided value (14.9). | Trivial |
| 5c | `api/upload.js`, `api/verify.js`, `api/logout.js`, `api/config.js` | Add rate limiting to all authenticated endpoints (14.8). | Medium |
| 5d | `css/styles.css` | Delete ~70 lines dead CSS: `.brand-*` block, `.extraction-grid` block (14.5). | Trivial |

---

## Dependencies

```
Wave 1 ✅  ──► Wave 2 ✅  ──► Step 0 (commit + push)
                                  │
                          ┌───────┼───────┐
                          ▼       ▼       ▼
                       Wave 3  Wave 4  Wave 5
                       (weather)(data)  (security)
                          │       │       │
                          └───────┼───────┘
                                  ▼
                            PR to main
                                  │
                                  ▼
                         Phase 7 (Mediciones)
```

- **Waves 3, 4, 5 are independent** — can run in parallel or any order
- Wave 4a (sample_seq) requires Supabase migration before upload testing
- Wave 5a (shared verifyToken) should precede 5c (rate limiting on all endpoints)
- PR to main after all waves complete and validated on Vercel preview

---

## User Decisions — Resolved

**16.3 — Duplicate date handling:** ✅ DECIDED — Option B (`sample_seq` integer column).
- Row-order-within-batch + deterministic sort. Idempotent on re-upload.
- See REVIEW.md 16.3 for full edge case analysis.

---

## After This Branch

**Phase 7 — Mediciones Técnicas con Evidencia Fotográfica** remains the next major feature.
- Architecture designed in CLAUDE.md (reserved schema for `mediciones_tecnicas` + `medicion_fotos`)
- Cloudflare R2 for photos, Supabase for metadata
- Scope: ~110 mediciones, ~1,100 photos (~2-3GB in R2)
- Blocked by: all Waves 3–5 complete + PR merged to main
