# Harvest Predictor — Brix + pH for Whites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parallel pH regression path to the harvest predictor for white varieties; expose `ph_target` override in Ajustes UI; keep reds untouched.

**Architecture:** `resolveTarget` returns `phTarget` (null for reds). `computeOne` forks on `phTarget != null` → runs pH regression and treats pH as a *deadline* (semantic opposite of anthocyanins). New reasons `ph-excedido`, `ph-temprano`, `riesgo-ph`. Views/charts polymorphically render the secondary signal (ANT for reds, pH for whites). Ajustes table gets a "pH tope" column persisted via new DB column.

**Tech Stack:** Vanilla JS ESM, node:test, Supabase, Chart.js v4.

**Spec:** `docs/superpowers/specs/2026-05-21-predictor-whites-ph-design.md`

---

## File Structure

| File | Change |
|---|---|
| `sql/migration_harvest_target_overrides_ph.sql` | Create: `ALTER TABLE … ADD COLUMN ph_target` |
| `js/migrations-manifest.js` | Append migration name |
| `api/upload.js` | Add `'ph_target'` to `harvest_target_overrides.columns` set |
| `js/validation.js` | Add `ph_target` to numericCols set |
| `js/prediction.js` | `resolveTarget` returns `phTarget`; `computeOne` adds white branch; `detectEdgeCase` accepts white-mode params; `computeAll` reads `row.pH` into `s.pH` |
| `tests/mt28-prediction-whites.test.mjs` | New — assert white-specific reasons + targets |
| `js/demoMode.js` | Generate pH samples per scenario for whites; add `riesgo-ph`, `ph-temprano` scenarios; `PH_DEPENDENT_SCENARIOS` reassignment for reds |
| `js/charts.js` | `renderPredictionMini` / `renderPredictionDetail` accept `axis='ph'` |
| `js/predictionView.js` | `renderCard` secondary block polymorphic; footer shows pH for whites; `openDetail` axis label + targets/diagnostic rows for pH |
| `index.html` | Add `<th>pH tope</th>` to Ajustes table; rename `data-ant-block` → `data-secondary-block` |
| `js/predictionSettings.js` | Compute `phTarget` from rubric; render polymorphic ANT/pH cells; persist `ph_target` |

---

## Task 1: DB migration + API whitelist + validation

Pure data-plumbing — three trivially atomic edits committed together.

**Files:**
- Create: `sql/migration_harvest_target_overrides_ph.sql`
- Modify: `js/migrations-manifest.js`
- Modify: `api/upload.js`
- Modify: `js/validation.js`

- [ ] **Step 1: Create migration SQL**

Create `sql/migration_harvest_target_overrides_ph.sql` with:

```sql
-- sql/migration_harvest_target_overrides_ph.sql
-- Adds ph_target column to harvest_target_overrides.
-- Used by the harvest predictor for white varieties (Brix + pH model).
-- Reds keep ph_target = NULL (predictor ignores it for them).

ALTER TABLE public.harvest_target_overrides
  ADD COLUMN IF NOT EXISTS ph_target NUMERIC;

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_harvest_target_overrides_ph')
  ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 2: Append to migrations manifest**

In `js/migrations-manifest.js`, find the `MIGRATIONS` array. After the line containing `'migration_harvest_target_overrides',` insert:

```javascript
  'migration_harvest_target_overrides_ph',
```

- [ ] **Step 3: Add `ph_target` to API whitelist**

In `api/upload.js`, find the `harvest_target_overrides` block (around line 111). Replace:

```javascript
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

with:

```javascript
  harvest_target_overrides: {
    conflict: 'variety,valley',
    columns: new Set([
      'variety', 'valley',
      'brix_target', 'brix_target_lower', 'brix_upper',
      'anthocyanin_target', 'ph_target',
      'updated_by', 'updated_at',
    ]),
  },
```

- [ ] **Step 4: Add `ph_target` to validation**

In `js/validation.js`, find the `harvest_target_overrides` entry. Replace:

```javascript
  harvest_target_overrides: {
    intCols: new Set(),
    numericCols: new Set([
      'brix_target', 'brix_target_lower', 'brix_upper', 'anthocyanin_target',
    ]),
    requiredOnInsert: new Set(['variety', 'valley']),
  },
```

with:

```javascript
  harvest_target_overrides: {
    intCols: new Set(),
    numericCols: new Set([
      'brix_target', 'brix_target_lower', 'brix_upper', 'anthocyanin_target',
      'ph_target',
    ]),
    requiredOnInsert: new Set(['variety', 'valley']),
  },
```

- [ ] **Step 5: Commit (DO NOT push — push happens after the migration is run in Supabase)**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add sql/migration_harvest_target_overrides_ph.sql js/migrations-manifest.js api/upload.js js/validation.js && git commit -m "$(cat <<'EOF'
feat(predictor): DB plumbing for ph_target override

- sql migration adds ph_target NUMERIC to harvest_target_overrides
- manifest declares the migration
- api/upload.js whitelists ph_target for upsert
- validation.js treats ph_target as numeric

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `resolveTarget` returns `phTarget` + `computeAll` reads `s.pH`

Foundational predictor changes. After this, `target.phTarget` is available throughout but `computeOne` doesn't use it yet (handled in Task 3).

**Files:**
- Modify: `js/prediction.js`

- [ ] **Step 1: Update `resolveTarget`**

In `js/prediction.js`, find the function (around line 150). Replace:

```javascript
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

with:

```javascript
export function resolveTarget({ rubric, override }) {
  const ovr = override || {};
  const rb = rubric?.params?.brix;
  const ra = rubric?.params?.anthocyanins;
  const rp = rubric?.params?.pH;
  const brixLower  = ovr.brix_target_lower ?? rb?.a?.[0] ?? null;
  const brixUpper  = ovr.brix_upper        ?? rb?.a?.[1] ?? null;
  const brixTarget = ovr.brix_target
    ?? (rb?.a ? (rb.a[0] + rb.a[1]) / 2 : null);
  const antTarget  = ovr.anthocyanin_target ?? ra?.a ?? null;
  // pH is only consumed by the predictor when the rubric has NO anthocyanins
  // (i.e., whites). Reds keep phTarget = null even though their rubric has pH.
  const phTarget   = ovr.ph_target ?? ((rp && !ra) ? rp.a : null);
  return { brixLower, brixUpper, brixTarget, antTarget, phTarget };
}
```

- [ ] **Step 2: Enrich samples in `computeAll`**

In `js/prediction.js` `computeAll` (around line 338), find:

```javascript
    const sample = {
      sampleDate,
      brix: Number(row.brix),
      ant:  Number(row.tANT ?? row.tant ?? row.anthocyanins ?? row.ant),
    };
    if (!Number.isFinite(sample.brix)) continue;
```

Replace with:

```javascript
    const sample = {
      sampleDate,
      brix: Number(row.brix),
      ant:  Number(row.tANT ?? row.tant ?? row.anthocyanins ?? row.ant),
      pH:   Number(row.pH ?? row.ph),
    };
    if (!Number.isFinite(sample.brix)) continue;
```

Then in the same function, find the loop that maps samples to current/historical:

```javascript
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
```

Replace with (add `pH: s.pH` to both maps):

```javascript
    const current = g.current.map(s => ({
      sampleDate: s.sampleDate,
      tDays: (s.sampleDate.getTime() - t0) / dayMs,
      brix: s.brix, ant: s.ant, pH: s.pH,
    }));
    const historicalByVintage = [];
    for (const arr of g.historicalByVintage.values()) {
      arr.sort((a, b) => a.sampleDate - b.sampleDate);
      const tv0 = arr[0].sampleDate.getTime();
      historicalByVintage.push(arr.map(s => ({
        tDays: (s.sampleDate.getTime() - tv0) / dayMs,
        brix: s.brix, ant: s.ant, pH: s.pH,
      })));
    }
```

- [ ] **Step 3: Run prediction tests to confirm no red-path regression**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && node --test tests/mt23-prediction-model.test.mjs tests/mt24-prediction-resolve.test.mjs tests/mt25-prediction-integration.test.mjs tests/mt26-prediction-backtest.test.mjs tests/mt27-demo-predictor.test.mjs
```

Expected: all pass. (Adding optional fields to result shapes doesn't break existing assertions.)

- [ ] **Step 4: Commit (do NOT push)**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add js/prediction.js && git commit -m "$(cat <<'EOF'
feat(predictor): resolveTarget returns phTarget; computeAll reads pH

resolveTarget now returns phTarget — defaults to rubric.params.pH.a when
the rubric has pH but no anthocyanins (whites); null otherwise. computeAll
includes s.pH in current and historical sample arrays. computeOne does
not yet branch on phTarget — that lands in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: White path in `computeOne` + `detectEdgeCase`

Adds the pH parallel regression and the white-mode edge-case branch.

**Files:**
- Modify: `js/prediction.js`

- [ ] **Step 1: Update `detectEdgeCase` to support white mode**

In `js/prediction.js`, find `detectEdgeCase` (around line 165). Replace the entire function with:

```javascript
export function detectEdgeCase({
  yhatBrixToday, yhatAntToday, yhatPhToday,
  betaPostBrix, betaPostAnt, betaPostPh,
  brixLower, brixUpper, antTarget, phTarget,
  brixMidEta, brixLowerEta, antEta, phEta, brixWindowCloses,
}) {
  if (betaPostBrix <= 0) return 'sin-tendencia-positiva';

  // White-mode checks (phTarget != null AND antTarget == null)
  if (phTarget != null && antTarget == null) {
    if (yhatPhToday > phTarget) return 'ph-excedido';
    const brixInWindow = yhatBrixToday >= brixLower && yhatBrixToday <= brixUpper;
    if (brixInWindow) return 'ya-en-ventana';
    if (Number.isFinite(phEta) && Number.isFinite(brixLowerEta)
        && phEta < brixLowerEta) return 'ph-temprano';
    const effectiveCloses = Math.min(
      Number.isFinite(brixWindowCloses) ? brixWindowCloses : Infinity,
      Number.isFinite(phEta) ? phEta : Infinity
    );
    if (Number.isFinite(effectiveCloses) && brixMidEta > effectiveCloses) {
      return 'riesgo-sobremadurez';
    }
    if (Number.isFinite(phEta) && phEta < brixMidEta) return 'riesgo-ph';
    return null;
  }

  // Red-mode checks (existing behavior)
  if (antTarget != null && betaPostAnt <= 0) return 'antocianinas-estancadas';
  const brixInWindow = yhatBrixToday >= brixLower && yhatBrixToday <= brixUpper;
  const antOver      = antTarget == null || (yhatAntToday >= antTarget);
  if (brixInWindow && antOver) return 'ya-en-ventana';
  if (antEta != null && Number.isFinite(antEta)
      && Number.isFinite(brixWindowCloses)
      && antEta > brixWindowCloses) return 'no-alcanzar-A';
  const recommendedEta = antEta != null ? Math.max(brixMidEta, antEta) : brixMidEta;
  if (Number.isFinite(brixWindowCloses) && recommendedEta > brixWindowCloses) {
    return 'riesgo-sobremadurez';
  }
  return null;
}
```

- [ ] **Step 2: Update `computeOne` to add white path**

In `js/prediction.js`, find `computeOne` (around line 197). The full function needs the pH parallel regression. Replace from the line `let antFit = null, antPrior = …` down to the end of `computeOne` with:

```javascript
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

  let phFit = null, phPrior = { V: 0, tau2Hist: Infinity, betaHist: null },
      phComb = { betaPost: NaN, sigmaBeta2Post: NaN };
  if (target.phTarget != null) {
    const phSamples = sorted
      .filter(s => Number.isFinite(s.pH))
      .map(s => ({ t: s.tDays, y: s.pH, w: wOf(s) }));
    phFit = weightedRegression(phSamples);
    phPrior = historicalSlopePrior(
      historicalByVintage.map(v => v
        .filter(s => Number.isFinite(s.pH))
        .map(s => ({ t: s.tDays, y: s.pH }))
      )
    );
    phComb = bayesianCombine({
      betaHat: phFit.beta, sigmaBeta2: phFit.sigmaBeta2,
      betaHist: phPrior.betaHist, tau2Hist: phPrior.tau2Hist,
    });
  }

  // ŷ at today using *this-season* fit
  const yhatBrixToday = brixFit.alpha + brixFit.beta * tToday;
  const yhatAntToday  = antFit ? antFit.alpha + antFit.beta * tToday : null;
  const yhatPhToday   = phFit  ? phFit.alpha  + phFit.beta  * tToday : null;

  // ETA in days from today using posterior slope
  const brixMidEta = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixTarget,
  });
  const brixLowerEta = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixLower,
  });
  const brixWindowOpensDays = brixLowerEta;
  const brixWindowClosesDays = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixUpper,
  });
  const antEta = target.antTarget != null ? etaDays({
    alpha: yhatAntToday - antComb.betaPost * tToday,
    beta: antComb.betaPost, tToday, target: target.antTarget,
  }) : null;
  const phEta  = target.phTarget != null ? etaDays({
    alpha: yhatPhToday - phComb.betaPost * tToday,
    beta: phComb.betaPost, tToday, target: target.phTarget,
  }) : null;

  // Edge-case detection
  const reason = detectEdgeCase({
    yhatBrixToday, yhatAntToday, yhatPhToday,
    betaPostBrix: brixComb.betaPost,
    betaPostAnt: antComb.betaPost,
    betaPostPh: phComb.betaPost,
    brixLower: target.brixLower, brixUpper: target.brixUpper,
    antTarget: target.antTarget, phTarget: target.phTarget,
    brixMidEta, brixLowerEta, antEta, phEta,
    brixWindowCloses: brixWindowClosesDays,
  });

  const dayMs = 86_400_000;
  // White mode: recommendedEta = min(brixMidEta, effectiveWindowCloses)
  // Red mode: recommendedEta = max(brixMidEta, antEta)
  // Brix-only fallback: recommendedEta = brixMidEta
  const isWhite = target.phTarget != null && target.antTarget == null;
  let recommendedEtaDays;
  if (isWhite) {
    const phEffective = Number.isFinite(phEta) ? phEta : Infinity;
    const brixUpperEffective = Number.isFinite(brixWindowClosesDays)
      ? brixWindowClosesDays : Infinity;
    const effectiveCloses = Math.min(phEffective, brixUpperEffective);
    recommendedEtaDays = Math.min(brixMidEta, effectiveCloses);
  } else if (antEta != null) {
    recommendedEtaDays = Math.max(brixMidEta, antEta);
  } else {
    recommendedEtaDays = brixMidEta;
  }
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

  // White-mode recommended date set even when reason fires for soft alerts
  // (riesgo-ph, riesgo-sobremadurez): still useful to show "harvest by X".
  const isSoftWhiteAlert = isWhite
    && (reason === 'riesgo-ph' || reason === 'riesgo-sobremadurez');
  const recommendedDate = (reason && reason !== 'ya-en-ventana' && !isSoftWhiteAlert)
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
    brixHoy: yhatBrixToday, antHoy: yhatAntToday, phHoy: yhatPhToday,
    samplesProjected: {
      brixEta: brixMidEta, antEta, phEta,
      brixWindowOpensDays, brixWindowClosesDays,
    },
    // Diagnostics passthrough — view needs these for the chart
    brixFit, brixComb, antFit, antComb, phFit, phComb,
  };
}
```

Also update the early-return when `nCurrent < 2`. Find:

```javascript
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
```

Replace with:

```javascript
  if (nCurrent < 2) {
    return {
      reason: 'pocos-datos-temporada',
      recommendedDate: null, brixWindowCloses: null,
      bandDays: Infinity, label: 'Baja',
      nCurrent, V: 0,
      brixHoy: current[0]?.brix ?? null,
      antHoy:  current[0]?.ant ?? null,
      phHoy:   current[0]?.pH ?? null,
      samplesProjected: { brixEta: null, antEta: null, phEta: null },
    };
  }
```

- [ ] **Step 2 (continued)**: also keep the `brixLowerEta` definition for callers. Look for the existing computation `brixWindowOpensDays = etaDays(...)` — in the new code above, both are computed as the same value (`brixLowerEta`). The new code preserves `brixWindowOpensDays` in the output so existing consumers don't break.

- [ ] **Step 3: Run prediction tests**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && node --test tests/mt23-prediction-model.test.mjs tests/mt24-prediction-resolve.test.mjs tests/mt25-prediction-integration.test.mjs tests/mt26-prediction-backtest.test.mjs tests/mt27-demo-predictor.test.mjs
```

Expected: all pass. (Red-path behavior is byte-identical because the white branches gate on `phTarget != null && antTarget == null`, and reds have `antTarget != null`.)

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add js/prediction.js && git commit -m "$(cat <<'EOF'
feat(predictor): white path with parallel pH regression

computeOne now runs a parallel pH weighted regression and Bayesian combine
when target.phTarget != null && target.antTarget == null. detectEdgeCase
forks: whites use a deadline semantic (ph-excedido, ph-temprano, riesgo-ph
plus existing ya-en-ventana / sin-tendencia-positiva / riesgo-sobremadurez).
recommendedDate for whites = today + min(brixMidEta, effectiveWindowCloses)
where effectiveWindowCloses = min(brixUpperEta, phEta). Reds unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write failing test `mt28-prediction-whites.test.mjs`

Test-first — written before demo data emits pH samples (so it WILL fail) so Task 5's implementation has an objective gate.

**Files:**
- Create: `tests/mt28-prediction-whites.test.mjs`

- [ ] **Step 1: Write the test file**

```javascript
// tests/mt28-prediction-whites.test.mjs
// MT.28 — Modo Demo + Prediction supports the white (Brix + pH) path.
// Verifies that white-rubric groups receive phTarget, that white-specific
// reasons appear in the predictor output, and that reds are unaffected.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DemoMode } from '../js/demoMode.js';
import { DataStore } from '../js/dataLoader.js';
import * as Prediction from '../js/prediction.js';
import { CONFIG } from '../js/config.js';
import { resolveValley } from '../js/classification.js';

function runComputeAll() {
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
  return Prediction.computeAll({
    berryData: DataStore.berryData || [],
    today, currentVintage,
    overrides: DataStore.harvestTargetOverrides || [],
    rubricFor, valleyFor,
  });
}

test('MT.28 whites: every white group has phTarget set, antTarget null', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const whiteVarieties = new Set([
      'Sauvignon Blanc', 'Chardonnay', 'Chenin Blanc', 'Viognier',
    ]);
    const whites = results.filter(r => whiteVarieties.has(r.variety));
    assert.ok(whites.length >= 1, `no white groups in demo (found: ${results.map(r=>r.variety).join(',')})`);
    for (const r of whites) {
      assert.ok(r.target.phTarget != null,
        `${r.variety} ${r.appellation}: phTarget should be non-null`);
      assert.equal(r.target.antTarget, null,
        `${r.variety} ${r.appellation}: antTarget should be null for whites`);
    }
  } finally {
    DemoMode.disable();
  }
});

test('MT.28 whites: every red group has antTarget set, phTarget null', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const whiteVarieties = new Set([
      'Sauvignon Blanc', 'Chardonnay', 'Chenin Blanc', 'Viognier',
    ]);
    const reds = results.filter(r => !whiteVarieties.has(r.variety));
    assert.ok(reds.length >= 1, 'no red groups in demo');
    for (const r of reds) {
      assert.ok(r.target.antTarget != null,
        `${r.variety} ${r.appellation}: antTarget should be non-null for reds`);
      assert.equal(r.target.phTarget, null,
        `${r.variety} ${r.appellation}: phTarget should be null for reds`);
    }
  } finally {
    DemoMode.disable();
  }
});

test('MT.28 whites: at least one ph-temprano OR riesgo-ph OR ph-excedido card', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const whiteVarieties = new Set([
      'Sauvignon Blanc', 'Chardonnay', 'Chenin Blanc', 'Viognier',
    ]);
    const whites = results.filter(r => whiteVarieties.has(r.variety));
    const phReasons = whites.map(r => r.prediction.reason).filter(rsn =>
      rsn === 'ph-temprano' || rsn === 'riesgo-ph' || rsn === 'ph-excedido');
    assert.ok(phReasons.length >= 1,
      `no white pH-reason cards. White reasons: ${whites.map(r => r.prediction.reason).join(',')}`);
  } finally {
    DemoMode.disable();
  }
});

test('MT.28 whites: phHoy is populated for white groups', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const whiteVarieties = new Set([
      'Sauvignon Blanc', 'Chardonnay', 'Chenin Blanc', 'Viognier',
    ]);
    const whites = results.filter(r => whiteVarieties.has(r.variety));
    for (const r of whites) {
      const p = r.prediction;
      if (p.reason === 'pocos-datos-temporada') continue;
      assert.ok(Number.isFinite(p.phHoy),
        `${r.variety} ${r.appellation}: phHoy=${p.phHoy} should be finite`);
    }
  } finally {
    DemoMode.disable();
  }
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && node --test tests/mt28-prediction-whites.test.mjs 2>&1 | tail -30
```

Expected: at least the pH-reason test FAILS because demoMode's current `pH` samples are random noise (3.5 ± 0.15) → no calibrated pH trajectories → no `ph-temprano`/`riesgo-ph` reasons. The `phTarget` and `phHoy` tests may pass already after Task 2 since both come from rubric/regression.

- [ ] **Step 3: Do NOT commit yet — committed together with Task 5.**

---

## Task 5: demoMode pH calibration + scenario reassignment

Make the failing test pass by adding calibrated pH samples for whites and two new white scenarios.

**Files:**
- Modify: `js/demoMode.js`

- [ ] **Step 1: Add scenarios + reassignment set**

In `js/demoMode.js`, find `SCENARIO_QUOTAS` (around line 254). Replace:

```javascript
const SCENARIO_QUOTAS = [
  ['ya-en-ventana',             0.25],
  ['eta-corta',                 0.20],
  ['eta-media',                 0.35],
  ['no-alcanzar-A',             0.10],
  ['antocianinas-estancadas',   0.10],
];

// Scenarios that require ANT machinery — reassigned to 'eta-media' when
// the group's rubric has no anthocyanins target (white varieties).
const ANT_DEPENDENT_SCENARIOS = new Set([
  'no-alcanzar-A', 'antocianinas-estancadas',
]);
```

with:

```javascript
const SCENARIO_QUOTAS = [
  ['ya-en-ventana',             0.20],
  ['eta-corta',                 0.20],
  ['eta-media',                 0.30],
  ['no-alcanzar-A',             0.10],
  ['antocianinas-estancadas',   0.10],
  ['riesgo-ph',                 0.05],
  ['ph-temprano',               0.05],
];

// Scenarios that require ANT machinery — reassigned to 'eta-media' when
// the group's rubric has no anthocyanins target (white varieties).
const ANT_DEPENDENT_SCENARIOS = new Set([
  'no-alcanzar-A', 'antocianinas-estancadas',
]);

// Scenarios that require pH-as-deadline machinery — reassigned to 'eta-media'
// when the group's rubric has no pH target (i.e., reds in current ruleset).
const PH_DEPENDENT_SCENARIOS = new Set([
  'riesgo-ph', 'ph-temprano',
]);
```

- [ ] **Step 2: Extend `scenarioParams` for pH outputs**

Still in `js/demoMode.js`, find `scenarioParams` (around line 271). Replace the entire function with:

```javascript
function scenarioParams(scenario, target, r) {
  const { brixLower, brixUpper, brixTarget, antTarget, phTarget } = target;
  switch (scenario) {
    case 'ya-en-ventana':
      return {
        yBrix: brixTarget + r() * 0.5, bBrix: 0.15,
        yAnt:  antTarget != null ? antTarget * 1.10 : null, bAnt: 8,
        yPh:   phTarget  != null ? phTarget  - 0.05 : null, bPh: 0.005,
      };
    case 'eta-corta':
      return {
        yBrix: brixLower - (2 + r()), bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.85 : null, bAnt: 12,
        yPh:   phTarget  != null ? phTarget  - 0.15 : null, bPh: 0.008,
      };
    case 'eta-media':
      return {
        yBrix: brixLower - (5 + r() * 2), bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.65 : null, bAnt: 12,
        yPh:   phTarget  != null ? phTarget  - 0.20 : null, bPh: 0.008,
      };
    case 'no-alcanzar-A':
      return {
        yBrix: brixTarget - r(), bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.50 : null, bAnt: 1.5,
        yPh:   null, bPh: 0,
      };
    case 'antocianinas-estancadas':
      return {
        yBrix: brixLower + r(), bBrix: 0.25,
        yAnt:  antTarget != null ? antTarget * 0.70 : null, bAnt: -0.5,
        yPh:   null, bPh: 0,
      };
    case 'riesgo-ph':
      return {
        yBrix: brixLower - (3 + r() * 0.5), bBrix: 0.25,
        yAnt:  null, bAnt: 0,
        yPh:   phTarget != null ? phTarget - 0.05 : null, bPh: 0.025,
      };
    case 'ph-temprano':
      return {
        yBrix: brixLower - (6 + r() * 0.5), bBrix: 0.20,
        yAnt:  null, bAnt: 0,
        yPh:   phTarget != null ? phTarget - 0.02 : null, bPh: 0.030,
      };
  }
  return null;
}
```

(Also: the older `riesgo-sobremadurez` case is GONE here — it was already removed in commit `e56fd74` per the previous fix. If it's still present in the live file, leave it alone — adding the new cases is the focus.)

- [ ] **Step 3: Update `buildCurrentSeasonGroups` to expose phTarget**

In `js/demoMode.js`, find `buildCurrentSeasonGroups` (around line 322). The current code computes `target` from rubric. Replace the `target = {...}` block with:

```javascript
    const brixSpec = rubric.params.brix;
    const antSpec  = rubric.params.anthocyanins;
    const phSpec   = rubric.params.pH;
    const target = {
      brixLower:  brixSpec?.a?.[0] ?? null,
      brixUpper:  brixSpec?.a?.[1] ?? null,
      brixTarget: brixSpec?.a ? (brixSpec.a[0] + brixSpec.a[1]) / 2 : null,
      antTarget:  antSpec?.a ?? null,
      phTarget:   (phSpec && !antSpec) ? phSpec.a : null,
    };
```

- [ ] **Step 4: Update reassignment logic + sample generation in `generateCurrentSeason`**

Find `generateCurrentSeason` (around line 387). Find the inner loop that picks scenario and falls back for white/ANT, plus the per-sample emit. Replace the entire loop body (between `for (let gi = 0; gi < groups.length; gi++) {` and the matching `}`) with:

```javascript
    const g = groups[gi];
    let scenario = scenarios[gi];
    // White (no antTarget) — reassign ANT-dependent scenarios
    if (g.target.antTarget == null && ANT_DEPENDENT_SCENARIOS.has(scenario)) {
      scenario = 'eta-media';
    }
    // Red (no phTarget) — reassign pH-dependent scenarios
    if (g.target.phTarget == null && PH_DEPENDENT_SCENARIOS.has(scenario)) {
      scenario = 'eta-media';
    }
    const p = scenarioParams(scenario, g.target, r);
    if (!p) continue;
    const yy = String(currentYear).slice(2);
    const isWhite = g.target.phTarget != null && g.target.antTarget == null;
    for (let i = 0; i < offsets.length; i++) {
      const t = offsets[i];
      const seq = i + 1;
      const dateObj = new Date(today.getTime() + t * dayMs);
      const sampleDate = dateObj.toISOString().slice(0, 10);
      const brix = p.yBrix + p.bBrix * t + (r() - 0.5) * 0.2;
      const ant  = p.yAnt != null
        ? Math.max(0, p.yAnt + p.bAnt * t + (r() - 0.5) * 60)
        : null;
      const pH = isWhite && p.yPh != null
        ? Math.max(2.5, Math.min(4.5, p.yPh + p.bPh * t + (r() - 0.5) * 0.02))
        : 3.5 + (r() - 0.5) * 0.3;  // red fallback: jittery non-trend (engine ignores)
      berry.push({
        sampleId: `${yy}${g.lotCode}-c${seq}`,
        sampleDate,
        vintage: currentYear,
        variety: g.variety,
        appellation: g.appellation,
        sampleType: 'Berries',
        lotCode: g.lotCode,
        brix,
        pH,
        ta: 5 + (r() - 0.5) * 1.5,
        tANT: ant != null ? Math.round(ant) : null,
        berryFW: 1.0 + (r() - 0.5) * 0.2,
        anthocyanins: ant != null ? Math.round(ant) : null,
        daysPostCrush: 38 + t,
        sampleSeq: seq,
        grapeType: null,
      });
    }
```

- [ ] **Step 5: Run mt28**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && node --test tests/mt28-prediction-whites.test.mjs
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Run full prediction suite (no regressions in reds/mt27)**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && node --test tests/mt23-prediction-model.test.mjs tests/mt24-prediction-resolve.test.mjs tests/mt25-prediction-integration.test.mjs tests/mt26-prediction-backtest.test.mjs tests/mt27-demo-predictor.test.mjs tests/mt28-prediction-whites.test.mjs
```

Expected: all pass.

- [ ] **Step 7: Commit (both files)**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add js/demoMode.js tests/mt28-prediction-whites.test.mjs && git commit -m "$(cat <<'EOF'
feat(demo): pH calibration for whites + 2 new scenarios

generateCurrentSeason now emits calibrated pH samples for white groups
(phTarget != null && antTarget == null). Two new scenarios — riesgo-ph
and ph-temprano — exercise the white-deadline edge cases.

PH_DEPENDENT_SCENARIOS reassignment mirrors the existing
ANT_DEPENDENT_SCENARIOS so red groups dropped into a pH scenario fall
back to 'eta-media'.

New test mt28-prediction-whites asserts:
- whites have phTarget, reds have antTarget (mutually exclusive)
- at least one white card lands on a pH-reason
- phHoy is populated for white groups

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `charts.js` axis='ph' support

Polymorphic chart functions now handle three axes.

**Files:**
- Modify: `js/charts.js`

- [ ] **Step 1: Update `renderPredictionMini` to support `axis='ph'`**

In `js/charts.js`, find `renderPredictionMini(canvas, ctx, axis)` (around line 2670). Replace the function with:

```javascript
  renderPredictionMini(canvas, ctx, axis) {
    if (!canvas || !ctx) return;
    const { prediction, target, today } = ctx;
    const C = CONFIG.predictionColors;

    const sortedCurrent = ctx.current
      .slice()
      .sort((a, b) => a.sampleDate - b.sampleDate);
    if (sortedCurrent.length === 0) return;
    const dayMs = 86_400_000;
    const t0 = sortedCurrent[0].sampleDate.getTime();
    const dayOf = ms => (ms - t0) / dayMs;
    const yOf = s => axis === 'brix' ? s.brix
                   : axis === 'ant'  ? s.ant
                   : s.pH;
    const observed = sortedCurrent
      .filter(s => Number.isFinite(yOf(s)))
      .map(s => ({ x: dayOf(s.sampleDate.getTime()), y: yOf(s) }));
    if (observed.length === 0) return;

    const etaDays = axis === 'brix' ? prediction.samplesProjected.brixEta
                  : axis === 'ant'  ? prediction.samplesProjected.antEta
                  : prediction.samplesProjected.phEta;
    const horizonDays = Number.isFinite(etaDays) ? Math.max(etaDays + 5, 5) : 21;
    const todayX = dayOf(today.getTime());
    const horizonEndX = todayX + horizonDays;
    const fit  = axis === 'brix' ? prediction.brixFit  : axis === 'ant' ? prediction.antFit  : prediction.phFit;
    const comb = axis === 'brix' ? prediction.brixComb : axis === 'ant' ? prediction.antComb : prediction.phComb;
    if (!fit || !Number.isFinite(comb?.betaPost)) return;
    const tToday = todayX;
    const projAtDays = d => {
      const yhatToday = fit.alpha + fit.beta * tToday;
      return yhatToday + comb.betaPost * d;
    };
    const projection = [];
    for (let d = 0; d <= horizonDays; d += 1) {
      projection.push({ x: todayX + d, y: projAtDays(d) });
    }
    const sigmaY = Math.sqrt(Math.max(0, fit.sigma2));
    const cone = [];
    for (let d = 0; d <= horizonDays; d += 1) {
      const y = projAtDays(d);
      const wY = 1.96 * Math.sqrt(sigmaY * sigmaY + (d * Math.sqrt(comb.sigmaBeta2Post)) ** 2);
      cone.push({ x: todayX + d, yLo: y - wY, yHi: y + wY });
    }

    const targetY = axis === 'brix' ? target.brixTarget
                  : axis === 'ant'  ? target.antTarget
                  : target.phTarget;
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
        data: [
          { x: observed[0].x, y: targetY },
          { x: horizonEndX,   y: targetY },
        ],
        pointRadius: 0, tension: 0, order: 0,
      });
    }

    const canvasId = canvas.id || `pred-${axis}-${Math.random().toString(36).slice(2,8)}`;
    if (this.instances[canvasId]) { this.instances[canvasId].destroy(); }
    const unit = axis === 'brix' ? '°Bx' : axis === 'ant' ? 'mg/L' : '';
    const fmtVal = v => axis === 'brix' ? `${Number(v).toFixed(1)} ${unit}`
                  : axis === 'ant' ? `${Math.round(Number(v))} ${unit}`
                  : Number(v).toFixed(2);
    const fmtDate = xDays => new Date(t0 + xDays * dayMs)
      .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    this.instances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        scales: {
          x: { type: 'linear', ticks: { font: { size: 9 } } },
          y: { ticks: { font: { size: 9 } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            filter: item => {
              const lbl = item.dataset.label;
              return lbl === 'Observado' || lbl === 'Proyección';
            },
            callbacks: {
              title: items => fmtDate(items[0].parsed.x),
              label: item => `${item.dataset.label}: ${fmtVal(item.parsed.y)}`,
            },
          },
        },
        animation: { duration: 0 },
      },
    });
  },
```

- [ ] **Step 2: Update `renderPredictionDetail` analogously**

Find `renderPredictionDetail(canvas, ctx, axis)` (next sibling, around line 2785). Apply the same axis-handling changes — find:

```javascript
    const observed = sortedCurrent.map(s => ({
      x: dayOf(s.sampleDate.getTime()),
      y: axis === 'brix' ? s.brix : s.ant,
    }));
```

Replace with:

```javascript
    const yOf = s => axis === 'brix' ? s.brix
                   : axis === 'ant'  ? s.ant
                   : s.pH;
    const observed = sortedCurrent
      .filter(s => Number.isFinite(yOf(s)))
      .map(s => ({ x: dayOf(s.sampleDate.getTime()), y: yOf(s) }));
    if (observed.length === 0) return;
```

Then in the same function find:

```javascript
    const etaDays = axis === 'brix'
      ? prediction.samplesProjected.brixEta
      : prediction.samplesProjected.antEta;
```

Replace with:

```javascript
    const etaDays = axis === 'brix' ? prediction.samplesProjected.brixEta
                  : axis === 'ant'  ? prediction.samplesProjected.antEta
                  : prediction.samplesProjected.phEta;
```

Find:

```javascript
    const fit = axis === 'brix' ? prediction.brixFit : prediction.antFit;
    const comb = axis === 'brix' ? prediction.brixComb : prediction.antComb;
```

Replace with:

```javascript
    const fit  = axis === 'brix' ? prediction.brixFit  : axis === 'ant' ? prediction.antFit  : prediction.phFit;
    const comb = axis === 'brix' ? prediction.brixComb : axis === 'ant' ? prediction.antComb : prediction.phComb;
```

Find:

```javascript
    const targetY = axis === 'brix' ? target.brixTarget : target.antTarget;
```

Replace with:

```javascript
    const targetY = axis === 'brix' ? target.brixTarget
                  : axis === 'ant'  ? target.antTarget
                  : target.phTarget;
```

Find:

```javascript
    const unit = axis === 'brix' ? '°Bx' : 'mg/L';
    const fmtVal = v => axis === 'brix'
      ? `${Number(v).toFixed(1)} ${unit}`
      : `${Math.round(Number(v))} ${unit}`;
```

Replace with:

```javascript
    const unit = axis === 'brix' ? '°Bx' : axis === 'ant' ? 'mg/L' : '';
    const fmtVal = v => axis === 'brix' ? `${Number(v).toFixed(1)} ${unit}`
                  : axis === 'ant' ? `${Math.round(Number(v))} ${unit}`
                  : Number(v).toFixed(2);
```

Find:

```javascript
    const canvasId = canvas.id || `pred-detail-${axis}-${Math.random().toString(36).slice(2,8)}`;
```

(No change needed — `${axis}` already supports 'ph'.)

- [ ] **Step 3: Run tests (charts is a render module but mt27/mt28 cover the data path; just sanity-check)**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && node --test tests/mt27-demo-predictor.test.mjs tests/mt28-prediction-whites.test.mjs
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add js/charts.js && git commit -m "$(cat <<'EOF'
feat(predictor): charts accept axis='ph' for whites

renderPredictionMini and renderPredictionDetail now branch on three
axes (brix/ant/ph). pH is unitless and rendered with 2-decimal precision.
Filters out non-finite samples (reds emit null pH, whites with no measured
pH would be skipped).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: PredictionView — card secondary block + modal polymorphism

Render ANT for reds, pH for whites in both the compact card and the expand modal.

**Files:**
- Modify: `js/predictionView.js`
- Modify: `index.html` (rename `data-ant-block` → `data-secondary-block`)

- [ ] **Step 1: Update the card secondary block (renderCard)**

In `js/predictionView.js`, find the renderCard inner template (around line 162). Replace:

```javascript
        <div style="font-size:9px;color:#7a7368;margin-top:6px">Brix</div>
        <div class="pred-mini"><canvas data-axis="brix"></canvas></div>
        ${r.target.antTarget != null ? `
          <div style="font-size:9px;color:#7a7368;margin-top:4px">Antocianinas</div>
          <div class="pred-mini"><canvas data-axis="ant"></canvas></div>` : ''}
```

with:

```javascript
        <div style="font-size:9px;color:#7a7368;margin-top:6px">Brix</div>
        <div class="pred-mini"><canvas data-axis="brix"></canvas></div>
        ${r.target.antTarget != null ? `
          <div style="font-size:9px;color:#7a7368;margin-top:4px">Antocianinas</div>
          <div class="pred-mini"><canvas data-axis="ant"></canvas></div>`
        : r.target.phTarget != null ? `
          <div style="font-size:9px;color:#7a7368;margin-top:4px">pH</div>
          <div class="pred-mini"><canvas data-axis="ph"></canvas></div>` : ''}
```

- [ ] **Step 2: Update the card footer**

Still in `renderCard`, find:

```javascript
        <div class="pred-card-foot">
          <span>Brix <b>${p.brixHoy != null ? p.brixHoy.toFixed(1) : '—'}</b></span>
          <span>ANT <b>${p.antHoy != null ? Math.round(p.antHoy) : '—'}</b></span>
          <span>n=${p.nCurrent} · ${p.V}v</span>
        </div>
```

Replace with:

```javascript
        <div class="pred-card-foot">
          <span>Brix <b>${p.brixHoy != null ? p.brixHoy.toFixed(1) : '—'}</b></span>
          ${r.target.antTarget != null
            ? `<span>ANT <b>${p.antHoy != null ? Math.round(p.antHoy) : '—'}</b></span>`
            : `<span>pH <b>${p.phHoy != null ? p.phHoy.toFixed(2) : '—'}</b></span>`}
          <span>n=${p.nCurrent} · ${p.V}v</span>
        </div>
```

- [ ] **Step 3: Update the deferred chart instantiation**

Still in `renderCard`, find:

```javascript
        const antCanvas = card.querySelector('canvas[data-axis="ant"]');
        if (antCanvas) {
          Charts.renderPredictionMini(antCanvas, {
            prediction: p, target: r.target, today,
            current: rebuildCurrent(r),
          }, 'ant');
        }
```

Replace with:

```javascript
        const antCanvas = card.querySelector('canvas[data-axis="ant"]');
        if (antCanvas) {
          Charts.renderPredictionMini(antCanvas, {
            prediction: p, target: r.target, today,
            current: rebuildCurrent(r),
          }, 'ant');
        }
        const phCanvas = card.querySelector('canvas[data-axis="ph"]');
        if (phCanvas) {
          Charts.renderPredictionMini(phCanvas, {
            prediction: p, target: r.target, today,
            current: rebuildCurrent(r),
          }, 'ph');
        }
```

- [ ] **Step 4: Update `rebuildCurrent` to include pH**

In `js/predictionView.js`, find `rebuildCurrent`. Replace:

```javascript
    .map(row => ({
      sampleDate: row.sampleDate instanceof Date ? row.sampleDate
                  : new Date(row.sampleDate),
      brix: Number(row.brix),
      ant:  Number(row.tANT ?? row.tant ?? row.anthocyanins ?? row.ant),
    }))
```

with:

```javascript
    .map(row => ({
      sampleDate: row.sampleDate instanceof Date ? row.sampleDate
                  : new Date(row.sampleDate),
      brix: Number(row.brix),
      ant:  Number(row.tANT ?? row.tant ?? row.anthocyanins ?? row.ant),
      pH:   Number(row.pH ?? row.ph),
    }))
```

- [ ] **Step 5: Rename `data-ant-block` to `data-secondary-block` in index.html**

In `index.html`, find the line:

```html
      <div data-ant-block>
```

Replace with:

```html
      <div data-secondary-block>
```

- [ ] **Step 6: Update axis label/canvas inside the modal (still index.html)**

In `index.html` inside the `pred-detail-modal`, find:

```html
      <div data-ant-block>
        <div class="pred-detail-axis-label">Antocianinas</div>
        <div class="pred-detail-mini"><canvas data-detail-axis="ant"></canvas></div>
      </div>
```

(Note: after Step 5 the outer wrapper is `data-secondary-block`.) Replace the entire block with:

```html
      <div data-secondary-block>
        <div class="pred-detail-axis-label" data-secondary-label>Antocianinas</div>
        <div class="pred-detail-mini"><canvas data-detail-axis="ant"></canvas></div>
      </div>
```

The label and canvas axis are toggled at runtime in `openDetail`.

- [ ] **Step 7: Update `openDetail` in predictionView.js to drive the polymorphic block**

In `js/predictionView.js openDetail`, find:

```javascript
    const brixCanvas = modal.querySelector('canvas[data-detail-axis="brix"]');
    const antCanvas  = modal.querySelector('canvas[data-detail-axis="ant"]');
    const antBlock   = modal.querySelector('[data-ant-block]');
    if (antBlock) antBlock.style.display = r.target.antTarget != null ? '' : 'none';
```

Replace with:

```javascript
    const brixCanvas = modal.querySelector('canvas[data-detail-axis="brix"]');
    const secondaryBlock = modal.querySelector('[data-secondary-block]');
    const secondaryLabel = modal.querySelector('[data-secondary-label]');
    const secondaryCanvasContainer = secondaryBlock?.querySelector('.pred-detail-mini');
    const isRed   = r.target.antTarget != null;
    const isWhite = r.target.phTarget != null && r.target.antTarget == null;
    if (secondaryBlock) {
      secondaryBlock.style.display = (isRed || isWhite) ? '' : 'none';
    }
    if (secondaryLabel) {
      secondaryLabel.textContent = isRed ? 'Antocianinas' : 'pH';
    }
    if (secondaryCanvasContainer) {
      // Replace canvas so a fresh one with the right data-detail-axis is used
      secondaryCanvasContainer.innerHTML =
        `<canvas data-detail-axis="${isRed ? 'ant' : 'ph'}"></canvas>`;
    }
    const secondaryCanvas = secondaryBlock?.querySelector('canvas');
```

Then find the `requestAnimationFrame` block at the end of `openDetail`:

```javascript
    requestAnimationFrame(() => {
      if (brixCanvas) {
        Charts.renderPredictionDetail(brixCanvas, {
          prediction: p, target: r.target, today,
          current: rebuildCurrent(r),
        }, 'brix');
      }
      if (antCanvas && r.target.antTarget != null) {
        Charts.renderPredictionDetail(antCanvas, {
          prediction: p, target: r.target, today,
          current: rebuildCurrent(r),
        }, 'ant');
      }
    });
```

Replace with:

```javascript
    requestAnimationFrame(() => {
      if (brixCanvas) {
        Charts.renderPredictionDetail(brixCanvas, {
          prediction: p, target: r.target, today,
          current: rebuildCurrent(r),
        }, 'brix');
      }
      if (secondaryCanvas && (isRed || isWhite)) {
        Charts.renderPredictionDetail(secondaryCanvas, {
          prediction: p, target: r.target, today,
          current: rebuildCurrent(r),
        }, isRed ? 'ant' : 'ph');
      }
    });
```

Also update the onDismiss cleanup (find `for (const c of [brixCanvas, antCanvas])`):

```javascript
      onDismiss: () => {
        for (const c of [brixCanvas, secondaryCanvas]) {
          if (!c?.id) continue;
          const inst = Charts.instances[c.id];
          if (inst) { inst.destroy(); delete Charts.instances[c.id]; }
        }
      },
```

- [ ] **Step 8: Update Objetivos table in openDetail**

In `openDetail`, find the targets-body block:

```javascript
    if (r.target.antTarget != null) {
      addRow('Antocianinas objetivo', `≥ ${Math.round(r.target.antTarget)} mg/L`);
    }
```

Replace with:

```javascript
    if (r.target.antTarget != null) {
      addRow('Antocianinas objetivo', `≥ ${Math.round(r.target.antTarget)} mg/L`);
    }
    if (r.target.phTarget != null && r.target.antTarget == null) {
      addRow('pH tope', `≤ ${r.target.phTarget.toFixed(2)}`);
    }
```

- [ ] **Step 9: Update Diagnóstico table in openDetail**

Find:

```javascript
    if (p.antHoy != null) {
      addDiag('ANT hoy (ŷ)', `${Math.round(p.antHoy)} mg/L`);
    }
    if (p.antComb && Number.isFinite(p.antComb.betaPost)) {
      addDiag('β ANT', `${p.antComb.betaPost.toFixed(2)} mg/L/día`);
    }
```

Replace with:

```javascript
    if (p.antHoy != null && r.target.antTarget != null) {
      addDiag('ANT hoy (ŷ)', `${Math.round(p.antHoy)} mg/L`);
    }
    if (p.antComb && Number.isFinite(p.antComb.betaPost) && r.target.antTarget != null) {
      addDiag('β ANT', `${p.antComb.betaPost.toFixed(2)} mg/L/día`);
    }
    if (p.phHoy != null && r.target.phTarget != null && r.target.antTarget == null) {
      addDiag('pH hoy (ŷ)', `${p.phHoy.toFixed(2)}`);
    }
    if (p.phComb && Number.isFinite(p.phComb.betaPost) && r.target.phTarget != null
        && r.target.antTarget == null) {
      addDiag('β pH', `${p.phComb.betaPost.toFixed(3)} /día`);
    }
```

- [ ] **Step 10: Add Razón explanations for white-mode reasons**

In `openDetail`, find the `reasonExplain` object:

```javascript
    const reasonExplain = {
      'sin-tendencia-positiva': '...',
      'antocianinas-estancadas': '...',
      'no-alcanzar-A': '...',
      'riesgo-sobremadurez': '...',
      'pocos-datos-temporada': '...',
    };
```

Add three new keys (keep existing keys verbatim):

```javascript
    const reasonExplain = {
      'sin-tendencia-positiva':
        'El Brix no muestra tendencia positiva en las muestras recientes. Revisar muestreo o esperar más datos.',
      'antocianinas-estancadas':
        'Las antocianinas están planas o decrecen. La fruta puede no estar madurando fenólicamente.',
      'no-alcanzar-A':
        'Las antocianinas no alcanzarán el objetivo antes de que el Brix supere el límite alto. La calidad A no es viable este ciclo.',
      'riesgo-sobremadurez':
        'El Brix supera el límite alto antes de que las antocianinas alcancen el objetivo. Considera cosechar antes para evitar sobremadurez.',
      'pocos-datos-temporada':
        'Hay menos de 2 muestras este ciclo. Toma más muestras antes de confiar en una recomendación.',
      'ph-excedido':
        'El pH ya superó el umbral de calidad A. Las uvas se cosecharán en grado B/C.',
      'ph-temprano':
        'El pH cruzará el umbral antes de que el Brix entre en la ventana ideal. Calidad A no es viable este ciclo.',
      'riesgo-ph':
        'El pH apretará la ventana — habrá que cosechar antes del Brix ideal para no perder calidad A.',
    };
```

- [ ] **Step 11: Update the `isAlert` set to include the white-mode alerts**

Earlier in `openDetail` (and similarly in `renderCard`), find:

```javascript
    const isAlert = ['riesgo-sobremadurez', 'no-alcanzar-A',
                     'sin-tendencia-positiva', 'antocianinas-estancadas']
                    .includes(p.reason);
```

Replace with:

```javascript
    const isAlert = ['riesgo-sobremadurez', 'no-alcanzar-A',
                     'sin-tendencia-positiva', 'antocianinas-estancadas',
                     'ph-excedido', 'ph-temprano', 'riesgo-ph']
                    .includes(p.reason);
```

Apply the same replacement in `renderCard` (search for the other occurrence of the same array).

- [ ] **Step 12: Update status text mapping for white-mode reasons**

In `renderCard`'s `dateText` IIFE, and `openDetail`'s `statusText` IIFE, add three lines mapping the new reasons. In `renderCard`:

```javascript
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
```

Replace with:

```javascript
    const dateText = (() => {
      if (isEmpty) return null;
      if (p.reason === 'sin-tendencia-positiva') return 'Sin tendencia';
      if (p.reason === 'antocianinas-estancadas') return 'ANT estancadas';
      if (p.reason === 'no-alcanzar-A') return 'No alcanzará A';
      if (p.reason === 'riesgo-sobremadurez') return 'Riesgo de sobremadurez';
      if (p.reason === 'ya-en-ventana') return 'Ya en ventana';
      if (p.reason === 'ph-excedido') return 'pH excedido';
      if (p.reason === 'ph-temprano') return 'pH temprano';
      if (p.reason === 'riesgo-ph') return 'Riesgo pH';
      if (!p.recommendedDate) return null;
      return p.recommendedDate.toLocaleDateString('es-MX',
        { day: 'numeric', month: 'short' });
    })();
```

In `openDetail`'s `statusText` IIFE, find similar lines and add the three new cases just before the `if (p.recommendedDate)` branch:

```javascript
      if (p.reason === 'ya-en-ventana') return 'Ya en ventana';
      if (p.reason === 'ph-excedido') return 'pH excedido';
      if (p.reason === 'ph-temprano') return 'pH temprano antes del Brix';
      if (p.reason === 'riesgo-ph') return 'Riesgo: pH apretará la ventana';
      if (p.recommendedDate) {
```

- [ ] **Step 13: Commit**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add js/predictionView.js index.html && git commit -m "$(cat <<'EOF'
feat(predictor): polymorphic secondary signal (ANT/pH) in card and modal

renderCard now shows the pH chart and pH foot value for whites instead
of anthocyanins. openDetail toggles the secondary block label/canvas
based on isRed/isWhite, populates targets and diagnostic rows for pH,
and adds Razón explanations for ph-excedido, ph-temprano, and riesgo-ph.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Ajustes UI — pH tope column

Add the editable column for whites; show "no aplica" for reds.

**Files:**
- Modify: `index.html` (table header)
- Modify: `js/predictionSettings.js`

- [ ] **Step 1: Add column header**

In `index.html`, find the Ajustes table header (around line 944). Replace:

```html
          <tr>
            <th>Varietal</th><th>Valle</th>
            <th class="num">Brix objetivo</th>
            <th class="num">Brix mín</th>
            <th class="num">Brix tope</th>
            <th class="num">ANT mín (ME)</th>
            <th>Nota</th>
          </tr>
```

with:

```html
          <tr>
            <th>Varietal</th><th>Valle</th>
            <th class="num">Brix objetivo</th>
            <th class="num">Brix mín</th>
            <th class="num">Brix tope</th>
            <th class="num">ANT mín (ME)</th>
            <th class="num">pH tope</th>
            <th>Nota</th>
          </tr>
```

- [ ] **Step 2: Update `renderRow` in predictionSettings.js**

In `js/predictionSettings.js`, find the `renderRow` function. Replace the `inherited` extraction (inside `render()`, where rows are built):

```javascript
        const rb = rubric?.params?.brix;
        const ra = rubric?.params?.anthocyanins;
        const inherited = {
          brixTarget: rb ? (rb.a[0] + rb.a[1]) / 2 : null,
          brixLower:  rb?.a?.[0] ?? null,
          brixUpper:  rb?.a?.[1] ?? null,
          antTarget:  ra?.a ?? null,
        };
```

with:

```javascript
        const rb = rubric?.params?.brix;
        const ra = rubric?.params?.anthocyanins;
        const rp = rubric?.params?.pH;
        const inherited = {
          brixTarget: rb ? (rb.a[0] + rb.a[1]) / 2 : null,
          brixLower:  rb?.a?.[0] ?? null,
          brixUpper:  rb?.a?.[1] ?? null,
          antTarget:  ra?.a ?? null,
          phTarget:   (rp && !ra) ? rp.a : null,
        };
```

- [ ] **Step 3: Update the `ph()` placeholder map inside `renderRow`**

Find inside `renderRow`:

```javascript
    const ph = field => {
      const map = { brix_target: 'brixTarget', brix_target_lower: 'brixLower',
                    brix_upper: 'brixUpper', anthocyanin_target: 'antTarget' };
      const inh = r.inherited[map[field]];
      return inh != null ? String(inh) : 'n/a';
    };
```

Replace with:

```javascript
    const ph = field => {
      const map = { brix_target: 'brixTarget', brix_target_lower: 'brixLower',
                    brix_upper: 'brixUpper', anthocyanin_target: 'antTarget',
                    ph_target: 'phTarget' };
      const inh = r.inherited[map[field]];
      return inh != null ? String(inh) : 'n/a';
    };
```

- [ ] **Step 4: Add pH cell after `antCell`**

Find the existing `antCell` block:

```javascript
    const antCell = r.inherited.antTarget == null
      ? `<td class="num" style="color:#9b9388;font-style:italic">no aplica</td>`
      : `<td class="num"><input type="number" step="1" data-field="anthocyanin_target"
            value="${escapeHtml(String(v('anthocyanin_target')))}" placeholder="${escapeHtml(ph('anthocyanin_target'))}"
            ${canEdit ? '' : 'disabled'}></td>`;
```

Immediately after that block (before the `note` computation), insert:

```javascript
    const phCell = r.inherited.phTarget == null
      ? `<td class="num" style="color:#9b9388;font-style:italic">no aplica</td>`
      : `<td class="num"><input type="number" step="0.01" data-field="ph_target"
            value="${escapeHtml(String(v('ph_target')))}" placeholder="${escapeHtml(ph('ph_target'))}"
            ${canEdit ? '' : 'disabled'}></td>`;
```

- [ ] **Step 5: Add pH cell to rendered row**

Find inside `renderRow`:

```javascript
    tr.innerHTML = `
      <td><b>${escapeHtml(r.variety)}</b></td>
      <td>${escapeHtml(r.valley)}</td>
      ${cells}
      ${antCell}
      <td style="font-size:11px;color:#7a7368">${escapeHtml(note)}</td>
    `;
```

Replace with:

```javascript
    tr.innerHTML = `
      <td><b>${escapeHtml(r.variety)}</b></td>
      <td>${escapeHtml(r.valley)}</td>
      ${cells}
      ${antCell}
      ${phCell}
      <td style="font-size:11px;color:#7a7368">${escapeHtml(note)}</td>
    `;
```

- [ ] **Step 6: Update the dirty-state field list**

Find:

```javascript
      const fields = ['brix_target','brix_target_lower','brix_upper','anthocyanin_target'];
      const overridden = fields.filter(f => r.ovr[f] != null);
      if (overridden.length === fields.length) note = 'override completo';
      else if (overridden.length === 0) note = '100% de rúbrica';
      else note = `heredado: ${fields.filter(f => !overridden.includes(f))
                    .map(f => f.replace('brix_','Brix ').replace('anthocyanin_','ANT '))
                    .join(', ')}`;
```

Replace with:

```javascript
      const fields = ['brix_target','brix_target_lower','brix_upper','anthocyanin_target','ph_target'];
      const overridden = fields.filter(f => r.ovr[f] != null);
      if (overridden.length === fields.length) note = 'override completo';
      else if (overridden.length === 0) note = '100% de rúbrica';
      else note = `heredado: ${fields.filter(f => !overridden.includes(f))
                    .map(f => f.replace('brix_','Brix ')
                              .replace('anthocyanin_','ANT ')
                              .replace('ph_','pH '))
                    .join(', ')}`;
```

- [ ] **Step 7: Verify in browser manually**

Run `npm run dev`. Navigate to /Ajustes-objetivos. Verify:
- Whites (Sauvignon Blanc, Chardonnay, Chenin Blanc) show editable "pH tope" input with placeholder from rubric (e.g., 3.20 for SB).
- Reds show "no aplica" in pH column.
- Whites show "no aplica" in ANT column.
- Editing pH value, then Save, persists (assuming the SQL migration has been run in Supabase).

- [ ] **Step 8: Commit**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add index.html js/predictionSettings.js && git commit -m "$(cat <<'EOF'
feat(ajustes): pH tope column for whites

Adds editable pH override column to the Ajustes targets table. Whites
inherit pH placeholder from rubric.params.pH.a; reds show "no aplica".
Dirty-state note now includes pH in the inherited/override summary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Visual verify + run SQL + push

Final verification step. The user must run the SQL migration in Supabase BEFORE pushing.

**Files:** none

- [ ] **Step 1: Remind user to run SQL migration**

Tell the user:
> Run `sql/migration_harvest_target_overrides_ph.sql` in the Supabase SQL Editor before deploying. The Ajustes Save flow will fail with a column-not-found error until the migration is applied.

- [ ] **Step 2: Start dev server and verify in Playwright**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && nohup npm run dev > /tmp/vite-mt28.log 2>&1 &
sleep 4
```

Then via Playwright:
- Set localStorage `xanic_session_token = 'dev-bypass'`, `xanic_role = 'lab'`
- Reload, enable demo, navigate to `/Predicción`
- Verify:
  - White card (e.g., Sauvignon Blanc) renders 2 charts: Brix + pH
  - Footer of white card shows `pH X.XX` instead of `ANT XXX`
  - Click white card → modal opens, secondary block is labeled "pH", Objetivos shows "pH tope: ≤ X.XX", Diagnóstico shows "pH hoy" and "β pH"
  - At least one card has reason `ph-temprano` or `riesgo-ph`
  - Navigate to `/Ajustes-objetivos` — whites have editable pH cell with rubric placeholder, reds show "no aplica"
- Press ESC, verify clean close

- [ ] **Step 3: Stop dev server**

```bash
pkill -f vite || true
```

- [ ] **Step 4: Push to remote**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git push origin main
```

- [ ] **Step 5: Report SHAs to user**

Final report: list of new commits, links to spec/plan, note that SQL migration must be run before users hit Ajustes Save.

---

## Self-Review

**Spec coverage:**
- DB migration + manifest + API whitelist + validation → Task 1 ✓
- `resolveTarget` returns phTarget → Task 2 ✓
- `computeAll` reads `s.pH` → Task 2 ✓
- pH parallel regression in `computeOne` → Task 3 ✓
- `detectEdgeCase` white branch (`ph-excedido`, `ph-temprano`, `riesgo-ph`, `riesgo-sobremadurez`, `ya-en-ventana`, `sin-tendencia-positiva`) → Task 3 ✓
- `recommendedDate = today + min(brixMidEta, effectiveWindowCloses)` for whites → Task 3 ✓
- New test mt28 (4 assertions) → Task 4 ✓
- Demo data calibration + new scenarios → Task 5 ✓
- `charts.js` axis='ph' → Task 6 ✓
- View polymorphism (card secondary + footer; modal block label/canvas; Objetivos/Diagnóstico/Razón) → Task 7 ✓
- Ajustes UI pH column → Task 8 ✓
- Visual verify + push → Task 9 ✓

**Placeholders:** none.

**Type consistency:**
- `target.phTarget` returned by `resolveTarget` (Task 2), consumed in `computeOne` (Task 3), `scenarioParams` (Task 5), charts (Task 6), views (Task 7), Ajustes (Task 8) ✓
- `prediction.phHoy`, `prediction.phFit`, `prediction.phComb` set in computeOne, read by charts and views ✓
- `prediction.samplesProjected.phEta` set in computeOne, read by charts ✓
- `sample.pH` shape used by `computeAll`, demoMode, rebuildCurrent, predictor regression — same camelCase `pH` everywhere ✓
- Reason names (`ph-excedido`, `ph-temprano`, `riesgo-ph`) consistent across detectEdgeCase, reasonExplain, isAlert, dateText/statusText ✓
- DB column `ph_target` (snake_case) consistent in SQL, validation, api whitelist, override field reads in resolveTarget ✓

No issues found.
