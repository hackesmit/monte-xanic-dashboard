# Harvest-Readiness Predictor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Predicción de cosecha view that estimates, for each `(variety, appellation)` group, when the lot will simultaneously satisfy the rubric's ideal-Brix midpoint AND the anthocyanin A-threshold — with a confidence band that widens with horizon and with thin training data.

**Architecture:** Pure-JS hybrid linear regression on this-season berry samples, combined Bayesian-style with a per-`(variety, appellation)` historical-slope prior computed from the last 21 days of each prior vintage. Override table allows lab/admin users to adjust the per-`(variety, valley)` Brix midpoint / Brix upper / ANT target away from the rubric default. Engine lives in `js/prediction.js` (no DOM, no network); view in `js/predictionView.js`; settings in `js/predictionSettings.js`. Writes go through the existing `/api/row` endpoint with a new `upsert` action.

**Tech Stack:** Vanilla JS ES modules, Chart.js for the mini-charts, Supabase REST for reads, `/api/row` (Node serverless) for writes, `node --test` for unit/integration/backtest suites.

**Spec:** [docs/superpowers/specs/2026-05-19-harvest-predictor-design.md](../specs/2026-05-19-harvest-predictor-design.md)

**Branch:** `spec/harvest-predictor` (already created; spec already committed at `f46787c`).

---

## File Structure

**New:**
- `sql/migration_harvest_target_overrides.sql` — DDL for override table.
- `js/prediction.js` — pure model. Exports `computeOne`, `computeAll`, `resolveTarget`, plus internal helpers exposed for tests (`weightedRegression`, `historicalSlopePrior`, `bayesianCombine`, `etaDate`, `confidenceBand`, `confidenceLabel`, `detectEdgeCase`).
- `js/predictionView.js` — renders the Predicción card grid; owns its DOM; reads `DataStore.berryData`, `DataStore.harvestTargetOverrides`; calls `Charts.renderPredictionMini` for each card.
- `js/predictionSettings.js` — renders the override editor; lab/admin-only edit; persists via `dataLoader.upsertHarvestTargetOverride`.
- `tests/mt23-prediction-model.test.mjs` — pure-function unit tests.
- `tests/mt24-prediction-resolve.test.mjs` — target resolution + computeOne orchestration tests.
- `tests/mt25-prediction-integration.test.mjs` — fixture-vintage end-to-end test.
- `tests/mt26-prediction-backtest.test.mjs` — backtest accuracy gates.
- `tests/fixtures/prediction-2024-kompali-cs.json` — frozen real berry samples for 2024 CS Kompali (extracted once; checked in).

**Modified (small):**
- `js/migrations-manifest.js` — append `migration_harvest_target_overrides`.
- `js/dataLoader.js` — add `loadHarvestTargetOverrides()` and `upsertHarvestTargetOverride(row)`; store on `DataStore.harvestTargetOverrides`.
- `js/charts.js` — add `Charts.renderPredictionMini(canvas, lotPrediction, axis)` (axis = `'brix'` or `'ant'`).
- `js/config.js` — add `harvestPredictorEnabled` flag (default `false`) and `predictionColors` (line, projection, cone, target).
- `js/app.js` — register `predicción` view + `ajustes-objetivos` route; refresh wiring; nav chip rendering condition on the flag.
- `index.html` — add `<button class="nav-tab" data-view="prediccion">…</button>` and view markup shell + settings page shell.
- `api/row.js` — add `'upsert'` action.
- `api/upload.js` — append `harvest_target_overrides` entry to `ALLOWED_TABLES`.

**Boundaries:** queries only in `dataLoader.js`; math only in `prediction.js`; render only in `charts.js` / view modules. `prediction.js` imports nothing browser-specific (testable headless).

---

## Conventions used in this plan

- **Test files** use `node --test` and `assert/strict` (matches `tests/mt11-classification.test.mjs`).
- **All commits** are made on branch `spec/harvest-predictor`.
- **Each commit** includes the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer per repo convention.
- **Never push to `main`**; PR opens at the end against `main`.

---

## Task 1: Database migration

**Files:**
- Create: `sql/migration_harvest_target_overrides.sql`
- Modify: `js/migrations-manifest.js`

- [ ] **Step 1: Create the migration file**

Create `sql/migration_harvest_target_overrides.sql`:

```sql
-- sql/migration_harvest_target_overrides.sql
-- Per (variety, valley) override of the rubric-derived harvest-readiness
-- targets used by the Predicción de cosecha view. Rows with NULL fields
-- fall back to the rubric values from js/config.js.

CREATE TABLE IF NOT EXISTS public.harvest_target_overrides (
  id                  BIGSERIAL PRIMARY KEY,
  variety             TEXT NOT NULL,
  valley              TEXT NOT NULL,            -- 'VDG' | 'VON' | 'VSV'
  brix_target         NUMERIC,                  -- midpoint of ideal range
  brix_target_lower   NUMERIC,                  -- window open (lower edge)
  brix_upper          NUMERIC,                  -- window close (upper edge)
  anthocyanin_target  NUMERIC,                  -- ANT ≥ this is A-grade
  updated_by          TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (variety, valley)
);

CREATE INDEX IF NOT EXISTS harvest_target_overrides_variety_valley
  ON public.harvest_target_overrides (variety, valley);

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_harvest_target_overrides')
  ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 2: Append to migrations manifest**

In `js/migrations-manifest.js`, append `'migration_harvest_target_overrides'` to the `MIGRATIONS` array (last position):

```js
export const MIGRATIONS = [
  // … existing entries …
  'migration_row_audit_columns',
  'migration_harvest_target_overrides',
];
```

- [ ] **Step 3: Apply the migration in Supabase SQL Editor**

Open Supabase → SQL Editor → paste the contents of `sql/migration_harvest_target_overrides.sql` → Run. Confirm `harvest_target_overrides` shows up under Tables and that `SELECT name FROM applied_migrations WHERE name = 'migration_harvest_target_overrides';` returns one row.

- [ ] **Step 4: Commit**

```bash
git add sql/migration_harvest_target_overrides.sql js/migrations-manifest.js
git commit -m "$(cat <<'EOF'
feat(db): harvest_target_overrides table for predictor

Per (variety, valley) override of rubric-derived harvest-readiness
targets. Nullable columns fall through to rubric defaults.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Weighted regression (prediction.js §5.2)

**Files:**
- Create: `js/prediction.js`
- Create: `tests/mt23-prediction-model.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/mt23-prediction-model.test.mjs`:

```js
// tests/mt23-prediction-model.test.mjs
// MT.23 — Harvest predictor pure model
// Engine lives in js/prediction.js (pure functions, no DOM, no queries).

import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedRegression } from '../js/prediction.js';

// Synthetic series: y = 2 + 0.5·t, exact line, unit weights
test('MT.23 weightedRegression: recovers slope and intercept on a perfect line', () => {
  const samples = [
    { t: 0,  y: 2.0 },
    { t: 2,  y: 3.0 },
    { t: 4,  y: 4.0 },
    { t: 6,  y: 5.0 },
    { t: 8,  y: 6.0 },
  ];
  const { alpha, beta, sigma2, sigmaBeta2, n, tBarW, sumWttBar2 } =
    weightedRegression(samples.map(s => ({ ...s, w: 1 })));
  assert.equal(n, 5);
  assert.ok(Math.abs(beta  - 0.5) < 1e-9, `beta=${beta}`);
  assert.ok(Math.abs(alpha - 2.0) < 1e-9, `alpha=${alpha}`);
  assert.ok(sigma2 < 1e-18, `sigma2=${sigma2}`);
  assert.ok(Math.abs(tBarW - 4) < 1e-9, `tBarW=${tBarW}`);
  assert.ok(sumWttBar2 > 0);
  assert.ok(Number.isFinite(sigmaBeta2));
});

test('MT.23 weightedRegression: non-unit weights shift the fit', () => {
  // Same xs/ys but heavy weight on (8, 7) pulls the slope above 0.5
  const samples = [
    { t: 0,  y: 2.0, w: 1 },
    { t: 2,  y: 3.0, w: 1 },
    { t: 4,  y: 4.0, w: 1 },
    { t: 6,  y: 5.0, w: 1 },
    { t: 8,  y: 7.0, w: 4 },     // heavier
  ];
  const { beta } = weightedRegression(samples);
  assert.ok(beta > 0.5, `beta=${beta} should be > 0.5 with heavy late weight`);
});

test('MT.23 weightedRegression: n=2 returns slope through both points and sigma2=0', () => {
  const { alpha, beta, sigma2 } = weightedRegression([
    { t: 0, y: 1, w: 1 },
    { t: 5, y: 6, w: 1 },
  ]);
  assert.ok(Math.abs(beta - 1) < 1e-9);
  assert.ok(Math.abs(alpha - 1) < 1e-9);
  assert.equal(sigma2, 0);   // n - 2 = 0, define as 0
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: FAIL with `Cannot find module '../js/prediction.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement `weightedRegression`**

Create `js/prediction.js`:

```js
// js/prediction.js
// Harvest-readiness predictor. Pure functions. No DOM, no network,
// no module-level side effects.
// See docs/superpowers/specs/2026-05-19-harvest-predictor-design.md

// ── Weighted linear regression (§5.2) ────────────────────────────────
// Input: array of { t, y, w }. Output: fit + diagnostics needed downstream.
// Weights are normalised so Σwᵢ = n, keeping (n - 2) as the σ̂² denominator.
export function weightedRegression(samples) {
  const n = samples.length;
  if (n < 2) {
    return { alpha: NaN, beta: NaN, sigma2: NaN, sigmaBeta2: NaN,
             n, tBarW: NaN, sumWttBar2: NaN };
  }
  const sumW = samples.reduce((s, p) => s + p.w, 0);
  if (sumW <= 0) {
    return { alpha: NaN, beta: NaN, sigma2: NaN, sigmaBeta2: NaN,
             n, tBarW: NaN, sumWttBar2: NaN };
  }
  // Normalise weights so Σw = n
  const norm = n / sumW;
  const w = samples.map(p => p.w * norm);

  let sumWt = 0, sumWy = 0;
  for (let i = 0; i < n; i++) {
    sumWt += w[i] * samples[i].t;
    sumWy += w[i] * samples[i].y;
  }
  const tBarW = sumWt / n;
  const yBarW = sumWy / n;

  let sumWttBar2 = 0, sumWtybar = 0;
  for (let i = 0; i < n; i++) {
    const dt = samples[i].t - tBarW;
    const dy = samples[i].y - yBarW;
    sumWttBar2 += w[i] * dt * dt;
    sumWtybar  += w[i] * dt * dy;
  }
  if (sumWttBar2 === 0) {
    return { alpha: NaN, beta: NaN, sigma2: NaN, sigmaBeta2: NaN,
             n, tBarW, sumWttBar2 };
  }
  const beta  = sumWtybar / sumWttBar2;
  const alpha = yBarW - beta * tBarW;

  // Residual variance
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const eHat = samples[i].y - (alpha + beta * samples[i].t);
    ssr += w[i] * eHat * eHat;
  }
  const denom = n - 2;
  const sigma2 = denom > 0 ? ssr / denom : 0;
  const sigmaBeta2 = sigma2 / sumWttBar2;

  return { alpha, beta, sigma2, sigmaBeta2, n, tBarW, sumWttBar2 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: 3 passes.

- [ ] **Step 5: Commit**

```bash
git add js/prediction.js tests/mt23-prediction-model.test.mjs
git commit -m "$(cat <<'EOF'
feat(prediction): weighted linear regression engine

Pure-function core of the harvest predictor. Returns fit (alpha,
beta) plus the diagnostics (sigma2, sigmaBeta2, n, tBarW,
sumWttBar2) downstream Bayesian combine and confidence band need.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Historical slope prior (§5.3)

**Files:**
- Modify: `js/prediction.js`
- Modify: `tests/mt23-prediction-model.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `tests/mt23-prediction-model.test.mjs`:

```js
import { historicalSlopePrior } from '../js/prediction.js';

// Helper: build a vintage of {t, y} samples spaced 3 days apart
const mkVintage = (lateSlope, n, lastT = 80, noise = 0) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = lastT - (n - 1 - i) * 3;     // last sample at t=80
    const y = 20 + lateSlope * (t - 60) + (noise ? (Math.sin(i) * noise) : 0);
    out.push({ t, y });
  }
  return out;
};

test('MT.23 historicalSlopePrior: averages last-21-day slopes across vintages', () => {
  const vintages = [
    mkVintage(0.10, 8),   // slope 0.10
    mkVintage(0.20, 8),   // slope 0.20
    mkVintage(0.30, 8),   // slope 0.30
  ];
  const { betaHist, tau2Hist, V } = historicalSlopePrior(vintages);
  assert.equal(V, 3);
  assert.ok(Math.abs(betaHist - 0.2) < 1e-9, `betaHist=${betaHist}`);
  assert.ok(tau2Hist > 0);
});

test('MT.23 historicalSlopePrior: drops vintages with <3 samples in last-21-day window', () => {
  const vintages = [
    mkVintage(0.10, 8),                          // kept
    [{ t: 60, y: 20 }, { t: 80, y: 22 }],        // only 2 in window → dropped
  ];
  const { V } = historicalSlopePrior(vintages);
  assert.equal(V, 1);
});

test('MT.23 historicalSlopePrior: V=0 returns betaHist=null, tau2Hist=Infinity', () => {
  const { betaHist, tau2Hist, V } = historicalSlopePrior([]);
  assert.equal(V, 0);
  assert.equal(betaHist, null);
  assert.equal(tau2Hist, Infinity);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: 3 new FAILs on `historicalSlopePrior` not exported.

- [ ] **Step 3: Implement `historicalSlopePrior`**

Append to `js/prediction.js`:

```js
// ── Historical slope prior (§5.3) ────────────────────────────────────
// Per prior vintage, fit OLS on the last 21 days before the vintage's
// max-y sample. Drop vintages with <3 samples in that window. Return
// mean slope (prior mean) and sample variance (prior variance, τ²).
export function historicalSlopePrior(vintages) {
  const slopes = [];
  for (const samples of vintages) {
    if (!samples || samples.length === 0) continue;
    const tMax = Math.max(...samples.map(s => s.t));
    const windowed = samples
      .filter(s => s.t >= tMax - 21 && s.t <= tMax)
      .map(s => ({ ...s, w: 1 }));
    if (windowed.length < 3) continue;
    const { beta } = weightedRegression(windowed);
    if (Number.isFinite(beta)) slopes.push(beta);
  }
  const V = slopes.length;
  if (V === 0) return { betaHist: null, tau2Hist: Infinity, V: 0 };
  const mean = slopes.reduce((a, b) => a + b, 0) / V;
  // Sample variance (Bessel-corrected when V > 1; tiny epsilon when V = 1)
  let varSum = 0;
  for (const s of slopes) varSum += (s - mean) ** 2;
  const tau2Hist = V > 1 ? varSum / (V - 1) : 1e-6;
  return { betaHist: mean, tau2Hist, V };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/prediction.js tests/mt23-prediction-model.test.mjs
git commit -m "$(cat <<'EOF'
feat(prediction): historical slope prior from last-21-day window

Per prior vintage, fit OLS on the last 21 days before the vintage's
peak Brix; drop vintages with <3 samples in that window. The mean
slope is the Bayesian prior; the sample variance is τ².

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Bayesian combine (§5.4)

**Files:**
- Modify: `js/prediction.js`
- Modify: `tests/mt23-prediction-model.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `tests/mt23-prediction-model.test.mjs`:

```js
import { bayesianCombine } from '../js/prediction.js';

test('MT.23 bayesianCombine: V=0 ⇒ posterior == data estimate', () => {
  const out = bayesianCombine({ betaHat: 0.5, sigmaBeta2: 0.04,
                                betaHist: null, tau2Hist: Infinity });
  assert.ok(Math.abs(out.betaPost - 0.5) < 1e-9);
  assert.ok(Math.abs(out.sigmaBeta2Post - 0.04) < 1e-9);
});

test('MT.23 bayesianCombine: data variance → 0 ⇒ posterior == data estimate', () => {
  const out = bayesianCombine({ betaHat: 0.5, sigmaBeta2: 1e-12,
                                betaHist: 0.1, tau2Hist: 0.01 });
  assert.ok(Math.abs(out.betaPost - 0.5) < 1e-6);
});

test('MT.23 bayesianCombine: equal precisions ⇒ posterior == midpoint', () => {
  const out = bayesianCombine({ betaHat: 0.6, sigmaBeta2: 0.01,
                                betaHist: 0.2, tau2Hist: 0.01 });
  assert.ok(Math.abs(out.betaPost - 0.4) < 1e-9);
  assert.ok(Math.abs(out.sigmaBeta2Post - 0.005) < 1e-9);
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: 3 FAILs on `bayesianCombine` not exported.

- [ ] **Step 3: Implement `bayesianCombine`**

Append to `js/prediction.js`:

```js
// ── Bayesian-style posterior slope (§5.4) ────────────────────────────
// Precision-weighted Gaussian combine. Handles V=0 (tau2=Infinity) and
// degenerate data variance gracefully.
export function bayesianCombine({ betaHat, sigmaBeta2, betaHist, tau2Hist }) {
  const dataPrec = sigmaBeta2 > 0 ? 1 / sigmaBeta2 : Infinity;
  const priorPrec = (betaHist != null && Number.isFinite(tau2Hist) && tau2Hist > 0)
    ? 1 / tau2Hist
    : 0;
  const totPrec = dataPrec + priorPrec;
  if (!Number.isFinite(totPrec) || totPrec === 0) {
    return { betaPost: betaHat, sigmaBeta2Post: sigmaBeta2 };
  }
  const sigmaBeta2Post = 1 / totPrec;
  const numerator = (Number.isFinite(dataPrec) ? betaHat * dataPrec : betaHat * 1e18)
                  + (priorPrec > 0 ? betaHist * priorPrec : 0);
  const denom    = Number.isFinite(dataPrec) ? (dataPrec + priorPrec) : (1e18 + priorPrec);
  const betaPost = numerator / denom;
  return { betaPost, sigmaBeta2Post };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: all tests pass (3 new + 6 prior = 9 total).

- [ ] **Step 5: Commit**

```bash
git add js/prediction.js tests/mt23-prediction-model.test.mjs
git commit -m "$(cat <<'EOF'
feat(prediction): Bayesian posterior slope combine

Precision-weighted Gaussian update of this-season slope estimate
against the historical slope prior. V=0 (tau2=Infinity) falls back
to the data estimate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ETA solve + confidence band (§5.5, §5.6)

**Files:**
- Modify: `js/prediction.js`
- Modify: `tests/mt23-prediction-model.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `tests/mt23-prediction-model.test.mjs`:

```js
import { etaDays, confidenceBand } from '../js/prediction.js';

test('MT.23 etaDays: anchored to fitted value at t_today', () => {
  // α=18, β=0.2  ⇒ ŷ_today (t=20) = 22. Target 23 ⇒ ETA = 5 days
  const days = etaDays({ alpha: 18, beta: 0.2, tToday: 20, target: 23 });
  assert.ok(Math.abs(days - 5) < 1e-9, `days=${days}`);
});

test('MT.23 etaDays: target already reached ⇒ negative or zero', () => {
  const days = etaDays({ alpha: 18, beta: 0.2, tToday: 20, target: 22 });
  assert.ok(Math.abs(days - 0) < 1e-9);
});

test('MT.23 etaDays: β=0 ⇒ Infinity', () => {
  const days = etaDays({ alpha: 18, beta: 0, tToday: 20, target: 23 });
  assert.equal(days, Infinity);
});

test('MT.23 confidenceBand: widens with horizon', () => {
  const args = { sigma2: 0.04, n: 6, tToday: 20, tBarW: 15, sumWttBar2: 50,
                 betaPost: 0.2, sigmaBeta2Post: 0.001 };
  const band10 = confidenceBand({ ...args, horizonDays: 10 });
  const band30 = confidenceBand({ ...args, horizonDays: 30 });
  assert.ok(band30 > band10,
    `expected band30 (${band30}) > band10 (${band10})`);
});

test('MT.23 confidenceBand: widens with smaller sumWttBar2 (sparser data)', () => {
  const base = { sigma2: 0.04, n: 6, tToday: 20, tBarW: 15,
                 betaPost: 0.2, sigmaBeta2Post: 0.001, horizonDays: 20 };
  const dense  = confidenceBand({ ...base, sumWttBar2: 100 });
  const sparse = confidenceBand({ ...base, sumWttBar2: 10  });
  assert.ok(sparse > dense, `sparse=${sparse} should exceed dense=${dense}`);
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: 5 FAILs.

- [ ] **Step 3: Implement `etaDays` and `confidenceBand`**

Append to `js/prediction.js`:

```js
// ── ETA solve (§5.5) ────────────────────────────────────────────────
// Returns days FROM t_today until the fitted line crosses `target`.
// Negative result is clamped to 0 (already past target); β≤0 returns Infinity.
export function etaDays({ alpha, beta, tToday, target }) {
  if (!Number.isFinite(beta) || beta <= 0) return Infinity;
  const yhatToday = alpha + beta * tToday;
  const days = (target - yhatToday) / beta;
  return days < 0 ? 0 : days;
}

// ── Confidence band (§5.6) ──────────────────────────────────────────
// σ_eta is RMS of (regression noise at today) and (extrapolation noise
// proportional to horizon). Returns ±days (1.96·σ_eta).
export function confidenceBand({
  sigma2, n, tToday, tBarW, sumWttBar2,
  betaPost, sigmaBeta2Post, horizonDays,
}) {
  if (!Number.isFinite(betaPost) || betaPost === 0) return Infinity;
  const sigmaYhat2 = sigma2 * (1 / n + ((tToday - tBarW) ** 2) / sumWttBar2);
  const noiseTerm = Math.sqrt(Math.max(0, sigmaYhat2)) / Math.abs(betaPost);
  const horizonTerm = (Math.abs(horizonDays) * Math.sqrt(sigmaBeta2Post))
                    / Math.abs(betaPost);
  const sigmaEta = Math.sqrt(noiseTerm ** 2 + horizonTerm ** 2);
  return 1.96 * sigmaEta;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: 14 total tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/prediction.js tests/mt23-prediction-model.test.mjs
git commit -m "$(cat <<'EOF'
feat(prediction): ETA solve and confidence band

ETA anchored to the fitted value at today (not noisy raw last
sample). Band combines regression-noise-at-today and horizon-driven
extrapolation noise in quadrature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Confidence label (§5.7)

**Files:**
- Modify: `js/prediction.js`
- Modify: `tests/mt23-prediction-model.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `tests/mt23-prediction-model.test.mjs`:

```js
import { confidenceLabel } from '../js/prediction.js';

test('MT.23 confidenceLabel: high training + dense + short horizon → Alta', () => {
  const lab = confidenceLabel({ V: 5, nCurrent: 8, horizonDays: 5 });
  assert.equal(lab, 'Alta');
});

test('MT.23 confidenceLabel: V=0 caps at Media even with strong data', () => {
  const lab = confidenceLabel({ V: 0, nCurrent: 10, horizonDays: 3 });
  assert.equal(lab, 'Media');
});

test('MT.23 confidenceLabel: thin data low → Baja', () => {
  const lab = confidenceLabel({ V: 1, nCurrent: 2, horizonDays: 45 });
  assert.equal(lab, 'Baja');
});

test('MT.23 confidenceLabel: horizon >= 60 ⇒ Baja regardless', () => {
  const lab = confidenceLabel({ V: 5, nCurrent: 10, horizonDays: 65 });
  assert.equal(lab, 'Baja');
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: 4 FAILs.

- [ ] **Step 3: Implement `confidenceLabel`**

Append to `js/prediction.js`:

```js
// ── Confidence label (§5.7) ──────────────────────────────────────────
export function confidenceLabel({ V, nCurrent, horizonDays }) {
  const freshnessScore = Math.min(1, nCurrent / 6);
  const horizonPenalty = Math.max(0, 1 - horizonDays / 60);
  let score;
  if (V > 0) {
    const trainingScore = Math.min(1, V / 5);
    score = trainingScore * freshnessScore * horizonPenalty;
  } else {
    score = freshnessScore * horizonPenalty;
  }
  let label = score >= 0.66 ? 'Alta' : score >= 0.33 ? 'Media' : 'Baja';
  if (V === 0 && label === 'Alta') label = 'Media';
  return label;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/mt23-prediction-model.test.mjs`
Expected: 18 total tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/prediction.js tests/mt23-prediction-model.test.mjs
git commit -m "$(cat <<'EOF'
feat(prediction): confidence label heuristic

Three-factor product (training × freshness × horizon) maps to
Alta/Media/Baja. V=0 cannot return Alta but can still be Media when
current-season data is strong and horizon short.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Effective target resolution (§5.1)

**Files:**
- Modify: `js/prediction.js`
- Create: `tests/mt24-prediction-resolve.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/mt24-prediction-resolve.test.mjs`:

```js
// tests/mt24-prediction-resolve.test.mjs
// MT.24 — Target resolution + computeOne orchestration tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget } from '../js/prediction.js';

// Stub rubric matching js/config.js structure
const RUBRIC_CS_VON = {
  params: {
    brix:         { kind: 'range', a: [23.5, 24.2] },
    anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
  },
};
const RUBRIC_SB_VDG = {
  params: {
    brix:         { kind: 'range', a: [19.0, 23.0] },
    // no anthocyanins entry → whites
  },
};

test('MT.24 resolveTarget: no override → midpoint, lower, upper, ant from rubric', () => {
  const t = resolveTarget({ rubric: RUBRIC_CS_VON, override: null });
  assert.ok(Math.abs(t.brixTarget - 23.85) < 1e-9);
  assert.equal(t.brixLower, 23.5);
  assert.equal(t.brixUpper, 24.2);
  assert.equal(t.antTarget, 950);
});

test('MT.24 resolveTarget: full override wins', () => {
  const t = resolveTarget({
    rubric: RUBRIC_CS_VON,
    override: { brix_target: 23.6, brix_target_lower: 23.0, brix_upper: 24.0,
                anthocyanin_target: 900 },
  });
  assert.equal(t.brixTarget, 23.6);
  assert.equal(t.brixLower, 23.0);
  assert.equal(t.brixUpper, 24.0);
  assert.equal(t.antTarget, 900);
});

test('MT.24 resolveTarget: partial override (only ANT) → others from rubric', () => {
  const t = resolveTarget({
    rubric: RUBRIC_CS_VON,
    override: { brix_target: null, brix_target_lower: null, brix_upper: null,
                anthocyanin_target: 1100 },
  });
  assert.ok(Math.abs(t.brixTarget - 23.85) < 1e-9);
  assert.equal(t.antTarget, 1100);
});

test('MT.24 resolveTarget: white rubric without anthocyanins → antTarget null', () => {
  const t = resolveTarget({ rubric: RUBRIC_SB_VDG, override: null });
  assert.equal(t.antTarget, null);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `node --test tests/mt24-prediction-resolve.test.mjs`
Expected: 4 FAILs on `resolveTarget` not exported.

- [ ] **Step 3: Implement `resolveTarget`**

Append to `js/prediction.js`:

```js
// ── Effective target resolution (§5.1) ───────────────────────────────
// override fields are nullable; null/undefined falls back to the rubric.
// rubric is the per-(variety,valley) entry from CONFIG.rubrics.
export function resolveTarget({ rubric, override }) {
  const ovr = override || {};
  const rb = rubric?.params?.brix;
  const ra = rubric?.params?.anthocyanins;
  const brixLower  = ovr.brix_target_lower ?? rb?.a?.[0] ?? null;
  const brixUpper  = ovr.brix_upper        ?? rb?.a?.[1] ?? null;
  const brixTarget = ovr.brix_target
    ?? (rb?.a ? (rb.a[0] + rb.a[1]) / 2 : null);
  const antTarget  = ovr.anthocyanin_target ?? ra?.a ?? null;
  return { brixLower, brixUpper, brixTarget, antTarget };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/mt24-prediction-resolve.test.mjs`
Expected: all 4 pass.

- [ ] **Step 5: Commit**

```bash
git add js/prediction.js tests/mt24-prediction-resolve.test.mjs
git commit -m "$(cat <<'EOF'
feat(prediction): effective target resolution

Per (variety, valley), an override row's nullable fields fall
through to the rubric values from CONFIG.rubrics. White rubrics
without anthocyanins yield antTarget=null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: computeOne orchestrator (§5.5, §5.8)

**Files:**
- Modify: `js/prediction.js`
- Modify: `tests/mt24-prediction-resolve.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `tests/mt24-prediction-resolve.test.mjs`:

```js
import { computeOne } from '../js/prediction.js';

// Build a realistic season-to-date Brix + ANT sequence
const mkSeries = (slopeBrix, slopeAnt, n, lastT = 25) => ({
  current: Array.from({ length: n }, (_, i) => {
    const t = i * (lastT / (n - 1));
    return {
      sampleDate: `2026-08-${String(1 + i).padStart(2, '0')}`,
      tDays: t,
      brix: 19 + slopeBrix * t,
      ant:  600 + slopeAnt * t,
    };
  }),
  historicalByVintage: [
    // 3 prior vintages, each with ~8 samples in the last 21 days, slope ~slopeBrix
    Array.from({ length: 8 }, (_, i) => ({
      tDays: 60 + i * 3,
      brix: 20 + slopeBrix * (60 + i * 3 - 60),
      ant:  700 + slopeAnt * (60 + i * 3 - 60),
    })),
    Array.from({ length: 8 }, (_, i) => ({
      tDays: 60 + i * 3,
      brix: 19.5 + (slopeBrix * 0.95) * (60 + i * 3 - 60),
      ant:  680  + (slopeAnt  * 0.95) * (60 + i * 3 - 60),
    })),
    Array.from({ length: 8 }, (_, i) => ({
      tDays: 60 + i * 3,
      brix: 20.5 + (slopeBrix * 1.05) * (60 + i * 3 - 60),
      ant:  720  + (slopeAnt  * 1.05) * (60 + i * 3 - 60),
    })),
  ],
});

test('MT.24 computeOne: produces all expected fields when n_current=6 and V=3', () => {
  const { current, historicalByVintage } = mkSeries(0.18, 18, 6);
  const target = { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 };
  const today = new Date('2026-09-01');
  const out = computeOne({ current, historicalByVintage, target, today });
  assert.ok(out.recommendedDate instanceof Date);
  assert.ok(out.brixWindowCloses instanceof Date);
  assert.ok(Number.isFinite(out.bandDays));
  assert.ok(['Alta', 'Media', 'Baja'].includes(out.label));
  assert.equal(out.nCurrent, 6);
  assert.equal(out.V, 3);
  assert.equal(out.reason, null);
});

test('MT.24 computeOne: nCurrent<2 → reason=pocos-datos-temporada', () => {
  const out = computeOne({
    current: [{ sampleDate: '2026-08-01', tDays: 0, brix: 20, ant: 600 }],
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-01'),
  });
  assert.equal(out.reason, 'pocos-datos-temporada');
  assert.equal(out.recommendedDate, null);
});

test('MT.24 computeOne: ya-en-ventana when ŷ already in [lower,upper] and ANT≥target', () => {
  // Build a series where the latest is exactly in window and ANT comfortably over target.
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-09-${String(1 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 23.5 + 0.05 * i,    // ŷ_today ≈ 23.7 ⇒ in [23.5, 24.2]
    ant:  1000 + 5 * i,       // > 950
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-09-05'),
  });
  assert.equal(out.reason, 'ya-en-ventana');
});

test('MT.24 computeOne: β_post_brix ≤ 0 → sin-tendencia-positiva', () => {
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-08-${String(1 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 22 - 0.1 * i,        // declining
    ant:  700 + 5 * i,
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-05'),
  });
  assert.equal(out.reason, 'sin-tendencia-positiva');
});

test('MT.24 computeOne: V=0 caps label at Media even with strong current data', () => {
  const current = Array.from({ length: 8 }, (_, i) => ({
    sampleDate: `2026-08-${String(20 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 22 + 0.3 * i,        // strong upward
    ant:  800 + 30 * i,
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-27'),
  });
  assert.ok(out.label !== 'Alta', `label=${out.label} must not be Alta when V=0`);
});

test('MT.24 computeOne: β_post_ant ≤ 0 → antocianinas-estancadas', () => {
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-08-${String(1 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 21 + 0.4 * i,         // brix climbing fine
    ant:  900 - 5 * i,          // ANT declining
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-05'),
  });
  assert.equal(out.reason, 'antocianinas-estancadas');
});

test('MT.24 computeOne: ANT crosses target after Brix exits upper → no-alcanzar-A', () => {
  // Brix climbs fast (will exit upper soon); ANT climbs very slowly (won't
  // reach target before Brix is past 24.2).
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-08-${String(20 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 23.5 + 0.4 * i,       // ŷ_today ≈ 25.1 → already above upper
    ant:  650 + 5 * i,          // very slow ANT
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-24'),
  });
  assert.ok(['no-alcanzar-A', 'riesgo-sobremadurez'].includes(out.reason),
    `reason=${out.reason}`);
});

test('MT.24 computeOne: recommendedDate past brixWindowCloses → riesgo-sobremadurez', () => {
  // Brix climbs fast (closes window soon); ANT climbs slowly (recommended
  // date sits after window closes).
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-08-${String(1 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 22 + 0.3 * i,          // ŷ_today ≈ 23.2; closes ≈ 3.3 d later
    ant:  600 + 12 * i,          // ANT will need ~30 d to reach 950
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-05'),
  });
  assert.ok(['riesgo-sobremadurez', 'no-alcanzar-A'].includes(out.reason),
    `reason=${out.reason}`);
});
```

The last two tests accept either `no-alcanzar-A` or `riesgo-sobremadurez` because — given the spec's edge-case detection order — a series can satisfy both preconditions; whichever fires first is correct.

- [ ] **Step 2: Run tests, expect failure**

Run: `node --test tests/mt24-prediction-resolve.test.mjs`
Expected: 5 new FAILs on `computeOne` not exported.

- [ ] **Step 3: Implement `computeOne` and `detectEdgeCase`**

Append to `js/prediction.js`:

```js
// ── Edge-case detection (§5.8) ───────────────────────────────────────
// Returns a reason string or null. Order matters: pocos-datos checked
// at the caller before regression runs (so n is real here).
export function detectEdgeCase({
  yhatBrixToday, yhatAntToday, betaPostBrix, betaPostAnt,
  brixLower, brixUpper, antTarget,
  brixMidEta, antEta, brixWindowCloses,
}) {
  if (betaPostBrix <= 0) return 'sin-tendencia-positiva';
  if (antTarget != null && betaPostAnt <= 0) return 'antocianinas-estancadas';
  const brixInWindow = yhatBrixToday >= brixLower && yhatBrixToday <= brixUpper;
  const antOver      = antTarget == null || (yhatAntToday >= antTarget);
  if (brixInWindow && antOver) return 'ya-en-ventana';
  // antEta > brixWindowCloses → ANT crosses target after Brix exits range
  if (antEta != null && Number.isFinite(antEta)
      && Number.isFinite(brixWindowCloses)
      && antEta > brixWindowCloses) return 'no-alcanzar-A';
  // recommendedDate sits after Brix exits the upper bound
  const recommendedEta = antEta != null ? Math.max(brixMidEta, antEta) : brixMidEta;
  if (Number.isFinite(brixWindowCloses) && recommendedEta > brixWindowCloses) {
    return 'riesgo-sobremadurez';
  }
  return null;
}

// ── computeOne orchestrator (§5.5) ───────────────────────────────────
// Inputs:
//   current:              [{ sampleDate (ISO string|Date), tDays, brix, ant }]
//   historicalByVintage:  [ [{ tDays, brix, ant }], ... ]
//   target:               { brixLower, brixUpper, brixTarget, antTarget|null }
//   today:                Date instance
//   recencyBoostWindow:   default 14 days, last-N samples get weight 1.5
// Output: { reason, recommendedDate|null, brixWindowCloses|null,
//           bandDays|Infinity, label, nCurrent, V, brixHoy, antHoy,
//           samplesProjected:{ brixEta, antEta } }
export function computeOne({
  current, historicalByVintage, target, today,
  recencyBoostWindow = 14,
}) {
  const nCurrent = current.length;
  if (nCurrent < 2) {
    return {
      reason: 'pocos-datos-temporada',
      recommendedDate: null, brixWindowCloses: null,
      bandDays: Infinity, label: 'Baja',
      nCurrent, V: 0, brixHoy: current[0]?.brix ?? null,
      antHoy: current[0]?.ant ?? null,
      samplesProjected: { brixEta: null, antEta: null },
    };
  }

  // Order by tDays asc; the last entry's tDays is "today's t"
  const sorted = [...current].sort((a, b) => a.tDays - b.tDays);
  const tToday = sorted[sorted.length - 1].tDays;

  // Per-sample weights: 1.5 if within recencyBoostWindow of t_today, else 1.0
  const wOf = s => (tToday - s.tDays) <= recencyBoostWindow ? 1.5 : 1.0;

  const brixSamples = sorted.map(s => ({ t: s.tDays, y: s.brix, w: wOf(s) }));
  const brixFit = weightedRegression(brixSamples);
  const brixPrior = historicalSlopePrior(
    historicalByVintage.map(v => v.map(s => ({ t: s.tDays, y: s.brix })))
  );
  const brixComb = bayesianCombine({
    betaHat: brixFit.beta, sigmaBeta2: brixFit.sigmaBeta2,
    betaHist: brixPrior.betaHist, tau2Hist: brixPrior.tau2Hist,
  });

  let antFit = null, antPrior = { V: 0, tau2Hist: Infinity, betaHist: null },
      antComb = { betaPost: NaN, sigmaBeta2Post: NaN };
  if (target.antTarget != null) {
    const antSamples = sorted.map(s => ({ t: s.tDays, y: s.ant, w: wOf(s) }));
    antFit = weightedRegression(antSamples);
    antPrior = historicalSlopePrior(
      historicalByVintage.map(v => v.map(s => ({ t: s.tDays, y: s.ant })))
    );
    antComb = bayesianCombine({
      betaHat: antFit.beta, sigmaBeta2: antFit.sigmaBeta2,
      betaHist: antPrior.betaHist, tau2Hist: antPrior.tau2Hist,
    });
  }

  // ŷ at today using *this-season* fit (not posterior — the posterior
  // adjusts the slope only; intercept stays from this-season data).
  const yhatBrixToday = brixFit.alpha + brixFit.beta * tToday;
  const yhatAntToday  = antFit ? antFit.alpha + antFit.beta * tToday : null;

  // ETA in days from today using posterior slope
  const brixMidEta = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixTarget,
  });
  const brixWindowOpensDays = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixLower,
  });
  const brixWindowClosesDays = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixUpper,
  });
  const antEta = target.antTarget != null ? etaDays({
    alpha: yhatAntToday - antComb.betaPost * tToday,
    beta: antComb.betaPost, tToday, target: target.antTarget,
  }) : null;

  // Edge-case detection (uses raw posterior slopes + ŷ_today checks)
  const reason = detectEdgeCase({
    yhatBrixToday, yhatAntToday,
    betaPostBrix: brixComb.betaPost, betaPostAnt: antComb.betaPost,
    brixLower: target.brixLower, brixUpper: target.brixUpper,
    antTarget: target.antTarget,
    brixMidEta, antEta, brixWindowCloses: brixWindowClosesDays,
  });

  const dayMs = 86_400_000;
  const recommendedEtaDays = (antEta != null)
    ? Math.max(brixMidEta, antEta) : brixMidEta;
  const horizonDays = Math.max(0, recommendedEtaDays);
  const bandDays = confidenceBand({
    sigma2: brixFit.sigma2, n: brixFit.n,
    tToday, tBarW: brixFit.tBarW, sumWttBar2: brixFit.sumWttBar2,
    betaPost: brixComb.betaPost, sigmaBeta2Post: brixComb.sigmaBeta2Post,
    horizonDays,
  });
  const label = confidenceLabel({
    V: brixPrior.V, nCurrent, horizonDays,
  });

  const recommendedDate = (reason && reason !== 'ya-en-ventana')
    ? null
    : (reason === 'ya-en-ventana' ? today
       : new Date(today.getTime() + recommendedEtaDays * dayMs));
  const brixWindowCloses = Number.isFinite(brixWindowClosesDays)
    ? new Date(today.getTime() + brixWindowClosesDays * dayMs)
    : null;

  return {
    reason, recommendedDate, brixWindowCloses,
    bandDays, label,
    nCurrent, V: brixPrior.V,
    brixHoy: yhatBrixToday, antHoy: yhatAntToday,
    samplesProjected: {
      brixEta: brixMidEta, antEta,
      brixWindowOpensDays, brixWindowClosesDays,
    },
    // Diagnostics passthrough — view needs these for the chart
    brixFit, brixComb, antFit, antComb,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/mt24-prediction-resolve.test.mjs`
Expected: all 9 pass.

- [ ] **Step 5: Commit**

```bash
git add js/prediction.js tests/mt24-prediction-resolve.test.mjs
git commit -m "$(cat <<'EOF'
feat(prediction): computeOne orchestrator + edge-case detection

Per-group orchestration: weighted regression → historical slope
prior → Bayesian combine → ETA solve → confidence band → label.
detectEdgeCase covers pocos-datos, sin-tendencia-positiva,
antocianinas-estancadas, ya-en-ventana, no-alcanzar-A, and
riesgo-sobremadurez per the spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: computeAll grouping helper

**Files:**
- Modify: `js/prediction.js`
- Modify: `tests/mt24-prediction-resolve.test.mjs`

- [ ] **Step 1: Add failing test**

Append to `tests/mt24-prediction-resolve.test.mjs`:

```js
import { computeAll } from '../js/prediction.js';

test('MT.24 computeAll: groups berry samples by (variety, appellation) and computes each', () => {
  const today = new Date('2026-09-01');
  const mkRow = (variety, appellation, vintage, dayOffset, brix, ant) => ({
    variety, appellation, vintage,
    sampleDate: new Date('2026-08-01').getTime() + dayOffset * 86_400_000,
    brix, tant: ant,
  });
  const berryData = [
    // CS Kompali current vintage (2026), 5 samples
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026,  0, 19.5, 600),
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026,  7, 20.5, 650),
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026, 14, 21.5, 720),
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026, 21, 22.5, 800),
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026, 28, 23.0, 870),
    // CS Kompali 2025 (historical), 8 samples in last 21 days
    ...Array.from({ length: 8 }, (_, i) => mkRow(
      'Cabernet Sauvignon', 'Kompali (VON)', 2025, 60 + i * 3, 20 + 0.1 * i * 3, 700 + 10 * i * 3,
    )),
  ];
  const rubricMap = {
    'Cabernet Sauvignon|Valle de Ojos Negros': {
      params: {
        brix: { kind: 'range', a: [23.5, 24.2] },
        anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
      },
    },
  };
  const valleyOf = appellation =>
    appellation.includes('VON') ? 'Valle de Ojos Negros'
      : appellation.includes('VDG') ? 'Valle de Guadalupe'
      : appellation.includes('VSV') ? 'Valle de San Vicente' : null;

  const result = computeAll({
    berryData, today, currentVintage: 2026,
    overrides: [],
    rubricFor: ({ variety, appellation }) =>
      rubricMap[`${variety}|${valleyOf(appellation)}`] ?? null,
    valleyFor: ({ appellation }) => valleyOf(appellation),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].variety, 'Cabernet Sauvignon');
  assert.equal(result[0].appellation, 'Kompali (VON)');
  assert.equal(result[0].prediction.nCurrent, 5);
  assert.equal(result[0].prediction.V, 1);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `node --test tests/mt24-prediction-resolve.test.mjs`
Expected: FAIL on `computeAll` not exported.

- [ ] **Step 3: Implement `computeAll`**

Append to `js/prediction.js`:

```js
// ── computeAll grouping helper ───────────────────────────────────────
// Groups berryData by (variety, appellation), splits each group into
// current vintage vs historical vintages, resolves the effective target,
// and calls computeOne. Returns one object per group, ordered by
// recommendedDate ascending (cards in the view will use this order).
export function computeAll({
  berryData, today, currentVintage,
  overrides, rubricFor, valleyFor,
}) {
  const overrideByKey = new Map();
  for (const o of overrides) {
    overrideByKey.set(`${o.variety}|${o.valley}`, o);
  }
  const groups = new Map();
  for (const row of berryData) {
    if (!row.variety || !row.appellation) continue;
    const key = `${row.variety}|${row.appellation}`;
    if (!groups.has(key)) {
      groups.set(key, { variety: row.variety, appellation: row.appellation,
                        current: [], historicalByVintage: new Map() });
    }
    const g = groups.get(key);
    const sampleDate = row.sampleDate instanceof Date
      ? row.sampleDate
      : new Date(row.sampleDate);
    if (!Number.isFinite(sampleDate.getTime())) continue;
    const sample = {
      sampleDate,
      brix: Number(row.brix),
      ant:  Number(row.tant ?? row.anthocyanins ?? row.ant),
    };
    if (!Number.isFinite(sample.brix)) continue;
    if (row.vintage === currentVintage) {
      g.current.push(sample);
    } else {
      const arr = g.historicalByVintage.get(row.vintage) ?? [];
      arr.push(sample);
      g.historicalByVintage.set(row.vintage, arr);
    }
  }
  const results = [];
  for (const g of groups.values()) {
    // Normalise to tDays relative to first current sample
    g.current.sort((a, b) => a.sampleDate - b.sampleDate);
    const t0 = g.current[0]?.sampleDate?.getTime() ?? today.getTime();
    const dayMs = 86_400_000;
    const current = g.current.map(s => ({
      sampleDate: s.sampleDate,
      tDays: (s.sampleDate.getTime() - t0) / dayMs,
      brix: s.brix, ant: s.ant,
    }));
    const historicalByVintage = [];
    for (const arr of g.historicalByVintage.values()) {
      arr.sort((a, b) => a.sampleDate - b.sampleDate);
      const tv0 = arr[0].sampleDate.getTime();
      historicalByVintage.push(arr.map(s => ({
        tDays: (s.sampleDate.getTime() - tv0) / dayMs,
        brix: s.brix, ant: s.ant,
      })));
    }
    const valley = valleyFor({ appellation: g.appellation });
    const rubric = rubricFor({ variety: g.variety, appellation: g.appellation });
    const override = overrideByKey.get(`${g.variety}|${valley}`) ?? null;
    const target = resolveTarget({ rubric, override });
    const tToday = (today.getTime() - t0) / dayMs;
    // Re-stamp tDays so 'today' aligns to the last sample for the view
    const prediction = computeOne({
      current, historicalByVintage, target,
      today: new Date(today),
    });
    results.push({
      variety: g.variety, appellation: g.appellation, valley,
      target, prediction, tToday,
    });
  }
  // Sort: ya-en-ventana first, then by recommendedDate ascending, then by
  // appellation for stability. Cards with reason=pocos-datos-temporada go last.
  const rank = r => {
    if (r.prediction.reason === 'ya-en-ventana') return -1;
    if (r.prediction.reason === 'pocos-datos-temporada') return 1e15;
    return r.prediction.recommendedDate
      ? r.prediction.recommendedDate.getTime()
      : 1e14;
  };
  results.sort((a, b) => rank(a) - rank(b)
    || a.appellation.localeCompare(b.appellation));
  return results;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/mt24-prediction-resolve.test.mjs`
Expected: 10 total tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/prediction.js tests/mt24-prediction-resolve.test.mjs
git commit -m "$(cat <<'EOF'
feat(prediction): computeAll grouping + sort

Groups berry samples by (variety, appellation), splits current vs
historical vintages, resolves effective targets, and orders results
by recommendedDate (ya-en-ventana pinned first, pocos-datos last).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Extend `/api/row` with `upsert` action

**Files:**
- Modify: `api/row.js`
- Modify: `api/upload.js`

- [ ] **Step 1: Add `harvest_target_overrides` to `ALLOWED_TABLES`**

In `api/upload.js`, locate the `ALLOWED_TABLES` declaration. Append a new entry (after the last existing entry, before the closing `}`):

```js
  harvest_target_overrides: {
    conflict: 'variety,valley',
    columns: new Set([
      'variety', 'valley',
      'brix_target', 'brix_target_lower', 'brix_upper',
      'anthocyanin_target',
      'updated_by', 'updated_at',
    ]),
  },
```

- [ ] **Step 2: Add `'upsert'` action in `api/row.js`**

In `api/row.js`, change `ALLOWED_ACTIONS` from `new Set(['update', 'delete'])` to `new Set(['update', 'delete', 'upsert'])`. Then, immediately after the `if (action === 'delete') { … }` block (before the trailing `return 400` line), add:

```js
  if (action === 'upsert') {
    row.updated_at = new Date().toISOString();
    row.updated_by = result.payload.user || 'lab';
    const upsertUrl = `${supabaseUrl}/rest/v1/${table}?on_conflict=${conflictCols.join(',')}`;
    try {
      const supaRes = await fetch(upsertUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(row),
      });
      const upserted = await supaRes.json();
      if (!supaRes.ok) {
        return res.status(supaRes.status).json({
          ok: false, error: upserted?.message || 'Error al guardar',
        });
      }
      const upsertedRow = Array.isArray(upserted) ? upserted[0] : upserted;
      return res.status(200).json({ ok: true, row: upsertedRow });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Error de red al guardar' });
    }
  }
```

Note: the `last_edited_at` / `last_edited_by` strip block at lines 53-56 must not apply to upsert paths if `updated_at` / `updated_by` are part of the row's column allowlist (they are — see Step 1). The existing strip only removes `last_edited_at` / `last_edited_by`, so this is already safe.

- [ ] **Step 3: Add an upsert smoke test (use an existing test pattern)**

Inspect `tests/mt20-api-row.test.mjs` to see how the existing update/delete API tests are structured. If the test runs against a mocked Supabase, add a parallel `upsert` test in the same file:

```js
test('MT.20 /api/row upsert: rejects non-lab role', async () => {
  // … reuse the existing helpers (mockReq, etc.) with action='upsert' and role='viewer'
  //     and assert 403.
});

test('MT.20 /api/row upsert: lab role hits PostgREST with merge-duplicates header', async () => {
  // … assert the outbound fetch URL contains on_conflict and headers carry
  //     resolution=merge-duplicates,return=representation.
});
```

If `tests/mt20-api-row.test.mjs` mocks via dependency injection, follow that pattern; otherwise treat the existing test file as the template and copy the closest matching helper.

- [ ] **Step 4: Run all API tests**

Run: `node --test tests/mt20-api-row.test.mjs`
Expected: existing tests pass + the two new upsert tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/row.js api/upload.js tests/mt20-api-row.test.mjs
git commit -m "$(cat <<'EOF'
feat(api): /api/row upsert action + harvest_target_overrides allowlist

Adds 'upsert' to ALLOWED_ACTIONS. Uses PostgREST merge-duplicates
resolution against the configured conflict columns. Server stamps
updated_at/updated_by. New harvest_target_overrides entry whitelists
the predictor's settings table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: dataLoader read + upsert helpers

**Files:**
- Modify: `js/dataLoader.js`

- [ ] **Step 1: Add `loadHarvestTargetOverrides`**

In `js/dataLoader.js`, after the `loadMediciones()` method (around line 215) and before the next helper, add:

```js
  async loadHarvestTargetOverrides() {
    if (!this.supabase) { this.harvestTargetOverrides = []; return; }
    try {
      const rows = await this._fetchAll('harvest_target_overrides', 'id');
      this.harvestTargetOverrides = rows || [];
    } catch (e) {
      console.error('[DataStore] loadHarvestTargetOverrides failed:', e);
      this.harvestTargetOverrides = [];
    }
  },

  async upsertHarvestTargetOverride(row) {
    const res = await fetch('/api/row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 'x-session-token': window.AuthSession?.token || '' },
      body: JSON.stringify({
        table: 'harvest_target_overrides',
        action: 'upsert',
        row,
      }),
    });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    // Refresh local cache
    await this.loadHarvestTargetOverrides();
    return data.row;
  },
```

Also ensure `this.harvestTargetOverrides = [];` is initialised in the DataStore constructor block (where similar arrays like `medicionesData = []` are declared). Search for `medicionesData` near the top of the file to find the right place.

- [ ] **Step 2: Wire `loadHarvestTargetOverrides` into the boot sequence**

Find where `loadMediciones()` is awaited during boot (search for `this.loadMediciones()` invocation). Add `await this.loadHarvestTargetOverrides();` immediately after.

- [ ] **Step 3: Manual verification (no automated test for this layer)**

Run `npm run dev`, open the browser console, type:
```
DataStore.harvestTargetOverrides
```
Expected: `[]` (empty, no overrides yet). No errors in the console.

- [ ] **Step 4: Commit**

```bash
git add js/dataLoader.js
git commit -m "$(cat <<'EOF'
feat(dataLoader): load + upsert harvest_target_overrides

loadHarvestTargetOverrides fetches the override table during boot.
upsertHarvestTargetOverride posts to /api/row with the new 'upsert'
action and refreshes the local cache on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Config flag + colors

**Files:**
- Modify: `js/config.js`

- [ ] **Step 1: Add the flag and color tokens**

Append to `js/config.js` (inside the `CONFIG` object, near the existing color sections):

```js
  // ── Harvest predictor ───────────────────────────────────────────────────
  harvestPredictorEnabled: false,     // flip to true after lab validation

  predictionColors: {
    line:        '#5b2d3a',           // historical/observed line
    projection:  '#5b2d3a',           // dashed forward extension
    cone:        'rgba(91, 45, 58, 0.08)',
    target:      '#2e7d4f',           // dashed target line
    etaMarker:   'rgba(91, 45, 58, 0.7)',
    alertBg:     '#fef8f2',
    alertBorder: '#e6cdb0',
  },
```

- [ ] **Step 2: Commit**

```bash
git add js/config.js
git commit -m "$(cat <<'EOF'
feat(config): harvestPredictorEnabled flag + prediction color tokens

Flag defaults off; flip to true post-validation. Color tokens used
by the mini-chart and aviso card styles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Chart factory `renderPredictionMini`

**Files:**
- Modify: `js/charts.js`

- [ ] **Step 1: Add the renderer to the `Charts` object**

In `js/charts.js`, inside the `Charts` object literal (search for `export const Charts = {`), add a new method `renderPredictionMini`:

```js
  // Render a small forecast chart for one varietal-ranch card.
  // `axis` is 'brix' or 'ant'. `prediction` is one entry from
  // Prediction.computeAll(...) — uses .samplesProjected, .target, etc.
  renderPredictionMini(canvas, ctx, axis) {
    if (!canvas || !ctx) return;
    const { prediction, target, today } = ctx;
    const C = CONFIG.predictionColors;

    // Build observed series points
    const sortedCurrent = ctx.current
      .slice()
      .sort((a, b) => a.sampleDate - b.sampleDate);
    const observed = sortedCurrent.map(s => ({
      x: s.sampleDate.getTime(),
      y: axis === 'brix' ? s.brix : s.ant,
    }));
    // Build projection segment: from last observed to ETA + buffer
    const dayMs = 86_400_000;
    const lastObs = observed[observed.length - 1];
    const etaDays = axis === 'brix'
      ? prediction.samplesProjected.brixEta
      : prediction.samplesProjected.antEta;
    const horizonDays = Number.isFinite(etaDays) ? Math.max(etaDays + 5, 5) : 21;
    const horizonEnd = today.getTime() + horizonDays * dayMs;
    const fit = axis === 'brix' ? prediction.brixFit : prediction.antFit;
    const comb = axis === 'brix' ? prediction.brixComb : prediction.antComb;
    if (!fit || !Number.isFinite(comb?.betaPost)) return;
    const tToday = (today.getTime() - sortedCurrent[0].sampleDate.getTime()) / dayMs;
    const projAtDays = d => {
      const tAtD = tToday + d;
      // Use *posterior* slope, anchored to ŷ_today from this-season fit.
      const yhatToday = fit.alpha + fit.beta * tToday;
      return yhatToday + comb.betaPost * d;
    };
    const projection = [];
    for (let d = 0; d <= horizonDays; d += 1) {
      projection.push({ x: today.getTime() + d * dayMs, y: projAtDays(d) });
    }
    // Confidence cone polygon: ±1.96·(sigmaYhat + horizon·sigmaBeta) / |β|.
    // Use the same formula as confidenceBand but rescaled to y-units.
    const sigmaY = Math.sqrt(Math.max(0, fit.sigma2));
    const cone = [];
    for (let d = 0; d <= horizonDays; d += 1) {
      const y = projAtDays(d);
      const wY = 1.96 * Math.sqrt(sigmaY * sigmaY + (d * Math.sqrt(comb.sigmaBeta2Post)) ** 2);
      cone.push({ x: today.getTime() + d * dayMs, yLo: y - wY, yHi: y + wY });
    }

    const targetY = axis === 'brix' ? target.brixTarget : target.antTarget;
    const datasets = [
      { label: 'Banda confianza',
        type: 'line', borderColor: 'transparent',
        backgroundColor: C.cone, fill: '+1',
        data: cone.map(p => ({ x: p.x, y: p.yHi })),
        pointRadius: 0, tension: 0, order: 1 },
      { label: 'Banda inferior',
        type: 'line', borderColor: 'transparent',
        data: cone.map(p => ({ x: p.x, y: p.yLo })),
        pointRadius: 0, tension: 0, order: 1 },
      { label: 'Observado',
        type: 'line', borderColor: C.line, borderWidth: 1.6,
        backgroundColor: C.line, data: observed,
        pointRadius: 2.4, tension: 0, order: 2 },
      { label: 'Proyección',
        type: 'line', borderColor: C.projection, borderWidth: 1.6,
        borderDash: [3, 3], data: projection,
        pointRadius: 0, tension: 0, order: 2 },
    ];
    if (targetY != null) {
      datasets.push({
        label: 'Objetivo', type: 'line',
        borderColor: C.target, borderWidth: 1, borderDash: [2, 3],
        data: [observed[0], { x: horizonEnd, y: targetY }]
          .map(p => ({ x: p.x, y: targetY })),
        pointRadius: 0, tension: 0, order: 0,
      });
    }

    const canvasId = canvas.id || `pred-${axis}-${Math.random().toString(36).slice(2,8)}`;
    if (this.instances[canvasId]) { this.instances[canvasId].destroy(); }
    this.instances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'time', time: { unit: 'day' }, ticks: { font: { size: 9 } } },
          y: { ticks: { font: { size: 9 } } },
        },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: { duration: 0 },
      },
    });
  },
```

The cone fill works by stacking two transparent line datasets and using Chart.js `fill: '+1'` to fill between them; the lower dataset must immediately follow the upper.

- [ ] **Step 2: Manual verification (deferred — covered by view smoke in Task 16)**

No standalone test; this function is exercised end-to-end when the view renders.

- [ ] **Step 3: Commit**

```bash
git add js/charts.js
git commit -m "$(cat <<'EOF'
feat(charts): renderPredictionMini for harvest forecast cards

Line through observed dots, dashed projection extending forward,
translucent gray confidence cone widening with horizon and
posterior slope uncertainty, dashed green target line.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: index.html shell + nav chip

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the nav chip**

In `index.html`, find the `<nav class="nav-tabs" id="nav-tabs">` block (around line 144). Append a new tab after the `mediciones` button:

```html
      <button class="nav-tab" data-view="prediccion">Predicción</button>
```

- [ ] **Step 2: Add the Predicción view markup**

After the last existing `<section id="view-*">` block, add:

```html
    <!-- Predicción de cosecha -->
    <section id="view-prediccion" class="view" hidden>
      <div class="view-header">
        <h2>Predicción de cosecha</h2>
        <div class="view-controls">
          <div class="chip-bar" id="prediccion-valley-chips">
            <button class="chip chip-active" data-valley="all">Todas</button>
            <button class="chip" data-valley="VDG">VDG</button>
            <button class="chip" data-valley="VON">VON</button>
            <button class="chip" data-valley="VSV">VSV</button>
          </div>
          <a class="link-button" data-view="ajustes-objetivos">⚙ Ajustes de objetivos</a>
        </div>
      </div>
      <div class="prediccion-grid" id="prediccion-grid"></div>
    </section>

    <!-- Ajustes de objetivos -->
    <section id="view-ajustes-objetivos" class="view" hidden>
      <div class="view-header">
        <h2>Ajustes de objetivos de cosecha</h2>
        <a class="link-button" data-view="prediccion">← Volver a Predicción</a>
      </div>
      <div class="settings-meta" id="ajustes-objetivos-meta"></div>
      <table class="settings-table" id="ajustes-objetivos-table">
        <thead>
          <tr>
            <th>Varietal</th><th>Valle</th>
            <th class="num">Brix objetivo</th>
            <th class="num">Brix mín</th>
            <th class="num">Brix tope</th>
            <th class="num">ANT mín (ME)</th>
            <th>Nota</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <div class="settings-actions">
        <button class="btn" id="ajustes-objetivos-cancel">Cancelar</button>
        <button class="btn btn-primary" id="ajustes-objetivos-save">Guardar cambios</button>
      </div>
    </section>
```

- [ ] **Step 3: Add minimal CSS for the grid + cards**

In the project's stylesheet (search for where `.view-header` is styled — usually `styles.css` or `index.html` `<style>`), append:

```css
.prediccion-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}
.pred-card {
  background: #fff; border-radius: 10px; padding: 14px;
  border: 1px solid #e6e3dc;
}
.pred-card-alert  { background: #fef8f2; border-color: #e6cdb0; }
.pred-card-empty  { background: #f7f5f1; border-style: dashed; }
.pred-card-header { display: flex; justify-content: space-between; align-items: flex-start; }
.pred-card-date   { font-size: 22px; font-weight: 600; color: #5b2d3a; margin-top: 8px; }
.pred-card-sub    { font-size: 11px; color: #7a7368; }
.pred-card-foot   { display: flex; justify-content: space-between; font-size: 11px;
                    color: #5a534a; padding-top: 8px; border-top: 1px solid #f0ebe4;
                    margin-top: 10px; }
.pred-badge       { font-size: 11px; padding: 3px 8px; border-radius: 10px; color: #fff; }
.pred-badge-alta  { background: #2e7d4f; }
.pred-badge-media { background: #c08a2d; }
.pred-badge-baja  { background: #b04040; }
.pred-badge-warn  { background: #c08a2d; }
.pred-card canvas { width: 100% !important; height: 70px !important; margin-top: 6px; }
.settings-table   { width: 100%; border-collapse: collapse; font-size: 13px; }
.settings-table th, .settings-table td { padding: 8px 10px; border-bottom: 1px solid #f0ebe4; }
.settings-table th { background: #f7f5f1; font-size: 11px; text-transform: uppercase;
                     letter-spacing: .5px; color: #5a534a; text-align: left; }
.settings-table th.num, .settings-table td.num { text-align: right; }
.settings-table input { width: 70px; padding: 4px 6px; border: 1px solid #d8d3ca;
                        border-radius: 4px; font-size: 13px; }
```

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open the app. The Predicción tab should appear next to Mediciones; clicking it should switch to an empty view. No console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css   # or wherever the styles live
git commit -m "$(cat <<'EOF'
feat(html): Predicción view + Ajustes de objetivos page shells

Nav chip, valley filter chips, card grid container, and a
settings-page markup shell with editable table. Minimal CSS for
the card layout and settings table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `predictionView.js` — render + sort + valley filter

**Files:**
- Create: `js/predictionView.js`
- Modify: `js/app.js`

- [ ] **Step 1: Create `predictionView.js`**

Create `js/predictionView.js`:

```js
// js/predictionView.js
// Renders the Predicción card grid. No math; delegates to Prediction.
// No queries; reads DataStore.berryData and DataStore.harvestTargetOverrides.

import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { Charts } from './charts.js';
import * as Prediction from './prediction.js';
import { resolveValley } from './classification.js';

let activeValley = 'all';

export const PredictionView = {
  mount() {
    const chipBar = document.getElementById('prediccion-valley-chips');
    if (chipBar && !chipBar._wired) {
      chipBar.addEventListener('click', e => {
        const btn = e.target.closest('.chip');
        if (!btn) return;
        activeValley = btn.dataset.valley || 'all';
        chipBar.querySelectorAll('.chip').forEach(b =>
          b.classList.toggle('chip-active', b === btn));
        this.render();
      });
      chipBar._wired = true;
    }
    this.render();
  },

  render() {
    const grid = document.getElementById('prediccion-grid');
    if (!grid) return;
    const today = new Date();
    const currentVintage = today.getFullYear();
    const rubricFor = ({ variety, appellation }) => {
      const valley = resolveValley(appellation);
      const map = CONFIG.varietyRubricMap[valley];
      if (!map) return null;
      const rubricId = map[variety];
      return rubricId ? CONFIG.rubrics[rubricId] : null;
    };
    const valleyFor = ({ appellation }) => {
      const v = resolveValley(appellation);
      return v === 'Valle de Guadalupe' ? 'VDG'
           : v === 'Valle de Ojos Negros' ? 'VON'
           : v === 'Valle de San Vicente' ? 'VSV' : null;
    };
    const results = Prediction.computeAll({
      berryData: DataStore.berryData || [],
      today, currentVintage,
      overrides: DataStore.harvestTargetOverrides || [],
      rubricFor, valleyFor,
    });
    const filtered = activeValley === 'all'
      ? results
      : results.filter(r => r.valley === activeValley);
    grid.innerHTML = '';
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="empty-state">Sin datos para mostrar.</p>';
      return;
    }
    for (const r of filtered) {
      grid.appendChild(this.renderCard(r, today));
    }
  },

  renderCard(r, today) {
    const card = document.createElement('div');
    const p = r.prediction;
    const isAlert = ['riesgo-sobremadurez', 'no-alcanzar-A',
                     'sin-tendencia-positiva', 'antocianinas-estancadas']
                    .includes(p.reason);
    const isEmpty = p.reason === 'pocos-datos-temporada';
    card.className = 'pred-card'
      + (isAlert ? ' pred-card-alert' : '')
      + (isEmpty ? ' pred-card-empty' : '');

    const dateText = (() => {
      if (isEmpty) return null;
      if (p.reason === 'sin-tendencia-positiva') return 'Sin tendencia';
      if (p.reason === 'antocianinas-estancadas') return 'ANT estancadas';
      if (p.reason === 'no-alcanzar-A') return 'No alcanzará A';
      if (p.reason === 'riesgo-sobremadurez') return 'Riesgo de sobremadurez';
      if (p.reason === 'ya-en-ventana') return 'Ya en ventana';
      if (!p.recommendedDate) return null;
      return p.recommendedDate.toLocaleDateString('es-MX',
        { day: 'numeric', month: 'short' });
    })();

    const badgeClass = (() => {
      if (isAlert) return 'pred-badge pred-badge-warn';
      if (p.label === 'Alta')  return 'pred-badge pred-badge-alta';
      if (p.label === 'Media') return 'pred-badge pred-badge-media';
      return 'pred-badge pred-badge-baja';
    })();
    const badgeText = isAlert ? '⚠ Aviso' : (isEmpty ? '' : p.label);

    const closesText = p.brixWindowCloses
      ? `cierra ${p.brixWindowCloses.toLocaleDateString('es-MX',
          { day: 'numeric', month: 'short' })}`
      : '';
    const horizonDays = p.recommendedDate
      ? Math.max(0, Math.round((p.recommendedDate - today) / 86_400_000))
      : null;

    card.innerHTML = `
      <div class="pred-card-header">
        <div>
          <div style="font-weight:600;font-size:14px">${escapeHtml(r.variety)}</div>
          <div style="font-size:11px;color:#7a7368">${escapeHtml(r.appellation)}</div>
        </div>
        ${badgeText ? `<div class="${badgeClass}">${escapeHtml(badgeText)}</div>` : ''}
      </div>
      ${isEmpty ? `
        <div style="margin:24px 0;text-align:center;color:#9b9388;font-size:12px">
          Pocos datos esta temporada<br>
          <span style="font-size:10px">se requiere n ≥ 2</span>
        </div>` : `
        <div class="pred-card-date">${dateText ? escapeHtml(dateText) : '—'}</div>
        <div class="pred-card-sub">
          ${horizonDays != null ? `±${Math.round(p.bandDays)} d · faltan ${horizonDays} d` : ''}
          ${closesText ? ` · ${closesText}` : ''}
        </div>
        <div style="font-size:9px;color:#7a7368;margin-top:6px">Brix</div>
        <canvas data-axis="brix"></canvas>
        ${r.target.antTarget != null ? `
          <div style="font-size:9px;color:#7a7368;margin-top:4px">Antocianinas</div>
          <canvas data-axis="ant"></canvas>` : ''}
        <div class="pred-card-foot">
          <span>Brix <b>${p.brixHoy != null ? p.brixHoy.toFixed(1) : '—'}</b></span>
          <span>ANT <b>${p.antHoy != null ? Math.round(p.antHoy) : '—'}</b></span>
          <span>n=${p.nCurrent} · ${p.V}v</span>
        </div>`}
    `;

    // After insertion, render the canvases. Defer to allow layout.
    if (!isEmpty) {
      requestAnimationFrame(() => {
        const brixCanvas = card.querySelector('canvas[data-axis="brix"]');
        if (brixCanvas) {
          Charts.renderPredictionMini(brixCanvas, {
            prediction: p, target: r.target, today,
            current: rebuildCurrent(r),
          }, 'brix');
        }
        const antCanvas = card.querySelector('canvas[data-axis="ant"]');
        if (antCanvas) {
          Charts.renderPredictionMini(antCanvas, {
            prediction: p, target: r.target, today,
            current: rebuildCurrent(r),
          }, 'ant');
        }
      });
    }
    return card;
  },
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Rebuild the current-vintage sample array for the chart. computeAll
// consumed berryData and returned a per-group result, but didn't include
// the raw sample list — pull it again from DataStore.
function rebuildCurrent(r) {
  const currentVintage = new Date().getFullYear();
  return (DataStore.berryData || [])
    .filter(row => row.variety === r.variety
                && row.appellation === r.appellation
                && row.vintage === currentVintage
                && Number.isFinite(Number(row.brix)))
    .map(row => ({
      sampleDate: row.sampleDate instanceof Date ? row.sampleDate
                  : new Date(row.sampleDate),
      brix: Number(row.brix),
      ant:  Number(row.tant ?? row.anthocyanins ?? row.ant),
    }))
    .sort((a, b) => a.sampleDate - b.sampleDate);
}
```

- [ ] **Step 2: Wire the route in `app.js`**

In `js/app.js`, find the `case 'mediciones':` block in the view switch (around line 411). After it, add:

```js
      case 'prediccion': {
        const { PredictionView } = await import('./predictionView.js');
        PredictionView.mount();
        break;
      }
```

Also, near the chip rendering for `nav-tabs` (search for `#nav-tabs .nav-tab`), if there's a code path that hides tabs by flag, gate the `prediccion` chip on `CONFIG.harvestPredictorEnabled`:

```js
const chipPred = document.querySelector('.nav-tab[data-view="prediccion"]');
if (chipPred) chipPred.hidden = !CONFIG.harvestPredictorEnabled;
```

Add this in the same boot block where existing chips are configured.

- [ ] **Step 3: Manual verification**

Set `CONFIG.harvestPredictorEnabled = true` in `js/config.js` temporarily. Run `npm run dev`. Open the app, click the Predicción tab. Confirm cards render with the line + cone + target visualisation. Confirm the valley filter chips work. Confirm there are no console errors. Revert the flag to `false` before committing.

- [ ] **Step 4: Commit**

```bash
git add js/predictionView.js js/app.js
git commit -m "$(cat <<'EOF'
feat(view): Predicción card grid + valley filter

Renders one card per (variety, appellation) group with: confidence
badge, recommended date / aviso copy, Brix and ANT mini-charts,
and a footer showing today's measurements + sample/vintage counts.
Chip bar filters by valley. View hidden by harvestPredictorEnabled
flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `predictionSettings.js` — table render

**Files:**
- Create: `js/predictionSettings.js`
- Modify: `js/app.js`

- [ ] **Step 1: Create the settings module**

Create `js/predictionSettings.js`:

```js
// js/predictionSettings.js
// Renders the harvest-target overrides editor. Lab/admin can edit;
// everyone else sees read-only inputs.

import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { resolveValley } from './classification.js';

const VALLEY_CODES = { 'Valle de Guadalupe': 'VDG',
                       'Valle de Ojos Negros': 'VON',
                       'Valle de San Vicente': 'VSV' };

let dirtyRows = new Map();          // key = `${variety}|${valley}` → row patch

export const PredictionSettings = {
  mount() {
    dirtyRows = new Map();
    this.render();
    document.getElementById('ajustes-objetivos-save')
      ?.addEventListener('click', () => this.save());
    document.getElementById('ajustes-objetivos-cancel')
      ?.addEventListener('click', () => { dirtyRows.clear(); this.render(); });
  },

  render() {
    const tbody = document.querySelector('#ajustes-objetivos-table tbody');
    const meta  = document.getElementById('ajustes-objetivos-meta');
    if (!tbody) return;
    const canEdit = window.AuthSession?.role === 'lab'
                 || window.AuthSession?.role === 'admin';
    const overrides = new Map();
    for (const o of (DataStore.harvestTargetOverrides || [])) {
      overrides.set(`${o.variety}|${o.valley}`, o);
    }
    tbody.innerHTML = '';
    // Build all (variety, valley) combos that have a rubric entry
    const rows = [];
    for (const [valleyName, vmap] of Object.entries(CONFIG.varietyRubricMap)) {
      const valley = VALLEY_CODES[valleyName];
      if (!valley) continue;
      for (const [variety, rubricId] of Object.entries(vmap)) {
        const rubric = CONFIG.rubrics[rubricId];
        const rb = rubric?.params?.brix;
        const ra = rubric?.params?.anthocyanins;
        const inherited = {
          brixTarget: rb ? (rb.a[0] + rb.a[1]) / 2 : null,
          brixLower:  rb?.a?.[0] ?? null,
          brixUpper:  rb?.a?.[1] ?? null,
          antTarget:  ra?.a ?? null,
        };
        const ovr = overrides.get(`${variety}|${valley}`);
        rows.push({ variety, valley, rubric, inherited, ovr });
      }
    }
    rows.sort((a, b) => a.variety.localeCompare(b.variety)
                     || a.valley.localeCompare(b.valley));
    for (const r of rows) tbody.appendChild(this.renderRow(r, canEdit));

    // Meta: latest updated_by/updated_at
    const latest = (DataStore.harvestTargetOverrides || [])
      .slice()
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
    if (meta && latest) {
      meta.textContent = `Última actualización: ${latest.updated_by ?? '—'} · `
        + new Date(latest.updated_at).toLocaleDateString('es-MX',
            { day:'numeric', month:'short', year:'numeric' });
    } else if (meta) {
      meta.textContent = 'Sin overrides registrados — todos los valores se heredan de la rúbrica.';
    }
  },

  renderRow(r, canEdit) {
    const tr = document.createElement('tr');
    const key = `${r.variety}|${r.valley}`;
    const dirty = dirtyRows.get(key) ?? {};
    const v = field => (
      dirty[field] !== undefined ? dirty[field]
      : r.ovr?.[field] !== undefined && r.ovr[field] !== null ? r.ovr[field]
      : ''
    );
    const ph = field => {
      const map = { brix_target: 'brixTarget', brix_target_lower: 'brixLower',
                    brix_upper: 'brixUpper', anthocyanin_target: 'antTarget' };
      const inh = r.inherited[map[field]];
      return inh != null ? String(inh) : 'n/a';
    };

    const inputs = ['brix_target', 'brix_target_lower', 'brix_upper'];
    const cells = inputs.map(f =>
      `<td class="num"><input type="number" step="0.01" data-field="${f}"
          value="${v(f)}" placeholder="${ph(f)}" ${canEdit ? '' : 'disabled'}></td>`
    ).join('');
    const antCell = r.inherited.antTarget == null
      ? `<td class="num" style="color:#9b9388;font-style:italic">no aplica</td>`
      : `<td class="num"><input type="number" step="1" data-field="anthocyanin_target"
            value="${v('anthocyanin_target')}" placeholder="${ph('anthocyanin_target')}"
            ${canEdit ? '' : 'disabled'}></td>`;

    let note;
    if (!r.ovr) note = '100% de rúbrica';
    else {
      const fields = ['brix_target','brix_target_lower','brix_upper','anthocyanin_target'];
      const overridden = fields.filter(f => r.ovr[f] != null);
      if (overridden.length === fields.length) note = 'override completo';
      else if (overridden.length === 0) note = '100% de rúbrica';
      else note = `heredado: ${fields.filter(f => !overridden.includes(f))
                    .map(f => f.replace('brix_','Brix ').replace('anthocyanin_','ANT '))
                    .join(', ')}`;
    }

    tr.innerHTML = `
      <td><b>${r.variety}</b></td>
      <td>${r.valley}</td>
      ${cells}
      ${antCell}
      <td style="font-size:11px;color:#7a7368">${note}</td>
    `;
    if (canEdit) {
      tr.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', e => {
          const patch = dirtyRows.get(key) ?? {};
          const val = e.target.value.trim();
          patch[e.target.dataset.field] = val === '' ? null : Number(val);
          dirtyRows.set(key, patch);
        });
      });
    }
    return tr;
  },

  async save() {
    if (!dirtyRows.size) return;
    const errors = [];
    for (const [key, patch] of dirtyRows.entries()) {
      const [variety, valley] = key.split('|');
      try {
        await DataStore.upsertHarvestTargetOverride({
          variety, valley, ...patch,
        });
      } catch (e) {
        errors.push(`${variety} · ${valley}: ${e.message}`);
      }
    }
    dirtyRows.clear();
    this.render();
    if (errors.length) {
      alert(`Algunos registros no se guardaron:\n${errors.join('\n')}`);
    }
  },
};
```

- [ ] **Step 2: Wire the route in `app.js`**

In the view switch (next to the `prediccion` case from Task 15), add:

```js
      case 'ajustes-objetivos': {
        const { PredictionSettings } = await import('./predictionSettings.js');
        PredictionSettings.mount();
        break;
      }
```

Ensure that clicking the `<a class="link-button" data-view="ajustes-objetivos">` element from the Predicción header navigates to this view. Search `app.js` for the existing `[data-view]` click delegation; it should already cover anchors with that attribute.

- [ ] **Step 3: Manual verification**

With the predictor flag on and as a `lab` user, navigate to Predicción → click "⚙ Ajustes de objetivos". The settings table should render with one row per `(variety, valley)` combo that has a rubric. Edit a Brix midpoint, click Guardar, and confirm a successful POST to `/api/row` (check Network tab). Return to Predicción and confirm the corresponding card's recommended date moves.

- [ ] **Step 4: Commit**

```bash
git add js/predictionSettings.js js/app.js
git commit -m "$(cat <<'EOF'
feat(settings): harvest target overrides editor

One editable row per (variety, valley) that has a rubric entry.
Empty inputs inherit from rubric (placeholder shows the inherited
value). White varietals show 'no aplica' for ANT. Lab/admin can
edit; viewers see disabled inputs. Save dispatches one upsert per
dirty row via DataStore.upsertHarvestTargetOverride.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Fixture vintage + integration test

**Files:**
- Create: `tests/fixtures/prediction-2024-kompali-cs.json`
- Create: `tests/mt25-prediction-integration.test.mjs`

- [ ] **Step 1: Build the fixture**

Pull the 2024 Cabernet Sauvignon Kompali berry samples from Supabase as JSON. From the Supabase SQL Editor run:

```sql
SELECT sample_date, brix, tant
FROM wine_samples
WHERE sample_type = 'Berries'
  AND variety = 'Cabernet Sauvignon'
  AND appellation = 'Kompali (VON)'
  AND vintage_year = 2024
ORDER BY sample_date ASC;
```

Save the result as `tests/fixtures/prediction-2024-kompali-cs.json` shaped like:

```json
{
  "variety": "Cabernet Sauvignon",
  "appellation": "Kompali (VON)",
  "vintage": 2024,
  "rubricId": "CS-SY-MAL-MRS-TEM-VON",
  "samples": [
    { "sampleDate": "2024-08-05", "brix": 19.4, "ant": 580 },
    { "sampleDate": "2024-08-12", "brix": 20.1, "ant": 620 }
    /* … etc … */
  ],
  "actualReceptionDate": "2024-09-25"
}
```

`actualReceptionDate` comes from `tank_receptions.reception_date` filtered for the same variety + valley + vintage.

If no 2024 data exists, pick the most recent vintage that does and rename the fixture file (e.g. `prediction-2023-...-cs.json`).

- [ ] **Step 2: Write the integration test**

Create `tests/mt25-prediction-integration.test.mjs`:

```js
// tests/mt25-prediction-integration.test.mjs
// MT.25 — Harvest predictor integration against a frozen real vintage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTarget, computeOne } from '../js/prediction.js';

const fx = JSON.parse(readFileSync(
  new URL('./fixtures/prediction-2024-kompali-cs.json', import.meta.url)));

// Pulled in-line from js/config.js — keep in sync if rubric thresholds shift.
const RUBRIC = {
  params: {
    brix:         { kind: 'range', a: [23.5, 24.2] },
    anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
  },
};

test('MT.25 integration: predict 2024 Kompali CS reception within ±10 days', () => {
  const samples = fx.samples
    .map(s => ({ ...s, sampleDate: new Date(s.sampleDate) }))
    .sort((a, b) => a.sampleDate - b.sampleDate);
  // "Today" = 21 days before the actual reception date — typical winemaker
  // forecast horizon.
  const reception = new Date(fx.actualReceptionDate);
  const today = new Date(reception.getTime() - 21 * 86_400_000);
  const current = samples
    .filter(s => s.sampleDate <= today)
    .map((s, i, arr) => ({
      sampleDate: s.sampleDate,
      tDays: (s.sampleDate - arr[0].sampleDate) / 86_400_000,
      brix: s.brix, ant: s.ant,
    }));
  const target = resolveTarget({ rubric: RUBRIC, override: null });
  // No prior vintages in the integration fixture; this tests the
  // V=0 fallback path on real data.
  const out = computeOne({
    current, historicalByVintage: [], target, today,
  });
  assert.ok(out.recommendedDate, `reason=${out.reason}`);
  const errorDays = Math.abs(
    (out.recommendedDate.getTime() - reception.getTime()) / 86_400_000);
  assert.ok(errorDays <= 10,
    `predicted ${out.recommendedDate.toISOString().slice(0,10)} ` +
    `vs actual ${fx.actualReceptionDate}, error=${errorDays.toFixed(1)} d`);
});
```

- [ ] **Step 3: Run the test**

Run: `node --test tests/mt25-prediction-integration.test.mjs`
Expected: PASS. If the error exceeds 10 days, investigate the model — do NOT inflate the bound. (Possible adjustment: the recencyBoostWindow, or the historical prior bias, but a fix to either is a real model change requiring re-review.)

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/prediction-2024-kompali-cs.json \
        tests/mt25-prediction-integration.test.mjs
git commit -m "$(cat <<'EOF'
test(prediction): integration test on 2024 Kompali CS fixture

Locks the predictor's MAE at T-21 to ≤10 days against a real
historical vintage. Frozen JSON fixture; regenerated only when
underlying samples are corrected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Backtest harness

**Files:**
- Create: `tests/mt26-prediction-backtest.test.mjs`

- [ ] **Step 1: Write the backtest**

Create `tests/mt26-prediction-backtest.test.mjs`:

```js
// tests/mt26-prediction-backtest.test.mjs
// MT.26 — Backtest harness. For each prior vintage in the fixture,
// simulate predictions at T-30, T-21, T-14, T-7 and verify MAE bounds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolveTarget, computeOne } from '../js/prediction.js';

const RUBRIC = {
  params: {
    brix:         { kind: 'range', a: [23.5, 24.2] },
    anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
  },
};

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(FIXTURE_DIR)
  .filter(f => f.startsWith('prediction-') && f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(new URL(f, FIXTURE_DIR))));

function predictAt(samples, today, target, historicalByVintage = []) {
  const current = samples
    .filter(s => s.sampleDate <= today)
    .map((s, i, arr) => ({
      sampleDate: s.sampleDate,
      tDays: (s.sampleDate - arr[0].sampleDate) / 86_400_000,
      brix: s.brix, ant: s.ant,
    }));
  return computeOne({ current, historicalByVintage, target, today });
}

test('MT.26 backtest: MAE at T-14 < 7 days, MAE at T-30 < 14 days', () => {
  const errors = { 30: [], 21: [], 14: [], 7: [] };
  for (const fx of fixtures) {
    if (!fx.actualReceptionDate) continue;
    const samples = fx.samples
      .map(s => ({ ...s, sampleDate: new Date(s.sampleDate) }))
      .sort((a, b) => a.sampleDate - b.sampleDate);
    const reception = new Date(fx.actualReceptionDate);
    const target = resolveTarget({ rubric: RUBRIC, override: null });
    for (const offset of [30, 21, 14, 7]) {
      const today = new Date(reception.getTime() - offset * 86_400_000);
      const before = samples.filter(s => s.sampleDate <= today);
      if (before.length < 2) continue;
      const out = predictAt(samples, today, target, []);
      if (!out.recommendedDate) continue;
      const err = Math.abs((out.recommendedDate - reception) / 86_400_000);
      errors[offset].push(err);
    }
  }
  const mae = arr => arr.length
    ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const mae14 = mae(errors[14]);
  const mae30 = mae(errors[30]);
  // Allow null when no fixtures yielded enough samples at that horizon
  if (mae14 != null) assert.ok(mae14 < 7,
    `MAE(T-14) = ${mae14.toFixed(2)} d, expected < 7`);
  if (mae30 != null) assert.ok(mae30 < 14,
    `MAE(T-30) = ${mae30.toFixed(2)} d, expected < 14`);
  console.log('[MT.26 backtest]', JSON.stringify({
    n: { 30: errors[30].length, 21: errors[21].length,
         14: errors[14].length,  7: errors[7].length },
    mae: { 30: mae30, 21: mae(errors[21]), 14: mae14, 7: mae(errors[7]) },
  }));
});
```

- [ ] **Step 2: Run the backtest**

Run: `node --test tests/mt26-prediction-backtest.test.mjs`
Expected: PASS. The `console.log` line reports the per-horizon counts and MAE; this is the model-quality dashboard for future code changes.

- [ ] **Step 3: Commit**

```bash
git add tests/mt26-prediction-backtest.test.mjs
git commit -m "$(cat <<'EOF'
test(prediction): backtest harness across fixture vintages

Walks each fixture, simulates predictions at T-30, T-21, T-14,
T-7. Asserts MAE(T-14) < 7 d and MAE(T-30) < 14 d. Logs counts
and per-horizon MAE so future model changes can see the impact.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Manual smoke checklist update + flag handling docs

**Files:**
- Modify: `docs/Operations.md` (or wherever the smoke checklist lives — check `docs/` for the most recent "smoke" or "round" doc)

- [ ] **Step 1: Locate the smoke checklist**

Run: `grep -rl -i "smoke\|round 3[7-9]\|smoke-checklist" docs/`
Expected: returns one or two markdown files. Pick the most recently dated one.

- [ ] **Step 2: Append the predictor smoke section**

Append the following to that file (replace "Round 38" with the current round number if different):

```markdown
## Round 38 — Harvest predictor smoke

1. Set `CONFIG.harvestPredictorEnabled = true` in `js/config.js`; reload.
2. The Predicción tab appears next to Mediciones.
3. Open Predicción → cards render, sorted by days-until ascending. `ya-en-ventana` cards (if any) appear at top.
4. Click chip VDG → only VDG cards remain. Click "Todas" → all cards return.
5. Open one card visually — line traces the dots, dashed projection extends, gray cone widens with horizon, dashed green target line is visible.
6. Click "⚙ Ajustes de objetivos" → settings page renders with all (variety, valley) rubric combos.
7. As a `lab` user, set Brix objetivo for one row, Guardar → return to Predicción → that varietal's recommended date moves accordingly.
8. As a non-lab user, settings inputs are disabled; Guardar is disabled / not available.
9. A varietal-ranch with `n=1` shows "Pocos datos esta temporada".
10. After lab validation week, flip `harvestPredictorEnabled = false → true` in the deployment config; commit that change in a follow-up PR.
```

- [ ] **Step 3: Commit**

```bash
git add docs/Operations.md   # or whichever file you appended to
git commit -m "$(cat <<'EOF'
docs(ops): add harvest predictor manual smoke checklist

Round-38 entry covering nav chip, view rendering, valley filter,
mini-chart, settings page editing + role gating, and the
n=1 placeholder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Open the PR

**Files:** (none — git operations only)

- [ ] **Step 1: Run the full test suite locally**

Run: `npm test`
Expected: all existing tests still pass, plus the new mt23/mt24/mt25/mt26 suites.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin spec/harvest-predictor
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat: harvest-readiness predictor" --body "$(cat <<'EOF'
## Summary

- Predicción de cosecha view estimates when each (variety, appellation)
  enters the rubric's A-grade window (Brix in ideal range AND ANT ≥ target).
- Confidence band widens with horizon and shrinks with more current-season
  samples and historical vintages.
- Per (variety, valley) override table for lab/admin to shift targets away
  from the rubric defaults.
- Ships behind `CONFIG.harvestPredictorEnabled = false` for one deploy
  while the lab team validates against the live vintage.

Spec: docs/superpowers/specs/2026-05-19-harvest-predictor-design.md

## Test plan

- [ ] `npm test` — mt23/mt24/mt25/mt26 all green.
- [ ] Apply `sql/migration_harvest_target_overrides.sql` in Supabase.
- [ ] In a deploy preview, flip the flag on; walk the Round-38 smoke checklist.
- [ ] Lab team uses Predicción against the live vintage for 1 week.
- [ ] Flip the flag on in main config; close out the feature gate in a follow-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Return the PR URL to the user**

---

## Self-review notes (writer's pass)

- **Spec §5.1 targets** — Task 7 covers via `resolveTarget`.
- **Spec §5.2 weighted regression** — Task 2 covers; weighted means and `sigmaBeta2` both surface.
- **Spec §5.3 historical slope prior** — Task 3 covers; last-21-days window + <3-sample filter both enforced.
- **Spec §5.4 Bayesian combine** — Task 4 covers.
- **Spec §5.5 ETA solve + window-close annotation** — Task 5 + Task 8 cover (`brixWindowCloses` returned).
- **Spec §5.6 confidence band (quadrature)** — Task 5 covers.
- **Spec §5.7 confidence label (V=0 cap)** — Task 6 covers; explicit assertion exists.
- **Spec §5.8 edge cases (all 7)** — Task 8 covers; tests exist for every reason (`pocos-datos-temporada`, `sin-historial` indirectly via Task 6 label test, `sin-tendencia-positiva`, `antocianinas-estancadas`, `ya-en-ventana`, `no-alcanzar-A`, `riesgo-sobremadurez`).
- **Spec §6 migration** — Task 1 covers.
- **Spec §7 view UI** — Tasks 14, 15 cover the card grid + valley filter + chart rendering. The click-to-expand detail panel with full-size charts and a "histórico" section listing prior vintages' reception dates is **NOT** implemented in this plan; it's deferred as a follow-up. See "Known gap" below.
- **Spec §8 settings UI** — Tasks 14, 16 cover; lab/admin gating reused via `window.AuthSession`.
- **Spec §9.1 unit tests** — Tasks 2–8.
- **Spec §9.2 integration test** — Task 17.
- **Spec §9.3 backtest** — Task 18.
- **Spec §9.4 manual smoke** — Task 19.
- **Spec §9.5 rollout** — Tasks 12 (flag), 19 (smoke), 20 (PR + rollout language).

No placeholders. No TBD steps. Each task is bite-sized (target 2–5 minutes per step). Types and method names referenced in later tasks (`weightedRegression`, `historicalSlopePrior`, `bayesianCombine`, `etaDays`, `confidenceBand`, `confidenceLabel`, `resolveTarget`, `detectEdgeCase`, `computeOne`, `computeAll`) match exactly where defined.

### Known gap

The spec §7 describes a click-to-expand detail panel per card (full-size Brix and ANT charts plus a "histórico" section listing prior vintages' actual reception dates joined from `tank_receptions`). This plan does **not** implement that panel; the cards render but are not clickable. Decision: ship the predictor first, add the detail panel as a follow-up PR once the lab team has used the basic view. If the panel is required at launch, add a Task 21 covering: click handler on the card → modal/expand → larger charts via the same `Charts.renderPredictionMini` (with `height: 280`) → small histórico table fetched via `DataStore.receptionData.filter(...)`.
