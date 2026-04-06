# Plan — Wave 3 + Wave 4 Implementation

## Branch: `feature/wave3-wave4-fixes`
**Source:** REVIEW.md Rounds 7–9, TASK.md  
**Prerequisite:** Waves 1–2 committed on main (cf25021)

---

## Pre-flight: Commit Existing Changes (Step 0)

Three files already have uncommitted fixes (4e + 4f). Commit these before starting new work.

**Files:** `.vercelignore`, `js/auth.js`, `js/events.js`  
**Commit message:** `fix: vercelignore docs exclusion + duplicate login listener guard`

---

## Wave 3 — Weather: GDD Chart + Location Filter

### 3a — HTML: Valley Selector + GDD Canvas
**File:** `index.html`

1. In the weather section header (currently Line ~605, hard-coded "Clima durante la Vendimia — Valle de Guadalupe"):
   - Replace static text with a `<span id="weather-valley-label">Valle de Guadalupe</span>`
   - Add 3 valley toggle buttons: `<button class="valley-btn active" data-valley="VDG">VDG</button>`, `VON`, `SV`
   - Style as chip-style buttons matching existing filter chip aesthetic
2. After `#chartWeatherRain` canvas (~Line 618), add:
   ```html
   <div class="chart-card">
     <div class="chart-header"><h3>GDD Acumulados</h3><button class="export-btn" data-chart="chartGDD" data-title="GDD Acumulados">PNG</button></div>
     <canvas id="chartGDD"></canvas>
   </div>
   ```

### 3b — Filter State: `weatherLocation`
**File:** `js/filters.js`

1. Add `weatherLocation: 'VDG'` to `Filters.state` (after `colorBy`)
2. Add method `setWeatherLocation(loc)`:
   ```javascript
   setWeatherLocation(loc) {
     this.state.weatherLocation = loc;
     // Update button active states
     document.querySelectorAll('.valley-btn').forEach(b => 
       b.classList.toggle('active', b.dataset.valley === loc));
     // Update header text
     const label = document.getElementById('weather-valley-label');
     if (label) label.textContent = CONFIG.VALLEY_NAMES[loc] || loc;
     App.refresh();
   }
   ```
3. Add `VALLEY_NAMES` to `js/config.js`: `{ VDG: 'Valle de Guadalupe', VON: 'Valle de Ojos Negros', SV: 'San Vicente' }`

**File:** `js/events.js`

4. In `_bindFilters()`, add delegation for `.valley-btn` click → `Filters.setWeatherLocation(btn.dataset.valley)`

### 3c — GDD Cumulative Chart
**File:** `js/charts.js`

Add `createGDDChart(canvasId, berryData, location)`:
- **Type:** Line chart
- **X-axis:** Day of season (1 = Jul 1, labels: Jul, Aug, Sep, Oct)
- **Y-axis:** Cumulative GDD (°C·days)
- **Data source:** `WeatherStore.getRange(julFirst, octEnd, location)` → accumulate `max(0, (temp_max + temp_min)/2 - 10)` per day
- **Lines:** One line per vintage year (from `WeatherStore.getVintagesFromData()`) so user can compare seasons
- **Colors:** Vintage-based palette (current year bold, prior years muted)
- **Tooltip:** "Día X — GDD: Y.Y°C·días"

### 3d — Pass Location to All Weather Charts
**File:** `js/app.js` (vintage view rendering, ~Line 335)

Update the vintage/weather view render calls:
```javascript
const loc = Filters.state.weatherLocation;
Charts.createWeatherTimeSeries('chartWeatherTemp', vintages, loc);
Charts.createRainfallChart('chartWeatherRain', vintages, loc);
Charts.createGDDChart('chartGDD', cleanBerry, loc);
```

**File:** `js/charts.js`

Update signatures:
- `createWeatherTimeSeries(canvasId, vintages, location = 'VDG')` — pass `location` to `WeatherStore.getRange()`
- `createRainfallChart(canvasId, vintages, location = 'VDG')` — same
- Harvest calendar weather overlay — pass location if applicable

### 3e — Dynamic Header Text
Handled within 3b (`setWeatherLocation` updates `#weather-valley-label`). Initial render in `App.refresh()` should also set the label based on `Filters.state.weatherLocation`.

### Wave 3 Validation
- Switch valley dropdown → all 3 weather charts + GDD chart update
- GDD chart shows accumulation curve starting Jul 1
- Header reflects selected valley name in Spanish
- Export buttons work on GDD chart
- Mobile: valley buttons wrap cleanly

---

## Wave 4 — Data Integrity + Quick Fixes

### 4a — Same-Day Duplicate Handling (`sample_seq`)
**Effort:** Medium — 4 files + 1 new SQL migration

**Step 1: SQL Migration**
**File:** `sql/migration_sample_seq.sql` (new)
```sql
-- Add sample_seq column
ALTER TABLE wine_samples ADD COLUMN sample_seq INTEGER NOT NULL DEFAULT 1;

-- Drop old unique constraint
ALTER TABLE wine_samples DROP CONSTRAINT IF EXISTS wine_samples_sample_id_sample_date_key;

-- Create new composite unique constraint
ALTER TABLE wine_samples ADD CONSTRAINT wine_samples_sample_id_date_seq_key 
  UNIQUE (sample_id, sample_date, sample_seq);
```

**Step 2: Client Upload**
**File:** `js/upload.js`

In `parseWineXRay()` (or before `upsertRows()` call):
1. Group parsed rows by `(sample_id, sample_date)`
2. Within each group, sort deterministically by value fingerprint: `tANT` → `pH` → `berry_weight` (nulls last)
3. Assign `sample_seq = 1, 2, 3...` per group position
4. Add `sample_seq` to each row object sent to API

**Step 3: Server Upload**
**File:** `api/upload.js`

Change `ALLOWED_TABLES.wine_samples.conflict` from `'sample_id,sample_date'` to `'sample_id,sample_date,sample_seq'`

**Step 4: Chart Display Offset**
**File:** `js/charts.js`

Where `daysPostCrush` is used for x-axis positioning (scatter charts in berry/evolution views):
- Compute display value: `daysPostCrush + ((d.sample_seq || 1) - 1) * 0.15`
- Tooltip still shows raw `daysPostCrush`
- Only affects visual spread, not data

### 4b — Cross-Lot Same-Day Jitter
**File:** `js/charts.js`

Add deterministic jitter for points from different lots on the same day:
```javascript
function _hashJitter(sampleId) {
  let hash = 0;
  for (let i = 0; i < sampleId.length; i++) 
    hash = ((hash << 5) - hash) + sampleId.charCodeAt(i);
  return ((hash % 40) - 20) / 100;  // ±0.2 days
}
```
Apply to display `daysPostCrush` (additive with 4a's `sample_seq` offset). Tooltip shows raw value.

### 4c — Extraction Table Respects Filters
**File:** `js/app.js` — `updateExtractionTable()` (~Line 571)

Current bug: uses `DataStore.berryData` and `DataStore.wineRecepcion` (raw, unfiltered).

Fix:
1. Accept filtered data as parameters: `updateExtractionTable(filteredBerry, filteredWine)`
2. In the extraction view case (~Line 316), pass the already-filtered data:
   ```javascript
   this.updateExtractionTable(cleanBerry, filteredWineExt);
   ```
3. Inside the function, iterate `filteredBerry` instead of `DataStore.berryData`, and `filteredWine` instead of `DataStore.wineRecepcion`
4. Keep `CONFIG.berryToWine` mapping logic — just filter the data sources

### 4d — Blacklist Check in `api/config.js`
**File:** `api/config.js`

After HMAC signature verification and expiry check, add blacklist lookup matching `api/verify.js:47-62`:
```javascript
// Check token blacklist
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data } = await supabase
  .from('token_blacklist')
  .select('token_hash')
  .eq('token_hash', tokenHash)
  .maybeSingle();
if (data) return res.status(401).json({ error: 'Token revoked' });
```
Must also make handler `async` and compute `tokenHash` from the token (SHA-256 or match existing pattern in `api/logout.js`).

### Wave 4 Validation
- Upload CSV with same-day duplicates → both rows preserved with seq 1, 2
- Re-upload same CSV → upsert overwrites identically (idempotent)
- Overlapping cross-lot points visually separated
- Filter variety in extraction view → table shows only matching pairs
- Logout → try `/api/config` with old token → 401
- All existing functionality unchanged

---

## Implementation Order

```
Step 0: Commit existing 4e+4f changes
         │
    ┌────┴────┐
    ▼         ▼
 Wave 3    Wave 4
 (3a→3b    (4d→4c→4a→4b)
  →3c→3d)
    │         │
    └────┬────┘
         ▼
   Final commit + push
```

### Recommended sequence within waves:

**Wave 3:** 3a → 3b → 3c → 3d/3e (sequential — each step builds on prior)

**Wave 4 (can parallelize some):**
- 4d (blacklist) — independent, do first (security)
- 4c (extraction filter) — independent, small change
- 4a (sample_seq) — medium effort, requires migration then code
- 4b (jitter) — depends on 4a's offset logic being in place

**Wave 3 and Wave 4 are independent** — can be worked in parallel by separate agents.

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| `sample_seq` migration breaks existing data | Default to 1, additive only, no data modification |
| Weather charts break when switching valley | Defensive: `getRange()` already handles unknown locations gracefully |
| Extraction table filter changes hide valid data | Keep `CONFIG.berryToWine` pairing, only filter input data |
| GDD calculation edge cases (missing weather days) | `getCumulativeGDD()` already has >3-day gap guard, returns null |
| Blacklist check adds latency to `/api/config` | Single indexed lookup, same pattern as 3 other endpoints |

---

## After This Branch

- Wave 5 (security hardening, dead CSS) → separate branch
- PR to main after Waves 3+4 validated
- Phase 7 (Mediciones) blocked until all waves merged
