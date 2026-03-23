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

### 2.1 Concurrent refresh from cache + Supabase load — PARTIALLY FIXED
- **SEVERITY:** ~~High~~ Medium (guard added but incomplete)
- **CATEGORY:** Race Condition
- **FILE:LINE:** `js/app.js:262-320`
- **DESCRIPTION:** Guard flag `_refreshInProgress` + `_refreshPending` pattern added, preventing concurrent refreshes. **However, missing `try/finally`:** if any chart/table/KPI method throws during `refresh()`, the flag stays `true` permanently, silently blocking all future refreshes and freezing the dashboard. PLAN.md explicitly warned: "If `refresh()` throws, the guard flag could get stuck. Use try/finally."
- **REMAINING FIX:** Wrap the body of `refresh()` in `try { ... } finally { this._refreshInProgress = false; }` and check `_refreshPending` inside the `finally` block.

### 2.2 IntersectionObserver not disconnected on view switch — FIXED
- **SEVERITY:** ~~High~~ Resolved
- **CATEGORY:** Race Condition / Memory Leak
- **FILE:LINE:** `js/app.js:235-240`
- **DESCRIPTION:** `setView()` now calls `Charts._lazyObserver.disconnect()`, clears `_lazyQueue`, and calls `Charts._pruneOrphans()` before rendering the new view.

### 2.3 Weather sync partial failure + concurrent calls
- **SEVERITY:** Medium
- **CATEGORY:** Race Condition
- **FILE:LINE:** `js/weather.js:42-93`
- **DESCRIPTION:** `sync()` updates in-memory state (`_byDate`, `data`) regardless of whether the Supabase upsert succeeded. If upsert fails for one valley/year, in-memory cache diverges from DB. Two concurrent `sync()` calls can also race on the shared state.
- **REPRODUCTION:** Network interruption during sync for VON/2024. In-memory cache shows data that isn't in DB. Cache clear forces refetch, data disappears.
- **SUGGESTED FIX:** Only update `_byDate`/`data` after confirmed upsert success. Add a `_isSyncing` flag to prevent concurrent calls.

### 2.4 Render fires after canvas hidden — FIXED
- **SEVERITY:** ~~Medium~~ Resolved
- **CATEGORY:** Race Condition
- **FILE:LINE:** `js/charts.js:1192-1203`
- **DESCRIPTION:** Observer callback now checks `entry.target.closest('.view-panel')` for `active` class before calling `job.fn()`. Combined with 2.2 fix (disconnect on view switch), stale renders are fully prevented.

### 2.5 Refresh during paginated Supabase load
- **SEVERITY:** Medium
- **CATEGORY:** Race Condition
- **FILE:LINE:** `js/app.js:21-26`
- **DESCRIPTION:** When cache loads first, a background Supabase load starts. If `refresh()` is called while `_fetchAll()` is still paginating, `Filters.getFiltered()` operates on partially-loaded data.
- **REPRODUCTION:** Cache hit + slow Supabase (2-3s latency). Second refresh fires mid-pagination, showing incomplete datasets.
- **SUGGESTED FIX:** Only call `refresh()` after `loadFromSupabase()` has fully resolved (all pages fetched).

---

## 3. FILTER STATE CONSISTENCY

### 3.1 Stale lot IDs persist in Filters.state.lots — FIXED
- **SEVERITY:** ~~Critical~~ Resolved
- **CATEGORY:** Filter State
- **FILE:LINE:** `js/filters.js:347-358`
- **DESCRIPTION:** `getFiltered()` now validates lot selections against data filtered without the lot filter. Stale lots are auto-removed from `state.lots` and their chip CSS class is cleared. Set deletion during `for...of` iteration is spec-safe.

### 3.2 Filter state not visually confirmed on view return
- **SEVERITY:** Medium
- **CATEGORY:** Filter State / UX
- **FILE:LINE:** `js/app.js:196-223`
- **DESCRIPTION:** Berry and wine filters are independently maintained (`Filters.state` / `Filters.wineState`), which is by design (see 3.4). However, when returning to a view, filter chips and UI controls are not rebuilt to reflect the preserved state. Users may not realize previous filters are still active.
- **REPRODUCTION:** Select Vintage 2024 + Syrah in Berry view. Switch to Wine view. Switch back to Berry. Filters are still active but the UI may not clearly indicate which ones.
- **SUGGESTED FIX:** Rebuild filter chips UI in `setView()` when returning to a view, so preserved filters are visually confirmed.

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

### 4.2 IP spoofing bypasses rate limiting
- **SEVERITY:** High
- **CATEGORY:** Security / Rate Limit Bypass
- **FILE:LINE:** `api/login.js:32`
- **DESCRIPTION:** `x-forwarded-for` is used as-is for the rate-limit key, without splitting on commas. An attacker can vary the header value to get fresh rate-limit buckets.
- **REPRODUCTION:** Send login attempts with different `x-forwarded-for` values: `192.168.1.100, proxy1`, then `192.168.1.101, proxy1`. Each gets 10 fresh attempts.
- **SUGGESTED FIX:** Extract the leftmost IP: `req.headers['x-forwarded-for']?.split(',')[0].trim()`.

### 4.3 Role fallback defaults to 'admin' on token decode failure
- **SEVERITY:** Low
- **CATEGORY:** Security / Defense-in-Depth
- **FILE:LINE:** `js/auth.js:85-86`
- **DESCRIPTION:** During login, the role is extracted from the token payload (`payload.role`), not localStorage. The `|| 'admin'` fallback on line 85 and the `catch` on line 86 only activate if the server returns a malformed token without a role field. The `init()` catch path (line 41) also defaults to admin, but immediately shows the login screen (line 46), blocking any privilege escalation. Incognito mode does NOT trigger this — modern browsers support localStorage in private browsing.
- **REPRODUCTION:** Server returns a token with no `role` in its payload. Client decodes it and defaults to admin. Unlikely without a server-side bug.
- **SUGGESTED FIX:** Change default from `'admin'` to `'viewer'` (least privilege) in both `auth.js:85-86` and `auth.js:41`.

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

### 5.3 _applyThemeToCharts() — API MISMATCH
- **SEVERITY:** Low
- **CATEGORY:** UI
- **FILE:LINE:** `js/charts.js:80`
- **DESCRIPTION:** `chart.update('none')` was changed to `chart.update({ duration: 400, easing: 'easeOutQuart' })` for C2 (theme transition animation). However, Chart.js 4.4.1 `update()` accepts a string mode, not an object. The object is silently ignored and default animation plays instead. Functionally harmless but doesn't achieve the intended 400ms easeOutQuart.
- **SUGGESTED FIX:** Set `chart.options.animation = { duration: 400, easing: 'easeOutQuart' }` before calling `chart.update()`, or simply use `chart.update()` for default animation.

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

## 8. C-TIER IMPLEMENTATION REVIEW

### C1 Offline fallback notification — VERIFIED CORRECT
- **Files:** `js/app.js:186-202`, `index.html`, `css/styles.css`
- Toast shows "Usando datos en caché (última actualización: X)" with `es-MX` locale when Supabase fails. 6-second auto-dismiss. `#offline-toast` inside `#dashboard-content`, styled with slide-up animation.

### C2 Chart theme transition — API MISMATCH (see 5.3)
- **File:** `js/charts.js:80`
- `chart.update({ duration: 400, easing: 'easeOutQuart' })` — Chart.js 4.4.1 ignores object argument. Default animation plays instead. See finding 5.3 for fix.

### C3 Upload duplicate detection — VERIFIED CORRECT
- **File:** `js/upload.js:183-204`
- `_detectDuplicates()` queries existing rows by primary/composite key before upsert. Shows "X nuevas, Y actualizadas" in pending and success messages. Wrapped in try/catch, returns 0 on failure (non-blocking).

---

## Priority Matrix

### Open Items

| Priority | ID | Severity | Category | Fix Effort |
|----------|----|----------|----------|------------|
| 1 | 4.1 | Critical | Security | Medium |
| 2 | 4.2 | High | Security | Low |
| 3 | 2.1 | Medium | Race Condition (incomplete) | Low (add try/finally) |
| 4 | 3.2 | Medium | Filter State / UX | Medium |
| 5 | 2.3 | Medium | Race Condition | Medium |
| 6 | 2.5 | Medium | Race Condition | Low |
| 7 | 4.4 | Medium | Security | Medium |
| 8 | 4.5 | Medium | Security | Medium |
| 9 | 4.3 | Low | Security / Defense-in-Depth | Low |
| 10 | 5.3 | Low | UI (Chart.js API mismatch) | Low |

### Resolved Items

| ID | Category | Resolution |
|----|----------|------------|
| 5.1 | XSS | FIXED (A-tier) |
| 3.1 | Filter State | FIXED — stale lot auto-cleanup |
| 2.2 | Memory Leak | FIXED — observer disconnect on view switch |
| 2.4 | Race Condition | FIXED — active panel check |
| 5.2 | Memory Leak | FIXED — `_pruneOrphans()` |
| 5.4 | Data Integrity | FIXED — pH filter centralized in `app.js` |
| 6.1 | Data Integrity | FIXED — API schema validation |
| 6.2 | Data Integrity | FIXED — GDD missing day threshold |
| 6.3 | Data Integrity | FIXED — negative rainfall guard |
| 1.1 | Data Integrity | FIXED — header validation error |
| 1.2 | Data Integrity | FIXED — vintage range guard |
| B4 | Data Integrity | FIXED — preferment vintage from batch_code |

### Rules for the Builder
- All user-facing messages must be in Spanish
- Follow file responsibility rules from CLAUDE.md (KPIs in `kpis.js`, charts in `charts.js`, etc.)
- Do not introduce npm packages or build tools
- Every fix must be mobile responsive
- Preserve existing Chart.js 4.4.1 and SheetJS 0.18.5 API compatibility
