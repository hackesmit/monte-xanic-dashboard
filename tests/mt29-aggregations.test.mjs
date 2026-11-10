// tests/mt29-aggregations.test.mjs
// MT.29 — weightedMean + peakBy pure utilities.
// Engine lives in js/aggregations.js (pure functions, no DOM, no queries).

import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedMean, weightedMeanStats, peakBy } from '../js/aggregations.js';

// ── weightedMean ─────────────────────────────────────────────────────

test('MT.29 weightedMean: all-equal weights matches arithmetic mean', () => {
  const rows = [{ x: 10, _weight: 3 }, { x: 20, _weight: 3 }, { x: 30, _weight: 3 }];
  assert.equal(weightedMean(rows, 'x'), 20);
});

test('MT.29 weightedMean: disparate weights — large lot dominates (full coverage)', () => {
  const rows = [
    { x: 10, _weight: 1 },   // small experimental lot
    { x: 100, _weight: 99 }, // large commercial lot
  ];
  // Every lot has a real weight → tonnage-weighted: (10*1 + 100*99) / 100 = 99.1
  assert.equal(weightedMean(rows, 'x'), 99.1);
});

// xd-eg4 policy: partial tonnage coverage must NOT invent a 1-ton weight and
// mix scales. The known-tonnage lot may not swamp the unknown-tonnage one; we
// fall back to a plain unweighted mean over all value-rows.
test('MT.29 weightedMean: bead repro — partial coverage falls back to unweighted (not ~29.9)', () => {
  const rows = [
    { brix: 20, _weight: null }, // tonnage unknown
    { brix: 30, _weight: 100 },  // tonnage known
  ];
  // Old broken behaviour: (20*1 + 30*100)/101 = 29.90 (20 Bx lot <1%).
  // New policy: unweighted (20 + 30)/2 = 25.
  assert.equal(weightedMean(rows, 'brix'), 25);
});

test('MT.29 weightedMean: null weight → unweighted fallback (partial coverage)', () => {
  const rows = [
    { x: 10, _weight: null },
    { x: 20, _weight: 4 },
  ];
  // Not fully covered → plain mean (10 + 20)/2 = 15, NOT the mixed 18.
  assert.equal(weightedMean(rows, 'x'), 15);
});

test('MT.29 weightedMean: 0 weight treated as missing → no tonnage → unweighted', () => {
  const rows = [
    { x: 50, _weight: 0 },
    { x: 100, _weight: 0 },
  ];
  // Zero coverage → unweighted (50 + 100)/2 = 75.
  assert.equal(weightedMean(rows, 'x'), 75);
});

test('MT.29 weightedMean: all NaN values returns null', () => {
  const rows = [
    { x: NaN, _weight: 5 },
    { x: NaN, _weight: 5 },
  ];
  assert.equal(weightedMean(rows, 'x'), null);
});

test('MT.29 weightedMean: empty array returns null', () => {
  assert.equal(weightedMean([], 'x'), null);
});

test('MT.29 weightedMean: skips null values, keeps others', () => {
  const rows = [
    { x: null, _weight: 5 },   // skipped (no value)
    { x: 10,   _weight: 5 },
    { x: 20,   _weight: 5 },
  ];
  assert.equal(weightedMean(rows, 'x'), 15);
});

// ── weightedMeanStats: coverage reporting ────────────────────────────

test('MT.29 weightedMeanStats: full coverage → weighted=true, coverage=1', () => {
  const rows = [{ x: 20, _weight: 3 }, { x: 24, _weight: 1 }];
  const s = weightedMeanStats(rows, 'x');
  assert.equal(s.mean, 21);          // (20*3 + 24*1)/4
  assert.equal(s.coverage, 1);
  assert.equal(s.weighted, true);
});

test('MT.29 weightedMeanStats: partial coverage → weighted=false, reports fraction', () => {
  const rows = [
    { x: 20, _weight: null },
    { x: 30, _weight: 100 },
  ];
  const s = weightedMeanStats(rows, 'x');
  assert.equal(s.mean, 25);          // unweighted fallback
  assert.equal(s.coverage, 0.5);
  assert.equal(s.weighted, false);
});

test('MT.29 weightedMeanStats: coverage counts only value-rows', () => {
  const rows = [
    { x: null, _weight: 10 }, // no value → excluded from coverage denominator
    { x: 10,   _weight: 5 },
    { x: 20,   _weight: 5 },
  ];
  const s = weightedMeanStats(rows, 'x');
  assert.equal(s.coverage, 1);       // both value-rows carry weight
  assert.equal(s.weighted, true);
  assert.equal(s.mean, 15);
});

test('MT.29 weightedMeanStats: no valid values → null mean, zero coverage', () => {
  const s = weightedMeanStats([{ x: null }, { x: NaN }], 'x');
  assert.equal(s.mean, null);
  assert.equal(s.coverage, 0);
  assert.equal(s.weighted, false);
});

// xd-eg4 author round (issue TWO): an infinite weight must not survive
// validation. `rawW > 0` alone admits Infinity, so two Infinity-weighted rows
// give wNum=Infinity, wDen=Infinity and a NaN mean that renders as garbage and
// silently grades C downstream. Parse strictly: a non-finite weight is missing.
test('MT.29 weightedMeanStats: Infinity weight is rejected → unweighted, finite mean (not NaN)', () => {
  const rows = [
    { x: 20, _weight: Infinity },
    { x: 30, _weight: Infinity },
  ];
  const s = weightedMeanStats(rows, 'x');
  assert.equal(s.weighted, false);   // no valid weights
  assert.equal(s.coverage, 0);       // Infinity weights count as missing
  assert.equal(s.mean, 25);          // plain (20+30)/2, never NaN
  assert.ok(Number.isFinite(s.mean));
});

test('MT.29 weightedMeanStats: one Infinity weight among finite ones → partial fallback', () => {
  const rows = [
    { x: 10, _weight: Infinity }, // rejected → missing weight
    { x: 20, _weight: 4 },
  ];
  const s = weightedMeanStats(rows, 'x');
  assert.equal(s.weighted, false);
  assert.equal(s.coverage, 0.5);     // only the _weight:4 row counts
  assert.equal(s.mean, 15);          // unweighted (10+20)/2
});

test('MT.29 weightedMeanStats: a non-finite VALUE is discarded, not averaged in', () => {
  const rows = [
    { x: Infinity, _weight: 5 }, // no usable value
    { x: 10,       _weight: 5 },
    { x: 20,       _weight: 5 },
  ];
  const s = weightedMeanStats(rows, 'x');
  assert.equal(s.mean, 15);          // Infinity row excluded entirely
  assert.equal(s.weighted, true);
  assert.ok(Number.isFinite(s.mean));
});

// ── peakBy ───────────────────────────────────────────────────────────

test('MT.29 peakBy: returns row with max key', () => {
  const rows = [{ ant: 100 }, { ant: 500 }, { ant: 300 }];
  assert.equal(peakBy(rows, 'ant').ant, 500);
});

test('MT.29 peakBy: all null returns null', () => {
  const rows = [{ ant: null }, { ant: null }];
  assert.equal(peakBy(rows, 'ant'), null);
});

test('MT.29 peakBy: ties return first encountered', () => {
  const rows = [{ id: 'a', ant: 500 }, { id: 'b', ant: 500 }];
  assert.equal(peakBy(rows, 'ant').id, 'a');
});

test('MT.29 peakBy: skips NaN', () => {
  const rows = [{ ant: NaN }, { ant: 100 }];
  assert.equal(peakBy(rows, 'ant').ant, 100);
});

test('MT.29 peakBy: empty array returns null', () => {
  assert.equal(peakBy([], 'ant'), null);
});
