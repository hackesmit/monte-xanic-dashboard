// tests/mt24-prediction-resolve.test.mjs
// MT.24 — Target resolution + computeOne orchestration tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget } from '../js/prediction.js';

// Stub rubric matching js/config.js structure
const RUBRIC_CS_VON = {
  params: {
    brix:         { kind: 'range', a: [23.5, 24.2] },
    anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
  },
};
const RUBRIC_SB_VDG = {
  params: {
    brix:         { kind: 'range', a: [19.0, 23.0] },
    // no anthocyanins entry → whites
  },
};

test('MT.24 resolveTarget: no override → midpoint, lower, upper, ant from rubric', () => {
  const t = resolveTarget({ rubric: RUBRIC_CS_VON, override: null });
  assert.ok(Math.abs(t.brixTarget - 23.85) < 1e-9);
  assert.equal(t.brixLower, 23.5);
  assert.equal(t.brixUpper, 24.2);
  assert.equal(t.antTarget, 950);
});

test('MT.24 resolveTarget: full override wins', () => {
  const t = resolveTarget({
    rubric: RUBRIC_CS_VON,
    override: { brix_target: 23.6, brix_target_lower: 23.0, brix_upper: 24.0,
                anthocyanin_target: 900 },
  });
  assert.equal(t.brixTarget, 23.6);
  assert.equal(t.brixLower, 23.0);
  assert.equal(t.brixUpper, 24.0);
  assert.equal(t.antTarget, 900);
});

test('MT.24 resolveTarget: partial override (only ANT) → others from rubric', () => {
  const t = resolveTarget({
    rubric: RUBRIC_CS_VON,
    override: { brix_target: null, brix_target_lower: null, brix_upper: null,
                anthocyanin_target: 1100 },
  });
  assert.ok(Math.abs(t.brixTarget - 23.85) < 1e-9);
  assert.equal(t.antTarget, 1100);
});

test('MT.24 resolveTarget: white rubric without anthocyanins → antTarget null', () => {
  const t = resolveTarget({ rubric: RUBRIC_SB_VDG, override: null });
  assert.equal(t.antTarget, null);
});
