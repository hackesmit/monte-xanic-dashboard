# Code Review — Monte Xanic Dashboard

> Generated from Workflow 2 (Debugging Agent Review) in TASK.md.
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

#### 16.1 PDF/PNG export not working — HIGH
- **FILES:** `js/charts.js:1586-1689`, `index.html:16`
- **DESCRIPTION:** Chart export (both PNG and PDF) is broken in production. Root causes likely compound:
  1. **CSP blocks inline handlers (14.12):** Export buttons use `onclick` which is blocked by Vercel CSP. The delegated listener in `events.js` may not cover all export flows.
  2. **jsPDF CDN race condition:** `jspdf.umd.min.js` loaded with `defer` — if user clicks export before library loads, `window.jspdf` is undefined and export silently fails (console error only, no user feedback).
  3. **PNG Image load race:** `chartImg.onload` callback may not fire if base64 data URL is cached synchronously. No error handler on `chartImg.onerror`.
  4. **Silent failures:** All error paths return silently with no user-facing message in Spanish.
- **FIX:** Ensure export buttons work via delegated event binding (CSP fix). Add loading guard for jsPDF. Add Spanish error toast on failure. Add `onerror` handler on Image.

#### 16.2 Same-lot data points not connected — last-point bug — HIGH
- **FILES:** `js/charts.js:9-23` (`_identifyLastPoints`), `js/charts.js:168-229` (scatter rendering)
- **DESCRIPTION:** After first data update, user reports "the program registers each node as if it's the last and gives it golden border, not allowing to connect the dots." Two related issues:
  1. **No per-lot lines:** Scatter charts group data by variety or origin (`Filters.state.colorBy`), NOT by lotCode. Points from the same lot (e.g., '25CFCC-1' measured on 5 different dates) are mixed into a single variety dataset. There are no lines connecting same-lot measurements over time — each point floats independently.
  2. **Golden border logic:** `_identifyLastPoints()` groups by `lotCode` and flags the point with max `daysPostCrush` per lot. But since scatter datasets are grouped by variety/origin, the golden borders appear scattered throughout the dataset with no visual context for WHY a point is "last" (no connecting line to preceding points).
  3. **Lot identity:** The composite key `(sample_id, sample_date)` means the same `sample_id` appears multiple times with different dates. The grouping must treat all rows with the same `sample_id` as one lot's time series.
- **FIX:** Add per-lot line segments within scatter datasets. When `showLines` is toggled, connect points sharing the same `lotCode` sorted by `daysPostCrush`. Ensure only the true final point per lot gets the golden border. Consider always showing lot lines (thin, semi-transparent) even when `showLines` is false.

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

#### 16.7 Chart legends not visible in PNG/PDF exports — HIGH
- **FILES:** `js/charts.js:238` (`legend: { display: false }`), `js/charts.js:1586-1689` (export functions)
- **DESCRIPTION:** Scatter charts in Bayas view use `legend: { display: false }` and render a custom HTML `<div class="legend-bar">` outside the `<canvas>`. When exporting to PNG/PDF, only the canvas is captured — the HTML legend is NOT included. Exported files have no indication of what colors represent which variety/origin/lot.
- **FIX:** Switch scatter charts to use Chart.js native `legend: { display: true }` so legends render inside the canvas and appear in exports. Or: render legend items onto the export canvas manually during PNG/PDF generation. Native legend is simpler and maintains export fidelity.

#### 16.8 Varietal colors not distinct enough — MEDIUM
- **FILE:** `js/config.js:13-30`
- **DESCRIPTION:** Several varietal color pairs are too similar, especially on dark backgrounds and in exported images:
  - **Cab Sauvignon (#DC143C)** vs **Cab Franc (#C41E3A)** — both dark reds, nearly identical
  - **Cab Franc (#C41E3A)** vs **Tempranillo (#E74C3C)** — both red-adjacent
  - **Marselan (#E91E63)** vs **Merlot (#E040A0)** — both pink/magenta
  - **All whites** — Sauvignon Blanc (#F0E68C), Chardonnay (#F5E6A3), Viognier (#E8D5A0), Chenin Blanc (#D4E8B0) are all pale yellows, nearly indistinguishable
- **FIX:** Redistribute reds across a wider hue range (blue, teal, orange). Make whites clearly distinct (one cool green, one warm gold, one coral, one ice blue). Maintain dark-theme contrast. Perceptual distance between any two colors should be ≥ 30 in CIELAB ΔE.

### FUTURE IDEAS (noted, not prioritized)

#### 16.9 Interactive data point inspection in exports
- **DESCRIPTION:** User expressed interest in seeing data values at each point in exported images. Not immediately needed.
- **NOTE:** Could be achieved by enabling Chart.js `datalabels` plugin (CDN) for export-only rendering, or by annotating the export canvas with point values during PNG/PDF generation.

---

## Priority Matrix (Updated Round 7)

### Open Items

| Priority | ID | Severity | Category | Fix Effort |
|----------|----|----------|----------|------------|
| **0** | **14.12** | **Critical** | CSP blocks inline event handlers on Vercel | High (proper fix) |
| **1** | **16.1** | **High** | PDF/PNG export broken (compounds with CSP + race conditions) | Medium |
| **2** | **16.2** | **High** | Same-lot points not connected, golden border on every point | Medium |
| **3** | **16.5** | **High** | No GDD chart (calculation exists, no visualization) | Medium |
| **4** | **16.6** | **High** | No weather location filter (API ready, no UI) | Medium |
| **5** | **16.7** | **High** | Legends invisible in PNG/PDF exports | Low |
| **6** | **16.3** | **Medium** | Same-day different-hour measurements overwritten | Medium (needs DB decision) |
| **7** | **16.8** | **Medium** | Varietal colors too similar | Low |
| **8** | **14.1** | **High** | Extraction table ignores filters | Low |
| **9** | **14.2** | **High** | Blacklist missing from `api/config.js` | Low |
| **10** | **14.3** | **Medium** | Token verification triplicated | Medium |
| **11** | **14.8** | **Medium** | No rate limiting on upload/verify/logout/config | Medium |
| **12** | **14.9** | **Medium** | User-provided conflict column in upload API | Trivial |
| **13** | **15.2** | **Medium** | Docs deploy to Vercel | Trivial |
| **14** | **16.4** | **Low** | Overlapping points need jitter | Low |
| **15** | **14.5** | **Low** | ~70 lines dead CSS | Trivial |
| **16** | **14.7** | **Low** | 4 origin charts missing export buttons | Trivial |

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
| **0** | **14.12** | **Critical** | CSP inline handlers on Vercel — `events.js` migration done, verify coverage | Verify |
| **1** | **16.1** | **High** | PDF/PNG export (jsPDF race + silent failures) | Medium |
| **2** | **16.2** | **High** | Same-lot points not connected, golden border scattered | Medium |
| **3** | **16.3** | **High** | Same-day measurements overwritten — `sample_seq` fix (decision confirmed) | Medium |
| **4** | **16.5** | **High** | No GDD chart (`getCumulativeGDD()` exists, no viz) | Medium |
| **5** | **16.6** | **High** | No weather location filter (API ready, no UI) | Medium |
| **6** | **16.7** | **High** | Legends invisible in PNG/PDF exports | Low |
| **7** | **17.1** | **High** | Blacklist missing from `api/config.js` (security gap) | Low |
| **8** | **16.8** | **Medium** | Varietal colors too similar | Low |
| **9** | **14.1** | **High** | Extraction table ignores filters | Low |
| **10** | **14.3** | **Medium** | Token verification triplicated | Medium |
| **11** | **14.8** | **Medium** | No rate limiting on upload/verify/logout/config | Medium |
| **12** | **14.9** | **Medium** | User-provided conflict column in upload API | Trivial |
| **13** | **17.3** | **Medium** | Docs deploy to Vercel (.vercelignore) | Trivial |
| **14** | **16.4** | **Low** | Cross-lot same-day jitter (same-lot handled by 16.3) | Low |
| **15** | **14.5** | **Low** | ~70 lines dead CSS | Trivial |
| **16** | **14.7** | **Low** | 4 origin charts missing export buttons | Trivial |

#### Resolved Since Round 7

| ID | Category | Resolution |
|----|----------|------------|
| 17.7 | Upload broken (SyntaxError) | FIXED — removed duplicate `const supabaseUrl` declaration, reused vars from blacklist block |
| 15.1 | CSP connect-src | FIXED in commit `31a7062` — `archive-api.open-meteo.com` added to `connect-src` |
| 14.4 | Extraction pair duplication | FIXED — `_buildExtractionPairs()` extracted as shared helper |
| 14.12 | CSP inline handlers | PARTIALLY FIXED in commits `31a7062` + `2287b96` — 71 handlers migrated to `events.js`, nav converted to button tabs. Needs production verification. |

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

### Rules for the Builder
- All user-facing messages must be in Spanish
- Follow file responsibility rules from CLAUDE.md (KPIs in `kpis.js`, charts in `charts.js`, etc.)
- Do not introduce npm packages or build tools
- Every fix must be mobile responsive
- Preserve existing Chart.js 4.4.1 and SheetJS 0.18.5 API compatibility
