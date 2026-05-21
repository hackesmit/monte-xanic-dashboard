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
