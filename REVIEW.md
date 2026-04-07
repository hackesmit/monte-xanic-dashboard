# Code Review — Monte Xanic Dashboard

> All findings from Rounds 1–9 have been resolved. Waves 1–5 merged to main as of 2026-04-06.
> See TASK.md for the complete resolution table.
> Read `CLAUDE.md` first for full project context.
> **Do NOT modify files outside the scope of each fix.**

---

## 1. DATA INTEGRITY

### 1.1 Silent failure on headerless CSV upload — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Data Integrity
- **FILE:LINE:** `js/upload.js:40-43`
- **DESCRIPTION:** `parseWineXRay()` now validates headers against `CONFIG.wxToSupabase` keys. Returns `{ error: 'no_headers' }` if zero match. `handleUpload()` shows: "Archivo sin encabezados reconocidos. Verifique el formato WineXRay."

### 1.2 Fragile 2-digit vintage extraction — FIXED
- **SEVERITY:** ~~Low~~ Resolved
- **CATEGORY:** Data Integrity
- **FILE:LINE:** `js/upload.js:88-91`, `js/upload.js:130-133`, `js/upload.js:158-161`
- **DESCRIPTION:** All 3 vintage extraction sites now validate the computed year is in range `[2015, 2040]`. Out-of-range values set `vintage_year = null`.

### 1.3 below_detection regex — NO BUG
- **FILE:LINE:** `js/upload.js:8`
- **DESCRIPTION:** `/^<\s*\d+(\.\d+)?$/` correctly matches both `< 50` (space) and `<50.5` (decimal). No fix needed.

### 1.4 Pagination — NO BUG
- **FILE:LINE:** `js/dataLoader.js:99-113`
- **DESCRIPTION:** `range(from, from + PAGE - 1)` with `PAGE=1000` is correct (Supabase range is inclusive). When exactly 1000 rows are returned, it fetches the next page which returns 0 and breaks. No off-by-one.

### 1.5 Cache TTL — NO BUG
- **FILE:LINE:** `js/dataLoader.js:499`
- **DESCRIPTION:** 7-day TTL check `Date.now() - cache.ts > 7 * 24 * 60 * 60 * 1000` works correctly.

### 1.6 normalizeAppellation — NO BUG
- **FILE:LINE:** `js/config.js:107-126`
- **DESCRIPTION:** All ranches from CLAUDE.md are covered by `appellationFixes` + `_resolveRanchFromCode`. Includes K* prefix for Kompali, all code mappings (MX, OLE, 7L, R14, VA, ON, DA, DLA, DUB, LLC, SG, UC), and mojibake repair.

---

## 2. RACE CONDITIONS

### 2.1 Concurrent refresh from cache + Supabase load — FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** Race Condition
- **FILE:LINE:** `js/app.js:268-352`
- **DESCRIPTION:** Guard flag `_refreshInProgress` + `_refreshPending` pattern with proper `try/finally` (line 272 try, line 340 finally). Guard reset and pending re-run both inside finally block.

### 2.2 IntersectionObserver not disconnected on view switch — FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** Race Condition / Memory Leak
- **FILE:LINE:** `js/app.js:235-240`
- **DESCRIPTION:** `setView()` now calls `Charts._lazyObserver.disconnect()`, clears `_lazyQueue`, and calls `Charts._pruneOrphans()` before rendering the new view.

### 2.3 Weather sync partial failure + concurrent calls — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Race Condition
- **FILE:LINE:** `js/weather.js:42-47`
- **DESCRIPTION:** `_isSyncing` guard flag added with proper `try/finally` (line 47). In-memory state now only updates after confirmed DB upsert success. Concurrent calls return early.

### 2.4 Render fires after canvas hidden — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Race Condition
- **FILE:LINE:** `js/charts.js:1192-1203`
- **DESCRIPTION:** Observer callback now checks `entry.target.closest('.view-panel')` for `active` class before calling `job.fn()`. Combined with 2.2 fix (disconnect on view switch), stale renders are fully prevented.

### 2.5 Refresh during paginated Supabase load — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Race Condition
- **FILE:LINE:** `js/app.js:17-32`
- **DESCRIPTION:** Cache-hit path fires `refresh()` synchronously, then starts async Supabase load. The refresh guard (2.1) prevents overlapping refreshes with try/finally ensuring the flag always resets. `loadFromSupabase()` awaits all pages before returning, so the background refresh only fires with complete data.

---

## 3. FILTER STATE CONSISTENCY

### 3.1 Stale lot IDs persist in Filters.state.lots — FIXED
- **SEVERITY:** ~~Critical~~ Resolved
- **CATEGORY:** Filter State
- **FILE:LINE:** `js/filters.js:347-358`
- **DESCRIPTION:** `getFiltered()` now validates lot selections against data filtered without the lot filter. Stale lots are auto-removed from `state.lots` and their chip CSS class is cleared. Set deletion during `for...of` iteration is spec-safe.

### 3.2 Filter state not visually confirmed on view return — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Filter State / UX
- **FILE:LINE:** `js/app.js:261`, `js/filters.js:373-386`
- **DESCRIPTION:** `setView()` now calls `Filters.syncChipUI()` which toggles `.active` class on all chip containers (berry + wine) to match current filter state Sets. Also mitigates the pre-existing `clearAll()` broad `.chip` selector issue.

### 3.3 clearAll() resets grapeType and colorBy — NO BUG
- **FILE:LINE:** `js/filters.js:185-201`
- **DESCRIPTION:** `clearAll()` correctly resets `grapeType` to `'all'` and `colorBy` to `'variety'`. Working as intended.

### 3.4 Filter preservation across view switch — WORKS CORRECTLY
- **DESCRIPTION:** Scenario (Vintage 2024 + Syrah -> Wine -> back to Berry) preserves both filters because `Filters.state` and `Filters.wineState` are independent objects. This is by design but contributes to 3.2.

---

## 4. AUTH & SECURITY

### 4.1 Client-only upload role check — no server-side validation
- **SEVERITY:** Critical
- **CATEGORY:** Security / Privilege Escalation
- **FILE:LINE:** `js/auth.js:130-136`, `js/upload.js:186`
- **DESCRIPTION:** Upload role is enforced only on the client. `Auth.canUpload()` hides the UI, but `UploadManager.handleUpload()` has no role check and makes direct Supabase calls. An attacker with DevTools can call `UploadManager.handleUpload(file, el)` directly, inserting arbitrary data.
- **REPRODUCTION:** Open DevTools. Run: `Auth.role = 'lab'; UploadManager.handleUpload(maliciousFile, document.getElementById('loader-status'))`.
- **SUGGESTED FIX:** Create a server-side `/api/upload` endpoint that validates token role before allowing inserts. Update Supabase RLS policies to require authenticated claims.

### 4.2 IP spoofing bypasses rate limiting — FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** Security / Rate Limit Bypass
- **FILE:LINE:** `api/login.js:32-33`
- **DESCRIPTION:** IP extraction now prefers `x-real-ip` (set by Vercel), falls back to `x-forwarded-for` split on comma with `trim()`. Line 33: `req.headers['x-real-ip'] || (fwd ? fwd.split(',')[0].trim() : null) || 'unknown'`.

### 4.3 Role fallback defaults to 'admin' — FIXED
- **SEVERITY:** ~~Low~~ Resolved
- **CATEGORY:** Security / Defense-in-Depth
- **FILE:LINE:** `js/auth.js`, `api/verify.js`
- **DESCRIPTION:** All 6 `'admin'` fallback locations changed to `'viewer'` (least privilege): auth.js initial property, init catch, verify response chain, login decode, login decode catch, logout reset, and server-side verify.js fallback. Only legitimate `'admin'` reference is the account definition in `api/login.js:56`.

### 4.4 In-memory rate limit lost across serverless instances
- **SEVERITY:** Medium
- **CATEGORY:** Security / Rate Limit Bypass
- **FILE:LINE:** `api/login.js:4`
- **DESCRIPTION:** Rate-limit Map exists only in the current Vercel function instance. Vercel routes requests to different containers, so the rate limit resets on each cold start or load-balanced instance.
- **REPRODUCTION:** Attacker sends 5 attempts (hits limit on instance A). Request 6 routes to instance B with a fresh Map.
- **SUGGESTED FIX:** Move rate-limit tracking to Supabase or Vercel KV with TTL.

### 4.5 No token revocation mechanism
- **SEVERITY:** Medium
- **CATEGORY:** Security / Session Management
- **FILE:LINE:** `api/verify.js` (entire file)
- **DESCRIPTION:** Token verification relies only on HMAC signature + expiry. There's no revocation list. A leaked token remains valid for up to 24 hours even after the user logs out (client-side logout only clears localStorage).
- **REPRODUCTION:** User logs in, copies token, logs out. Token still passes server-side verification.
- **SUGGESTED FIX:** Implement a token blacklist in Supabase (`token_hash, invalidated_at`), checked in `/api/verify`.

### 4.6 Expired token check — NO BUG
- **FILE:LINE:** `api/verify.js:40-46`
- **DESCRIPTION:** Expiry check `!payload.exp || Date.now() > payload.exp` correctly rejects expired and exp-missing tokens.

---

## 5. RENDERING BUGS

### 5.1 XSS: Unescaped date and vintage fields in tables — FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** Security / XSS
- **FILE:LINE:** `js/tables.js:62-63,119,151`
- **DESCRIPTION:** `sampleDate`, `vintage`, and `fecha` were rendered directly into HTML without `_esc()`. **Fixed:** all date/vintage fields now wrapped with `this._esc()` across berry table (lines 62-63), wine table (line 119), and preferment table (line 151).

### 5.2 Chart instance cache — unbounded growth — FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** Performance / Memory Leak
- **FILE:LINE:** `js/charts.js:50-57`
- **DESCRIPTION:** `_pruneOrphans()` method now checks all cached instances against DOM, destroying and removing entries whose canvas no longer exists. Called from `App.setView()` on every view switch.

### 5.3 _applyThemeToCharts() — FIXED
- **SEVERITY:** ~~Low~~ Resolved
- **CATEGORY:** UI
- **FILE:LINE:** `js/charts.js:83-84`
- **DESCRIPTION:** Now correctly sets `chart.options.animation = { duration: 400, easing: 'easeOutQuart' }` before calling `chart.update()`, using the proper Chart.js 4.x API.

### 5.4 pH outlier filter inconsistent across views — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Data Integrity / UI
- **FILE:LINE:** `js/app.js:83`
- **DESCRIPTION:** pH filter moved from `kpis.js` and `charts.js` (where it was applied inconsistently) to `app.js:83` as `cleanBerry`. Now applied uniformly to KPIs, charts, tables, vintage view, and extraction view.

### 5.5 Division by zero in KPIs — NO BUG
- **FILE:LINE:** `js/kpis.js:4-6`
- **DESCRIPTION:** `avg()` returns `null` for empty arrays. `setKPI()` checks for `null` before calling `.toFixed()`. Safe.

---

## 6. WEATHER MODULE

### 6.1 No schema validation on Open-Meteo API response — FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** Data Integrity
- **FILE:LINE:** `js/weather.js:141`
- **DESCRIPTION:** Now validates `Array.isArray(d.time)` and logs `console.error('[WeatherStore] Respuesta inesperada de Open-Meteo:', d)` on schema mismatch.

### 6.2 GDD calculation silently skips missing days — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Data Integrity
- **FILE:LINE:** `js/weather.js:210-228`
- **DESCRIPTION:** Now tracks `totalDays` and `missingDays` explicitly. Returns `null` if `missingDays > 3` or `missingDays / totalDays > 0.1` (10% threshold).

### 6.3 Negative rainfall values not validated — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Data Integrity
- **FILE:LINE:** `js/weather.js:194`
- **DESCRIPTION:** `getCumulativeRainfall()` now checks `row.rainfall_mm >= 0` before summing. DB CHECK constraint not yet added (requires migration).

---

## 7. B-TIER IMPLEMENTATION REVIEW

### B1 Empty-state messaging — VERIFIED CORRECT
- **Files:** `js/charts.js`, `js/tables.js`
- Charts: `_drawNoData()` called for 5 chart types when `data.length === 0`. Message: "No hay datos para los filtros seleccionados".
- Tables: Berry (`colspan="11"`), wine (`colspan="11"`), preferment (`colspan="10"`) — all colspans match actual column counts.

### B2 Vintage context label — VERIFIED CORRECT
- **File:** `js/app.js:283-300`
- Appends "(filtrado: Syrah, Monte Xanic (VDG))" when `Filters.state.varieties` or `Filters.state.origins` are active. Only fires in vintage view via `_updateVintageUI()`.

### B3 Loading spinner — VERIFIED CORRECT
- **Files:** `index.html`, `css/styles.css`, `js/app.js:173-176`
- Spinner visible by default, hidden via `_hideSpinner()` in `onDataLoaded()`. All code paths in `App.init()` (cache, Supabase, JSON fallback, empty dashboard) call `onDataLoaded()`. Login screen z-index (10001) covers spinner (9999) during auth.

### B4 Wine vintage filter — BUG FOUND & FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** Data Integrity
- **FILE:LINE:** `js/dataLoader.js:97-100`
- **DESCRIPTION:** Prefermentativos-sourced rows had no `vintage` field because the `prefermentativos` table lacks a `vintage_year` column. **Fixed:** `_rowToPrefWine()` now extracts vintage from `batch_code` prefix (e.g., `25SBVDG-1` → 2025), consistent with how upload.js handles it. Note: the suggested fix of adding to `supabasePrefToWineJS` would not work since the DB table has no `vintage_year` column.

### B5 Chart legend keyboard accessibility — VERIFIED CORRECT
- **File:** `js/charts.js` (legend rendering)
- All legend items have `role="button"`, `tabindex="0"`, and `onkeydown` handler for Enter/Space. Applied to visible items, overflow items, and expand/collapse toggle. `event.preventDefault()` prevents page scroll on Space.

## 8. NEW FINDINGS (Code Sweep)

### 8.1 Weather API base URL is wrong — FIXED
- **SEVERITY:** ~~Critical~~ Resolved
- **CATEGORY:** Data Integrity
- **FILE:LINE:** `js/weather.js:11`
- **DESCRIPTION:** `_API_BASE` corrected from `api.open-meteo.com` to `archive-api.open-meteo.com` in commit `accba51`.

### 8.2 Offline toast may overflow on narrow mobile screens — FIXED
- **SEVERITY:** Low
- **CATEGORY:** UI / Mobile
- **FILE:LINE:** `css/styles.css` (`.offline-toast`)
- **DESCRIPTION:** `white-space: nowrap` with no `max-width` constraint. Long cache timestamp text like "Usando datos en caché (última actualización: 23 mar, 15:30)" can exceed viewport on screens < 360px.
- ~~**SUGGESTED FIX:**~~ Fixed in commit `accba51` — `max-width: 90vw; overflow: hidden; text-overflow: ellipsis` added.

### 8.2 clearAll() broad .chip selector — MITIGATED
- **CATEGORY:** Filter State
- **FILE:LINE:** `js/filters.js:213`
- **DESCRIPTION:** `document.querySelectorAll('.chip')` clears active class on ALL chips including wine chips. Pre-existing issue, now **mitigated** by `syncChipUI()` (3.2 fix) which re-syncs chip states on view return. No functional impact remains.

---

## 9. C-TIER IMPLEMENTATION REVIEW

### C1 Offline fallback notification — VERIFIED CORRECT
- **Files:** `js/app.js:186-202`, `index.html`, `css/styles.css`
- Toast shows "Usando datos en caché (última actualización: X)" with `es-MX` locale when Supabase fails. 6-second auto-dismiss. `#offline-toast` inside `#dashboard-content`, styled with slide-up animation.

### C2 Chart theme transition — VERIFIED CORRECT (fixed in 5.3)
- **File:** `js/charts.js:83-84`
- Now sets `chart.options.animation` before calling `chart.update()`, using the correct Chart.js 4.x API. 400ms easeOutQuart transition on theme toggle.

### C3 Upload duplicate detection — VERIFIED CORRECT
- **File:** `js/upload.js:183-204`
- `_detectDuplicates()` queries existing rows by primary/composite key before upsert. Shows "X nuevas, Y actualizadas" in pending and success messages. Wrapped in try/catch, returns 0 on failure (non-blocking).

---

## Priority Matrix

### Open Items

No open items. All findings resolved.

### Resolved Items

| ID | Category | Resolution |
|----|----------|------------|
| 8.1 | Data Integrity | FIXED (`accba51`) — weather API URL corrected |
| 2.1 | Race Condition | FIXED (`accba51`) — refresh guard with try/finally |
| 5.3 | UI | FIXED (`accba51`) — Chart.js animation API corrected |
| 8.2 | UI / Mobile | FIXED (`accba51`) — toast max-width 90vw |
| 5.1 | XSS | FIXED — `_esc()` on all fields |
| 3.1 | Filter State | FIXED — stale lot auto-cleanup in `getFiltered()` |
| 3.2 | Filter State / UX | FIXED — `syncChipUI()` on view switch |
| 2.2 | Memory Leak | FIXED — observer disconnect on view switch |
| 2.4 | Race Condition | FIXED — active panel check in observer |
| 5.2 | Memory Leak | FIXED — `_pruneOrphans()` on view switch |
| 5.4 | Data Integrity | FIXED — pH filter centralized in `app.js` |
| 4.2 | Security | FIXED — IP extraction splits `x-forwarded-for` |
| 2.3 | Race Condition | FIXED — `_isSyncing` guard with try/finally |
| 2.5 | Race Condition | FIXED — refresh guard with try/finally prevents overlap |
| 4.3 | Security | FIXED — all 'admin' fallbacks changed to 'viewer' |
| 6.1 | Data Integrity | FIXED — API schema validation |
| 6.2 | Data Integrity | FIXED — GDD missing day threshold |
| 6.3 | Data Integrity | FIXED — negative rainfall guard |
| 1.1 | Data Integrity | FIXED — header validation error |
| 1.2 | Data Integrity | FIXED — vintage range guard |
| B4 | Data Integrity | FIXED — preferment vintage from batch_code |
| 10.1 | Map Rendering | FIXED — deleted stale duplicate `vineyardSections` |
| 10.2 | UI | FIXED — removed duplicate Mapa nav option |
| 10.3 | Dead Code | FIXED — removed unreachable duplicate `case 'map'` |
| 11.3 | Repo Hygiene | FIXED — added test artifacts to `.gitignore` |
| 12.1 | Map Bugs | FIXED — all Section 10 bugs resolved |
| 12.2 | UI / CSS | FIXED — removed wrong adjacent sibling selector |
| 12.3 | Memory Leak | FIXED — explicit handler cleanup in showExportMenu |
| 12.4 | UI Side Effect | FIXED — menu appended to chart-card, no btn mutation |
| 4.1 | Security | FIXED — server-side `/api/upload` with token + role validation |
| 4.4 | Security | FIXED — rate limits persisted in Supabase `rate_limits` table |
| 4.5 | Security | FIXED — token blacklist on logout, 2h TTL, `/api/logout` endpoint |
| 11.1 | Maintainability | FIXED — `_buildExtractionPairs` helper used by both extraction charts |
| 11.2 | Data Visualization | FIXED — removed `max: 100` cap, bars >100% render fully |
| 13.1 | Maintainability | FIXED — `createExtractionPctChart` now uses shared helper |
| 13.2 | Data Visualization | FIXED — extraction % x-axis uncapped |
| 13.3 | Deployment | FIXED — `SUPABASE_SERVICE_KEY` + `SESSION_SECRET` documented in CLAUDE.md |
| 13.4 | Security | FIXED — token blacklist check added to `api/upload.js` |
| 13.5 | Documentation | FIXED — CLAUDE.md updated from 24h to 2h token expiry |
| 13.6 | Repo Hygiene | FIXED — redundant `sql/run_migrations.sql` deleted |

---

## 10. MAP VIEW — FIXED

### 10.1 Duplicate `vineyardSections` in config.js — FIXED
- **SEVERITY:** ~~Critical~~ Resolved
- **CATEGORY:** Map Rendering
- **DESCRIPTION:** Stale second `vineyardSections` array (lines 871–932) deleted. First array (649–817) with correct `ranchCode`, polygon `points`, and full variety names is now the only one.

### 10.2 Duplicate "Mapa" option in nav dropdown — FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** UI
- **DESCRIPTION:** Second `<option value="map">Mapa</option>` removed from `index.html`.

### 10.3 Duplicate `case 'map'` in refresh switch — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Dead Code
- **DESCRIPTION:** Unreachable second `case 'map'` block removed from `app.js`.

---

## 11. NEW CHART FUNCTIONS — UNCOMMITTED CHANGES

### 11.1 Duplicated extraction pair-building logic — divergence risk
- **SEVERITY:** Medium
- **CATEGORY:** Maintainability
- **FILE:LINE:** `js/charts.js:695–732` (new `createExtractionPctChart`) vs `js/charts.js:580–618` (existing `createExtractionChart`)
- **DESCRIPTION:** `createExtractionPctChart` copy-pastes ~40 lines of berry↔wine pair matching. The copies already diverge: the new one checks `berry.tANT > 0` (correct, prevents div-by-zero), the original does NOT — allowing `Infinity%` in tooltips when `berry.tANT === 0`.
- **FIX:** Extract to a shared `_buildExtractionPairs(berryData, wineData)` helper. Add `berry.tANT > 0` guard to original chart too.

### 11.2 Extraction % bars silently clipped at 100%
- **SEVERITY:** Low
- **CATEGORY:** Data Visualization
- **FILE:LINE:** `js/charts.js:802–803`
- **DESCRIPTION:** If wine tANT exceeds berry tANT (possible via measurement timing or concentration), `pct > 100`. X-axis `max: 100` clips bars without visual indication. Either remove `max: 100` or clamp with `Math.min(pct, 100)` + overflow marker.

### 11.3 Untracked test artifacts should be gitignored — FIXED
- **SEVERITY:** ~~Low~~ Resolved
- **CATEGORY:** Repo Hygiene
- **FILES:** `test-diag.js`, `test-results/`
- **DESCRIPTION:** Added `test-results/` and `test-diag.js` to `.gitignore`.

---

---

## 12. PHASE 6 POLISH — NEW FEATURES REVIEW (Round 3)

> Builder is on branch `feature/phase6-polish`. 5 new features: login polish, PDF export, mobile filter improvements, multi-vintage trend lines, origin radar chart.

### 12.1 MAP BUGS STILL UNFIXED — FIXED
- **SEVERITY:** ~~Critical~~ Resolved
- **STATUS:** All three map bugs (10.1, 10.2, 10.3) fixed on this branch.

### 12.2 Login label CSS selector highlights wrong label — FIXED
- **SEVERITY:** ~~Low~~ Resolved
- **CATEGORY:** UI / CSS
- **DESCRIPTION:** Removed `.login-input:focus + .login-label` selector (adjacent sibling, wrong direction). Kept only `:has()` selector which correctly targets the label before the focused input.

### 12.3 Export menu event handler accumulates — FIXED
- **SEVERITY:** ~~Low~~ Resolved
- **CATEGORY:** Memory / Event Leak
- **DESCRIPTION:** `showExportMenu` now stores handler ref in `this._exportMenuHandler` and explicitly removes it when replacing the menu or when a format is selected.

### 12.4 `btn.style.position = 'relative'` persists after menu close — FIXED
- **SEVERITY:** ~~Low~~ Resolved
- **CATEGORY:** UI Side Effect
- **DESCRIPTION:** Menu now appended to `.chart-card` parent (which already has `position: relative`) instead of the button. No inline style mutation on the button.

### 12.5 jsPDF CDN dependency added
- **SEVERITY:** Info
- **CATEGORY:** Dependencies
- **FILE:LINE:** `index.html:16`
- **DESCRIPTION:** `jspdf/2.5.2` loaded via CDN (`cdnjs.cloudflare.com`). This is within the CDN-only constraint of CLAUDE.md. The `exportChartPDF()` function guards with `typeof window.jspdf === 'undefined'` so failure is graceful. Acceptable.

### 12.6 Vintage comparison chart — behavior change
- **SEVERITY:** Info
- **CATEGORY:** Data Visualization
- **FILE:LINE:** `js/charts.js` (createVintageComparison)
- **DESCRIPTION:** Previously showed only lots appearing in 2+ vintages (strict comparison). Now shows ALL samples as scatter points with auto-generated 5-day-bin trend lines. This is a significant behavior change — the old chart was comparative (same lot across years), the new one is an aggregate overlay. The PLAN.md documents this as intentional ("Vintage comparison charts now show ALL data"). The trend line `filter: (item) => !item.text.includes('tendencia')` hides trend labels from legend, which is clean.
- **NOTE:** No regression — the old behavior was limited by requiring the same lot code across vintages, which excluded most data.

### 12.7 Radar chart normalization edge case
- **SEVERITY:** Low
- **CATEGORY:** Data Visualization
- **FILE:LINE:** `js/charts.js` (createOriginRadarChart, near line 585-588)
- **DESCRIPTION:** If all origins have the same value for a metric, `range = maxs[key] - mins[key]` is 0, and `normalize()` returns 50. This means all origins show 50% for that metric on the radar, which is visually correct (equal = same position) but the tooltip shows the raw value, so no data loss. Acceptable.

---

---

## 13. HARVEST CALENDAR + SECURITY HARDENING — REVIEW (Round 4)

> Reviewing PRs #1, #3, #4 merged to main. Harvest calendar, extraction helper, security hardening.
> All JS syntax checks pass. No unstaged source changes — only doc updates (CLAUDE.md, PLAN.md, TASK.md) + new `sql/run_migrations.sql`.

### 13.1 `createExtractionPctChart` still has inline pair logic — 11.1 HALF-FIXED
- **SEVERITY:** Medium
- **CATEGORY:** Maintainability
- **FILE:LINE:** `js/charts.js:852–893`
- **DESCRIPTION:** `_buildExtractionPairs()` helper was created (line 728) and `createExtractionChart` uses it (line 769). But `createExtractionPctChart` still has its own inline 40-line copy (lines 852–893). The comment says "Reuse same pair-building logic" but doesn't actually call the helper.
- **FIX:** Replace lines 852–893 with `const pairs = this._buildExtractionPairs(berryData, wineData);`

### 13.2 Extraction % bars still clipped at `max: 100` — 11.2 UNFIXED
- **SEVERITY:** Low
- **CATEGORY:** Data Visualization
- **FILE:LINE:** `js/charts.js:954`
- **DESCRIPTION:** `max: 100` on x-axis still present. Bars > 100% silently clipped.
- **FIX:** Remove `max: 100`.

### 13.3 `SUPABASE_SERVICE_KEY` env var not documented
- **SEVERITY:** Medium
- **CATEGORY:** Deployment
- **FILES:** `api/upload.js:71`, `api/login.js:12`, `api/verify.js:49`, `api/logout.js:20`
- **DESCRIPTION:** Four API endpoints now use `process.env.SUPABASE_SERVICE_KEY` (service role key, bypasses RLS). This env var is not listed in CLAUDE.md's "Environment Variables" section and is not in `.env.local` template. If missing in Vercel, upload/login/verify/logout will silently fall back or fail.
- **FIX:** Add `SUPABASE_SERVICE_KEY` to CLAUDE.md env vars section. Add to Vercel environment settings.

### 13.4 Token verification duplicated in `api/upload.js`
- **SEVERITY:** Low
- **CATEGORY:** Maintainability
- **FILE:LINE:** `api/upload.js:4–19`
- **DESCRIPTION:** `verifyToken()` function is copy-pasted from `api/verify.js`. If the verification logic changes (e.g., blacklist check added in verify.js:46–67), upload.js won't get the update. The upload endpoint does NOT check the token blacklist — a revoked token can still upload.
- **FIX:** Either import shared verification, or add blacklist check to `api/upload.js` the same way `api/verify.js` does it.

### 13.5 Token TTL reduced from 24h to 2h — undocumented
- **SEVERITY:** Low
- **CATEGORY:** UX / Documentation
- **FILE:LINE:** `api/login.js:137`
- **DESCRIPTION:** Token expiry changed from `24 * 60 * 60 * 1000` (24h) to `2 * 60 * 60 * 1000` (2h). CLAUDE.md still says "HMAC session tokens, 24h expiry". Users will be logged out more frequently. This is a security improvement but should be documented.
- **FIX:** Update CLAUDE.md auth description to say "2h expiry".

### 13.6 `sql/run_migrations.sql` duplicates existing migration files
- **SEVERITY:** Info
- **CATEGORY:** Repo Hygiene
- **FILE:** `sql/run_migrations.sql` (untracked)
- **DESCRIPTION:** Contains `CREATE TABLE rate_limits` and `CREATE TABLE token_blacklist`. These already exist as `sql/migration_rate_limits.sql` and `sql/migration_token_blacklist.sql` (committed). The new file appears to be a convenience wrapper but is redundant.
- **FIX:** Either delete `sql/run_migrations.sql` or add it to `.gitignore`.

### 13.7 Harvest calendar — well implemented, no bugs found
- **SEVERITY:** Info
- **CATEGORY:** New Feature
- **DESCRIPTION:** `createHarvestCalendar()` correctly:
  - Extracts crush dates from berry data, grouped by variety
  - Builds floating bars (Chart.js `data: [[start, end]]` format)
  - Overlays temperature line and rainfall bars on secondary y-axis
  - Uses `WeatherStore.dayOfSeason()` / `getRange()` — both exist and work correctly
  - Handles empty state in Spanish
  - Tooltip shows variety, day range, lot count, avg Brix, avg tANT
  - `dayToLabel()` correctly converts day-of-season to `"d MMM"` format without requiring a date adapter CDN
  - No time axis adapter needed — uses `type: 'linear'` with custom tick callback (smart design choice)

### 13.8 Security hardening — solid implementation
- **SEVERITY:** Info
- **CATEGORY:** Security
- **DESCRIPTION:**
  - **`api/upload.js`**: Token + role validation, table allowlist, row count limits, upsert via service key. Clean.
  - **`api/login.js`**: Persistent rate limits via Supabase with in-memory fallback. Stale entry sweep. Clean.
  - **`api/logout.js`**: Hashes token with SHA-256 before storing in blacklist. Clean.
  - **`api/verify.js`**: Checks blacklist table, fail-open on error (availability > security for internal tool). Reasonable tradeoff.
  - **`js/upload.js`**: Now routes through `/api/upload` instead of direct Supabase. Client-side role check kept as fast-fail. Clean.
  - **`js/auth.js`**: Logout calls `/api/logout` before clearing local storage. Fire-and-forget (`.catch(() => {})`). Clean.

---

---

## 14. FULL CODEBASE AUDIT (Round 5)

> Comprehensive review of all JS, CSS, HTML, and API files for dead code, redundancies, bugs, and security gaps.

### BUGS

#### 14.1 Extraction table ignores filters — HIGH
- **FILE:** `js/app.js:574,583`
- **DESCRIPTION:** `updateExtractionTable()` uses raw `DataStore.berryData` and `DataStore.wineRecepcion` (unfiltered). The extraction charts on the same view use `cleanBerry` and `filteredWineExt` (filtered by vintage/variety/origin). Result: charts and table show different data when filters are active.
- **FIX:** Pass `cleanBerry` and `filteredWineExt` as parameters instead of accessing DataStore directly.

#### 14.2 Blacklist check missing from `/api/config` and `/api/upload` — HIGH
- **FILE:** `api/config.js` (entire file), `api/upload.js:4-19`
- **DESCRIPTION:** Only `api/verify.js` checks the `token_blacklist` table. A revoked token (user logged out) can still call `/api/config` to get Supabase credentials and `/api/upload` to insert data. The blacklist is bypassed on 2 of 3 authenticated endpoints.
- **FIX:** Add blacklist check to both endpoints, or extract shared token verification with blacklist into a utility.

#### 14.3 Token verification logic triplicated — MEDIUM
- **FILE:** `api/upload.js:4-19`, `api/verify.js:29-37`, `api/config.js:28-34`
- **DESCRIPTION:** Three separate copies of HMAC signature + expiry verification. Already diverged: verify.js has blacklist check, the other two don't. Any future change must be applied in 3 places.
- **FIX:** Extract to shared `api/lib/verifyToken.js`.

#### 14.4 Extraction table also duplicates pair-building logic — MEDIUM
- **FILE:** `js/app.js:572-598`
- **DESCRIPTION:** `updateExtractionTable()` has its own 30-line pair-building block, making it the THIRD copy alongside `_buildExtractionPairs()` (charts.js:728) and `createExtractionPctChart` inline (charts.js:852). None of the three share code.
- **FIX:** All three should call `Charts._buildExtractionPairs()`.

### DEAD CODE

#### 14.5 Unused CSS classes — ~70 lines
- **FILE:** `css/styles.css`
- `.brand-top`, `.brand-name`, `.brand-divider`, `.brand-sub` (lines 120-148) — not in HTML or JS
- `.extraction-grid`, `.extraction-card`, `.ext-bar`, `.ext-bar-label`, `.ext-bar-track`, `.ext-bar-fill`, `.ext-bar-value` (lines 906-947) — not in HTML or JS
- **FIX:** Delete both blocks.

#### 14.6 `shortenOrigin()` is a no-op — LOW
- **FILE:** `js/filters.js:80-82`
- **DESCRIPTION:** `shortenOrigin(name) { return name || ''; }` — does nothing. Called 6 times across filters.js and charts.js. Was intended for abbreviating long origin names but never implemented.
- **FIX:** Either implement abbreviation logic or inline `name || ''` at call sites.

### MISSING FUNCTIONALITY

#### 14.7 Four origin comparison charts missing export buttons
- **FILE:** `index.html:320-339`
- **DESCRIPTION:** `chartOriginBrix`, `chartOriginAnt`, `chartOriginPH`, `chartOriginTA` chart cards have no `.chart-export-btn`. Every other chart card in the dashboard has one.
- **FIX:** Add `<button class="chart-export-btn" onclick="Charts.showExportMenu(...)">&#x2913;</button>` to each.

### SECURITY

#### 14.8 No rate limiting on `/api/upload`, `/api/verify`, `/api/logout`, `/api/config`
- **SEVERITY:** Medium
- **DESCRIPTION:** Only `/api/login` has rate limiting. Other endpoints can be hammered. `/api/upload` is the highest risk — unlimited insert requests if token is valid.
- **FIX:** Apply shared rate limiter, or at minimum add to `/api/upload`.

#### 14.9 User-provided `conflict` column in upload API
- **FILE:** `api/upload.js:54,78`
- **DESCRIPTION:** Client sends `conflict` parameter which becomes `on_conflict=` in the Supabase URL. While `encodeURIComponent` prevents injection, attacker can probe schema by sending invalid column names and observing error responses.
- **FIX:** Ignore client-provided `conflict`, always use `tableConfig.conflict`.

### EDGE CASES

#### 14.10 Harvest calendar `dayToLabel` month index
- **FILE:** `js/charts.js:1379`
- **DESCRIPTION:** `monthNames[d.getUTCMonth() - 6]` — works for Jul(6)–Nov(10) but returns `undefined` for dates outside that range (Dec–Jun). The `|| ''` fallback prevents crashes but shows blank month labels.
- **Impact:** Low — harvest season is Jul–Oct, so unlikely to trigger.

#### 14.11 `daysPostCrush || 0` treats null as day 0
- **FILE:** `js/charts.js:735,858`, `js/app.js:577`
- **DESCRIPTION:** `(d.daysPostCrush || 0)` converts null/undefined to 0, meaning a sample with missing DPC is treated as "harvested on day 0". This incorrectly selects it as the "latest" measurement if all other samples also have DPC 0 or null.
- **Impact:** Low — most samples have DPC populated.

#### 14.12 CSP blocks ALL inline event handlers on Vercel — CRITICAL
- **FILE:** `vercel.json:11`
- **DESCRIPTION:** The Content-Security-Policy `script-src` directive is `'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net` — **no `'unsafe-inline'`**. Every `onclick="..."` and `onchange="..."` in `index.html` is silently blocked by the browser on Vercel. Inline event handlers are treated as inline scripts by CSP.
- **AFFECTED:** `nav-select` onchange (view switching), all `onclick` handlers (chart exports, filter clicks, theme toggle, help toggle, logout, mobile section toggles, map metric select, ranch tabs, explorer buttons, upload close button, data loader)
- **WHY IT WORKS LOCALLY:** `http-server` doesn't send CSP headers.
- **WHY IT APPEARS PARTIAL:** Some actions may also be bound via `addEventListener` in JS (not blocked by CSP). Pure inline-only handlers (like `nav-select onchange`) fail silently.
- **FIX (option A — quick):** Add `'unsafe-inline'` to `script-src` in `vercel.json`.
- **FIX (option B — proper):** Migrate all inline handlers to `addEventListener` in JS. Correct long-term fix but ~30+ handlers to move.

---

## Priority Matrix (Updated Round 5)

### Open Items

| Priority | ID | Severity | Category | Fix Effort |
|----------|----|----------|----------|------------|
| **0** | **14.12** | **Critical** | CSP blocks inline event handlers on Vercel — nothing works | Trivial (A) / High (B) |
| **1** | **14.2** | **High** | Blacklist missing from config + upload endpoints | Low |
| **2** | **14.1** | **High** | Extraction table ignores filters | Low |
| **3** | **14.3** | **Medium** | Token verification triplicated | Medium |
| 4 | 13.1 | Medium | `createExtractionPctChart` inline pair logic | Trivial |
| 5 | 14.4 | Medium | Extraction table also duplicates pair logic | Low |
| 6 | 13.3 | Medium | `SUPABASE_SERVICE_KEY` not documented | Trivial |
| 7 | 14.8 | Medium | No rate limiting on upload/verify/logout/config | Medium |
| 8 | 14.9 | Medium | User-provided conflict column in upload API | Trivial |
| 9 | 13.2 | Low | Extraction % bars clipped at max: 100 | Trivial |
| 10 | 14.5 | Low | ~70 lines dead CSS | Trivial |
| 11 | 14.7 | Low | 4 origin charts missing export buttons | Trivial |
| 12 | 13.5 | Low | Token TTL 24h→2h undocumented | Trivial |

---

### Rules for the Builder
- All user-facing messages must be in Spanish
- Follow file responsibility rules from CLAUDE.md (KPIs in `kpis.js`, charts in `charts.js`, etc.)
- Do not introduce npm packages or build tools
- Every fix must be mobile responsive
- Preserve existing Chart.js 4.4.1 and SheetJS 0.18.5 API compatibility

---

---

## 15. DOCUMENTATION UPDATE REVIEW (Round 6)

> Reviewing uncommitted changes: CLAUDE.md, PLAN.md, TASK.md, .claude/settings.local.json + new REPORTE_DASHBOARD.txt.
> All changes are documentation/config — no source code modifications.

### Priority 1 Issues

#### 15.1 CSP `connect-src` blocks weather API on Vercel — HIGH
- **FILE:** `vercel.json:11`
- **DESCRIPTION:** `connect-src` allows `https://api.open-meteo.com` but `js/weather.js:11` uses `https://archive-api.open-meteo.com/v1/archive`. These are different origins — CSP exact-match does NOT wildcard subdomains. Weather fetch calls are blocked on Vercel.
- **FIX:** Change `connect-src` to include `https://archive-api.open-meteo.com` (or use `https://*.open-meteo.com`).
- **NOTE:** Compounds with 14.12 — the entire CSP needs a single pass fix.

#### 15.2 REPORTE_DASHBOARD.txt exposes architecture on Vercel — MEDIUM
- **FILE:** `REPORTE_DASHBOARD.txt`, `.vercelignore`
- **DESCRIPTION:** 985-line Spanish report detailing API endpoints, auth flow, rate limit thresholds, table schemas, and security implementation specifics. Not in `.vercelignore` — if committed, deploys as publicly accessible `https://domain/REPORTE_DASHBOARD.txt`. No credentials, but exposes internal architecture to attackers.
- **FIX:** Add `REPORTE_DASHBOARD.txt` to `.vercelignore`. Also add `PLAN.md`, `TASK.md`, `REVIEW.md` — all currently missing.

### Priority 2 Improvements

#### 15.3 Round 5 Priority Matrix is stale — 5 items silently resolved
- **FILE:** `REVIEW.md:558-577`
- **DESCRIPTION:** Priority Matrix lists 12 open items. Verified against committed code — 5 are already resolved:
  - **13.1** (ExtractionPctChart inline pair logic) — FIXED: `charts.js:851` calls `_buildExtractionPairs()`
  - **13.2** (Extraction % max: 100 cap) — FIXED: no `max: 100` found in charts.js
  - **13.3** (SUPABASE_SERVICE_KEY undocumented) — FIXED: already in CLAUDE.md env vars section
  - **13.5** (Token TTL 24h→2h undocumented) — FIXED in this diff: CLAUDE.md now says "2h expiry"
  - **14.2** partially fixed: `api/upload.js` has blacklist check (line 47-54), `api/config.js` still lacks it
- **FIX:** Update matrix below.

#### 15.4 Docs missing from .vercelignore
- **FILE:** `.vercelignore`
- **DESCRIPTION:** Only `CLAUDE.md` is excluded. `PLAN.md`, `TASK.md`, `REVIEW.md` deploy to Vercel alongside the app. None contain secrets but are internal planning docs.
- **FIX:** Add all 4 to `.vercelignore`.

### Missing Tests

No tests exist in this project (vanilla JS, CDN-only). This is an existing gap, not introduced by these changes.

---

---

## 16. USER TESTING FINDINGS (Round 7)

> First real data update by winery staff. These are bugs and missing features reported from production usage.
> Discovered: 2026-03-31

### BUGS

#### 16.1 PDF/PNG export not working — HIGH — ✅ RESOLVED
- **FILES:** `js/charts.js`
- **DESCRIPTION:** Chart export (both PNG and PDF) was broken in production due to CSP inline handlers, jsPDF race condition, missing Image onerror, and silent failures.
- **FIX APPLIED:** (1) CSP inline handlers resolved in Wave 1a–e (events.js delegation). (2) jsPDF undefined guard now shows Spanish toast. (3) `onerror` handler added on `new Image()`. (4) try/catch on `toBase64Image()` and entire PDF generation. (5) All 7 failure paths now show user-facing Spanish messages via `_showExportToast()`.

#### 16.2 Same-lot data points not connected — last-point bug — HIGH — ✅ RESOLVED
- **FILES:** `js/charts.js`
- **DESCRIPTION:** Scatter charts had no per-lot lines, and golden border appeared on ALL points in a lot (not just the last) because `_identifyLastPoints()` returned a sampleId Set shared by all lot points.
- **FIX APPLIED:** (1) `_identifyLastPoints()` now returns `lotCode→maxDaysPostCrush` map — only the single point matching max DPC gets golden border. (2) Per-chart `_lotLinePlugin` (Chart.js plugin) draws thin semi-transparent lines connecting same-lot points sorted by x-value. Lines always visible (not gated by `showLines` toggle). (3) Last points also get slightly larger radius (+2px).

#### 16.3 Duplicate dates with different hours overwritten on upload — HIGH
- **FILES:** `js/upload.js:26-29` (`_normalizeValue`), `api/upload.js:24` (conflict key), `js/charts.js` (display)
- **DESCRIPTION:** Some vineyard lots are sampled twice on the same day at different hours. The upload pipeline strips time from dates (`val.toISOString().split('T')[0]`), and the upsert conflict key `(sample_id, sample_date)` treats both measurements as the same row — second upload overwrites the first.
- **IMPACT:** Data loss — only one measurement per lot per day survives.
- **DECISION (confirmed by user):** Option B — `sample_seq` integer column. Row-order-within-batch + deterministic sort.
- **FIX — 3 files + 1 migration:**
  1. **`sql/migration_sample_seq.sql`** — Add `sample_seq INTEGER NOT NULL DEFAULT 1` to `wine_samples`. Drop old unique constraint on `(sample_id, sample_date)`. Create new unique constraint on `(sample_id, sample_date, sample_seq)`. Set all existing rows to `sample_seq = 1`.
  2. **`js/upload.js`** — In `parseWineXRay()` or before `upsertRows()`: group parsed rows by `(sample_id, sample_date)`. Within each group, sort deterministically (by source time if Date object had time component, else by value fingerprint: tANT → pH → berry_weight). Assign `sample_seq = 1, 2, 3...` per group position. This makes seq stable regardless of CSV row order.
  3. **`api/upload.js`** — Change conflict key from `'sample_id,sample_date'` to `'sample_id,sample_date,sample_seq'` in `ALLOWED_TABLES.wine_samples.conflict`.
  4. **`js/charts.js`** — When plotting `daysPostCrush`, add `+ (sample_seq - 1) * 0.15` day offset so same-day points spread apart visually. Tooltip still shows the real `daysPostCrush` value.
- **IDEMPOTENCY:** Same CSV uploaded twice → same groups, same deterministic sort → same seqs → upsert overwrites with identical values. Safe.
- **EDGE CASE (accepted):** Two separate CSVs each with 1 row for same `(sample_id, sample_date)` → both get seq=1 → second overwrites first. Acceptable because in practice each data source (WineXRay, Y15, etc.) exports all measurements at once. Future architecture: dedicated upload path per source eliminates this entirely.
- **NOTE:** 16.4 (overlapping points jitter) is now a subset of this fix — the `sample_seq` offset handles same-lot same-day overlap. Cross-lot same-day overlap is a separate visual issue (lower priority, handled by deterministic hash jitter on `sampleId`).

#### 16.4 No jitter for overlapping data points at same x-coordinate — LOW
- **FILES:** `js/charts.js:168-229`
- **DESCRIPTION:** Multiple points from DIFFERENT lots with identical `daysPostCrush` values plot at the exact same pixel. Points stack invisibly — only the top one is clickable/visible. (Same-lot same-day overlap is now handled by 16.3's `sample_seq` offset.)
- **FIX:** Add small deterministic jitter based on hash of `sampleId` (±0.2 days) to `daysPostCrush` for display only. Tooltip still shows exact value.

### MISSING FEATURES

#### 16.5 No GDD (Growing Degree Days) visualization — HIGH
- **FILES:** `js/weather.js:208-238` (calculation exists), `js/charts.js` (no GDD chart), `index.html` (no GDD container)
- **DESCRIPTION:** `WeatherStore.getCumulativeGDD()` is fully implemented (base 10°C, cached, valley-aware, with data quality checks). But it is ONLY used in the explorer detail view (`explorer.js:144`). There is no GDD chart, no GDD time series, and no GDD overlay in the weather section.
- **FIX:** Add a cumulative GDD chart to the weather view — line chart showing GDD accumulation from July 1 through harvest season, one line per valley. Add GDD column to berry scatter tooltips. Optionally add GDD as a secondary axis on the harvest calendar.

#### 16.6 No weather location filter — HIGH
- **FILES:** `js/weather.js` (API supports location param), `js/charts.js:1107,1178` (no location passed), `index.html:601` (hardcoded "Valle de Guadalupe"), `js/filters.js` (no location state)
- **DESCRIPTION:** Weather data is fetched and cached for all 3 valleys (VDG, VON, SV). `WeatherStore.getRange(start, end, location)` accepts a location parameter. But:
  1. **No UI dropdown** for users to select valley
  2. **Chart functions** never pass the location param → always defaults to VDG
  3. **Section header** is hardcoded to "Valle de Guadalupe"
- **FIX:** Add valley selector dropdown (VDG/VON/SV) in the weather section header. Pass selected valley to `getRange()` in all weather chart calls. Update header text dynamically. Add to `Filters.state` so it persists across view switches.

#### 16.7 Chart legends not visible in PNG/PDF exports — HIGH — ✅ RESOLVED
- **FILES:** `js/charts.js`
- **DESCRIPTION:** Scatter charts used `legend: { display: false }` with external HTML legend bar — not captured in canvas exports.
- **FIX APPLIED:** Native Chart.js legends enabled on `createScatter` and `createPureScatter` (bottom position, point-style circles, themed colors, onClick wired to `toggleSeries()`). Legends render inside canvas → visible in PNG/PDF exports. HTML legend bar kept for mobile expand/collapse interaction.

#### 16.8 Varietal colors not distinct enough — MEDIUM — ✅ RESOLVED
- **FILE:** `js/config.js`
- **DESCRIPTION:** Multiple varietal color pairs were nearly identical (Cab Sauv/Cab Franc, Tempranillo/Grenache, all 4 whites as pale yellows).
- **FIX APPLIED:** 10 colors redistributed across wider hue range. Key changes: Cab Franc→#6366F1 (indigo), Tempranillo→#F97316 (orange), Marselan→#BE185D (deep rose), Grenache→#EF4444 (true red), Caladoc→#A78BFA (lavender). Whites spread to green (#4ADE80)/gold (#FDE047)/coral (#FB923C)/cyan (#22D3EE).

### FUTURE IDEAS (noted, not prioritized)

#### 16.9 Interactive data point inspection in exports
- **DESCRIPTION:** User expressed interest in seeing data values at each point in exported images. Not immediately needed.
- **NOTE:** Could be achieved by enabling Chart.js `datalabels` plugin (CDN) for export-only rendering, or by annotating the export canvas with point values during PNG/PDF generation.

---

## Priority Matrix (Updated Round 7)

### Open Items

| Priority | ID | Severity | Category | Fix Effort |
|----------|----|----------|----------|------------|
| ~~0~~ | ~~14.12~~ | ~~Critical~~ | ~~CSP blocks inline event handlers on Vercel~~ — **RESOLVED** (commits 31a7062, 2287b96, bb288a5) | ~~High~~ |
| ~~1~~ | ~~16.1~~ | ~~High~~ | ~~PDF/PNG export broken~~ — **RESOLVED** (Wave 1f: toast errors, jsPDF guard, Image onerror) | ~~Medium~~ |
| ~~2~~ | ~~16.2~~ | ~~High~~ | ~~Same-lot points not connected, golden border on every point~~ — **RESOLVED** (Wave 2a: lot-line plugin + last-point fix) | ~~Medium~~ |
| **3** | **16.5** | **High** | No GDD chart (calculation exists, no visualization) | Medium |
| **4** | **16.6** | **High** | No weather location filter (API ready, no UI) | Medium |
| ~~5~~ | ~~16.7~~ | ~~High~~ | ~~Legends invisible in PNG/PDF exports~~ — **RESOLVED** (Wave 2b: native Chart.js legends) | ~~Low~~ |
| **6** | **16.3** | **Medium** | Same-day different-hour measurements overwritten (decision confirmed: sample_seq) | Medium |
| ~~7~~ | ~~16.8~~ | ~~Medium~~ | ~~Varietal colors too similar~~ — **RESOLVED** (Wave 2c: 10 colors redistributed) | ~~Low~~ |
| **8** | **14.1** | **High** | Extraction table ignores filters | Low |
| **9** | **14.2** | **High** | Blacklist missing from `api/config.js` | Low |
| **10** | **14.3** | **Medium** | Token verification triplicated | Medium |
| **11** | **14.8** | **Medium** | No rate limiting on upload/verify/logout/config | Medium |
| **12** | **14.9** | **Medium** | User-provided conflict column in upload API | Trivial |
| **13** | **15.2** | **Medium** | Docs deploy to Vercel | Trivial |
| **14** | **16.4** | **Low** | Overlapping points need jitter | Low |
| **15** | **14.5** | **Low** | ~70 lines dead CSS | Trivial |
| ~~16~~ | ~~14.7~~ | ~~Low~~ | ~~4 origin charts missing export buttons~~ — **RESOLVED** (Wave 2d) | ~~Trivial~~ |

### Rules for the Builder
- All user-facing messages must be in Spanish
- Follow file responsibility rules from CLAUDE.md (KPIs in `kpis.js`, charts in `charts.js`, etc.)
- Do not introduce npm packages or build tools
- Every fix must be mobile responsive
- Preserve existing Chart.js 4.4.1 and SheetJS 0.18.5 API compatibility
- Per-lot line connections in scatter charts are the top user priority — makes data legible
- Export fidelity: what you see on screen should match what appears in PNG/PDF
- Color changes must maintain ≥ 30 CIELAB ΔE between any two varietals

### Notes

- All CLAUDE.md documentation changes are accurate and match committed source code.
- TASK.md Phase 7 implementation steps are well-structured and consistent with CLAUDE.md schema.
- PLAN.md Phase 6 → Phase 7 transition is clean; Phase 6 details preserved in git history (`8906903`, `bb75fbc`).
- `.claude/settings.local.json` is user-specific tool permissions — no impact on deployed code.
- `REPORTE_DASHBOARD.txt` is a thorough feature catalog with no credential leaks.
- CLAUDE.md Phase 4 login polish appears in both Phase 4 (`completed in Phase 6`) and Phase 6 (`Login screen UI polish — radial gold glow...`). Minor redundancy, not a bug.

---

## 17. DOC/CONFIG REVIEW — Post-CSP-Migration (Round 8)

> Reviewing uncommitted changes on `feature/csp-inline-handler-migration` after commits `31a7062` (CSP handler migration) and `2287b96` (nav button tabs).
> Changed files: `.claude/settings.local.json`, `CLAUDE.md`, `PLAN.md`, `REVIEW.md`, `TASK.md`
> Untracked files: `REPORTE_DASHBOARD.txt`, `docs/`
> **No source code changes** — all diffs are documentation/config updates.

### Priority 1 Issues

#### 17.1 `api/config.js` still missing token blacklist check — HIGH (SECURITY)
- **FILE:** `api/config.js:1-51`
- **DESCRIPTION:** Three of four authenticated API endpoints (`api/verify.js`, `api/upload.js`, `api/logout.js`) check the `token_blacklist` table before proceeding. `api/config.js` does NOT — it verifies HMAC signature and expiry but skips blacklist lookup. A revoked token (user logged out) can still fetch Supabase credentials from `/api/config` until it naturally expires (up to 2h).
- **IMPACT:** After logout, a stolen/leaked token remains valid for credential retrieval for up to 2 hours.
- **FIX:** Add blacklist check to `api/config.js` matching the pattern in `api/verify.js:47-62`.
- **STATUS:** Carried forward from 14.2 — still open.

#### 17.2 `js/filters.js` still uses inline `onclick` assignments — HIGH (CSP)
- **FILE:** `js/filters.js:55,75,99,114,132,153,174`
- **DESCRIPTION:** The CSP inline handler migration (commit `31a7062`) moved 71 handlers from `index.html` to `js/events.js`. However, `js/filters.js` dynamically creates filter chip elements and assigns `chip.onclick = () => ...` at 7 locations. These are **programmatic property assignments**, not HTML `onclick` attributes, so they are NOT blocked by CSP `script-src 'self'`. This is a **false alarm** — `element.onclick = fn` in JS is CSP-safe. No fix needed.
- **STATUS:** NOT a bug. Documented for completeness — no action required.

### Priority 2 Improvements

#### 17.3 `.vercelignore` missing 4 doc files — MEDIUM (INFO DISCLOSURE)
- **FILE:** `.vercelignore`
- **CURRENT CONTENTS:** `sql/`, `CLAUDE.md`, `.claude/`, `.editorconfig`, `.nvmrc`
- **MISSING:** `PLAN.md`, `TASK.md`, `REVIEW.md`, `REPORTE_DASHBOARD.txt`
- **DESCRIPTION:** These files deploy as publicly accessible static assets on Vercel. `REPORTE_DASHBOARD.txt` (50KB) details API endpoints, auth flow, rate limit thresholds, and table schemas. No credentials, but exposes internal architecture.
- **FIX:** Add to `.vercelignore`:
  ```
  PLAN.md
  TASK.md
  REVIEW.md
  REPORTE_DASHBOARD.txt
  ```
- **STATUS:** Carried forward from 15.2/15.4 — still open. Trivial fix.

#### 17.4 REVIEW.md contains two Priority Matrix sections — LOW (DOC HYGIENE)
- **FILE:** `REVIEW.md:708-731` (Round 7 matrix) and `REVIEW.md:753-769` (Round 6 matrix)
- **DESCRIPTION:** The uncommitted diff appends Round 7 findings and a new Priority Matrix but preserves the stale Round 6 matrix below it. The Round 6 matrix still lists `15.1` as open (now resolved — `archive-api.open-meteo.com` was added to `connect-src` in commit `31a7062`). Also lists `14.4` which is resolved.
- **FIX:** Remove the Round 6 Priority Matrix section entirely — the Round 7 matrix supersedes it. Alternatively, move resolved items to a "Resolved Since Round 6" table.

#### 17.5 PLAN.md references `15.1` as open in Wave 1 description — LOW
- **FILE:** `PLAN.md` (uncommitted), Wave 1 task 1d
- **DESCRIPTION:** Wave 1 task 1d says "Fix CSP `connect-src` to include `archive-api.open-meteo.com`". This was already fixed in commit `31a7062` (`vercel.json` line 11 now includes it). Task should be marked as done.
- **FIX:** Mark task 1d as complete in PLAN.md, or note it's already resolved.

#### 17.6 `docs/superpowers/` directory is untracked and likely unintentional — LOW
- **PATH:** `docs/superpowers/` (untracked)
- **DESCRIPTION:** Empty or near-empty directory that appears to be a Claude Code skills artifact, not project documentation. If committed, it would deploy to Vercel (not in `.vercelignore`).
- **FIX:** Add `docs/` to `.gitignore` if it's a local artifact. Or add to `.vercelignore` if it should be tracked but not deployed.

#### 17.7 `api/upload.js` had fatal SyntaxError — upload endpoint COMPLETELY BROKEN — CRITICAL ✅ FIXED
- **FILE:** `api/upload.js:48,87`
- **DESCRIPTION:** `const supabaseUrl` was declared twice in the same function scope. Line 48 (added for blacklist check) and line 87 (original insert logic) both declared `const supabaseUrl = process.env.SUPABASE_URL`. Node.js ESM throws `SyntaxError: Identifier 'supabaseUrl' has already been declared` at parse time. The entire `/api/upload` endpoint never loaded. Every POST returned a 500 error.
- **IMPACT:** All data uploads to Supabase silently failed. Users saw the file parsed (row count displayed), but data never reached the database. On page refresh, all "uploaded" data disappeared.
- **ROOT CAUSE:** Security Hardening added a blacklist check (lines 47-62) that introduced `const supabaseUrl` on line 48, colliding with the existing declaration on line 87.
- **FIX APPLIED:** Removed duplicate declarations on lines 87-88. Reused `supabaseUrl` and `serviceKey` from lines 48-49 throughout. Verified: `node --input-type=module -e "await import('./api/upload.js')"` → no error.

### Priority Matrix (Updated Round 8)

#### Open Items

| Priority | ID | Severity | Category | Fix Effort |
|----------|----|----------|----------|------------|
| ~~0~~ | ~~14.12~~ | ~~Critical~~ | ~~CSP inline handlers~~ — **RESOLVED** (Wave 1a–e) | ~~High~~ |
| ~~1~~ | ~~16.1~~ | ~~High~~ | ~~PDF/PNG export~~ — **RESOLVED** (Wave 1f) | ~~Medium~~ |
| ~~2~~ | ~~16.2~~ | ~~High~~ | ~~Same-lot points not connected~~ — **RESOLVED** (Wave 2a) | ~~Medium~~ |
| **3** | **16.3** | **High** | Same-day measurements overwritten — `sample_seq` fix (decision confirmed) | Medium |
| **4** | **16.5** | **High** | No GDD chart (`getCumulativeGDD()` exists, no viz) | Medium |
| **5** | **16.6** | **High** | No weather location filter (API ready, no UI) | Medium |
| ~~6~~ | ~~16.7~~ | ~~High~~ | ~~Legends invisible in exports~~ — **RESOLVED** (Wave 2b) | ~~Low~~ |
| **7** | **17.1** | **High** | Blacklist missing from `api/config.js` (security gap) | Low |
| ~~8~~ | ~~16.8~~ | ~~Medium~~ | ~~Varietal colors too similar~~ — **RESOLVED** (Wave 2c) | ~~Low~~ |
| **9** | **14.1** | **High** | Extraction table ignores filters | Low |
| **10** | **14.3** | **Medium** | Token verification triplicated | Medium |
| **11** | **14.8** | **Medium** | No rate limiting on upload/verify/logout/config | Medium |
| **12** | **14.9** | **Medium** | User-provided conflict column in upload API | Trivial |
| **13** | **17.3** | **Medium** | Docs deploy to Vercel (.vercelignore) | Trivial |
| **14** | **16.4** | **Low** | Cross-lot same-day jitter (same-lot handled by 16.3) | Low |
| **15** | **14.5** | **Low** | ~70 lines dead CSS | Trivial |
| ~~16~~ | ~~14.7~~ | ~~Low~~ | ~~4 origin charts missing export buttons~~ — **RESOLVED** (Wave 2d) | ~~Trivial~~ |
| **17** | **18.1** | **Medium** | Duplicate login form listener — 2x `/api/login` requests after logout/re-login (`auth.js:151` + `events.js:36`) | Trivial |

#### Resolved Since Round 7

| ID | Category | Resolution |
|----|----------|------------|
| 14.12 | CSP inline handlers | FIXED — Wave 1a–e: 71 static + 11 dynamic handlers migrated to `events.js` delegation (commits 31a7062, 2287b96, bb288a5) |
| 17.7 | Upload broken (SyntaxError) | FIXED — removed duplicate `const supabaseUrl` declaration, reused vars from blacklist block |
| 15.1 | CSP connect-src | FIXED in commit `31a7062` — `archive-api.open-meteo.com` added to `connect-src` |
| 16.1 | PDF/PNG export broken | FIXED — Wave 1f: jsPDF load guard, Image onerror, try/catch on toBase64Image, 7 Spanish error toasts |
| 16.2 | Same-lot points not connected | FIXED — Wave 2a: `_lotLinePlugin` draws lot lines, `_identifyLastPoints` returns lotCode→maxDPC map (was sampleId Set) |
| 16.7 | Legends invisible in exports | FIXED — Wave 2b: native Chart.js legends on scatter charts (bottom, point-style, themed) |
| 16.8 | Varietal colors too similar | FIXED — Wave 2c: 10 colors redistributed (Cab Franc→indigo, Tempranillo→orange, whites→green/gold/coral/cyan) |
| 14.7 | 4 origin charts missing export buttons | FIXED — Wave 2d: export buttons added with CSP-safe `data-chart-id`/`data-chart-title` attrs |
| 14.4 | Extraction pair duplication | FIXED — `_buildExtractionPairs()` extracted as shared helper |

### Missing Tests

No tests exist in this project (vanilla JS, CDN-only). This is an existing gap, not introduced by these changes.

### Notes

- **No source code in this diff** — all changes are doc/config updates. Risk is zero for regressions.
- **`.claude/settings.local.json`** grew by 78 lines of tool permission entries. This is user-specific config, not deployed. No security concern — entries reflect debugging sessions (Playwright, bcrypt, curl). Does not affect production.
- **CLAUDE.md updates are accurate.** Verified: project structure matches (new `api/logout.js`, `api/upload.js`, `sql/migration_rate_limits.sql`, `sql/migration_token_blacklist.sql` all exist). Feature descriptions match committed code. Roadmap correctly marks Phases 1–6 + Security Hardening as complete.
- **PLAN.md refactored from Phase 6 to Round 7 bug fixes.** Wave structure is sound. Task 1d (CSP connect-src) is already resolved and should be marked done.
- **TASK.md refactored to status dashboard format.** Item counts and priorities match REVIEW.md. Cross-references are consistent.
- **Branch `feature/csp-inline-handler-migration`** has 2 commits ahead of `main` (`31a7062`, `2287b96`). These are source code changes already committed — not part of this review's uncommitted diff. The uncommitted changes are doc-only updates that should be committed and merged alongside the CSP migration branch.

---

## 18. FULL BRANCH REVIEW — CSP Inline Handler Migration (Round 9)

> Full review of all source code changes on `feature/csp-inline-handler-migration` vs `main`.
> 4 commits: `31a7062`, `2287b96`, `bb288a5`, `af801fa`
> 16 files changed: +2751 / -260 lines (mostly new `events.js` + `REPORTE_DASHBOARD.txt` + docs)
> Source files: `js/events.js` (new, 237 lines), `index.html` (171 lines changed), `js/app.js`, `js/charts.js`, `js/explorer.js`, `js/maps.js`, `api/upload.js`, `css/styles.css`, `vercel.json`

### Verification Summary

- **Zero inline handlers remain** — Confirmed: `grep -rn 'onclick=\|onchange=\|onkeydown=' js/ index.html` → 0 matches
- **events.js binds 71+ handlers** via 12 methods in `bindAll()` — all DOM container IDs verified in `index.html`
- **CSP `connect-src`** correctly updated: only `archive-api.open-meteo.com` is used (`weather.js:11`)
- **Script load order** correct: `events.js` loaded after all dependencies, before `app.js`
- **`data-*` attribute routing** verified for: filters (`data-clear`), exports (`data-chart-id`/`data-chart-title`/`data-export-direct`), explorer (`data-slot`), maps (`data-section`/`data-ranch`), legends (`data-series`/`data-action`), nav (`data-view`), grape types (`data-grape-type`/`data-wine-grape-type`), color mode (`data-mode`)
- **api/upload.js** duplicate variable fix verified: `supabaseUrl` (line 48) and `serviceKey` (line 49) are the only declarations, reused throughout

### Priority 1 Issues

#### 18.1 Duplicate login form listener — causes 2x `/api/login` requests
- **SEVERITY:** Medium (functional bug, affects rate limiting)
- **FILES:** `js/auth.js:13,151` + `js/events.js:36-37`
- **DESCRIPTION:** `Auth.init()` (line 13) calls `Auth.bindForm()` which adds a submit listener on `#login-form` (auth.js:151). After successful auth, `App.init()` → `Events.bindAll()` → `Events._bindAuth()` adds a SECOND submit listener on `#login-form` (events.js:36-37). On subsequent login (after logout + re-login), both listeners fire, calling `Auth.handleSubmit()` twice, which fires two parallel `fetch('/api/login')` requests. Each counts against the 10-attempt rate limit.
- **REPRODUCTION:** Login successfully → logout → login again → network tab shows 2x POST to `/api/login`.
- **FIX:** Remove the `#login-form` submit binding from `Events._bindAuth()`. `Auth.bindForm()` already handles it. Keep only the `#logout-btn` click binding in `Events._bindAuth()`:
  ```js
  _bindAuth() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => Auth.logout());
  },
  ```

#### 18.2 `Auth.bindForm()` also duplicates the login button click handler
- **SEVERITY:** Low (same root cause as 18.1)
- **FILES:** `js/auth.js:152`
- **DESCRIPTION:** `Auth.bindForm()` binds both `form.submit` AND `btn.click` on `#login-btn`. The button is type="submit" inside the form, so its click already triggers the form submit event. This means even without the Events duplication, a button click fires `handleSubmit` twice (once from click listener, once from submit listener). But `event.preventDefault()` is called in the submit handler, so the form doesn't actually submit twice — both listeners call `login()` in parallel though.
- **FIX:** Remove the `btn.click` listener in `Auth.bindForm()` — the form submit handler is sufficient.

### Priority 2 Improvements

#### 18.3 Round 8 "Resolved" table had stale duplicate 14.12 "PARTIALLY FIXED" entry — FIXED
- **FILE:** `REVIEW.md` (Resolved Since Round 7 table)
- **DESCRIPTION:** Had two 14.12 entries — one correct FIXED and one stale PARTIALLY FIXED. Removed the stale duplicate. Round 8 Open Items matrix was already correctly struck through.

#### 18.5 `.nav-select` lost `margin-bottom: 28px` — minor map view spacing change
- **FILE:** `css/styles.css:269` (diff)
- **DESCRIPTION:** The old `.nav-select` had `margin-bottom: 28px`. This was removed because the new `.nav-tabs` has its own 28px margin. But `#map-metric-select` still uses the `.nav-select` class and lost the bottom margin. The `#map-metric-select` is inside `.map-header` (which has `margin-bottom: 16px`), so the visual impact is minimal — but spacing may differ slightly from before.
- **FIX:** Not urgent. If map metric select spacing looks off, add `#map-metric-select { margin-bottom: 0; }` explicitly to make the intent clear.

#### 18.6 Branch 2 commits ahead of remote — needs push before PR
- **DESCRIPTION:** `git status` shows branch ahead of remote by 2 commits (`af801fa`, `bb288a5`).

### Missing Tests

No tests exist (vanilla JS, CDN-only). Existing gap, not introduced by these changes.

### Notes

- **Overall code quality is good.** The migration approach (data-* attributes + event delegation) is the correct CSP-compliant pattern. Delegation methods use proper null-guarding, `closest()` traversal, and `isNaN()` validation.
- **Nav dropdown → button tabs** is a UX improvement — tap-friendly on mobile, eliminates select element quirks. CSS is responsive with 50% width on desktop, 33% on mobile.
- **Export delegation** correctly preserves the `btn` reference for menu positioning (`showExportMenu(chartId, chartTitle, btn)` where `btn = e.target.closest('.chart-export-btn')`). The `data-export-direct` flag for direct PNG export is handled correctly.
- **Legend `data-series` attribute** correctly uses `replace(/"/g, '&quot;')` for HTML-safe encoding. The browser decodes it back to the original string in `dataset.series`.
- **Explorer `data-slot` + class selectors** cleanly separate click vs change delegation and route to the correct Explorer method.
- **`api/upload.js` fix** was correct and necessary — the duplicate `const` declarations caused a SyntaxError that broke the entire upload endpoint.
- **No unrelated scope expansion.** All changes serve the CSP migration goal. The nav tab change (commit `2287b96`) was needed because the select element's `onchange` was an inline handler.
- **18.1 is the only functional bug** found in the entire branch. Fix is a 3-line deletion.

### Rules for the Builder
- All user-facing messages must be in Spanish
- Follow file responsibility rules from CLAUDE.md (KPIs in `kpis.js`, charts in `charts.js`, etc.)
- Do not introduce npm packages or build tools
- Every fix must be mobile responsive
- Preserve existing Chart.js 4.4.1 and SheetJS 0.18.5 API compatibility
