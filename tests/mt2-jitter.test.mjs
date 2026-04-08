// MT.2 — Deterministic jitter function in charts.js
// Tests that _applyDaysJitter produces deterministic, bounded offsets.
// Logic extracted from js/charts.js:3-13.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Extracted from charts.js — shared jitter helper.
 * Offsets x by sample_seq spacing + deterministic lot hash.
 */
function _applyDaysJitter(x, d) {
  if (d.sampleSeq > 1) x += (d.sampleSeq - 1) * 0.15;
  const lot = d.lotCode || d.sampleId;
  if (lot) {
    let hash = 0;
    for (let c = 0; c < lot.length; c++) hash = ((hash << 5) - hash + lot.charCodeAt(c)) | 0;
    x += ((((hash % 41) + 41) % 41) - 20) * 0.01; // ±0.2 day
  }
  return x;
}

describe('MT.2 — deterministic jitter', () => {
  it('same lot always produces the same offset', () => {
    const d = { sampleSeq: 1, lotCode: '25CSMX-1' };
    const result1 = _applyDaysJitter(10, d);
    const result2 = _applyDaysJitter(10, d);
    assert.equal(result1, result2);
  });

  it('different lots produce different offsets', () => {
    const d1 = { sampleSeq: 1, lotCode: '25CSMX-1' };
    const d2 = { sampleSeq: 1, lotCode: '25SYON-3' };
    const r1 = _applyDaysJitter(10, d1);
    const r2 = _applyDaysJitter(10, d2);
    assert.notEqual(r1, r2);
  });

  it('jitter range is symmetric ±0.2 day', () => {
    const lots = [
      'A', 'BB', 'CCC', '25CSMX-1', '25SYON-3', 'KOMPALI-2',
      'TEST-LONG-LOT-CODE-12345', 'X', '25NBMX-4', '24CFVA-2'
    ];
    for (const lotCode of lots) {
      const d = { sampleSeq: 1, lotCode };
      const result = _applyDaysJitter(0, d);
      assert.ok(result >= -0.21 && result <= 0.21,
        `Jitter for "${lotCode}" = ${result}, expected within ±0.2`);
    }
  });

  it('sampleSeq > 1 adds 0.15 * (seq-1) offset', () => {
    const d1 = { sampleSeq: 1, lotCode: 'LOT-A' };
    const d2 = { sampleSeq: 2, lotCode: 'LOT-A' };
    const d3 = { sampleSeq: 3, lotCode: 'LOT-A' };
    const r1 = _applyDaysJitter(10, d1);
    const r2 = _applyDaysJitter(10, d2);
    const r3 = _applyDaysJitter(10, d3);
    // seq offset is additive on top of same hash jitter
    assert.ok(Math.abs((r2 - r1) - 0.15) < 1e-10, `seq 2 offset: ${r2 - r1}`);
    assert.ok(Math.abs((r3 - r1) - 0.30) < 1e-10, `seq 3 offset: ${r3 - r1}`);
  });

  it('sampleSeq=1 adds no seq offset (only hash)', () => {
    const d = { sampleSeq: 1, lotCode: 'LOT-A' };
    const result = _applyDaysJitter(10, d);
    // Result should be 10 + hash jitter only (no seq offset)
    const noSeq = { sampleSeq: undefined, lotCode: 'LOT-A' };
    const resultNoSeq = _applyDaysJitter(10, noSeq);
    assert.equal(result, resultNoSeq);
  });

  it('falls back to sampleId when lotCode is missing', () => {
    const d = { sampleSeq: 1, sampleId: '25CSMX-1' };
    const result = _applyDaysJitter(10, d);
    // Should produce same result as if lotCode was '25CSMX-1'
    const dWithLot = { sampleSeq: 1, lotCode: '25CSMX-1' };
    const resultWithLot = _applyDaysJitter(10, dWithLot);
    assert.equal(result, resultWithLot);
  });

  it('no lot or sampleId produces zero jitter (hash component)', () => {
    const d = { sampleSeq: 1 };
    const result = _applyDaysJitter(10, d);
    assert.equal(result, 10);
  });

  it('is stable across many calls (no random component)', () => {
    const d = { sampleSeq: 2, lotCode: '25NBMX-4' };
    const results = new Set();
    for (let i = 0; i < 100; i++) {
      results.add(_applyDaysJitter(5, d));
    }
    assert.equal(results.size, 1, 'Should produce exactly one unique value');
  });
});
