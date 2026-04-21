// MT.12 — joinBerryWithReceptions: tank_receptions → berry.av/ag/polyphenols
// Tests the aggregation logic (in dataLoader.js) that supplies the quality
// classification engine with parameters it can't get from wine_samples alone.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal re-implementation of the join under test ────────────────
// Mirrors js/dataLoader.js exactly. If the algorithm changes there, this
// copy must update too (same pattern as MT.7's whitelist mirror).

function normalizeLotCode(s) {
  if (s === null || s === undefined) return '';
  return String(s).trim().toUpperCase()
    .replace(/^(\d{2})-?/, '')
    .replace(/_(BERRIES|RECEPCION)$/i, '');
}

function joinBerryWithReceptions(store) {
  const recById = new Map();
  for (const r of (store.receptionData || [])) {
    if (!r || !r.id) continue;
    recById.set(r.id, r);
  }

  const lotIndex = new Map();
  for (const rl of (store.receptionLotsData || [])) {
    if (!rl || !rl.lot_code || !rl.reception_id) continue;
    const rec = recById.get(rl.reception_id);
    if (!rec || rec.vintage_year == null) continue;
    const key = `${normalizeLotCode(rl.lot_code)}||${rec.vintage_year}`;
    if (!lotIndex.has(key)) lotIndex.set(key, []);
    lotIndex.get(key).push(rec);
  }

  const avgField = (recs, primary, fallback) => {
    let sum = 0, n = 0;
    for (const r of recs) {
      let v = r[primary];
      if ((v === null || v === undefined || v === '') && fallback) v = r[fallback];
      if (v === null || v === undefined || v === '') continue;
      const num = Number(v);
      if (Number.isFinite(num)) { sum += num; n += 1; }
    }
    return n > 0 ? sum / n : null;
  };

  for (const b of (store.berryData || [])) {
    if (!b.lotCode || b.vintage == null) continue;
    const normBerry = normalizeLotCode(b.lotCode);
    let recs = lotIndex.get(`${normBerry}||${b.vintage}`);
    if (!recs || !recs.length) {
      const stripped = normBerry.replace(/-\d+$/, '');
      if (stripped && stripped !== normBerry) {
        recs = lotIndex.get(`${stripped}||${b.vintage}`);
      }
    }
    if (!recs || !recs.length) continue;

    const av = avgField(recs, 'av');
    const ag = avgField(recs, 'ag');
    const poly = avgField(recs, 'polifenoles_wx', 'poli_spica');
    if (av !== null) b.av = av;
    if (ag !== null) b.ag = ag;
    if (poly !== null) b.polyphenols = poly;
  }
  return store.berryData;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('MT.12 — reception join — lot code normalization', () => {
  it('strips 2-digit vintage prefix', () => {
    assert.equal(normalizeLotCode('25CSMX-5B'), 'CSMX-5B');
    assert.equal(normalizeLotCode('25-CSMX-5B'), 'CSMX-5B');
  });
  it('preserves trailing seq (berry side keeps it)', () => {
    assert.equal(normalizeLotCode('25CSMX-5B-1'), 'CSMX-5B-1');
  });
  it('uppercases and trims', () => {
    assert.equal(normalizeLotCode('  csmx-5b  '), 'CSMX-5B');
  });
  it('tolerates null/undefined', () => {
    assert.equal(normalizeLotCode(null), '');
    assert.equal(normalizeLotCode(undefined), '');
  });
});

describe('MT.12 — reception join — single-tank lot', () => {
  it('attaches av/ag/polyphenols from one reception', () => {
    const store = {
      berryData: [
        { lotCode: 'CSMX-5B-1', vintage: 2025, brix: 24 }
      ],
      receptionData: [
        { id: 1, vintage_year: 2025, av: 0.02, ag: 0.05, polifenoles_wx: 2600 }
      ],
      receptionLotsData: [
        { reception_id: 1, lot_code: 'CSMX-5B', lot_position: 1 }
      ]
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].av, 0.02);
    assert.equal(store.berryData[0].ag, 0.05);
    assert.equal(store.berryData[0].polyphenols, 2600);
  });

  it('falls back to poli_spica when polifenoles_wx missing', () => {
    const store = {
      berryData: [{ lotCode: 'CSMX-5B', vintage: 2025 }],
      receptionData: [
        { id: 1, vintage_year: 2025, polifenoles_wx: null, poli_spica: 2400 }
      ],
      receptionLotsData: [{ reception_id: 1, lot_code: 'CSMX-5B' }]
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].polyphenols, 2400);
  });
});

describe('MT.12 — reception join — multi-tank averaging', () => {
  it('averages av across multiple receptions for same lot+vintage', () => {
    const store = {
      berryData: [{ lotCode: 'CSMX-5B', vintage: 2025 }],
      receptionData: [
        { id: 1, vintage_year: 2025, av: 0.02, ag: 0.05, polifenoles_wx: 2800 },
        { id: 2, vintage_year: 2025, av: 0.04, ag: 0.09, polifenoles_wx: 2000 }
      ],
      receptionLotsData: [
        { reception_id: 1, lot_code: 'CSMX-5B', lot_position: 1 },
        { reception_id: 2, lot_code: 'CSMX-5B', lot_position: 1 }
      ]
    };
    joinBerryWithReceptions(store);
    assert.ok(Math.abs(store.berryData[0].av - 0.03) < 1e-9);
    assert.ok(Math.abs(store.berryData[0].ag - 0.07) < 1e-9);
    assert.equal(store.berryData[0].polyphenols, 2400);
  });

  it('skips null values when averaging', () => {
    const store = {
      berryData: [{ lotCode: 'CSMX-5B', vintage: 2025 }],
      receptionData: [
        { id: 1, vintage_year: 2025, av: 0.02 },               // ag missing
        { id: 2, vintage_year: 2025, av: 0.04, ag: 0.08 }
      ],
      receptionLotsData: [
        { reception_id: 1, lot_code: 'CSMX-5B' },
        { reception_id: 2, lot_code: 'CSMX-5B' }
      ]
    };
    joinBerryWithReceptions(store);
    assert.ok(Math.abs(store.berryData[0].av - 0.03) < 1e-9);
    assert.equal(store.berryData[0].ag, 0.08);  // single value, not averaged with undefined
  });
});

describe('MT.12 — reception join — vintage isolation', () => {
  it('does not join receptions from a different vintage', () => {
    const store = {
      berryData: [{ lotCode: 'CSMX-5B', vintage: 2025 }],
      receptionData: [
        { id: 1, vintage_year: 2024, av: 0.10, ag: 0.20, polifenoles_wx: 9000 }
      ],
      receptionLotsData: [{ reception_id: 1, lot_code: 'CSMX-5B' }]
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].av, undefined);
    assert.equal(store.berryData[0].ag, undefined);
    assert.equal(store.berryData[0].polyphenols, undefined);
  });

  it('joins multi-vintage data correctly', () => {
    const store = {
      berryData: [
        { lotCode: 'CSMX-5B', vintage: 2024 },
        { lotCode: 'CSMX-5B', vintage: 2025 }
      ],
      receptionData: [
        { id: 1, vintage_year: 2024, av: 0.03 },
        { id: 2, vintage_year: 2025, av: 0.02 }
      ],
      receptionLotsData: [
        { reception_id: 1, lot_code: 'CSMX-5B' },
        { reception_id: 2, lot_code: 'CSMX-5B' }
      ]
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].av, 0.03);
    assert.equal(store.berryData[1].av, 0.02);
  });
});

describe('MT.12 — reception join — lot code mismatch tolerance', () => {
  it('matches berry lotCode with trailing seq against shorter reception_lots code', () => {
    const store = {
      berryData: [{ lotCode: 'CSMX-5B-1', vintage: 2025 }],
      receptionData: [{ id: 1, vintage_year: 2025, av: 0.02 }],
      receptionLotsData: [{ reception_id: 1, lot_code: 'CSMX-5B' }]
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].av, 0.02);
  });

  it('matches when both sides have vintage prefix', () => {
    const store = {
      berryData: [{ lotCode: '25CSMX-5B', vintage: 2025 }],
      receptionData: [{ id: 1, vintage_year: 2025, av: 0.02 }],
      receptionLotsData: [{ reception_id: 1, lot_code: '25CSMX-5B' }]
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].av, 0.02);
  });
});

describe('MT.12 — reception join — defensive behavior', () => {
  it('no-op on empty stores', () => {
    const store = { berryData: [], receptionData: [], receptionLotsData: [] };
    assert.deepEqual(joinBerryWithReceptions(store), []);
  });

  it('skips berries without lotCode or vintage', () => {
    const store = {
      berryData: [
        { lotCode: null, vintage: 2025 },
        { lotCode: 'CSMX-5B', vintage: null }
      ],
      receptionData: [{ id: 1, vintage_year: 2025, av: 0.05 }],
      receptionLotsData: [{ reception_id: 1, lot_code: 'CSMX-5B' }]
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].av, undefined);
    assert.equal(store.berryData[1].av, undefined);
  });

  it('leaves berry untouched when no matching reception', () => {
    const store = {
      berryData: [{ lotCode: 'GHOST-LOT', vintage: 2025, brix: 24 }],
      receptionData: [{ id: 1, vintage_year: 2025, av: 0.05 }],
      receptionLotsData: [{ reception_id: 1, lot_code: 'OTHER-LOT' }]
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].av, undefined);
    assert.equal(store.berryData[0].brix, 24);  // other fields untouched
  });

  it('is idempotent — running twice gives same result', () => {
    const store = {
      berryData: [{ lotCode: 'CSMX-5B', vintage: 2025 }],
      receptionData: [{ id: 1, vintage_year: 2025, av: 0.02, ag: 0.05 }],
      receptionLotsData: [{ reception_id: 1, lot_code: 'CSMX-5B' }]
    };
    joinBerryWithReceptions(store);
    const first = { ...store.berryData[0] };
    joinBerryWithReceptions(store);
    assert.deepEqual(store.berryData[0], first);
  });

  it('ignores reception rows whose linked reception_id is missing', () => {
    const store = {
      berryData: [{ lotCode: 'CSMX-5B', vintage: 2025 }],
      receptionData: [{ id: 999, vintage_year: 2025, av: 0.02 }],
      receptionLotsData: [{ reception_id: 1, lot_code: 'CSMX-5B' }]  // orphaned
    };
    joinBerryWithReceptions(store);
    assert.equal(store.berryData[0].av, undefined);
  });
});
