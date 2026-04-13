// MT.6 — Deterministic canonical seq, weak ID guard, composite ID builder
// Tests Identity.canonicalSeqAssign, Identity.extractLotCode, Identity.isWeakSampleId,
// Identity.buildCompositeSampleId, Identity.stableRowKey
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
  },

  buildCompositeSampleId(row) {
    const prefix = row.sample_id || '';
    const parts = [prefix];
    if (row.variety) parts.push(row.variety.replace(/\s+/g, ''));
    if (row.appellation) parts.push(row.appellation.replace(/\s+/g, ''));
    if (row.vessel_id) parts.push(String(row.vessel_id).replace(/\s+/g, ''));
    return parts.join('-');
  },

  isWeakSampleId(id) {
    if (!id) return true;
    const s = String(id).trim();
    return s.length < 3 || /^\d+$/.test(s);
  },

  stableRowKey(row) {
    return `${row.sample_id || ''}|${row.sample_date || ''}|${row.sample_seq || ''}`;
  }
};

// ── Tests ──

describe('MT.6 — canonicalSeqAssign (deterministic)', () => {
  it('same rows in different order produce identical sample_seq', () => {
    const rowsA = [
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Wine', vessel_id: 'T1', brix: 24.5, ph: 3.5, ta: 6.0 },
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Wine', vessel_id: 'T2', brix: 23.0, ph: 3.6, ta: 5.8 },
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Berries', vessel_id: '', brix: 22.0, ph: 3.4, ta: 7.0 },
    ];
    const rowsB = [
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Berries', vessel_id: '', brix: 22.0, ph: 3.4, ta: 7.0 },
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Wine', vessel_id: 'T2', brix: 23.0, ph: 3.6, ta: 5.8 },
      { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_type: 'Wine', vessel_id: 'T1', brix: 24.5, ph: 3.5, ta: 6.0 },
    ];

    Identity.canonicalSeqAssign(rowsA);
    Identity.canonicalSeqAssign(rowsB);

    // Both should produce same mapping regardless of input order
    const keyA = rowsA.map(r => Identity.stableRowKey(r)).sort();
    const keyB = rowsB.map(r => Identity.stableRowKey(r)).sort();
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
    assert.equal(sorted[0].berry_weight, 1.2); // lower berry_weight first
    assert.equal(sorted[1].berry_weight, 1.5);
  });

  it('fully identical rows still get deterministic seq via JSON tiebreaker', () => {
    const rows = [
      { sample_id: 'W', sample_date: '2025-01-01', brix: 24, ph: 3.5, ta: 6.0, notes: 'B' },
      { sample_id: 'W', sample_date: '2025-01-01', brix: 24, ph: 3.5, ta: 6.0, notes: 'A' },
    ];
    Identity.canonicalSeqAssign(rows);

    // Run again with reversed input to confirm determinism
    const rows2 = [
      { sample_id: 'W', sample_date: '2025-01-01', brix: 24, ph: 3.5, ta: 6.0, notes: 'A' },
      { sample_id: 'W', sample_date: '2025-01-01', brix: 24, ph: 3.5, ta: 6.0, notes: 'B' },
    ];
    Identity.canonicalSeqAssign(rows2);

    const keyA = rows.map(r => Identity.stableRowKey(r)).sort();
    const keyB = rows2.map(r => Identity.stableRowKey(r)).sort();
    assert.deepEqual(keyA, keyB);
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

describe('MT.6 — buildCompositeSampleId', () => {
  it('constructs composite from vintage prefix + variety + appellation', () => {
    const row = { sample_id: '25', variety: 'Cabernet Sauvignon', appellation: 'VDG-Rancho1' };
    const result = Identity.buildCompositeSampleId(row);
    assert.equal(result, '25-CabernetSauvignon-VDG-Rancho1');
  });

  it('includes vessel_id when present', () => {
    const row = { sample_id: '25', variety: 'Merlot', appellation: 'VON', vessel_id: 'T5' };
    assert.equal(Identity.buildCompositeSampleId(row), '25-Merlot-VON-T5');
  });

  it('handles missing fields gracefully', () => {
    const row = { sample_id: '25' };
    assert.equal(Identity.buildCompositeSampleId(row), '25');
  });

  it('strips whitespace from field values', () => {
    const row = { sample_id: '25', variety: 'Petit Verdot', appellation: 'San Vicente' };
    assert.equal(Identity.buildCompositeSampleId(row), '25-PetitVerdot-SanVicente');
  });

  it('result is not a weak ID when variety is present', () => {
    const row = { sample_id: '25', variety: 'Durif' };
    const composite = Identity.buildCompositeSampleId(row);
    assert.equal(Identity.isWeakSampleId(composite), false);
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

  it('extracts meaningful lot from composite IDs', () => {
    // Composite IDs built by buildCompositeSampleId
    assert.equal(Identity.extractLotCode('25-CabernetSauvignon-VDG'), '-CabernetSauvignon-VDG');
  });
});

describe('MT.6 — isWeakSampleId', () => {
  it('detects purely numeric IDs as weak', () => {
    assert.equal(Identity.isWeakSampleId('25'), true);
    assert.equal(Identity.isWeakSampleId('1'), true);
    assert.equal(Identity.isWeakSampleId('123'), true);
  });

  it('detects short IDs (< 3 chars) as weak', () => {
    assert.equal(Identity.isWeakSampleId('AB'), true);
    assert.equal(Identity.isWeakSampleId('X'), true);
  });

  it('accepts valid lot-style IDs', () => {
    assert.equal(Identity.isWeakSampleId('25CSMX-1'), false);
    assert.equal(Identity.isWeakSampleId('24NEBBIOLO'), false);
    assert.equal(Identity.isWeakSampleId('ABC'), false);
  });

  it('treats null/undefined/empty as weak', () => {
    assert.equal(Identity.isWeakSampleId(null), true);
    assert.equal(Identity.isWeakSampleId(undefined), true);
    assert.equal(Identity.isWeakSampleId(''), true);
  });

  it('treats whitespace-only as weak', () => {
    assert.equal(Identity.isWeakSampleId('  '), true);
  });
});

describe('MT.6 — stableRowKey', () => {
  it('builds composite key from row fields', () => {
    const row = { sample_id: '25CSMX-1', sample_date: '2025-08-15', sample_seq: 2 };
    assert.equal(Identity.stableRowKey(row), '25CSMX-1|2025-08-15|2');
  });

  it('handles missing fields with empty strings', () => {
    const row = { sample_id: '25CSMX-1' };
    assert.equal(Identity.stableRowKey(row), '25CSMX-1||');
  });
});
