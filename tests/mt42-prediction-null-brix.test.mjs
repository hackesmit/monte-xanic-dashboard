// tests/mt42-prediction-null-brix.test.mjs
// MT.42 — A berry row with a null or blank Brix must be DROPPED, never coerced
// to a fabricated 0 °Bx measurement. Number(null) === Number('') === 0 (finite),
// so the old `Number(row.brix)` mapping kept blank rows and corrupted the
// regression that drives the harvest date. Regression guard for xd-6jg.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAll } from '../js/prediction.js';

const dayMs = 86_400_000;
const t0 = Date.parse('2026-08-01T00:00:00Z');

// Brix-only rubric (no anthocyanins) so the predictor runs in the simplest
// mode; a generous range keeps the sample math free of edge-case reasons.
const RUBRIC = { params: { brix: { kind: 'range', a: [22.0, 26.0] } } };
const rubricFor = () => RUBRIC;
const valleyFor = () => 'VDG';

function row(dayOffset, brix) {
  return {
    variety: 'Cabernet Sauvignon',
    appellation: 'Valle de Guadalupe',
    sampleDate: new Date(t0 + dayOffset * dayMs),
    vintage: 2026,
    brix,
  };
}

test('MT.42: null/blank Brix rows are excluded from nCurrent and brixHoy', () => {
  // Three current-vintage samples across two weeks: 22.0 / null / 23.5.
  const berryData = [row(0, 22.0), row(7, null), row(14, 23.5)];
  const results = computeAll({
    berryData,
    today: new Date(t0 + 14 * dayMs),
    currentVintage: 2026,
    overrides: [],
    rubricFor, valleyFor,
  });

  assert.equal(results.length, 1, 'exactly one (variety, appellation) group');
  const pred = results[0].prediction;

  // Only the two real readings survive — the null row is dropped, not kept as 0.
  assert.equal(pred.nCurrent, 2,
    `nCurrent should count only real readings, got ${pred.nCurrent}`);

  // A perfect line through (0, 22.0) and (14, 23.5) reads 23.5 at t_today,
  // matching the last real Brix — not the ~15.9 the fabricated 0 produced.
  assert.ok(Math.abs(pred.brixHoy - 23.5) < 1e-9,
    `brixHoy should match the last real reading 23.5, got ${pred.brixHoy}`);
});

test('MT.42: blank-string Brix ("") is also excluded (not coerced to 0)', () => {
  const berryData = [row(0, 22.0), row(7, ''), row(14, 23.5)];
  const results = computeAll({
    berryData,
    today: new Date(t0 + 14 * dayMs),
    currentVintage: 2026,
    overrides: [],
    rubricFor, valleyFor,
  });
  const pred = results[0].prediction;
  assert.equal(pred.nCurrent, 2, `nCurrent=${pred.nCurrent}`);
  assert.ok(Math.abs(pred.brixHoy - 23.5) < 1e-9, `brixHoy=${pred.brixHoy}`);
});

// A blank *primary* alias must not mask a valid fallback. The `??` chain only
// falls through on null/undefined, so { tANT: '', anthocyanins: 450 } used to
// select the blank '' → NaN and silently drop a real anthocyanin reading. The
// fix picks the first *finite* alias, keeping the fallback. Same for pH.
test('MT.42: blank primary ANT alias falls through to a valid fallback', () => {
  const antRubric = {
    params: {
      brix: { kind: 'range', a: [22.0, 26.0] },
      anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
    },
  };
  // Both current rows carry a blank tANT primary but a valid `anthocyanins`
  // fallback (400 → 450); a perfect line reads 450 at t_today.
  const berryData = [
    { ...row(0, 22.0), tANT: '', anthocyanins: 400 },
    { ...row(14, 23.5), tANT: '', anthocyanins: 450 },
  ];
  const results = computeAll({
    berryData,
    today: new Date(t0 + 14 * dayMs),
    currentVintage: 2026,
    overrides: [],
    rubricFor: () => antRubric, valleyFor,
  });
  const pred = results[0].prediction;
  // Samples are kept (valid Brix) and the fallback anthocyanin drives antHoy.
  assert.equal(pred.nCurrent, 2, `nCurrent=${pred.nCurrent}`);
  assert.ok(Math.abs(pred.antHoy - 450) < 1e-9,
    `antHoy should use the fallback 450, got ${pred.antHoy}`);
});

test('MT.42: blank primary pH alias falls through to a valid fallback', () => {
  // White-mode rubric: pH present, NO anthocyanins → phTarget is set.
  const phRubric = {
    params: {
      brix: { kind: 'range', a: [22.0, 26.0] },
      pH: { kind: 'le-a-le-b', a: 3.67, b: 3.80 },
    },
  };
  // Both current rows carry a blank `pH` primary but a valid lowercase `ph`
  // fallback (3.4 → 3.6); a perfect line reads 3.6 at t_today.
  const berryData = [
    { ...row(0, 22.0), pH: '', ph: 3.4 },
    { ...row(14, 23.5), pH: '', ph: 3.6 },
  ];
  const results = computeAll({
    berryData,
    today: new Date(t0 + 14 * dayMs),
    currentVintage: 2026,
    overrides: [],
    rubricFor: () => phRubric, valleyFor,
  });
  const pred = results[0].prediction;
  assert.equal(pred.nCurrent, 2, `nCurrent=${pred.nCurrent}`);
  assert.ok(Math.abs(pred.phHoy - 3.6) < 1e-9,
    `phHoy should use the fallback 3.6, got ${pred.phHoy}`);
});
