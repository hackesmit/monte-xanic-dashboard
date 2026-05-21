// tests/mt25-prediction-integration.test.mjs
// MT.25 — Harvest predictor integration against a frozen vintage fixture.
// The fixture in tests/fixtures/prediction-2024-kompali-cs.json is currently
// synthetic-but-realistic; replace its `samples` array with real WineXRay
// berry rows once available to harden this gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTarget, computeOne } from '../js/prediction.js';

const fx = JSON.parse(readFileSync(
  new URL('./fixtures/prediction-2024-kompali-cs.json', import.meta.url)));

// Pulled in-line from js/config.js — keep in sync if rubric thresholds shift.
const RUBRIC = {
  params: {
    brix:         { kind: 'range', a: [23.5, 24.2] },
    anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
  },
};

test('MT.25 integration: predict 2024 Kompali CS reception within ±10 days', () => {
  const samples = fx.samples
    .map(s => ({ ...s, sampleDate: new Date(s.sampleDate) }))
    .sort((a, b) => a.sampleDate - b.sampleDate);
  // "Today" = 21 days before the actual reception date — typical winemaker
  // forecast horizon.
  const reception = new Date(fx.actualReceptionDate);
  const today = new Date(reception.getTime() - 21 * 86_400_000);
  const current = samples
    .filter(s => s.sampleDate <= today)
    .map((s, i, arr) => ({
      sampleDate: s.sampleDate,
      tDays: (s.sampleDate - arr[0].sampleDate) / 86_400_000,
      brix: s.brix, ant: s.ant,
    }));
  const target = resolveTarget({ rubric: RUBRIC, override: null });
  // No prior vintages in the integration fixture; this tests the
  // V=0 fallback path on real-shaped data.
  const out = computeOne({
    current, historicalByVintage: [], target, today,
  });
  assert.ok(out.recommendedDate, `reason=${out.reason}`);
  const errorDays = Math.abs(
    (out.recommendedDate.getTime() - reception.getTime()) / 86_400_000);
  assert.ok(errorDays <= 10,
    `predicted ${out.recommendedDate.toISOString().slice(0,10)} ` +
    `vs actual ${fx.actualReceptionDate}, error=${errorDays.toFixed(1)} d`);
});
