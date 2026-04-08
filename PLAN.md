# Round 10 Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all Round 10 review findings (4 P1 issues + 5 P2 improvements), then merge `feature/wave3-wave4-fixes` → `main`.

**Architecture:** Vanilla JS single-page app, no framework. Charts via Chart.js 4.4.1 (CDN). Data from Supabase. Weather from Open-Meteo API cached in `WeatherStore`. All labels in Spanish. Serverless API endpoints on Vercel (Node.js ESM).

**Tech Stack:** Vanilla JS (ES6), Chart.js 4.4.1, Supabase, Vercel serverless, bcryptjs

---

## File Map

| File | Responsibility | Tasks |
|------|---------------|-------|
| `js/charts.js` | All Chart.js rendering | 6a, 7a |
| `js/filters.js` | Filter state & UI management | 6b |
| `js/app.js` | Main app logic, routing, refresh | 6a (caller), 7e |
| `js/events.js` | Event delegation & handlers | 7d |
| `api/logout.js` | Token revocation endpoint | 6c |
| `api/config.js` | Supabase credentials endpoint | 7b |
| `api/lib/rateLimit.js` | In-memory rate limiter | 7c |
| `.gitignore` | Git exclusion patterns | 6d |
| `.vercelignore` | Vercel deploy exclusions | 6d |

No new files are created. All changes are modifications to existing files.

---

## Wave 6 — P1 Fixes (Must Fix Before Merge)

### Task 6a: Pass valley location to harvest calendar

**Files:**
- Modify: `js/charts.js:1350` — add `location` parameter to `createHarvestCalendar`
- Modify: `js/charts.js:1409` — pass `location` to `WeatherStore.getRange()`
- Modify: `js/app.js:334` — pass `weatherLoc` to `createHarvestCalendar` call

**Context:** Every other weather chart receives a `location` parameter (see `charts.js:1053`, `1126`, `1198`, `1274`). The harvest calendar at line 1409 was missed — it calls `WeatherStore.getRange()` without the third argument, so it always defaults to `'VDG'`. The `getRange` signature is `getRange(startDate, endDate, location)` (weather.js:168) and defaults to `'VDG'` when location is falsy.

- [ ] **Step 1: Add `location` parameter to `createHarvestCalendar`**

In `js/charts.js`, change the function signature at line 1350:

```javascript
// Before:
createHarvestCalendar(canvasId, berryData, wineData, vintage) {

// After:
createHarvestCalendar(canvasId, berryData, wineData, vintage, location) {
```

- [ ] **Step 2: Pass `location` to `WeatherStore.getRange()` inside `createHarvestCalendar`**

In `js/charts.js`, change line 1409:

```javascript
// Before:
const weatherRows = WeatherStore.getRange(`${vintage}-07-01`, `${vintage}-10-31`);

// After:
const weatherRows = WeatherStore.getRange(`${vintage}-07-01`, `${vintage}-10-31`, location);
```

- [ ] **Step 3: Pass `weatherLoc` from caller in `app.js`**

In `js/app.js`, line 334. The variable `weatherLoc` is already defined on line 338 as `Filters.state.weatherLocation || 'VDG'`. Move it above line 334 and pass it:

```javascript
// Before (lines 333-338):
const calVintage = activeVintages.length === 1 ? activeVintages[0] : (activeVintages.length ? Math.max(...activeVintages) : null);
Charts.createHarvestCalendar('chartHarvestCal', cleanBerry, Filters.getFilteredWine(), calVintage);
const valleyVintage = activeVintages.length === 1 ? activeVintages[0] : (activeVintages.length ? Math.max(...activeVintages) : WeatherStore.getVintagesFromData().slice(-1)[0] || null);
Charts.createValleyTempChart('chartValleyTemp', valleyVintage);
const weatherVintages = WeatherStore.getVintagesFromData();
const weatherLoc = Filters.state.weatherLocation || 'VDG';

// After:
const calVintage = activeVintages.length === 1 ? activeVintages[0] : (activeVintages.length ? Math.max(...activeVintages) : null);
const weatherLoc = Filters.state.weatherLocation || 'VDG';
Charts.createHarvestCalendar('chartHarvestCal', cleanBerry, Filters.getFilteredWine(), calVintage, weatherLoc);
const valleyVintage = activeVintages.length === 1 ? activeVintages[0] : (activeVintages.length ? Math.max(...activeVintages) : WeatherStore.getVintagesFromData().slice(-1)[0] || null);
Charts.createValleyTempChart('chartValleyTemp', valleyVintage);
const weatherVintages = WeatherStore.getVintagesFromData();
```

Note: `weatherLoc` is moved up 4 lines. The later references on lines 339-341 still work because the variable is now defined earlier in the same scope.

- [ ] **Step 4: Verify manually**

Run `npm start`, navigate to Vendimias view, select a vintage, switch valley selector to VON or SV — the harvest calendar weather overlay should update to match the selected valley.

- [ ] **Step 5: Commit**

```bash
git add js/charts.js js/app.js
git commit -m "fix: harvest calendar now respects valley selector (#P1.1)"
```

---

### Task 6b: Reset `weatherLocation` and valley UI in `clearAll()`

**Files:**
- Modify: `js/filters.js:205-221` — add state reset + UI reset inside `clearAll()`

**Context:** `clearAll()` resets vintages, varieties, origins, lots, grapeType, colorBy — but never touches `state.weatherLocation`, the `#weather-valley-select` dropdown, or the `#weather-section-title` text. After "Limpiar Todo", the valley selector can show VON/SV while the state may have drifted.

- [ ] **Step 1: Add weather state + UI reset to `clearAll()`**

In `js/filters.js`, inside `clearAll()`, after the line `if (lotSearch) lotSearch.value = '';` and before `this.filterLotSearch('');`, add:

```javascript
// Reset weather valley to default
this.state.weatherLocation = 'VDG';
const valleySelect = document.getElementById('weather-valley-select');
if (valleySelect) valleySelect.value = 'VDG';
const weatherTitle = document.getElementById('weather-section-title');
if (weatherTitle) weatherTitle.textContent = 'Clima durante la Vendimia — Valle de Guadalupe';
```

- [ ] **Step 2: Verify manually**

Run `npm start`, switch valley to VON, click "Limpiar Todo" — valley selector should reset to VDG, header should read "Valle de Guadalupe".

- [ ] **Step 3: Commit**

```bash
git add js/filters.js
git commit -m "fix: clearAll resets weather valley selector to VDG (#P1.2)"
```

---

### Task 6c: Verify HMAC signature before blacklisting in logout

**Files:**
- Modify: `api/logout.js` — import `verifyToken`, verify token before blacklisting

**Context:** Currently `logout.js` accepts any arbitrary string as a token, hashes it, and inserts it into `token_blacklist`. An attacker could spray forged token hashes to pollute the blacklist table. The shared `verifyToken` module (`api/lib/verifyToken.js`) already handles HMAC verification + expiry checks. We should verify the token is valid before blacklisting it. Note: we do NOT check the blacklist during this verification (a token being re-blacklisted is harmless), just signature + expiry.

- [ ] **Step 1: Add `verifyToken` import and verification**

Replace the entire content of `api/logout.js`:

```javascript
import crypto from 'crypto';
import { verifyToken } from './lib/verifyToken.js';
import { rateLimit } from './lib/rateLimit.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  if (!rateLimit(req, res)) return;

  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ ok: false });
  }

  // Verify HMAC signature + expiry before blacklisting (skip blacklist check)
  const result = await verifyToken(token, { checkBlacklist: false });
  if (result.error) {
    return res.status(result.status).json({ ok: false });
  }

  // Hash the token for storage (don't store raw tokens)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (supabaseUrl && serviceKey) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/token_blacklist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ token_hash: tokenHash })
      });
    } catch (err) {
      console.error('[logout] Blacklist insert failed:', err.message);
    }
  }

  res.status(200).json({ ok: true });
}
```

Key change: Added `verifyToken(token, { checkBlacklist: false })` before the blacklist insert. Invalid/expired tokens are rejected with 401. We pass `checkBlacklist: false` because: (a) a token being logged out doesn't need a blacklist check, and (b) re-blacklisting an already-blacklisted token is harmless.

- [ ] **Step 2: Verify manually**

Test logout with a valid session — should succeed (200). Test with a garbage token string — should get 401. Test with an expired token — should get 401.

- [ ] **Step 3: Commit**

```bash
git add api/logout.js
git commit -m "fix: verify HMAC signature before blacklisting token (#P1.3)"
```

---

### Task 6d: Add `RESUMEN*.txt` to `.gitignore` and `.vercelignore`

**Files:**
- Modify: `.gitignore` — add `RESUMEN*.txt` pattern
- Modify: `.vercelignore` — add `RESUMEN*.txt` pattern

**Context:** `RESUMEN_2026-04-06.txt` is an internal work summary containing task details and security gap descriptions. It's not in `.gitignore` or `.vercelignore`. If accidentally committed, it would be publicly visible. Also addresses P2.6 (`.vercelignore` has `REPORTE_DASHBOARD.txt` but not `RESUMEN*.txt`).

- [ ] **Step 1: Add to `.gitignore`**

Add at the end of `.gitignore`, after the `# Test artifacts` section:

```
# Internal summaries
RESUMEN*.txt
PROJECT_SUMMARY.md
```

- [ ] **Step 2: Add to `.vercelignore`**

Add after the existing `REPORTE_DASHBOARD.txt` line:

```
RESUMEN*.txt
PROJECT_SUMMARY.md
```

- [ ] **Step 3: Verify**

```bash
git status
```

`RESUMEN_2026-04-06.txt` and `PROJECT_SUMMARY.md` should no longer appear as untracked files.

- [ ] **Step 4: Commit**

```bash
git add .gitignore .vercelignore
git commit -m "fix: add RESUMEN*.txt and PROJECT_SUMMARY.md to gitignore (#P1.4, #P2.6)"
```

---

## Wave 7 — P2 Improvements (Should Fix)

### Task 7a: Extract shared jitter helper `_applyDaysJitter()`

**Files:**
- Modify: `js/charts.js` — add helper function, refactor lines ~198-208 and ~567-577

**Context:** Two identical jitter code blocks exist: one in the scatter chart builder (~198-208) and one in the vintage comparison builder (~567-577). Both apply `sampleSeq` offset + hash-based lot jitter. Extract to a shared helper to avoid divergence.

- [ ] **Step 1: Add helper function inside the `Charts` object**

Add `_applyDaysJitter` as a private method near the top of the `Charts` object (before the first chart function). Place it after any existing private helpers (like `_drawNoData`). Find the appropriate location:

```javascript
_applyDaysJitter(x, d) {
  // Offset same-day duplicate measurements (same lot, same day)
  if (d.sampleSeq > 1) x += (d.sampleSeq - 1) * 0.15;
  // Deterministic jitter for different lots on the same day
  const lot = d.lotCode || d.sampleId;
  if (lot) {
    let hash = 0;
    for (let c = 0; c < lot.length; c++) hash = ((hash << 5) - hash + lot.charCodeAt(c)) | 0;
    x += ((hash % 41) - 20) * 0.01; // ±0.2 day
  }
  return x;
},
```

- [ ] **Step 2: Replace first jitter block (~lines 198-208)**

In the scatter chart section, replace the inline jitter block:

```javascript
// Before:
if (xField === 'daysPostCrush') {
  // Offset same-day duplicate measurements (same lot, same day)
  if (d.sampleSeq > 1) x += (d.sampleSeq - 1) * 0.15;
  // Deterministic jitter for different lots on the same day
  const lot = d.lotCode || d.sampleId;
  if (lot) {
    let hash = 0;
    for (let c = 0; c < lot.length; c++) hash = ((hash << 5) - hash + lot.charCodeAt(c)) | 0;
    x += ((hash % 41) - 20) * 0.01; // ±0.2 day
  }
}

// After:
if (xField === 'daysPostCrush') {
  x = Charts._applyDaysJitter(x, d);
}
```

- [ ] **Step 3: Replace second jitter block (~lines 567-577)**

In the vintage comparison section, replace:

```javascript
// Before:
if (d.sampleSeq > 1) x += (d.sampleSeq - 1) * 0.15;
// Cross-lot jitter
const lot = d.lotCode || d.sampleId;
if (lot) {
  let hash = 0;
  for (let c = 0; c < lot.length; c++) hash = ((hash << 5) - hash + lot.charCodeAt(c)) | 0;
  x += ((hash % 41) - 20) * 0.01;
}

// After:
x = Charts._applyDaysJitter(x, d);
```

- [ ] **Step 4: Verify manually**

Run `npm start`, check scatter charts and vintage comparison — jitter behavior should be identical to before.

- [ ] **Step 5: Commit**

```bash
git add js/charts.js
git commit -m "refactor: extract shared _applyDaysJitter helper (#P2.1)"
```

---

### Task 7b: Swap auth-before-rate-limit order on `api/config.js`

**Files:**
- Modify: `api/config.js:12-15` — move `verifyToken()` before `rateLimit()`

**Context:** Currently rate limit runs first (line 12), then auth (line 14). This means unauthenticated garbage requests consume the IP's rate-limit bucket, potentially locking out legitimate users behind corporate NAT. Verifying auth first rejects invalid tokens immediately without touching the rate limiter.

- [ ] **Step 1: Swap the order**

In `api/config.js`, change lines 12-18:

```javascript
// Before:
if (!rateLimit(req, res)) return;

const token = req.headers['x-session-token'];
const result = await verifyToken(token, { checkBlacklist: true });
if (result.error) {
  return res.status(result.status).json({ error: result.error });
}

// After:
const token = req.headers['x-session-token'];
const result = await verifyToken(token, { checkBlacklist: true });
if (result.error) {
  return res.status(result.status).json({ error: result.error });
}

if (!rateLimit(req, res)) return;
```

- [ ] **Step 2: Commit**

```bash
git add api/config.js
git commit -m "fix: verify auth before rate limiting on /api/config (#P2.2)"
```

---

### Task 7c: Periodic eviction in rate limiter

**Files:**
- Modify: `api/lib/rateLimit.js:18-23` — change eviction trigger from size > 500 to every 100 inserts

**Context:** Stale entries are only swept when `buckets.size > 500`, a threshold never reached under normal traffic. A counter-based sweep every 100 inserts is more predictable.

- [ ] **Step 1: Add insert counter and change eviction logic**

Replace the full content of `api/lib/rateLimit.js`:

```javascript
// Simple in-memory rate limiter for authenticated endpoints.
// Resets on cold start (acceptable for Vercel serverless).

const buckets = new Map();
let insertCount = 0;

const DEFAULTS = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 60             // per window
};

export function rateLimit(req, res, opts = {}) {
  const { windowMs, maxRequests } = { ...DEFAULTS, ...opts };
  const fwd = req.headers['x-forwarded-for'];
  const ip = req.headers['x-real-ip'] || (fwd ? fwd.split(',')[0].trim() : null) || 'unknown';
  const key = `${req.url}:${ip}`;
  const now = Date.now();

  // Sweep stale entries every 100 inserts
  if (++insertCount >= 100) {
    insertCount = 0;
    for (const [k, v] of buckets) {
      if (now - v.start > windowMs) buckets.delete(k);
    }
  }

  const record = buckets.get(key);
  if (!record || now - record.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }

  record.count++;
  if (record.count > maxRequests) {
    res.status(429).json({ error: 'Demasiadas solicitudes. Intente de nuevo más tarde.' });
    return false;
  }
  return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add api/lib/rateLimit.js
git commit -m "fix: sweep rate limiter every 100 inserts instead of at 500 buckets (#P2.3)"
```

---

### Task 7d: Skip re-render in valley handler when sync finds no new data

**Files:**
- Modify: `js/events.js:30-50` — only re-render after sync if new data was fetched

**Context:** The valley change handler calls `renderWeather()` immediately (correct), then conditionally calls `WeatherStore.sync(vintages).then(renderWeather)`. The `.then(renderWeather)` fires a third render even if sync found no new data. `WeatherStore.sync()` doesn't return a value indicating whether new data was fetched, so we need to compare data length before/after.

- [ ] **Step 1: Track data count before sync, only re-render if changed**

In `js/events.js`, replace the sync block (the `const hasData` check and the following `if` statement):

```javascript
// Before:
renderWeather();
// If no data for this valley, trigger a sync then re-render
const hasData = vintages.some(y => WeatherStore.getRange(`${y}-07-01`, `${y}-10-31`, loc).length > 0);
if (!hasData && vintages.length) {
  WeatherStore.sync(vintages).then(renderWeather);
}

// After:
renderWeather();
// If no data for this valley, trigger a sync then re-render only if new data arrived
const hasData = vintages.some(y => WeatherStore.getRange(`${y}-07-01`, `${y}-10-31`, loc).length > 0);
if (!hasData && vintages.length) {
  const countBefore = WeatherStore.data.length;
  WeatherStore.sync(vintages).then(() => {
    if (WeatherStore.data.length > countBefore) renderWeather();
  });
}
```

- [ ] **Step 2: Verify manually**

Switch valley to one with data already loaded — should NOT cause a double render. Switch to a valley with no data — should sync, then re-render once.

- [ ] **Step 3: Commit**

```bash
git add js/events.js
git commit -m "fix: skip weather re-render when sync fetches no new data (#P2.4)"
```

---

### Task 7e: Use berry vintage for `valleyVintage` fallback

**Files:**
- Modify: `js/app.js:335` — derive fallback from berry data instead of WeatherStore

**Context:** When no vintage filters are active, `valleyVintage` falls back to `WeatherStore.getVintagesFromData().slice(-1)[0]`, which may differ from the berry data's latest vintage. Using `DataStore.berryData` to derive the latest vintage is more intuitive since the chart is about berry/harvest data.

- [ ] **Step 1: Change the fallback**

In `js/app.js`, line 335 (after the `weatherLoc` move from Task 6a, this will be line ~336):

```javascript
// Before:
const valleyVintage = activeVintages.length === 1 ? activeVintages[0] : (activeVintages.length ? Math.max(...activeVintages) : WeatherStore.getVintagesFromData().slice(-1)[0] || null);

// After:
const berryVintages = [...new Set(cleanBerry.map(d => d.vintage).filter(Boolean))];
const valleyVintage = activeVintages.length === 1 ? activeVintages[0] : (activeVintages.length ? Math.max(...activeVintages) : (berryVintages.length ? Math.max(...berryVintages) : null));
```

This derives the fallback from `cleanBerry` (the filtered berry data already available in scope) instead of `WeatherStore`.

- [ ] **Step 2: Verify manually**

Run `npm start`, navigate to Vendimias with no vintage selected — the valley temperature chart should show the latest vintage present in berry data.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "fix: valleyVintage fallback uses berry vintage, not weather vintage (#P2.5)"
```

---

## Post-Implementation

### After Waves 6–7 are complete:

- [ ] **Update TASK.md** — mark all P1 and P2 items as resolved
- [ ] **Update REVIEW.md** — note Round 10 findings are resolved
- [ ] **Run `npm start`** — full manual smoke test across all views
- [ ] **Commit doc updates**

```bash
git add TASK.md REVIEW.md
git commit -m "docs: mark Round 10 findings as resolved"
```

- [ ] **Merge to main via PR**

```bash
git push -u origin feature/wave3-wave4-fixes
gh pr create --title "Round 10 fixes: P1 + P2 findings" --body "..."
```

---

## Out of Scope (Noted for Future)

**Missing tests (MT.1–MT.5):** The project has no unit test framework. Playwright is installed for e2e but there are no unit tests. Adding a test framework (e.g., Vitest) would be a separate task/phase. The 5 missing test areas from REVIEW.md should be addressed when a test framework is established, but are not blockers for this merge.

---

## Completed Work (Waves 1–5)

<details>
<summary>Click to expand</summary>

### Wave 1 — CSP Fix + Export Repair
- `js/events.js` — 237 lines, all event delegation
- 71 static + 11 dynamic inline handlers migrated
- Nav dropdown → tap-friendly button tabs
- CSP `connect-src` updated for `archive-api.open-meteo.com`
- Export fix: jsPDF guard, Image onerror, error toasts

### Wave 2 — Lot Connection + Legends + Colors
- Lot-line plugin connecting same-lot points
- Last-point identification (golden border)
- Native Chart.js legends (visible in exports)
- 10 varietal colors redistributed
- 4 origin chart export buttons

### Wave 3 — Weather: GDD Chart + Location Filter
- Valley selector (VDG / VON / SV) in weather section
- `Filters.state.weatherLocation` with change handler
- GDD cumulative chart (base 10°C, Jul 1 start)
- Multi-valley temperature comparison chart (VDG vs VON vs SV)
- Location param passed to all weather charts
- Dynamic section header text

### Wave 4 — Data Integrity + Quick Fixes
- `sample_seq` column for same-day duplicate handling (SQL migration + upload + chart offset)
- Cross-lot same-day jitter (±0.2 day deterministic hash)
- Extraction table respects active filters
- Blacklist check on `/api/config`
- `.vercelignore` docs exclusion
- Duplicate login listener fix

### Wave 5 — Security Hardening + Cleanup
- `api/lib/verifyToken.js` — shared HMAC + expiry + blacklist verification
- `api/lib/rateLimit.js` — in-memory rate limiting on all authenticated endpoints
- Server-side conflict column (client-provided value ignored)
- ~72 lines dead CSS removed
- Perfil Químico por Origen radar chart removed

### New Files Created
| File | Purpose |
|------|---------|
| `api/lib/verifyToken.js` | Shared token verification (HMAC + expiry + blacklist) |
| `api/lib/rateLimit.js` | In-memory rate limiter for authenticated endpoints |
| `sql/migration_sample_seq.sql` | Adds `sample_seq` column + composite unique constraint |

</details>
