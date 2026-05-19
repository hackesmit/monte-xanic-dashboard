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
