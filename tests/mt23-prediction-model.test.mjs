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

// Degenerate case 1: a SINGLE historical vintage must not pin the posterior.
// The old code set tau2Hist=1e-6 for V=1 (prior precision 1e6), so the lone
// historical slope overwhelmed the current season entirely and quadrupled the
// ETA. A single vintage gives no between-vintage variance estimate, so its
// prior must be weak, never near-zero.
test('MT.23 historicalSlopePrior: single vintage yields a weak (non-epsilon) prior', () => {
  const { betaHist, tau2Hist, V } = historicalSlopePrior([mkVintage(0.05, 8)]);
  assert.equal(V, 1);
  assert.ok(Math.abs(betaHist - 0.05) < 1e-9, `betaHist=${betaHist}`);
  // Never the old 1e-6 epsilon: variance scales with the slope (CV ≈ 150%).
  assert.ok(tau2Hist > 1e-4, `tau2Hist=${tau2Hist} must not be a tiny epsilon`);
  assert.ok(Math.abs(tau2Hist - (1.5 * 0.05) ** 2) < 1e-9, `tau2Hist=${tau2Hist}`);
});

test('MT.23 single historical vintage does not discard the current season', () => {
  // Repro from the bead: one historical vintage slope 0.0500, current
  // betaHat 0.200 (sigmaBeta2 0.01). Old behavior: betaPost pinned to 0.0500.
  const { betaHist, tau2Hist } = historicalSlopePrior([mkVintage(0.05, 8)]);
  const { betaPost } = bayesianCombine({
    betaHat: 0.2, sigmaBeta2: 0.01, betaHist, tau2Hist,
  });
  // Corrected: the current season survives — posterior lifts well clear of the
  // pinned 0.0500 and stays below the raw data estimate (a genuine blend).
  assert.ok(betaPost > 0.09, `betaPost=${betaPost} — current season was discarded`);
  assert.ok(betaPost < 0.2, `betaPost=${betaPost} — should stay below betaHat`);
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

// FINDING 1: the old ≥2-vintage variance floor (0.05·mean)² gave, for two
// vintages both at slope 0.05, τ²≈6.25e-6 (precision 160 000) and re-pinned the
// posterior to ~0.050094. bayesianCombine now caps the prior precision at the
// current season's, so that same τ² can no longer dominate: the posterior is a
// genuine blend that keeps ≥50 % current-season weight.
test('MT.23 bayesianCombine: caps prior precision at data precision (no pinning)', () => {
  // Reviewer repro: betaHat 0.2 (sigmaBeta2 0.01 ⇒ dataPrec 100), τ²=6.25e-6
  // ⇒ raw prior precision 160 000, capped to 100. betaPost = (0.2·100 + 0.05·100)/200.
  const out = bayesianCombine({ betaHat: 0.2, sigmaBeta2: 0.01,
                                betaHist: 0.05, tau2Hist: 6.25e-6 });
  assert.ok(Math.abs(out.betaPost - 0.125) < 1e-9,
    `betaPost=${out.betaPost} — prior still pinning the posterior`);
  assert.ok(out.betaPost > 0.09, `betaPost=${out.betaPost} — current season discarded`);
  // Posterior precision is bounded by 2·dataPrec (prior never exceeds data).
  assert.ok(Math.abs(out.sigmaBeta2Post - 0.005) < 1e-9, `sigmaBeta2Post=${out.sigmaBeta2Post}`);
});

// FINDING 1 end-to-end: two near-duplicate vintages (both ≈slope 0.05) produce a
// collapsed sample variance, but the posterior is no longer pinned to 0.05.
test('MT.23 near-duplicate vintages do not pin the posterior', () => {
  const prior = historicalSlopePrior([mkVintage(0.05, 8), mkVintage(0.0500001, 8)]);
  assert.equal(prior.V, 2);
  const { betaPost } = bayesianCombine({
    betaHat: 0.2, sigmaBeta2: 0.01, betaHist: prior.betaHist, tau2Hist: prior.tau2Hist,
  });
  assert.ok(betaPost > 0.09, `betaPost=${betaPost} — copied vintages re-pinned the posterior`);
  assert.ok(betaPost < 0.2, `betaPost=${betaPost} — should stay below betaHat`);
});

// FINDING 2: the old near-zero guard only caught an EXACTLY zero mean. A lone
// historical slope of 1e-6 gave τ²≈2.25e-12 (precision ≈4e11) and pinned the
// posterior to a meaningless ~0 slope. A mean below the metric's absolute slope
// scale is now treated as uninformative (τ²=Infinity ⇒ prior precision 0).
test('MT.23 historicalSlopePrior: near-zero mean slope → uninformative prior', () => {
  const prior = historicalSlopePrior([mkVintage(1e-6, 8)], { slopeScale: 0.01 });
  assert.equal(prior.tau2Hist, Infinity, `tau2Hist=${prior.tau2Hist} — near-zero mean still informs`);
  const { betaPost } = bayesianCombine({
    betaHat: 0.2, sigmaBeta2: 0.01, betaHist: prior.betaHist, tau2Hist: prior.tau2Hist,
  });
  assert.ok(Math.abs(betaPost - 0.2) < 1e-9,
    `betaPost=${betaPost} — a 1e-6 historical slope pinned the posterior near zero`);
});

// FINDING 2 boundary: a mean ABOVE the scale is still a real, informative prior.
test('MT.23 historicalSlopePrior: mean above slope scale stays informative', () => {
  const prior = historicalSlopePrior([mkVintage(0.05, 8)], { slopeScale: 0.01 });
  assert.ok(Number.isFinite(prior.tau2Hist) && prior.tau2Hist > 0,
    `tau2Hist=${prior.tau2Hist} — a genuine slope was wrongly dropped`);
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

test('MT.23 confidenceLabel: monotone in V — history never worse than none', () => {
  // Regression guard: V=2 used to score trainingScore(0.4)·base while V=0
  // scored base outright, so ADDING two vintages of history downgraded
  // Media → Baja on identical current-season data.
  const rank = { 'Baja': 0, 'Media': 1, 'Alta': 2 };
  for (const horizonDays of [0, 10, 20, 35, 50]) {
    const v0 = confidenceLabel({ V: 0, nCurrent: 7, horizonDays });
    for (const V of [1, 2, 3, 5]) {
      const lab = confidenceLabel({ V, nCurrent: 7, horizonDays });
      assert.ok(rank[lab] >= rank[v0],
        `V=${V} label ${lab} ranks below V=0 label ${v0} at horizon ${horizonDays}`);
    }
  }
  // 'Alta' still requires deep training history, not just the floor
  assert.equal(confidenceLabel({ V: 2, nCurrent: 10, horizonDays: 0 }), 'Media');
});
