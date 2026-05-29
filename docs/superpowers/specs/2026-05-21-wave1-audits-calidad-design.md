# Wave 1 — Aggregation correctness + calidad surfacing

**Status:** Draft 2026-05-21 (Playwright-verified)
**Touches:** `js/aggregations.js` (new), `js/kpis.js`, `js/charts.js`, `js/dataLoader.js`, `js/mediciones.js`, `js/maps.js`, `js/app.js`, `index.html`, `css/styles.css`, `tests/mt29-aggregations.test.mjs` (new), `tests/mt30-extraction.test.mjs` (new), `tests/mt31-map-calidad.test.mjs` (new)
**Playwright findings:** #2 confirmed as real bug (different mechanism than reported); #7 cannot be reproduced and is **deferred** from this wave.

## Problem

Five issues, audited in parallel:

| # | Audit finding |
|---|---|
| **#1 Weighted averages** | **CONFIRMED.** 7–9 aggregation sites use `sum / n`. No site uses a per-lot weight. `mediciones_tecnicas.tons_received` exists per lote (joined by `lotCode`) and is unused for weighting today. Distorts metrics whenever lot sizes differ — small experimental lots count equally with large commercial lots. |
| **#2 Calidad map filter "greyed out"** | **Real bug; root cause is a snake_case/camelCase field-naming mismatch in `classification.js`**, not the filter. Playwright confirms: dropdown is fully selectable, pipeline runs end-to-end, but **every parcel renders "Sin clasificar" grey** because `scoreLot()` returns null grade. Root cause: `classification.js` reads `medicion.health_madura`, `health_inmadura`, `health_grade`, `phenolic_maturity` (snake_case) but `_rowToMedicion()` in `dataLoader.js:131` (and `demoMode.js:601-607`) emits the camelCase versions: `healthMadura`, `healthInmadura`, `healthGrade`, `phenolicMaturity`. Sanitary/visual scoring always returns null → `impSum < 60` guard fires → `{ grade: null, reason: 'Datos insuficientes' }` for every lot. Bonus mismatch in `maps.js:110`: reads `s.medicion?.tons_received` but actual field is `s.medicion?.tons`. |
| **#3 Calidad in Mediciones Técnicas** | **Clean integration available.** `scoreLot(row)` accepts a mediciones row and returns `{ grade, score36, percentile, missing }`. No boundary violation, no schema change, existing `.pred-badge` / `.detail-grade-*` CSS is reusable. |
| **#5 Extraction %** | **Half-correct in code.** The denominator picks berry with MAX `daysPostCrush` — the label is *"Días Post-Envero"* (post-veraison) so for berries this means most-mature = closest to harvest = the LAST berry sample. That matches intent. The **numerator** is wrong: `wineByCodigo[code] = d` overwrites with each loop iteration, so the LAST wine record by load order wins — not PEAK ANT. Two sites: `app.js:667`, `charts.js:708`. |
| **#7 Pronóstico no-refresh** | **Cannot reproduce.** Playwright confirms: clicking "Mostrar pronóstico" toggles state, horizon selector becomes visible, network shows correct `forecast_days=7` and `forecast_days=16` fetches on change, both return 200 OK. The data path is intact. Either (a) user's complaint is about subtle visual change between 7d and 16d (hard to see on a 100-day-wide chart), or (b) the chart render after forecast fetch has a subtle Chart.js bug that requires user-side video repro. **Deferred from Wave 1** pending concrete repro steps. |

## Non-goals

- No schema changes (no new columns, no migration).
- No new server-side aggregation (everything stays client-side per current architecture).
- No demo-mode changes (demo data is fictional; weighting is a real-data correctness concern). `DemoMode.enable()` should bypass `_weight` injection.
- No predictor changes (Wave 2 territory).
- No backfill of historical mediciones rows — the fallback policy handles missing weights.
- No changes to wine_samples / berry_samples ordering in Supabase (peak/last computed client-side).

## Key decisions

1. **Weight source**: `mediciones_tecnicas.tons_received`, joined to berry/wine samples by `lotCode`. User-confirmed.
2. **Fallback for lots without mediciones**: `weight = 1`. User-confirmed. Lots silently weight-1, no exclusion. Worst case: behavior is at-least-as-correct as today's pure-arithmetic.
3. **Extraction definitions**:
   - **Berry denominator** = last berry sample (MAX `daysPostCrush`). Already correct — no change needed.
   - **Wine numerator** = PEAK `antoWX` across all `wine_samples` for the lot's `codigoBodega`. Change from current "latest by load order".
4. **Single enrichment pass**: weights and peak computations live in `dataLoader.js`, surfaced as `s._weight` on sample rows. Consumers don't thread `tons` through callsites.
5. **#2 and #7 scope is conditional**: Playwright findings dictate whether they ship in this wave or split off.

## Architecture

### Aggregation util (`js/aggregations.js` — new)

Pure functions, no DOM, no globals.

```javascript
export function weightedMean(rows, valueKey, weightKey = '_weight', { fallbackWeight = 1 } = {}) {
  let num = 0, den = 0;
  for (const r of rows) {
    const v = r[valueKey];
    if (v == null || Number.isNaN(v)) continue;
    const w = (r[weightKey] != null && r[weightKey] > 0) ? r[weightKey] : fallbackWeight;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

export function peakBy(rows, key) {
  let best = null;
  let bestVal = -Infinity;
  for (const r of rows) {
    const v = r[key];
    if (v == null || Number.isNaN(v)) continue;
    if (v > bestVal) { bestVal = v; best = r; }
  }
  return best;
}
```

**Design notes:**
- `fallbackWeight = 1` (not 0, not skip) implements the user's "weight=1 fallback" decision.
- Returns `null` when no valid rows (not `NaN`, not 0) — caller decides display.
- Rejects `NaN` values explicitly — guard against parse errors upstream.

### Lot-weight enrichment (`js/dataLoader.js`)

In `loadAll()` (or wherever berry/wine samples are normalized), after mediciones are fetched, build a `Map<lotCode, tons_received>` and tag each sample:

```javascript
// After existing mediciones load:
const weightByLot = new Map();
for (const m of mediciones) {
  if (m.lotCode && m.tons != null && m.tons > 0) {
    weightByLot.set(m.lotCode, m.tons);
  }
}

// Enrich berry + wine samples:
for (const s of berrySamples) {
  s._weight = weightByLot.get(s.lotCode) ?? null;
}
for (const w of wineSamples) {
  w._weight = weightByLot.get(w.lotCode) ?? null;
}
```

**Guard against demo mode:**
```javascript
if (DemoMode?.isActive?.()) return;  // demo data is fictional, skip enrichment
```

**Why client-side join (not Supabase view):**
- Mediciones load is already happening; reusing it adds zero round-trips.
- A Supabase view would force a schema-touch and migration; non-goal.
- Behavior is deterministic and inspectable in the browser console.

### Refactor sites

Each site shifts from `sum/n` to `weightedMean(rows, key, '_weight')`. Concrete diffs:

**`kpis.js:4-7`** (berry KPI cards) and **`42-45`** (wine KPI cards):
```javascript
// Before:
const avgBrix = rows.reduce((s, r) => s + (r.brix || 0), 0) / rows.length;
// After:
const avgBrix = weightedMean(rows, 'brix');  // null-safe, weight-aware
```

**`charts.js:386-399, 457-469, 903-924, 1497-1515, 2278-2290`**: each follows the same pattern — replace the per-bucket arithmetic mean with `weightedMean(bucket, metricKey, '_weight')`.

**`dataLoader.js:643-653`** (`_enrichBerryWithRecepcion`): this is a fallback that fills berry sample fields from recepción when berry data is sparse. Currently uses simple averages; change to `weightedMean` for consistency (though the weight is the same for all rows in this scope so the result is identical — but keeps the codebase consistent).

**`maps.js:79`** (`aggregateBySection` chemistry rollup): currently hardcodes `const w = 1;`. Change to `const w = (lot._weight && lot._weight > 0) ? lot._weight : 1;` — piggybacks on the `_weight` enrichment from the data-loader pass. Surfaced as the **10th aggregation site** by Playwright while diagnosing #2.

**Numbers shown to user:** weighted means change to 1–2 decimals (existing precision). No tooltip/legend changes — the displayed metric is still labeled the same; the calculation underneath is just more correct.

### Extraction numerator fix

**`js/app.js:667`** and **`js/charts.js:708`** — both have the same loop pattern:

```javascript
// Before (LAST wine record wins):
wineByCodigo[d.codigoBodega] = d;

// After (PEAK ANT wins):
const prev = wineByCodigo[d.codigoBodega];
if (!prev || (d.antoWX || 0) > (prev.antoWX || 0)) {
  wineByCodigo[d.codigoBodega] = d;
}
```

Functionally equivalent to `peakBy(wineSamples.filter(w => w.codigoBodega === code), 'antoWX')`, but inline keeps the existing single-pass loop structure.

**Berry denominator stays as-is.** The MAX-`daysPostCrush` selection at `app.js:648` / `charts.js:692` already means "last berry pre-harvest" given the field's true semantic (days post-veraison, not post-crush).

**Aside (non-goal but worth flagging):** the field is named `daysPostCrush` everywhere in JS but labeled `"Días Post-Envero"` in Spanish UI (`config.js:675, 700`). This is a misnomer that should be renamed in a separate cleanup PR — not in scope here.

### Calidad in Mediciones (`js/mediciones.js`, `index.html`, `css/styles.css`)

1. **In `refresh()`** — precompute scores once:
   ```javascript
   import { scoreLot } from './classification.js';
   data.forEach(d => { d._score = scoreLot(d); });
   ```

2. **`index.html`** — add header to the mediciones table:
   ```html
   <th class="num sortable" data-sort="score36">Calidad</th>
   ```

3. **`renderTable()` (line 454+)** — add cell:
   ```javascript
   <td>${d._score?.grade
     ? `<span class="pred-badge pred-badge-${d._score.grade.toLowerCase().replace('+','-plus')}">${d._score.grade}<small>${d._score.score36?.toFixed(0) ?? '—'}</small></span>`
     : '—'}</td>
   ```

4. **`sortBy()` (line 490+)** — add `'score36'` to sortable keys, sort by `d._score?.score36 ?? -Infinity`.

5. **Edit modal (line 164+)** — after phenolic-maturity input, add a read-only `<div class="detail-grade">` showing grade + score36 + percentile + missing-params hint. Updates live as user edits other fields by re-running `scoreLot()` on input.

6. **CSS** — extend `.pred-badge` color palette to A+ / A / B / C grades. If missing classes, add:
   ```css
   .pred-badge-a-plus { background: var(--color-success-strong); color: white; }
   .pred-badge-a      { background: var(--color-success); color: white; }
   .pred-badge-b      { background: var(--color-warning); color: var(--text-on-warning); }
   .pred-badge-c      { background: var(--color-danger); color: white; }
   ```
   (Exact tokens taken from existing palette — to be confirmed against `css/styles.css`.)

### #2 Calidad map fix (`js/classification.js`, `js/maps.js`)

**Root cause** (verified end-to-end with Playwright + code read): field-naming mismatch. Mediciones objects (post-`_rowToMedicion`) use camelCase, but `classification.js` reads snake_case from them. Four mismatches:

```javascript
// classification.js:68-74 — scoreSanitaryPct(medicion):
medicion.health_picadura  // → should be: medicion.healthPicadura
medicion.health_enfermedad // → healthEnfermedad
medicion.health_quemadura  // → healthQuemadura
medicion.health_madura     // → healthMadura
medicion.health_inmadura   // → healthInmadura
medicion.health_sobremadura // → healthSobremadura

// classification.js:84-85 — scoreVisual(medicion):
medicion.health_grade      // → healthGrade

// classification.js:138 — madurezKey in scoreLot:
lot.medicion?.phenolic_maturity  // → phenolicMaturity

// maps.js:110 — tons read from medicion:
s.medicion?.tons_received  // → s.medicion?.tons
```

When sanitary/visual return null, `impSum` doesn't reach the 60 threshold (line 131 guard) → `Datos insuficientes` → null grade → grey on map.

**Fix:**
1. **`js/classification.js`**: rename the 8 snake_case field reads to camelCase (3 spots: lines 68-74, 84-85, 138).
2. **`js/maps.js:110`**: `s.medicion?.tons_received` → `s.medicion?.tons`.

**No data-flow changes** — the data was always being delivered correctly; classification just couldn't read it.

**Aside — the snake/camel reverse map at `dataLoader.js:599`** (`phenolic_maturity: m.phenolicMaturity`) is used by `upsertMedicion` for write-back to Supabase. That direction is correct (DB uses snake_case). The bug is one-directional: classification reads the wrong shape.

**Bonus catch surfaced by this audit:** `maps.js:79` aggregates section chemistry with `w = 1` hardcoded (unweighted) — so this is **the 10th #1 site**. The mediciones-tons join from #1's enrichment pass (`_weight` injection) already flows through `sectionLots`, so changing `w = 1` → `w = lot._weight ?? 1` here piggybacks for free.

### #7 Pronóstico — deferred

Playwright cannot reproduce the user's reported symptom. The data path works end-to-end:
- Toggle click → `weatherShowForecast` flips, horizon selector becomes visible
- Horizon change → `Filters.state.weatherForecastHorizon` updates → `_forecastSyncAndRender()` → `WeatherStore.syncForecast(valley, h)` for all 3 valleys → 200 OK with correct `forecast_days` param
- `_renderWeatherCharts()` runs after Promise.all resolves

**To revisit:** ask user for a specific repro — "I select horizon X expecting Y but see Z" — with browser console open. Defer until then.

## Tests

**`tests/mt29-aggregations.test.mjs`** — pure unit tests on the new util:

1. `weightedMean` with all-equal weights → matches arithmetic mean.
2. `weightedMean` with disparate weights → large lot dominates as expected.
3. `weightedMean` with NULL weights → fallback=1 kicks in, doesn't silently exclude.
4. `weightedMean` with all NaN values → returns `null`.
5. `weightedMean` with empty array → returns `null`.
6. `peakBy` → returns row with max key.
7. `peakBy` with all NULL → returns `null`.
8. `peakBy` with ties → returns first encountered (document this).

**`tests/mt30-extraction.test.mjs`** — extraction-formula regression:

1. Wine samples for one `codigoBodega` with ascending dates but PEAK ANT in the middle → numerator picks middle (peak), not last (date).
2. Berry samples for one lot with multiple `daysPostCrush` values → denominator picks MAX (most-mature). Already correct, regression-guarded.
3. Integration: build a tiny fake dataset, call `loadAll()`-equivalent, assert extraction% matches hand-computed value.
4. Demo mode enabled → enrichment skipped, no `_weight` on rows (regression guard).

**`tests/mt31-map-calidad.test.mjs`** — calidad scoring regression (the actual fix is field-renames in classification.js):

1. Build a lot with a camelCase medicion (`healthMadura: 70, healthPicadura: 5, healthGrade: 'Bueno', phenolicMaturity: 'Parcial'`) and call `scoreLot`. Assert: `grade` is non-null, `madurezAdj !== 0` (phenolicMaturity is recognized), `buckets.sanitary_pct` and `buckets.visual` are populated.
2. Same lot with `medicion: null` → `grade` may still resolve from chemistry alone if `impSum >= 60`, otherwise `reason: 'Datos insuficientes'`.
3. Build a lot with the OLD snake_case shape (`health_madura`, `health_grade`, `phenolic_maturity`) → `grade` should still be null because we deliberately broke the snake_case path (snake-case mediciones don't exist anywhere in the live codebase). Regression-pin this so nobody re-introduces snake-case readers.
4. Integration: `MapStore.aggregateBySection()` on synthetic data with camelCase mediciones → at least one section's grade is non-null.

**Manual UAT:**
- Open demo mode + map view → at least some parcels show A+/A/B/C colors, not all grey.
- Open a real vintage with mixed lot sizes → eyeball KPI cards before/after for weighted-mean shift.

## Risks

- **R1 — Calidad CSS palette tokens may not exist.** If `var(--color-success-strong)` etc. aren't defined, the badge renders unstyled. **Mitigation:** read `css/styles.css` during implementation, reuse the predictor's existing badge palette (`.pred-badge-alta` / `.media` / `.baja`) re-mapped to A+/A/B/C if needed.
- **R2 — Peak ANT may be a lab spike, not real peak.** A single noisy measurement skews extraction high. **Mitigation:** defer outlier filtering until real data shows the problem. Spec for now: pure max.
- **R3 — `_weight` mutates sample rows in place.** If another consumer relies on the original shape (e.g., for serialization), `_weight` leaks into JSON. **Mitigation:** prefix with `_` (signals internal), document in `dataLoader.js`. If a consumer needs to serialize, they strip `_*` keys.
- **R4 — Demo mode interaction.** Demo overlay produces its own samples; injecting `_weight = null` on them produces "weight=1 fallback for everything" which is fine — but if demo creates a small experimental lot, it now contributes equally. **Mitigation:** acceptable — demo data is fictional, the weighting math is what matters.
- **R5 — Mediciones-less lots become invisible to ops teams.** Currently no signal that a lot lacks tonnage. Future improvement (out of scope): banner in mediciones view listing lots without `tons_received`.

## Open items (resolved before plan-writing)

- [x] Playwright verification of #2 — **confirmed real bug; mechanism is missing classification inputs in map dataset, not the filter itself**
- [x] Playwright verification of #7 — **cannot reproduce; deferred from wave**
- [ ] Confirm `.pred-badge-a` etc. color tokens exist in `css/styles.css` (or pick existing ones to reuse) — implementer's task during Wave 1

## Wave 1 scope summary

In: **#1** (weighted averages), **#3** (calidad in mediciones), **#5** (extraction numerator), **#2** (calidad on map — different mechanism than reported).

Out: **#7** (pronóstico — cannot reproduce; revisit with user repro steps).
