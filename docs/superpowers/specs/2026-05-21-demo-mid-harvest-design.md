# Demo mode — mid-harvest dataset for the Predicción view

**Status:** Approved 2026-05-21
**Owner:** Builder agent
**Touches:** `js/demoMode.js`, `tests/mt27-demo-predictor.test.mjs` (new)

## Problem

`/Predicción` (gated behind `CONFIG.harvestPredictorEnabled`, enabled in `c172cec`) renders cards that need ≥2 berry samples per `(variety, appellation)` group with `vintage === new Date().getFullYear()`. `js/demoMode.js` generates all samples with `VINTAGE = 2025`, so in 2026 every card hits `pocos-datos-temporada` and the grid is empty.

The goal is to populate the grid with a **didactic mid-harvest mix** that exercises all six prediction outcomes (`null` with ETA, `ya-en-ventana`, `riesgo-sobremadurez`, `no-alcanzar-A`, `antocianinas-estancadas`, and a fast/normal split among ETAs).

## Non-goals

- No change to `prediction.js`, `predictionView.js`, `config.js`, or the demoMode overlay contract.
- No change to non-berry demo data (reception, wine, mediciones) — the predictor only reads `berryData`.
- No date-shimming in PredictionView; sample dates anchor to real `new Date()`, accepting that the calendar season won't match real harvest months. This is a demo.

## Architecture

Refactor `generateDemoData()` in `js/demoMode.js`:

```
generateDemoData()
├── generateHistoricalSeason(2025)   // existing logic, extracted
└── generateCurrentSeason(currentYear, today)   // new
```

Both return partial datasets; the orchestrator concatenates `berry` arrays and returns the merged result. `wine`, `preferment`, `mediciones`, `receptions`, `receptionLots` come only from `generateHistoricalSeason` (unchanged).

### Historical season tweak (Bayesian prior)

`generateHistoricalSeason` currently emits 3 points per section at dpc ∈ {18, 28, 38}. `Prediction.historicalSlopePrior` fits OLS on the last 21 days before each vintage's max-y sample and drops vintages with <3 points in that window. Three points spread across 20 days → only 2 land in the 21-day window → vintage dropped → V=0 → no prior.

Densify to 6 points at dpc ∈ {18, 24, 30, 33, 36, 38}. Last 21 days catch ≥4 points → V≥1 → posterior slope blends prior + this-season data.

### Current season generation

Group sections by `(variety, appellation)` first (deriving from `CONFIG.vineyardSections` with the same `primaryVariety` + `demoRubricFor` filter). Assign each group one scenario, then emit 5 berry samples spaced at `today − {32, 24, 16, 8, 0}` days.

Sample IDs: `${currentYear%100}${lotCode}-c${seq}` — the `c` suffix avoids collision with historical IDs `${VINTAGE%100}${lotCode}-${seq}`.

## Scenarios

Six scenarios with target distribution:

| Scenario | Quota | Expected `reason` | yhat_brix_today | β_brix | yhat_ant_today | β_ant |
|---|---|---|---|---|---|---|
| `ya-en-ventana` | 25% | `ya-en-ventana` | `brixTarget + r·0.5` | 0.15 | `antTarget·1.1` | 8 |
| `eta-corta` | 20% | `null` (3–7d) | `brixLower − (2 + r)` | 0.30 | `antTarget·0.85` | 12 |
| `eta-media` | 25% | `null` (10–20d) | `brixLower − (5 + r·2)` | 0.30 | `antTarget·0.65` | 12 |
| `riesgo-sobremadurez` | 10% | `riesgo-sobremadurez` | `brixUpper + (0.3 + r·0.4)` | 0.25 | `antTarget·0.55` | 6 |
| `no-alcanzar-A` | 10% | `no-alcanzar-A` | `brixTarget − r` | 0.30 | `antTarget·0.50` | 1.5 |
| `antocianinas-estancadas` | 10% | `antocianinas-estancadas` | `brixLower + r` | 0.25 | `antTarget·0.7` | −0.5 |

`r` denotes a fresh draw from the seeded RNG, range [0, 1). Brix jitter `N(0, 0.1)`, tANT jitter `N(0, 30)` — small enough to preserve the intended slope.

Sample generation formula (per group, per scenario):

```
brix_i = yhat_brix_today + β_brix · (t_i − 0) + jitter_brix
ant_i  = yhat_ant_today  + β_ant  · (t_i − 0) + jitter_ant
```

where `t_i ∈ {−32, −24, −16, −8, 0}` (days from today). Sample dates: `today + t_i`.

### Variety without `antTarget`

White varieties (Sauvignon Blanc, Chardonnay, Chenin Blanc, Viognier) may have rubrics without `params.anthocyanins`. For those groups: emit only Brix samples (omit `tANT`), and reassign scenarios that depend on ANT behavior (`no-alcanzar-A`, `antocianinas-estancadas`) to `eta-media`.

### Assignment algorithm

1. Build groups: iterate `CONFIG.vineyardSections`, derive `(variety, appellation)`, dedupe.
2. Sort groups by `(appellation, variety)` for determinism.
3. Compute integer quotas from the % distribution (largest-remainder rounding) so every scenario has at least 1 group (clamp minimum=1 if total groups ≥6).
4. Shuffle the quota pool with the seeded RNG, draw one per group.

## Tests

`tests/mt27-demo-predictor.test.mjs` (node:test, ESM, `mt*` convention):

1. **Coverage** — after `DemoMode.enable()`, `Prediction.computeAll(...)` returns ≥1 group for each of: `ya-en-ventana`, `riesgo-sobremadurez`, `no-alcanzar-A`, `antocianinas-estancadas`, and ≥2 groups with `reason === null && Number.isFinite(recommendedDate?.getTime())`.
2. **No empty groups** — current-season groups never have `reason === 'pocos-datos-temporada'` (assert each group received 5 samples).
3. **Confidence** — ≥80% of cards have `label ∈ {'Alta', 'Media'}`.
4. **Clean restore** — after `DemoMode.disable()`, `DataStore.berryData` deep-equals the pre-enable snapshot.

The test imports `js/demoMode.js`, `js/prediction.js`, `js/dataLoader.js` directly. Uses `new Date()` as today; if the test runs near year-end and the predictor's `currentVintage` rolls over, the test will still pass because samples are generated relative to the same `new Date()` the test reads.

## Visual verification (manual)

After `npm run dev`:
1. Toggle Modo Demo on.
2. Navigate to Predicción.
3. Confirm grid is populated with a mix of green ("Ya en ventana"), neutral (ETA dates), and red-bordered (alert) cards.
4. Toggle Modo Demo off, confirm grid returns to real-data state.

## Risks

- **Rubric drift**: if `CONFIG.rubrics` changes Brix/ANT targets after this lands, calibrated scenarios may shift bucket. Mitigation: the test asserts coverage, so any drift surfaces as a test failure.
- **Section count**: if `CONFIG.vineyardSections` shrinks below ~12 groups, smaller scenarios (10% bucket) may round to 1 group and barely cover edge cases. Acceptable for current section count (~30+).
- **Variety filter**: if `primaryVariety` returns null for >50% of sections, group count drops sharply. Currently stable.
