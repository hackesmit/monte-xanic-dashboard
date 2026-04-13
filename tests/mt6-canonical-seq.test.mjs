// MT.6 — Deterministic canonical seq + extractLotCode
// Tests Identity.canonicalSeqAssign and Identity.extractLotCode
// Logic extracted from js/identity.js (runs in browser context as global).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Extract Identity module logic for Node.js testing ──

const Identity = {
  canonicalSeqAssign(rows) {
    const groups = {};
    rows.forEach(r => {
      const key = `${r.sample_id}|${r.sample_date || ''}`;
      (groups[key] = groups[key] || []).push(r);
    });
    for (const group of Object.values(groups)) {
      group.sort((a, b) => {
        return (a.sample_type || '').localeCompare(b.sample_type || '')
            || (a.vessel_id || '').localeCompare(b.vessel_id || '')
            || (a.brix ?? -Infinity) - (b.brix ?? -Infinity)
            || (a.ph ?? -Infinity) - (b.ph ?? -Infinity)
            || (a.ta ?? -Infinity) - (b.ta ?? -Infinity)
            || (a.berry_weight ?? -Infinity) - (b.berry_weight ?? -Infinity)
            || (a.tant ?? -Infinity) - (b.tant ?? -Infinity)
            || JSON.stringify(a).localeCompare(JSON.stringify(b));
      });
      group.forEach((r, i) => { r.sample_seq = i + 1; });
    }
    return rows;
  },

  extractLotCode(sampleId) {
    if (!sampleId) return '';
    let code = String(sampleId);
    code = code.replace(/^\d{2}/, '');
    code = code.replace(/_(BERRIES|RECEPCION)$/i, '');
    return code;
  }
};

// ── Tests ──

describe('MT.6 — canonicalSeqAssign (deterministic)', () => {
  it('same rows in different order produce identical sample_seq', () => {
    const make = () => [
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Wine', vessel_id: 'T1', brix: 24.5, ph: 3.5, ta: 6.0 },
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Wine', vessel_id: 'T2', brix: 23.0, ph: 3.6, ta: 5.8 },
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Berries', vessel_id: '', brix: 22.0, ph: 3.4, ta: 7.0 },
    ];
    const rowsA = make();
    const rowsB = [make()[2], make()[1], make()[0]]; // reversed

    Identity.canonicalSeqAssign(rowsA);
    Identity.canonicalSeqAssign(rowsB);

    const toKey = r => `${r.sample_type}|${r.vessel_id}|${r.sample_seq}`;
    const keyA = rowsA.map(toKey).sort();
    const keyB = rowsB.map(toKey).sort();
    assert.deepEqual(keyA, keyB);
  });

  it('different (sample_id, sample_date) groups get independent counters', () => {
    const rows = [
      { sample_id: 'A', sample_date: '2025-08-15', brix: 20 },
      { sample_id: 'B', sample_date: '2025-08-15', brix: 21 },
      { sample_id: 'A', sample_date: '2025-08-15', brix: 22 },
      { sample_id: 'A', sample_date: '2025-08-16', brix: 19 },
    ];
    Identity.canonicalSeqAssign(rows);

    const aRows15 = rows.filter(r => r.sample_id === 'A' && r.sample_date === '2025-08-15');
    assert.deepEqual(aRows15.map(r => r.sample_seq).sort(), [1, 2]);

    const bRows = rows.filter(r => r.sample_id === 'B');
    assert.equal(bRows[0].sample_seq, 1);

    const aRows16 = rows.filter(r => r.sample_id === 'A' && r.sample_date === '2025-08-16');
    assert.equal(aRows16[0].sample_seq, 1);
  });

  it('tiebreaking by brix/ph/ta produces stable order', () => {
    const rows = [
      { sample_id: 'X', sample_date: '2025-01-01', sample_type: 'Wine', vessel_id: 'T1', brix: 24, ph: 3.5, ta: 6.0 },
      { sample_id: 'X', sample_date: '2025-01-01', sample_type: 'Wine', vessel_id: 'T1', brix: 24, ph: 3.5, ta: 5.5 },
      { sample_id: 'X', sample_date: '2025-01-01', sample_type: 'Wine', vessel_id: 'T1', brix: 24, ph: 3.4, ta: 6.0 },
    ];
    Identity.canonicalSeqAssign(rows);

    const sorted = [...rows].sort((a, b) => a.sample_seq - b.sample_seq);
    assert.equal(sorted[0].ph, 3.4);
    assert.equal(sorted[1].ta, 5.5);
    assert.equal(sorted[2].ta, 6.0);
  });

  it('rows with identical primary fields use berry_weight/tant tiebreaker', () => {
    const rows = [
      { sample_id: 'Z', sample_date: '2025-01-01', sample_type: 'Wine', vessel_id: 'T1', brix: 24, ph: 3.5, ta: 6.0, berry_weight: 1.5, tant: 100 },
      { sample_id: 'Z', sample_date: '2025-01-01', sample_type: 'Wine', vessel_id: 'T1', brix: 24, ph: 3.5, ta: 6.0, berry_weight: 1.2, tant: 200 },
    ];
    Identity.canonicalSeqAssign(rows);

    const sorted = [...rows].sort((a, b) => a.sample_seq - b.sample_seq);
    assert.equal(sorted[0].berry_weight, 1.2);
    assert.equal(sorted[1].berry_weight, 1.5);
  });

  it('fully identical rows still get deterministic seq via JSON tiebreaker', () => {
    const rows = [
      { sample_id: 'W', sample_date: '2025-01-01', brix: 24, ph: 3.5, ta: 6.0, notes: 'B' },
      { sample_id: 'W', sample_date: '2025-01-01', brix: 24, ph: 3.5, ta: 6.0, notes: 'A' },
    ];
    Identity.canonicalSeqAssign(rows);

    const rows2 = [
      { sample_id: 'W', sample_date: '2025-01-01', brix: 24, ph: 3.5, ta: 6.0, notes: 'A' },
      { sample_id: 'W', sample_date: '2025-01-01', brix: 24, ph: 3.5, ta: 6.0, notes: 'B' },
    ];
    Identity.canonicalSeqAssign(rows2);

    const seqA = rows.map(r => `${r.notes}:${r.sample_seq}`).sort();
    const seqB = rows2.map(r => `${r.notes}:${r.sample_seq}`).sort();
    assert.deepEqual(seqA, seqB);
  });

  it('handles null/missing sort fields gracefully', () => {
    const rows = [
      { sample_id: 'Y', sample_date: '2025-01-01', brix: null },
      { sample_id: 'Y', sample_date: '2025-01-01', brix: 20 },
      { sample_id: 'Y', sample_date: '2025-01-01' },
    ];
    Identity.canonicalSeqAssign(rows);

    const seqs = rows.map(r => r.sample_seq);
    assert.deepEqual(seqs.sort(), [1, 2, 3]);
    const withBrix = rows.find(r => r.brix === 20);
    assert.equal(withBrix.sample_seq, 3);
  });

  it('handles empty input', () => {
    const rows = [];
    Identity.canonicalSeqAssign(rows);
    assert.equal(rows.length, 0);
  });

  it('single row per group gets seq=1', () => {
    const rows = [
      { sample_id: 'A', sample_date: '2025-01-01', brix: 22 },
      { sample_id: 'B', sample_date: '2025-01-01', brix: 23 },
    ];
    Identity.canonicalSeqAssign(rows);
    assert.equal(rows[0].sample_seq, 1);
    assert.equal(rows[1].sample_seq, 1);
  });
});

describe('MT.6 — extractLotCode', () => {
  it('strips vintage prefix from standard lot codes', () => {
    assert.equal(Identity.extractLotCode('25CSMX-1'), 'CSMX-1');
    assert.equal(Identity.extractLotCode('24NEBBIOLO-A'), 'NEBBIOLO-A');
  });

  it('strips _BERRIES suffix', () => {
    assert.equal(Identity.extractLotCode('25CSMX_BERRIES'), 'CSMX');
  });

  it('strips _RECEPCION suffix', () => {
    assert.equal(Identity.extractLotCode('25LOT1_RECEPCION'), 'LOT1');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(Identity.extractLotCode(null), '');
    assert.equal(Identity.extractLotCode(undefined), '');
    assert.equal(Identity.extractLotCode(''), '');
  });

  it('returns empty string for weak numeric-only IDs after prefix strip', () => {
    assert.equal(Identity.extractLotCode('25'), '');
  });
});
