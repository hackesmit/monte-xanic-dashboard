// MT.1 — sample_seq assignment in upload.js
// Tests that multiple rows with the same (sample_id, sample_date) get incrementing sample_seq values.
// Logic extracted from js/upload.js:97-103 (runs in browser context with XLSX globals).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Extracted sample_seq assignment logic from upload.js parseWineXRay().
 * After parsing rows, it groups by (sample_id, sample_date) and assigns
 * incrementing sample_seq per group.
 */
function assignSampleSeq(rows) {
  const seqCounters = {};
  rows.forEach(r => {
    const key = `${r.sample_id}|${r.sample_date || ''}`;
    seqCounters[key] = (seqCounters[key] || 0) + 1;
    r.sample_seq = seqCounters[key];
  });
  return rows;
}

describe('MT.1 — sample_seq assignment', () => {
  it('assigns seq=1 to a single row per (sample_id, sample_date)', () => {
    const rows = [
      { sample_id: '25CSMX-1', sample_date: '2025-08-15' },
      { sample_id: '25CSMX-2', sample_date: '2025-08-15' },
    ];
    assignSampleSeq(rows);
    assert.equal(rows[0].sample_seq, 1);
    assert.equal(rows[1].sample_seq, 1);
  });

  it('increments seq for duplicate (sample_id, sample_date) pairs', () => {
    const rows = [
      { sample_id: '25CSMX-1', sample_date: '2025-08-15' },
      { sample_id: '25CSMX-1', sample_date: '2025-08-15' },
      { sample_id: '25CSMX-1', sample_date: '2025-08-15' },
    ];
    assignSampleSeq(rows);
    assert.equal(rows[0].sample_seq, 1);
    assert.equal(rows[1].sample_seq, 2);
    assert.equal(rows[2].sample_seq, 3);
  });

  it('treats different dates as separate groups', () => {
    const rows = [
      { sample_id: '25CSMX-1', sample_date: '2025-08-15' },
      { sample_id: '25CSMX-1', sample_date: '2025-08-16' },
    ];
    assignSampleSeq(rows);
    assert.equal(rows[0].sample_seq, 1);
    assert.equal(rows[1].sample_seq, 1);
  });

  it('treats different sample_ids as separate groups', () => {
    const rows = [
      { sample_id: '25CSMX-1', sample_date: '2025-08-15' },
      { sample_id: '25CSMX-2', sample_date: '2025-08-15' },
    ];
    assignSampleSeq(rows);
    assert.equal(rows[0].sample_seq, 1);
    assert.equal(rows[1].sample_seq, 1);
  });

  it('handles null/missing sample_date gracefully', () => {
    const rows = [
      { sample_id: '25CSMX-1', sample_date: null },
      { sample_id: '25CSMX-1', sample_date: null },
      { sample_id: '25CSMX-1' }, // sample_date undefined
    ];
    assignSampleSeq(rows);
    // null and undefined both become empty string via `|| ''`
    assert.equal(rows[0].sample_seq, 1);
    assert.equal(rows[1].sample_seq, 2);
    assert.equal(rows[2].sample_seq, 3);
  });

  it('handles empty input', () => {
    const rows = [];
    assignSampleSeq(rows);
    assert.equal(rows.length, 0);
  });

  it('mixed groups get independent counters', () => {
    const rows = [
      { sample_id: 'A', sample_date: '2025-08-15' },
      { sample_id: 'B', sample_date: '2025-08-15' },
      { sample_id: 'A', sample_date: '2025-08-15' },
      { sample_id: 'B', sample_date: '2025-08-15' },
      { sample_id: 'A', sample_date: '2025-08-16' },
    ];
    assignSampleSeq(rows);
    assert.equal(rows[0].sample_seq, 1); // A|08-15 #1
    assert.equal(rows[1].sample_seq, 1); // B|08-15 #1
    assert.equal(rows[2].sample_seq, 2); // A|08-15 #2
    assert.equal(rows[3].sample_seq, 2); // B|08-15 #2
    assert.equal(rows[4].sample_seq, 1); // A|08-16 #1
  });
});
