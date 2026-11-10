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

// ── weightedQualifier: KPI honesty labelling (xd-eg4 author round) ────
// Pure decision function behind setKPI's `*` marker + tooltip. Kept DOM-free so
// the three honesty rules below are unit-testable without a browser.

test('MT.39 weightedQualifier: fully weighted → no marker, no tooltip', () => {
  const q = KPIs.weightedQualifier({ coverage: 1, weighted: true });
  assert.equal(q.marked, false);
  assert.equal(q.title, null);
});

test('MT.39 weightedQualifier: partial coverage → marked, wording says "mediciones" not "lotes"', () => {
  // Issue THREE: coverage counts value-rows, not unique lots, so the disclosure
  // must not claim "% de los lotes" — that would itself be misleading.
  const q = KPIs.weightedQualifier({ coverage: 0.5, weighted: false });
  assert.equal(q.marked, true);
  assert.match(q.title, /50% de las mediciones/);
  assert.doesNotMatch(q.title, /lotes/);
});

test('MT.39 weightedQualifier: ZERO coverage still qualifies, with distinct wording', () => {
  // Issue ONE: weighted===false && coverage===0 was rendered as an unqualified
  // tonnage-weighted figure — the one case where weighting is fully undefined.
  // It must be marked, and its wording must differ from the partial case.
  const zero = KPIs.weightedQualifier({ coverage: 0, weighted: false });
  const partial = KPIs.weightedQualifier({ coverage: 0.5, weighted: false });
  assert.equal(zero.marked, true);
  assert.notEqual(zero.title, partial.title);
  assert.doesNotMatch(zero.title, /%/);        // no "conocido en X%" — none is known
  assert.match(zero.title, /ninguna medición/);
  assert.match(zero.title, /sin fuente/);      // no tonnage source: say so, never invent 1 t
});

test('MT.39 weightedQualifier: no meta → no marker (legacy callers)', () => {
  const q = KPIs.weightedQualifier(undefined);
  assert.equal(q.marked, false);
  assert.equal(q.title, null);
});
