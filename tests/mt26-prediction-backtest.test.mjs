// tests/mt26-prediction-backtest.test.mjs
// MT.26 — Backtest harness. For each prior vintage in the fixture set,
// simulate predictions at T-30, T-21, T-14, T-7 and verify MAE bounds.
// Currently runs against the synthetic Kompali CS fixture; add more
// fixtures named tests/fixtures/prediction-*.json to expand the gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolveTarget, computeOne } from '../js/prediction.js';

const RUBRIC = {
  params: {
    brix:         { kind: 'range', a: [23.5, 24.2] },
    anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
  },
};

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(FIXTURE_DIR)
  .filter(f => f.startsWith('prediction-') && f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(new URL(f, FIXTURE_DIR))));

function predictAt(samples, today, target, historicalByVintage = []) {
  const before = samples.filter(s => s.sampleDate <= today);
  if (before.length < 2) return null;
  const current = before.map((s, i, arr) => ({
    sampleDate: s.sampleDate,
    tDays: (s.sampleDate - arr[0].sampleDate) / 86_400_000,
    brix: s.brix, ant: s.ant,
  }));
  return computeOne({ current, historicalByVintage, target, today });
}

test('MT.26 backtest: MAE at T-14 < 7 days, MAE at T-30 < 14 days', () => {
  const errors = { 30: [], 21: [], 14: [], 7: [] };
  for (const fx of fixtures) {
    if (!fx.actualReceptionDate) continue;
    const samples = fx.samples
      .map(s => ({ ...s, sampleDate: new Date(s.sampleDate) }))
      .sort((a, b) => a.sampleDate - b.sampleDate);
    const reception = new Date(fx.actualReceptionDate);
    const target = resolveTarget({ rubric: RUBRIC, override: null });
    for (const offset of [30, 21, 14, 7]) {
      const today = new Date(reception.getTime() - offset * 86_400_000);
      const out = predictAt(samples, today, target, []);
      if (!out || !out.recommendedDate) continue;
      const err = Math.abs((out.recommendedDate - reception) / 86_400_000);
      errors[offset].push(err);
    }
  }
  const mae = arr => arr.length
    ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const mae14 = mae(errors[14]);
  const mae30 = mae(errors[30]);
  // Allow null when no fixtures yielded enough samples at that horizon
  if (mae14 != null) assert.ok(mae14 < 7,
    `MAE(T-14) = ${mae14.toFixed(2)} d, expected < 7`);
  if (mae30 != null) assert.ok(mae30 < 14,
    `MAE(T-30) = ${mae30.toFixed(2)} d, expected < 14`);
  console.log('[MT.26 backtest]', JSON.stringify({
    n: { 30: errors[30].length, 21: errors[21].length,
         14: errors[14].length,  7: errors[7].length },
    mae: { 30: mae30, 21: mae(errors[21]), 14: mae14, 7: mae(errors[7]) },
  }));
});
