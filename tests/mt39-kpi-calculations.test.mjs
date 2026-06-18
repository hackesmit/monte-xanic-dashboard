// tests/mt39-kpi-calculations.test.mjs
// MT.39 — KPIs pure calculation logic (kpis.js). Covers KPIs.avg edge cases
// and the KPIs.weightedAvg → aggregations.weightedMean passthrough. The
// DOM-bound methods (setKPI/updateBerryKPIs/updateWineKPIs) are not unit-tested
// here as the project runs node:test without a DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { KPIs } from '../js/kpis.js';

test('MT.39 avg: arithmetic mean of valid numbers', () => {
  assert.equal(KPIs.avg([2, 4, 6]), 4);
  assert.equal(KPIs.avg([10]), 10);
});

test('MT.39 avg: empty array → null', () => {
  assert.equal(KPIs.avg([]), null);
});

test('MT.39 avg: ignores null/undefined/NaN/non-numbers', () => {
  assert.equal(KPIs.avg([2, null, 4, undefined, NaN, '6', 6]), 4); // (2+4+6)/3
});

test('MT.39 avg: all-invalid → null (not 0 or NaN)', () => {
  assert.equal(KPIs.avg([null, undefined, NaN, 'x']), null);
});

test('MT.39 avg: negative and decimal values', () => {
  assert.equal(KPIs.avg([-2, 2]), 0);
  assert.ok(Math.abs(KPIs.avg([1.5, 2.5]) - 2) < 1e-9);
});

test('MT.39 weightedAvg: equal/absent weights match a plain mean', () => {
  // Rows without _weight fall back to weight=1 → unweighted mean.
  const rows = [{ brix: 20 }, { brix: 24 }];
  assert.equal(KPIs.weightedAvg(rows, 'brix'), 22);
});

test('MT.39 weightedAvg: honors per-row _weight (tonnage weighting)', () => {
  // 20 @ weight 3, 24 @ weight 1 → (20*3 + 24*1) / 4 = 21
  const rows = [{ brix: 20, _weight: 3 }, { brix: 24, _weight: 1 }];
  assert.equal(KPIs.weightedAvg(rows, 'brix'), 21);
});

test('MT.39 weightedAvg: no valid values → null', () => {
  const rows = [{ brix: null }, { brix: NaN }, {}];
  assert.equal(KPIs.weightedAvg(rows, 'brix'), null);
});
