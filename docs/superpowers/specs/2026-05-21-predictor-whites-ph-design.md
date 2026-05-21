# Harvest predictor — Brix + pH model for whites

**Status:** Approved 2026-05-21
**Touches:** `js/prediction.js`, `js/predictionView.js`, `js/predictionSettings.js`, `js/charts.js`, `js/demoMode.js`, `js/dataLoader.js`, `js/validation.js`, `js/migrations-manifest.js`, `index.html`, `sql/migration_harvest_target_overrides_ph.sql` (new), `tests/mt28-prediction-whites.test.mjs` (new)

## Problem

The predictor's secondary signal is hardcoded to anthocyanins (red varieties). Whites have no `anthocyanins` parameter in their rubric, so the predictor falls back to **Brix-only** — losing the second dimension that determines harvest quality. For whites, pH is the meaningful second signal: it rises with maturity and must stay **below** the rubric's A-grade threshold (`pH.a`, e.g. 3.20 for Sauvignon Blanc).

This spec adds a **white path** to the model that runs a parallel pH regression, treats pH as a **deadline** (not a target to reach), and exposes a `ph_target` override in the Ajustes UI. Reds are unchanged.

## Non-goals

- No changes to red-path math or red-path UI.
- No pH prediction for reds even though their rubric has `pH` (per user constraint: "reds brix and ant").
- No changes to the `<dialog>` modal scaffold (just polymorphic data).

## Key decisions

1. **Red vs white detection**: rubric has `params.anthocyanins` → red. Otherwise (rubric has `pH` but not `anthocyanins`) → white. The two sets are mutually exclusive in current `CONFIG.rubrics`.
2. **pH target**: defaults to `rubric.params.pH.a` (A-grade threshold). Overrideable per `(variety, valley)` via Ajustes.
3. **pH semantic**: pH rises with maturity; the target is a **ceiling**. Cosechar antes de cruzarlo.
4. **Recommendation timing**: `recommendedDate = today + min(brixMidEta, effectiveWindowCloses)`. If pH crosses earlier than ideal Brix, harvest at pH-crossover (still A-grade).
5. **`effectiveWindowCloses`** = `min(brixUpperEta, pHEta)`. Either dimension can close the harvest window.

## Architecture

### Data layer

**DB**: new column on `harvest_target_overrides`:
```sql
ALTER TABLE public.harvest_target_overrides
  ADD COLUMN IF NOT EXISTS ph_target NUMERIC;
```
Migration name: `migration_harvest_target_overrides_ph`. Append to `js/migrations-manifest.js`.

**`resolveTarget(rubric, override)`** in `prediction.js` returns:
```javascript
{ brixLower, brixUpper, brixTarget, antTarget, phTarget }
```
where:
- `antTarget = override.anthocyanin_target ?? rubric.params.anthocyanins?.a ?? null`
- `phTarget = override.ph_target ?? (rubric.params.pH && !rubric.params.anthocyanins ? rubric.params.pH.a : null)`

So `phTarget` is **null for reds** (engine ignores it) and the rubric A-threshold for whites unless overridden.

### Predictor logic (`prediction.js`)

`computeOne` keeps the Brix regression branch unchanged. The secondary branch becomes:

```
if antTarget != null  → red path (existing): wait for ANT to reach target
elif phTarget != null → white path (new): treat pH as deadline
else                  → Brix-only fallback (existing)
```

**White path computation**:
1. Run weighted regression on `s.pH` samples (same `weightedRegression` function).
2. Historical pH prior via `historicalSlopePrior` on prior vintages' pH series.
3. Bayesian combine slope.
4. `pHEta = etaDays({alpha, beta, tToday, target: phTarget})` — days until pH crosses target.
5. `effectiveWindowCloses = min(brixUpperEta, pHEta)`.
6. `recommendedEta = min(brixMidEta, effectiveWindowCloses)`.

**`detectEdgeCase` (white branch)** — order matters:
1. `β_brix ≤ 0` → `sin-tendencia-positiva`
2. `yhat_pH_today > phTarget` → `ph-excedido` (already failed)
3. `brixInWindow && yhat_pH_today ≤ phTarget` → `ya-en-ventana`
4. `pHEta < brixLowerEta` → `ph-temprano` (pH will cross before Brix even enters window)
5. `recommendedEta > effectiveWindowCloses` → `riesgo-sobremadurez` (either Brix-upper or pH closes too early)
6. `pHEta < brixMidEta` (but ≥ brixLowerEta) → `riesgo-ph` (harvest earlier than ideal Brix)
7. otherwise → `null` (normal ETA)

**`antocianinas-estancadas` is NOT emitted for whites.** **`no-alcanzar-A` is NOT emitted for whites** (replaced by `ph-temprano`).

**Outputs added to `computeOne` result**:
- `phHoy` (yhat_pH_today)
- `phFit`, `phComb` (regression diagnostics for the chart)
- `samplesProjected.phEta`

`samplesProjected.antEta` remains null for whites; `samplesProjected.phEta` is null for reds. Consumers branch on which is non-null.

**`computeAll`** samples enrichment: include `s.pH = Number(row.pH ?? row.ph)` alongside `brix` and `ant`.

### Views

**`predictionView.js renderCard`** — secondary chart block:
```javascript
${r.target.antTarget != null
  ? `<div class="pred-mini"><canvas data-axis="ant"></canvas></div>`
  : r.target.phTarget != null
    ? `<div class="pred-mini"><canvas data-axis="ph"></canvas></div>`
    : ''}
```

Footer: for whites, replace `ANT` with `pH` and show `phHoy.toFixed(2)`.

**`predictionView.js openDetail`**:
- Rename DOM `data-ant-block` → `data-secondary-block` in `index.html`. Show when either `antTarget` or `phTarget` is set.
- Axis label inside the block: "Antocianinas" for reds, "pH" for whites.
- Canvas attribute: `data-detail-axis="ant"` or `"ph"` (selected at render time).
- **Targets** table:
  - Reds: `Antocianinas objetivo: ≥ X mg/L`
  - Whites: `pH tope: ≤ X.XX`
- **Diagnóstico** table:
  - Reds: `ANT hoy (ŷ)`, `β ANT`
  - Whites: `pH hoy (ŷ)`, `β pH`
- **Razón** explanations (whites):
  - `ph-excedido`: "El pH ya superó el umbral de calidad A. Las uvas se cosecharán en grado B/C."
  - `ph-temprano`: "El pH cruzará el umbral antes de que el Brix entre en la ventana ideal. Calidad A no es viable este ciclo."
  - `riesgo-ph`: "El pH apretará la ventana — habrá que cosechar antes del Brix ideal para no perder calidad A."

### Charts (`charts.js`)

Both `renderPredictionMini` and `renderPredictionDetail` accept `axis ∈ {'brix','ant','ph'}`:

```javascript
const y = axis === 'brix' ? s.brix : axis === 'ant' ? s.ant : s.pH;
const fit  = axis === 'brix' ? prediction.brixFit  : axis === 'ant' ? prediction.antFit  : prediction.phFit;
const comb = axis === 'brix' ? prediction.brixComb : axis === 'ant' ? prediction.antComb : prediction.phComb;
const targetY = axis === 'brix' ? target.brixTarget : axis === 'ant' ? target.antTarget : target.phTarget;
const unit = axis === 'brix' ? '°Bx' : axis === 'ant' ? 'mg/L' : '';
const fmtVal = v => axis === 'brix' ? `${Number(v).toFixed(1)} ${unit}`
              : axis === 'ant' ? `${Math.round(Number(v))} ${unit}`
              : Number(v).toFixed(2);  // pH unitless, 2 decimals
```

Cone math is identical (same σ², σ_β² mechanics on pH residuals).

### Ajustes UI (`predictionSettings.js`, `index.html`)

**Table header** adds one column after "ANT mín (ME)":
```html
<th class="num">pH tope</th>
```

**`renderRow`** computes `phTarget` from rubric (`rp = rubric.params.pH; phTarget = (rp && !ra) ? rp.a : null`) and renders polymorphic cells:
- ANT column: editable if `isRed`, else "no aplica"
- pH column: editable if `isWhite`, else "no aplica"

Add `ph_target: 'phTarget'` to the placeholder map. Add `ph_target` to the dirty-state field list for the "100% rúbrica" / "override completo" note.

**`validation.js`** — `harvest_target_overrides` schema: `ph_target: { type: 'number', min: 2.5, max: 4.5, optional: true, nullable: true }`.

**`dataLoader.js` upsertHarvestTargetOverride** — whitelist field `ph_target`.

### Demo data (`demoMode.js`)

Scenarios assigned per group as today. For **white groups** (`g.target.antTarget == null && g.target.phTarget != null`), reinterpret scenario calibration:

| Scenario | β_brix | yhat_brix_today | β_pH | yhat_pH_today |
|---|---|---|---|---|
| `ya-en-ventana` | 0.15 | brixTarget | 0.005 | phTarget − 0.05 |
| `eta-corta` | 0.30 | brixLower − 2 | 0.008 | phTarget − 0.15 |
| `eta-media` | 0.30 | brixLower − 5 | 0.008 | phTarget − 0.20 |
| `riesgo-ph` | 0.25 | brixLower − 3 | 0.025 | phTarget − 0.05 |
| `ph-temprano` | 0.20 | brixLower − 6 | 0.030 | phTarget − 0.02 |

Two new scenario keys (`riesgo-ph`, `ph-temprano`) added to `SCENARIO_QUOTAS` *only when there is at least one white group*; otherwise red-only quotas apply. (Easier: emit them in the global quotas; for red groups, fall back to `eta-media` like the existing ANT-dependent reassignment does for whites.)

Reassignment rule (mirror of the existing ANT one):
```javascript
const PH_DEPENDENT_SCENARIOS = new Set(['riesgo-ph', 'ph-temprano']);
if (g.target.phTarget == null && PH_DEPENDENT_SCENARIOS.has(scenario)) {
  scenario = 'eta-media';
}
```

Sample generation in `generateCurrentSeason`:
```javascript
const pH = isWhite
  ? Math.max(2.5, p.yPh + p.bPh * t + (r() - 0.5) * 0.02)
  : 3.5 + (r() - 0.5) * 0.3;  // existing baseline for reds (no model use)
```

(Reds still emit pH samples for completeness of the berry row — the engine just ignores them.)

### Tests

`tests/mt28-prediction-whites.test.mjs` — runs `DemoMode.enable()` + `Prediction.computeAll`, then asserts:

1. **At least one card per white-specific reason**: `ph-excedido` OR `ph-temprano` OR `riesgo-ph` appears ≥1 time (some may be unreachable similar to `riesgo-sobremadurez` — assert the ones we calibrate for).
2. **No white group hits `pocos-datos-temporada`** (whites have 5 samples too).
3. **Whites use `phTarget`, reds use `antTarget`**: assert that for every white-rubric group `r.target.phTarget != null && r.target.antTarget == null`, and reverse for reds.
4. **Confidence ≥ 70% Alta/Media** across all groups (whites + reds combined).

Existing `mt27-demo-predictor.test.mjs` continues to pass unchanged (still asserts red reasons + general coverage).

## Risks

- **pH measurement noise** is larger than Brix; β_pH may be flatter (β ≈ 0.005/day vs 0.3/day for Brix). Bayesian combine handles this, but priors from V=0 demo data give wide confidence — acceptable for demo, may need tuning when real white-vintage history accumulates.
- **`ph-temprano` reachability**: same risk as `no-alcanzar-A` for reds — the analogous detect-order may have a gap. Tests assert reachability empirically; if 0 cards land that reason after calibration, treat as engine bug like the existing `riesgo-sobremadurez` finding.
- **Ajustes column width**: adding a 7th data column may overflow on smaller laptops. If grid becomes unreadable, group ANT+pH into one polymorphic header ("Secundario") instead of two distinct columns. Decision deferred to visual review.
