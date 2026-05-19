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
