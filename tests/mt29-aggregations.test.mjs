// tests/mt29-aggregations.test.mjs
// MT.29 — weightedMean + peakBy pure utilities.
// Engine lives in js/aggregations.js (pure functions, no DOM, no queries).

import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedMean, peakBy } from '../js/aggregations.js';

// ── weightedMean ─────────────────────────────────────────────────────

test('MT.29 weightedMean: all-equal weights matches arithmetic mean', () => {
  const rows = [{ x: 10, _weight: 3 }, { x: 20, _weight: 3 }, { x: 30, _weight: 3 }];
  assert.equal(weightedMean(rows, 'x'), 20);
});

test('MT.29 weightedMean: disparate weights — large lot dominates', () => {
  const rows = [
    { x: 10, _weight: 1 },   // small experimental lot
    { x: 100, _weight: 99 }, // large commercial lot
  ];
  // Weighted: (10*1 + 100*99) / (1 + 99) = 9910/100 = 99.1
  assert.equal(weightedMean(rows, 'x'), 99.1);
});

test('MT.29 weightedMean: null weight uses fallbackWeight=1 (default)', () => {
  const rows = [
    { x: 10, _weight: null },  // fallback to 1
    { x: 20, _weight: 4 },     // 4
  ];
  // Weighted: (10*1 + 20*4) / (1+4) = 90/5 = 18
  assert.equal(weightedMean(rows, 'x'), 18);
});

test('MT.29 weightedMean: 0 weight uses fallbackWeight (treats 0 as missing)', () => {
  const rows = [
    { x: 50, _weight: 0 },
    { x: 100, _weight: 0 },
  ];
  // Both fallback to 1: (50+100)/2 = 75
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
    { x: null, _weight: 5 },   // skipped
    { x: 10,   _weight: 5 },
    { x: 20,   _weight: 5 },
  ];
  assert.equal(weightedMean(rows, 'x'), 15);
});

test('MT.29 weightedMean: custom fallbackWeight option', () => {
  const rows = [
    { x: 100, _weight: null },
    { x: 200, _weight: null },
  ];
  // Both fallback to custom 5; weighted = (100*5 + 200*5)/(5+5) = 150
  assert.equal(weightedMean(rows, 'x', '_weight', { fallbackWeight: 5 }), 150);
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
