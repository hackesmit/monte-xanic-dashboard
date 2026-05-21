# Design — Harvest-Readiness Predictor

**Date:** 2026-05-19
**Author:** Brainstorm session (user + Claude)
**Status:** Draft — pending user review
**Reference inputs:** rubric thresholds in `js/config.js:1027-1135`; berry sample schema in `sql/migration_berry_samples.sql`; classification engine in `js/classification.js`.

---

## 1. Goal

Add a **Predicción de cosecha** view that estimates, for each `(variety, appellation)` currently in the field, when the lot will simultaneously satisfy the rubric's ideal Brix range **and** anthocyanin threshold — i.e. when it lands in the "A-grade" window. Each prediction ships with:

- a recommended harvest date,
- a confidence band (`±days`) that **widens with the prediction horizon**,
- a confidence label (`Alta / Media / Baja`) that reflects how much **training data** informed it.

A settings page lets lab/admin users override the per-varietal × valley Brix/ANT targets the predictor reads from the rubric.

## 2. Non-goals

- Not predicting fermentation trajectories, final wine quality scores, yield/tonnage, or vintage outlook (each is a separate prediction problem, deferred).
- Not predicting per-lot — berry samples are tagged by `(variety, appellation, vintage_year)` only; lot-level prediction would require schema changes that are out of scope.
- No new ML serving infrastructure. The model is pure JS in the browser.
- No weather features in the MVP. The cumulative-GDD path is a future extension; rubric-driven extrapolation is sufficient first.
- No automated harvest scheduling, crew dispatching, or notifications. Output is informational; user acts on it.
- No editing of the rubric itself. Targets shift only via the override table.

## 3. Architecture & file layout

Pure JS, vanilla ES modules — same discipline as `classification.js`.

**New files:**

- `js/prediction.js` — pure model. Takes plain objects in (this-season berry samples, historical berry samples grouped by vintage, effective target values) and returns a plain prediction object. No DOM, no network, no module-level side effects. Mirrors `classification.js`.
- `js/predictionView.js` — view module. Owns the Predicción DOM tree. Calls `Prediction.computeAll(berryData, targets)`, renders card grid, sorts cards by `daysUntilWindow` ascending, hooks Chart.js mini-charts via `Charts.renderPredictionMini(...)`.
- `js/predictionSettings.js` — settings page module. Renders the editable target-override table, gates editing on lab/admin role, persists via `dataLoader.upsertHarvestTargetOverride(row)`.

**Extended files (minimal additions):**

- `js/dataLoader.js` — `loadHarvestTargetOverrides()` (select from new table) and `upsertHarvestTargetOverride(row)`. No prediction logic here.
- `js/charts.js` — `renderPredictionMini(canvas, lotPrediction)` (line + projection + confidence cone + target line). Pure rendering; no math.
- `js/app.js` — route registration for `predicción` view + `ajustes/objetivos` settings page; refresh wiring.
- `js/migrations-manifest.js` — append `migration_harvest_target_overrides`.
- `index.html` — markup shell for the Predicción view and settings page.
- `js/config.js` — color set for confidence band; no rubric changes.

**Boundaries respected:**

- Queries only in `dataLoader.js`. Math only in `prediction.js`. Charts only in `charts.js`. Settings persistence only via `dataLoader.js`.
- `prediction.js` does not import Supabase, fetch, or DOM APIs — testable headless.

## 4. Data flow

1. **Boot:** `DataStore.loadAll()` (existing) already fetches all berry samples. The predictor reuses `DataStore.berryData`; no new bulk query needed.
2. **New small query:** `dataLoader.loadHarvestTargetOverrides()` — typical ≤ 100 rows, one round trip, cached on `DataStore`.
3. **On view render:** `predictionView.render()`:
   - Pulls samples from `DataStore.berryData`.
   - Groups by `(variety, appellation)`. For each group, splits into **current vintage** (≥ current year) and **historical vintages**.
   - For groups with `n_current ≥ 2`, calls `Prediction.computeOne({ current, historicalByVintage, target })`.
   - Renders one card per group; sorts ascending by `daysUntilWindow`.
4. **Refresh triggers:**
   - Variety/appellation/valley filter chip change → re-render filtered subset using the same in-memory data.
   - Upload completes → existing `DataStore.refresh()` flow re-renders; predictor recomputes automatically.
   - Override saved in settings → re-fetch overrides, recompute, re-render.
5. **Compute strategy:** synchronous, client-side. Typical Monte Xanic dataset (~5 vintages × ~20 varietal-ranches × ~30 samples ≈ 3 000 rows) runs in well under 50 ms total. No worker, no `/api/predict` endpoint, no cache table.
6. **Off-season:** if a varietal-ranch has `n_current ≤ 1`, the predictor returns `{ reason: 'pocos-datos-temporada' }`; the card shows a "Pocos datos esta temporada" placeholder. No math attempted.

## 5. Model

### 5.1 Effective targets (per `(variety, valley)`)

```
brixLower  = override.brix_target_lower   ?? rubric.brix.a[0]
brixUpper  = override.brix_upper          ?? rubric.brix.a[1]
brixTarget = override.brix_target         ?? (rubric.brix.a[0] + rubric.brix.a[1]) / 2
antTarget  = override.anthocyanin_target  ?? rubric.anthocyanins.a
```

Override values that are `NULL` fall through to the rubric. A varietal whose rubric has no anthocyanins entry (whites) yields `antTarget = null`; the predictor uses Brix alone for those.

### 5.2 Weighted linear regression on this-season samples

Let `t = days since first current-vintage sample for the group`, `y = Brix` (or ANT). Weights `wᵢ` decay linearly so the most recent 14 days count 1.5×; older samples weight 1.0×.

Weighted means:
```
t̄_w = Σ wᵢ tᵢ / Σ wᵢ
ȳ_w = Σ wᵢ yᵢ / Σ wᵢ
```

OLS coefficients:
```
β̂   = Σ wᵢ (tᵢ − t̄_w)(yᵢ − ȳ_w) / Σ wᵢ (tᵢ − t̄_w)²
α̂   = ȳ_w − β̂ · t̄_w
ε̂ᵢ  = yᵢ − (α̂ + β̂·tᵢ)
σ̂²  = Σ wᵢ ε̂ᵢ² / (Σ wᵢ − 2)     // weights normalised so Σwᵢ = n
σ̂_β² = σ̂² / Σ wᵢ (tᵢ − t̄_w)²
```

### 5.3 Historical slope prior

For each prior vintage `v` of the same `(variety, appellation)`:

1. Find the vintage's max-Brix sample date `t_v_max`.
2. Take all samples in `[t_v_max − 21 days, t_v_max]` (the late-ripening window).
3. If `< 3` samples in that window, **drop this vintage** (slope too noisy).
4. Fit unweighted OLS slope `β_v` on the survivors.

Let `V` = number of surviving prior vintages.

```
β̄_hist  = mean(β_v)
τ²_hist = sample variance of {β_v}          // prior variance on slope
```

Why "last 21 days only": ripening accelerates near the end. Using whole-vintage slope as a prior systematically underestimates the current rate and biases ETAs late.

### 5.4 Bayesian posterior slope

Treat both as Normal estimators of the true slope:
```
σ²_β_post = 1 / ( 1/σ̂_β²  +  1/τ²_hist )           // V=0 ⇒ uninformative prior ⇒ σ²_β_post = σ̂_β²
β_post    = σ²_β_post · ( β̂ / σ̂_β²  +  β̄_hist / τ²_hist )
```

When this-season `n` is small, `σ̂_β²` is large and the prior dominates. When `n` is large, the data dominates. When no prior exists (`V = 0`), the predictor falls back to the pure regression estimate.

### 5.5 ETA solve

For each axis (Brix, ANT), use the fitted value at today (not the noisy last raw sample) as the anchor:
```
ŷ_today = α̂ + β̂ · t_today
etaDate(target) = today + (target − ŷ_today) / β_post
```

For Brix the relevant `target` is `brixTarget` (the midpoint of the ideal range — the "max quality" point per the rubric). For ANT, `target = antTarget`.

```
brixMidEta      = etaDate(brixTarget)
antEta          = antTarget != null ? etaDate(antTarget) : null
recommendedDate = MAX(brixMidEta, antEta)                      // both conditions must hold
brixWindowOpens = etaDate(brixLower)                           // for context only
brixWindowCloses = etaDate(brixUpper)                          // for the "ventana cierra" annotation
```

The view shows `recommendedDate` (big date) and `brixWindowCloses` (smaller "ventana cierra ~D" annotation, so the user sees the latest acceptable harvest day).

### 5.6 Confidence band

```
σ²_ŷ_today = σ̂² · ( 1/n  +  (t_today − t̄_w)² / Σ wᵢ (tᵢ − t̄_w)² )
horizon    = max(0, recommendedDate − today)          // in days
σ_eta      = √[ (σ_ŷ_today / |β_post|)²  +  (horizon · σ_β_post / |β_post|)² ]
band_days  = 1.96 · σ_eta
```

The first term is the noise of the regression's current value; the second grows linearly with how far we extrapolate. Combining in quadrature (not linear sum) keeps the band statistically honest.

### 5.7 Confidence label

```
trainingScore  = V > 0 ? min(1, V / 5) : null      // capped at 5 prior vintages; null when no history
freshnessScore = min(1, n_current / 6)
horizonPenalty = max(0, 1 − horizon / 60)

score = trainingScore != null
      ? trainingScore · freshnessScore · horizonPenalty
      : freshnessScore · horizonPenalty

label = score ≥ 0.66 ? 'Alta' : score ≥ 0.33 ? 'Media' : 'Baja'
if V == 0 and label == 'Alta': label = 'Media'     // never Alta without historical priors
```

Rationale: zero history shouldn't zero out the whole score (it would always return `Baja` even with plenty of current-season data and a short horizon), but it shouldn't be allowed to return `Alta` either.

### 5.8 Edge cases (each returns a `reason` string the view maps to UI copy)

| `reason`                  | Condition                                                                                  | Card state                          |
|---------------------------|--------------------------------------------------------------------------------------------|-------------------------------------|
| `pocos-datos-temporada`   | `n_current < 2`                                                                            | Placeholder card; no math.          |
| `sin-historial`           | `V = 0`                                                                                    | Predicción shown; label `Media` max (per §5.7). |
| `sin-tendencia-positiva`  | `β_post_brix ≤ 0`                                                                          | No date; "sin tendencia" badge.     |
| `antocianinas-estancadas` | `antTarget != null` and `β_post_ant ≤ 0`                                                  | No date; "ANT estancadas" badge.    |
| `ya-en-ventana`           | `ŷ_today_brix ∈ [brixLower, brixUpper]` AND (`antTarget == null` OR `ŷ_today_ant ≥ antTarget`) | "Ya en ventana" + window-closes date. |
| `no-alcanzar-A`           | `antEta > brixWindowCloses` (ANT crosses target after Brix exits ideal range)              | Aviso card; "no alcanzará A".       |
| `riesgo-sobremadurez`     | `recommendedDate > brixWindowCloses` (Brix will exit upper bound before ANT catches up)    | Aviso card; "riesgo de sobremadurez". |

## 6. Database changes

`sql/migration_harvest_target_overrides.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.harvest_target_overrides (
  id                 BIGSERIAL PRIMARY KEY,
  variety            TEXT NOT NULL,
  valley             TEXT NOT NULL,              -- 'VDG' | 'VON' | 'VSV'
  brix_target        NUMERIC,                    -- nullable → rubric midpoint
  brix_target_lower  NUMERIC,                    -- nullable → rubric.brix.a[0]
  brix_upper         NUMERIC,                    -- nullable → rubric.brix.a[1]
  anthocyanin_target NUMERIC,                    -- nullable → rubric.anthocyanins.a
  updated_by         TEXT,
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (variety, valley)
);

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_harvest_target_overrides') ON CONFLICT DO NOTHING;
```

Appended to `MIGRATIONS` in `js/migrations-manifest.js`. No changes to existing tables. Predictor resolves `effective_target = override-field ?? rubric-field` per-field; a row with partial nulls is allowed.

## 7. Predicción view UI

- New top-level view, navigation chip "Predicción", placed after Mediciones in the existing chip bar.
- Valley filter chips (`Todas / VDG / VON / VSV`) reuse the existing pattern; chip row also has a "⚙ Ajustes de objetivos" link to the settings page.
- One card per `(variety, appellation)` group with `n_current ≥ 2`. Sort: ascending by `daysUntilWindow` (most urgent first); cards with `reason = 'ya-en-ventana'` pin to top; aviso cards pin to top of their relative position.
- Card content (see mockup `prediccion-layout-v2.html` in `.superpowers/brainstorm/...`):
  - Header: variety (bold) + appellation/valley (small), confidence badge (`Alta` green, `Media` amber, `Baja` red, `⚠ Aviso` amber).
  - Big date: e.g. `~22 Sept`, with sub-line `±3 d · faltan 8 d · ventana cierra 29 sep`.
  - **Brix chart**: small line chart showing the solid historical line through dots, dashed projection extending into the future, translucent gray cone widening with horizon, dashed green target line, vertical ETA marker at intercept.
  - **ANT chart**: same structure; suppressed when `antTarget == null` (whites).
  - Footer row: `Brix hoy <b>22.1</b>`, `ANT hoy <b>820</b>`, `n=7 · 4v`.
- Aviso/edge variants:
  - `riesgo-sobremadurez` / `no-alcanzar-A` → amber card border, no big date, message in Spanish explaining the issue, charts still shown so the user can see why.
  - `pocos-datos-temporada` → dashed-border placeholder card with "Pocos datos esta temporada · se requiere n ≥ 2".
- Click on a card opens a detail panel with full-size Brix and ANT charts (same shape, larger), plus a small "histórico" section listing prior vintages' actual harvest dates for that varietal-ranch (pulled from `tank_receptions.reception_date` joined by `(variety, appellation, vintage_year)` if available — read-only context).
- Mobile: single column, same card content, charts shrink but stay readable.

## 8. Settings UI (target overrides)

Lives at `ajustes/objetivos` route. Lab and admin can edit; everyone else sees read-only.

- One row per `(variety, valley)` combo that has a rubric entry. Columns: Varietal · Valle · Brix objetivo · Brix tope · ANT mín (ME) · note.
- Each numeric cell is an `<input type="number">`. Empty input = inherit from rubric; the placeholder shows the inherited value in dimmed gray so the user always sees what would be used.
- Note column shows what's overridden vs inherited ("heredado: ANT 950", "override completo", "100% de rúbrica").
- White varietals show "no aplica" in the ANT column (no anthocyanins in white rubrics).
- Save button persists all changed rows via `dataLoader.upsertHarvestTargetOverride(row)` (one upsert per changed row). Cancel reverts. Last-updated metadata visible in the header.
- On successful save: invalidate `DataStore.harvestTargetOverrides`, re-fetch, trigger `predictionView.render()` if mounted.
- Mobile: horizontal scroll; Variety/Valley columns sticky-left.

## 9. Testing & rollout

### 9.1 Unit (`tests/prediction.test.js`)

- Weighted regression on a known synthetic series returns expected `α̂, β̂, σ̂²` within `1e-9`.
- Bayesian combine: `V=0` ⇒ posterior == data estimate; `n=0` ⇒ posterior == prior; equal precisions ⇒ midpoint.
- ETA solve with known `α, β, target` exact.
- `band_days(horizon=t+10) > band_days(horizon=t)` monotonicity.
- Each `reason` fires when its precondition holds and not otherwise.
- Override resolution: full rubric, full override, mixed nulls.

### 9.2 Integration (`tests/prediction-integration.test.js`)

- Load a real fixture vintage (e.g. 2024 Kompali Cabernet Sauvignon) and verify `recommendedDate` falls within ±10 days of the actual harvest date pulled from `tank_receptions` for that varietal-ranch.

### 9.3 Backtest (`tests/prediction-backtest.test.js`)

- For each prior vintage with a known reception date, simulate predictions at T-30, T-21, T-14, T-7 days using only data available at that point.
- Compute mean absolute error of `recommendedDate` vs. actual reception date.
- Assertions: `MAE(T-14) < 7 days`, `MAE(T-30) < 14 days`.
- This test is the model's truth gate — fail fast when code edits regress accuracy.

### 9.4 Manual smoke (added to next-round smoke checklist)

1. Open Predicción view → cards render, sorted by `daysUntilWindow` ascending.
2. Filter chip "VDG" → only VDG cards remain.
3. Click a card → detail panel shows large charts + historical reception dates.
4. As a lab user, change a Brix target in Settings → Save → return to Predicción → that varietal-ranch's date updates.
5. A varietal-ranch with `n=1` shows the "Pocos datos esta temporada" placeholder.

### 9.5 Rollout

1. Run `migration_harvest_target_overrides.sql` in Supabase SQL Editor.
2. Ship behind `CONFIG.harvestPredictorEnabled = false` for one deploy.
3. Lab team validates against live-vintage cards for 1 week.
4. Flip the flag on. Remove the flag in the next cleanup PR — no v1/v2 shims.

## 10. Open questions deferred to implementation

- Exact placement of the "⚙ Ajustes de objetivos" entry-point (chip-bar vs. card-grid header) — decide during implementation review.
- Whether the detail panel's "histórico" section uses a table or a small per-vintage strip — pick whichever is faster in Chart.js given current patterns.
- Whether to also surface predictions as a row on the existing map view as a future extension (not in scope here).
