# Demo Mid-Harvest Dataset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `/Predicción` cards under Modo Demo with a didactic mid-harvest mix that exercises all 6 prediction outcomes.

**Architecture:** Refactor `js/demoMode.js` into two season generators (`generateHistoricalSeason` for 2025, `generateCurrentSeason` for the running year). Current-season generator groups vineyard sections by `(variety, appellation)`, assigns each group one of 6 scenarios with calibrated yhat/slope parameters, and emits 5 berry samples per group. Historical generator stays nearly unchanged but densifies samples to activate the Bayesian prior.

**Tech Stack:** Vanilla JS ES modules, node:test, mulberry32 seeded RNG.

**Spec:** `docs/superpowers/specs/2026-05-21-demo-mid-harvest-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `js/demoMode.js` | Existing — refactor into `generateHistoricalSeason()` (extract from `generateDemoData`), add `generateCurrentSeason()`, add scenario tables + helpers, densify historical to 6 points |
| `tests/mt27-demo-predictor.test.mjs` | New — node:test, asserts coverage of all 6 reasons, no `pocos-datos-temporada`, confidence distribution, clean restore |

No other files touched.

---

## Task 1: Densify historical season (Bayesian prior)

Increase historical samples from 3 to 6 per section so `historicalSlopePrior` captures ≥3 points in the 21-day window and V≥1.

**Files:**
- Modify: `js/demoMode.js:294-341`

- [ ] **Step 1: Replace the 3-point `dpcPoints` array with 6 points**

In `js/demoMode.js`, find the existing block:

```javascript
    const dpcPoints = [
      { dpc: 18, sampleDate: `${VINTAGE}-07-${String(20 + Math.floor(r()*5)).padStart(2,'0')}`, seq: 1, k: 0.4 },
      { dpc: 28, sampleDate: `${VINTAGE}-08-${String(5 + Math.floor(r()*5)).padStart(2,'0')}`,  seq: 2, k: 0.7 },
      { dpc: 38, sampleDate: `${VINTAGE}-08-${String(18 + Math.floor(r()*5)).padStart(2,'0')}`, seq: 3, k: 1.0 }
    ];
```

Replace with:

```javascript
    const dpcPoints = [
      { dpc: 18, sampleDate: `${VINTAGE}-07-${String(20 + Math.floor(r()*3)).padStart(2,'0')}`, seq: 1, k: 0.30 },
      { dpc: 24, sampleDate: `${VINTAGE}-07-${String(26 + Math.floor(r()*3)).padStart(2,'0')}`, seq: 2, k: 0.50 },
      { dpc: 30, sampleDate: `${VINTAGE}-08-${String(1  + Math.floor(r()*3)).padStart(2,'0')}`, seq: 3, k: 0.70 },
      { dpc: 33, sampleDate: `${VINTAGE}-08-${String(4  + Math.floor(r()*3)).padStart(2,'0')}`, seq: 4, k: 0.82 },
      { dpc: 36, sampleDate: `${VINTAGE}-08-${String(7  + Math.floor(r()*3)).padStart(2,'0')}`, seq: 5, k: 0.92 },
      { dpc: 38, sampleDate: `${VINTAGE}-08-${String(10 + Math.floor(r()*3)).padStart(2,'0')}`, seq: 6, k: 1.00 }
    ];
```

Also update the line that branches on the final point:

```javascript
      if (pt.seq === 3) { berry.push(latestRow); continue; }
```

becomes:

```javascript
      if (pt.seq === 6) { berry.push(latestRow); continue; }
```

And update the `latestRow.sampleSeq` assignment:

```javascript
      sampleSeq: 3,
```

becomes:

```javascript
      sampleSeq: 6,
```

And `latestRow.daysPostCrush`:

```javascript
      daysPostCrush: 38,
```

stays at 38 (max dpc unchanged).

- [ ] **Step 2: Verify dev still loads**

Run: `npm run dev` briefly, then Ctrl+C. Confirm no console errors. (Visual verification deferred to Task 6.)

- [ ] **Step 3: Commit**

```bash
git add js/demoMode.js
git commit -m "demo: densify 2025 historical season to 6 berry samples per section

Activates the Bayesian slope prior in Prediction.historicalSlopePrior by
ensuring >=3 samples fall in the 21-day window before each vintage's
peak.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extract `generateHistoricalSeason`

Mechanical refactor — wrap the existing `generateDemoData` body in a parametrized helper so we can add a parallel current-season generator.

**Files:**
- Modify: `js/demoMode.js:241-412`

- [ ] **Step 1: Rename and parameterize**

Rename `generateDemoData` to `generateHistoricalSeason(VINTAGE, r)`. Pass `VINTAGE` and the RNG `r` in instead of hardcoding them.

Find:

```javascript
function generateDemoData() {
  const r = rng(20250421);
  const VINTAGE = 2025;
```

Replace with:

```javascript
function generateHistoricalSeason(VINTAGE, r) {
```

- [ ] **Step 2: Add new orchestrator `generateDemoData`**

Immediately above `generateHistoricalSeason`, insert:

```javascript
function generateDemoData() {
  const r = rng(20250421);
  const currentYear = new Date().getFullYear();
  const today = new Date();
  const historical = generateHistoricalSeason(2025, r);
  // Task 3 will add: const current = generateCurrentSeason(currentYear, today, r);
  return historical;
}
```

- [ ] **Step 3: Run existing demo-related tests (smoke)**

Run: `npm test -- --test-name-pattern='MT.23|MT.24|MT.25|MT.26'`
Expected: all prediction tests still pass (we haven't broken the demo overlay's contract).

- [ ] **Step 4: Commit**

```bash
git add js/demoMode.js
git commit -m "demo: extract generateHistoricalSeason from generateDemoData

Pure refactor: wraps the existing 2025 berry/wine/mediciones generator
in a function parameterised by VINTAGE and RNG, so a current-season
generator can run alongside it. No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add scenario tables and group-builder helpers

Pure helpers — no integration yet. Sets up the data structures Task 4 needs.

**Files:**
- Modify: `js/demoMode.js` (add helpers above `generateHistoricalSeason`)

- [ ] **Step 1: Add scenario definitions**

In `js/demoMode.js`, immediately above `function generateHistoricalSeason(`, insert:

```javascript
// ── Current-season scenarios (mid-harvest demo) ──
// Each scenario yields (yhat_brix_today, β_brix, yhat_ant_today, β_ant)
// calibrated against the group's rubric so Prediction.computeOne lands
// on the intended `reason`. See spec § Scenarios.
const SCENARIO_QUOTAS = [
  ['ya-en-ventana',             0.25],
  ['eta-corta',                 0.20],
  ['eta-media',                 0.25],
  ['riesgo-sobremadurez',       0.10],
  ['no-alcanzar-A',             0.10],
  ['antocianinas-estancadas',   0.10],
];

// Scenarios that require ANT machinery — reassigned to 'eta-media' when
// the group's rubric has no anthocyanins target (white varieties).
const ANT_DEPENDENT_SCENARIOS = new Set([
  'no-alcanzar-A', 'antocianinas-estancadas',
]);

// Resolve (yhat_brix_today, β_brix, yhat_ant_today, β_ant) for a scenario,
// given the group's target window. `r` is the seeded RNG.
function scenarioParams(scenario, target, r) {
  const { brixLower, brixUpper, brixTarget, antTarget } = target;
  switch (scenario) {
    case 'ya-en-ventana':
      return {
        yBrix: brixTarget + r() * 0.5,
        bBrix: 0.15,
        yAnt:  antTarget != null ? antTarget * 1.10 : null,
        bAnt:  8,
      };
    case 'eta-corta':
      return {
        yBrix: brixLower - (2 + r()),
        bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.85 : null,
        bAnt:  12,
      };
    case 'eta-media':
      return {
        yBrix: brixLower - (5 + r() * 2),
        bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.65 : null,
        bAnt:  12,
      };
    case 'riesgo-sobremadurez':
      return {
        yBrix: brixUpper + (0.3 + r() * 0.4),
        bBrix: 0.25,
        yAnt:  antTarget != null ? antTarget * 0.55 : null,
        bAnt:  6,
      };
    case 'no-alcanzar-A':
      return {
        yBrix: brixTarget - r(),
        bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.50 : null,
        bAnt:  1.5,
      };
    case 'antocianinas-estancadas':
      return {
        yBrix: brixLower + r(),
        bBrix: 0.25,
        yAnt:  antTarget != null ? antTarget * 0.70 : null,
        bAnt:  -0.5,
      };
  }
  return null;
}
```

- [ ] **Step 2: Add the group builder**

Below `scenarioParams`, insert:

```javascript
// Deduplicate vineyardSections into (variety, appellation) groups with
// their resolved rubric. Stable sort by (appellation, variety) for
// deterministic scenario assignment.
function buildCurrentSeasonGroups() {
  const seen = new Map();  // key: "variety|appellation"
  for (const section of CONFIG.vineyardSections) {
    const variety = primaryVariety(section.variety);
    if (!variety) continue;
    const appellation = section.ranch;
    const rubric = demoRubricFor(variety, appellation);
    if (!rubric) continue;
    const key = `${variety}|${appellation}`;
    if (seen.has(key)) continue;
    // Effective rubric params (variety-specific peso_overrides applied
    // upstream; here we only need brix + anthocyanins thresholds).
    const brixSpec = rubric.params.brix;
    const antSpec  = rubric.params.anthocyanins;
    const target = {
      brixLower:  brixSpec?.a?.[0] ?? null,
      brixUpper:  brixSpec?.a?.[1] ?? null,
      brixTarget: brixSpec?.a ? (brixSpec.a[0] + brixSpec.a[1]) / 2 : null,
      antTarget:  antSpec?.a ?? null,
    };
    if (target.brixLower == null) continue;  // can't calibrate without window
    const ranchCode = section.ranchCode;
    const prefix = VARIETY_PREFIX[variety] || 'XX';
    // One representative section per group — use a stable suffix that
    // doesn't collide with the historical lotCode pattern.
    const lotCode = `${prefix}${ranchCode}-G`;
    seen.set(key, { variety, appellation, target, lotCode });
  }
  return [...seen.values()].sort((a, b) =>
    a.appellation.localeCompare(b.appellation)
    || a.variety.localeCompare(b.variety));
}

// Largest-remainder quota allocation: returns an array of scenario names
// (length === nGroups) with each scenario's count matching SCENARIO_QUOTAS,
// shuffled deterministically.
function assignScenarios(nGroups, r) {
  const raw = SCENARIO_QUOTAS.map(([name, pct]) => ({
    name, exact: pct * nGroups, floor: Math.floor(pct * nGroups),
  }));
  let allocated = raw.reduce((s, x) => s + x.floor, 0);
  const remainder = nGroups - allocated;
  // Sort by fractional part desc, add 1 to top `remainder` slots
  const order = raw.map((x, i) => ({ i, frac: x.exact - x.floor }))
                   .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) raw[order[k].i].floor += 1;
  // Build pool
  const pool = [];
  for (const x of raw) for (let k = 0; k < x.floor; k++) pool.push(x.name);
  // Fisher–Yates with seeded RNG
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
```

- [ ] **Step 3: Run existing tests (smoke)**

Run: `npm test -- --test-name-pattern='MT.23|MT.24|MT.25|MT.26'`
Expected: all prediction tests still pass (we added pure helpers, no integration).

- [ ] **Step 4: Commit**

```bash
git add js/demoMode.js
git commit -m "demo: add scenario tables and group builder helpers

Adds SCENARIO_QUOTAS, scenarioParams, buildCurrentSeasonGroups, and
assignScenarios — pure helpers that produce the calibration data
generateCurrentSeason will consume in the next commit. No integration yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Write the failing test (`mt27-demo-predictor`)

Test-first — write the assertions before the generator exists.

**Files:**
- Create: `tests/mt27-demo-predictor.test.mjs`

- [ ] **Step 1: Write the test file**

```javascript
// tests/mt27-demo-predictor.test.mjs
// MT.27 — Modo Demo populates the harvest-readiness predictor with a
// didactic mid-harvest mix. Verifies that DemoMode.enable() seeds the
// current-vintage berry samples needed for Prediction.computeAll to
// return all six expected `reason` values, and that disable() restores
// the original DataStore arrays.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DemoMode } from '../js/demoMode.js';
import { DataStore } from '../js/dataLoader.js';
import * as Prediction from '../js/prediction.js';
import { CONFIG } from '../js/config.js';
import { resolveValley } from '../js/classification.js';

function snapshot() {
  return {
    berry: DataStore.berryData?.slice() ?? [],
    wineR: DataStore.wineRecepcion?.slice() ?? [],
    wineP: DataStore.winePreferment?.slice() ?? [],
    med:   DataStore.medicionesData?.slice() ?? [],
    recs:  DataStore.receptionData?.slice() ?? [],
    recL:  DataStore.receptionLotsData?.slice() ?? [],
    loaded: { ...(DataStore.loaded ?? {}) },
  };
}

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

test('MT.27 demo: predictor returns at least one card per expected reason', () => {
  const before = snapshot();
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const reasons = results.map(r => r.prediction.reason);
    const counts = reasons.reduce((m, r) => (m[r ?? 'null'] = (m[r ?? 'null'] || 0) + 1, m), {});
    assert.ok((counts['ya-en-ventana']           ?? 0) >= 1, `ya-en-ventana=${counts['ya-en-ventana']} (counts=${JSON.stringify(counts)})`);
    assert.ok((counts['riesgo-sobremadurez']     ?? 0) >= 1, `riesgo-sobremadurez=${counts['riesgo-sobremadurez']}`);
    assert.ok((counts['no-alcanzar-A']           ?? 0) >= 1, `no-alcanzar-A=${counts['no-alcanzar-A']}`);
    assert.ok((counts['antocianinas-estancadas'] ?? 0) >= 1, `antocianinas-estancadas=${counts['antocianinas-estancadas']}`);
    const normalEtas = results.filter(r =>
      r.prediction.reason === null &&
      r.prediction.recommendedDate instanceof Date &&
      Number.isFinite(r.prediction.recommendedDate.getTime()));
    assert.ok(normalEtas.length >= 2, `normal-ETA cards=${normalEtas.length}`);
  } finally {
    DemoMode.disable();
    Object.assign(DataStore, before);  // belt-and-suspenders
  }
});

test('MT.27 demo: no current-season group hits pocos-datos-temporada', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const empty = results.filter(r => r.prediction.reason === 'pocos-datos-temporada');
    assert.equal(empty.length, 0,
      `empty groups: ${empty.map(r => `${r.variety}|${r.appellation}`).join(', ')}`);
  } finally {
    DemoMode.disable();
  }
});

test('MT.27 demo: confidence label is Alta/Media for >=80% of cards', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const good = results.filter(r => r.prediction.label === 'Alta' || r.prediction.label === 'Media');
    const ratio = good.length / Math.max(1, results.length);
    assert.ok(ratio >= 0.80,
      `Alta+Media ratio = ${(ratio * 100).toFixed(0)}% (good=${good.length}, total=${results.length})`);
  } finally {
    DemoMode.disable();
  }
});

test('MT.27 demo: disable() restores DataStore berry array', () => {
  const beforeBerry = (DataStore.berryData || []).slice();
  DemoMode.enable();
  DemoMode.disable();
  assert.deepEqual(DataStore.berryData, beforeBerry);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/mt27-demo-predictor.test.mjs`
Expected: FAIL — the first test fails because current `generateDemoData` only emits 2025 data, so all groups hit `pocos-datos-temporada` and no `ya-en-ventana` cards exist.

- [ ] **Step 3: Do NOT commit yet** — failing tests should not be committed alone. We commit with Task 5's implementation.

---

## Task 5: Implement `generateCurrentSeason`

Make the test pass.

**Files:**
- Modify: `js/demoMode.js`

- [ ] **Step 1: Add `generateCurrentSeason`**

In `js/demoMode.js`, immediately above the `generateDemoData` orchestrator (which we added in Task 2), insert:

```javascript
// Generate 5-point berry time series for each (variety, appellation)
// group in CONFIG.vineyardSections, calibrated so Prediction.computeOne
// lands on the assigned scenario's expected reason. Returns { berry }.
function generateCurrentSeason(currentYear, today, r) {
  const berry = [];
  const groups = buildCurrentSeasonGroups();
  const scenarios = assignScenarios(groups.length, r);
  const offsets = [-32, -24, -16, -8, 0];  // days from today
  const dayMs = 86_400_000;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    let scenario = scenarios[gi];
    // White varieties without antTarget — reassign ANT-dependent scenarios
    if (g.target.antTarget == null && ANT_DEPENDENT_SCENARIOS.has(scenario)) {
      scenario = 'eta-media';
    }
    const p = scenarioParams(scenario, g.target, r);
    if (!p) continue;
    const yy = String(currentYear).slice(2);
    for (let i = 0; i < offsets.length; i++) {
      const t = offsets[i];
      const seq = i + 1;
      const dateObj = new Date(today.getTime() + t * dayMs);
      const sampleDate = dateObj.toISOString().slice(0, 10);
      const brix = p.yBrix + p.bBrix * t + (r() - 0.5) * 0.2;
      const ant  = p.yAnt != null
        ? Math.max(0, p.yAnt + p.bAnt * t + (r() - 0.5) * 60)
        : null;
      berry.push({
        sampleId: `${yy}${g.lotCode}-c${seq}`,
        sampleDate,
        vintage: currentYear,
        variety: g.variety,
        appellation: g.appellation,
        sampleType: 'Berries',
        lotCode: g.lotCode,
        brix,
        pH: 3.5 + (r() - 0.5) * 0.3,
        ta: 5 + (r() - 0.5) * 1.5,
        tANT: ant != null ? Math.round(ant) : null,
        berryFW: 1.0 + (r() - 0.5) * 0.2,
        anthocyanins: ant != null ? Math.round(ant) : null,
        daysPostCrush: 38 + t,  // approximate; only used by some downstream views
        sampleSeq: seq,
        grapeType: null,
      });
    }
  }
  return { berry };
}
```

- [ ] **Step 2: Wire the orchestrator to merge both seasons**

In `js/demoMode.js`, find the orchestrator added in Task 2:

```javascript
function generateDemoData() {
  const r = rng(20250421);
  const currentYear = new Date().getFullYear();
  const today = new Date();
  const historical = generateHistoricalSeason(2025, r);
  // Task 3 will add: const current = generateCurrentSeason(currentYear, today, r);
  return historical;
}
```

Replace with:

```javascript
function generateDemoData() {
  const r = rng(20250421);
  const currentYear = new Date().getFullYear();
  const today = new Date();
  const historical = generateHistoricalSeason(2025, r);
  const current = generateCurrentSeason(currentYear, today, r);
  return {
    ...historical,
    berry: [...historical.berry, ...current.berry],
  };
}
```

- [ ] **Step 3: Run the new test**

Run: `node --test tests/mt27-demo-predictor.test.mjs`
Expected: all 4 tests PASS.

- [ ] **Step 4: Run the full prediction test suite to catch regressions**

Run: `npm test -- --test-name-pattern='MT.2[3-7]'`
Expected: all pass (MT.23–MT.27).

- [ ] **Step 5: Commit**

```bash
git add js/demoMode.js tests/mt27-demo-predictor.test.mjs
git commit -m "demo: populate Predicción with mid-harvest mix

Adds generateCurrentSeason that emits 5 berry samples per
(variety, appellation) group, calibrated to land on a mix of 6 prediction
outcomes (ya-en-ventana, ETA short/medium, riesgo-sobremadurez,
no-alcanzar-A, antocianinas-estancadas).

New test mt27-demo-predictor.test.mjs asserts that DemoMode.enable()
produces all 6 reasons, no pocos-datos-temporada groups, confidence
>=Media for >=80% of cards, and a clean restore on disable().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Visual verification + push

Manual smoke test, then push.

**Files:** none (verification only)

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify in browser**

- Navigate to the app in the browser.
- Toggle **Modo Demo** ON.
- Open **Predicción** view.
- Confirm:
  - Grid is populated (no "Sin datos para mostrar" message).
  - You can see a mix of card types: at least one "Ya en ventana", at least one with an explicit date ("X días"), at least one red-bordered alert (riesgo / no-alcanzar / ANT estancadas).
  - Switching the valley chips (VDG / VON / VSV / Todos) filters cards as expected.
- Toggle **Modo Demo** OFF.
- Confirm the grid returns to whatever state real data produces (likely empty or sparse since today is May).

- [ ] **Step 3: Stop dev server**

Ctrl+C in the dev server terminal.

- [ ] **Step 4: Push**

Run: `git push origin main`
Expected: push succeeds.

- [ ] **Step 5: Done**

Report to user: tests passing, visual verification complete, pushed.

---

## Self-Review

**Spec coverage:**
- Architecture (split into historical + current generators) → Tasks 2 + 5 ✓
- Historical densification → Task 1 ✓
- 6 scenarios with calibrated parameters → Task 3 (`scenarioParams`) ✓
- Group dedup + sort + scenario assignment → Task 3 (`buildCurrentSeasonGroups`, `assignScenarios`) ✓
- 5-point samples at `today - {32, 24, 16, 8, 0}` → Task 5 (`offsets`) ✓
- Sample IDs `${yy}${lotCode}-c${seq}` → Task 5 ✓
- Variety without antTarget → reassign to eta-media → Task 5 (`ANT_DEPENDENT_SCENARIOS` check) ✓
- Tests: 4 assertions per spec → Task 4 ✓
- Visual verification → Task 6 ✓

**Placeholders:** none — every step has exact code or exact command.

**Type consistency:**
- `scenarioParams` returns `{ yBrix, bBrix, yAnt, bAnt }` (Task 3), consumed identically in Task 5. ✓
- `buildCurrentSeasonGroups` returns `{ variety, appellation, target, lotCode }`, Task 5 reads all four. ✓
- `target.antTarget` used in both Task 3 (calibration) and Task 5 (reassignment guard). ✓
- `DataStore.berryData` shape matches what `_enrichData` and the predictor expect (vintage, variety, appellation, sampleDate, brix, tANT). ✓
- Test imports match exported symbols: `DemoMode` (named), `DataStore` (named), `Prediction.*` (namespace), `CONFIG` (named), `resolveValley` (named). ✓

No issues found.
