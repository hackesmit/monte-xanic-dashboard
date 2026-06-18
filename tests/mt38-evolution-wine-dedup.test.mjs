// tests/mt38-evolution-wine-dedup.test.mjs
// MT.38 — Evolution chart dedups wine samples by PEAK antoWX per codigoBodega.
// Regression guard for the 2026-06-18 fix: the previous
// "wineByCodigo[code] = d" overwrite in _buildEvolutionData picked whichever
// sample loaded last. Unlike the extraction join (MT.30) this variant must NOT
// drop below-detection samples — the evolution chart also plots other
// compounds, so a código whose antoWX is all-null still keeps a point (nulls
// just rank lowest when choosing the peak).

import test from 'node:test';
import assert from 'node:assert/strict';

// Replicates the production loop pattern (charts.js _buildEvolutionData) so we
// test the pattern itself rather than reaching into Charts (needs DOM/Filters).
function pickWineByCodigo(wineRows) {
  const wineByCodigo = {};
  for (const d of wineRows) {
    if (!d.codigoBodega) continue;
    const prev = wineByCodigo[d.codigoBodega];
    const cur = typeof d.antoWX === 'number' ? d.antoWX : -Infinity;
    const old = prev && typeof prev.antoWX === 'number' ? prev.antoWX : -Infinity;
    if (!prev || cur > old) wineByCodigo[d.codigoBodega] = d;
  }
  return wineByCodigo;
}

test('MT.38 picks peak antoWX, not the last-loaded sample', () => {
  const wine = [
    { codigoBodega: 'LOT1-W', fecha: '2026-08-01', antoWX: 800 },
    { codigoBodega: 'LOT1-W', fecha: '2026-08-15', antoWX: 1500 },  // peak
    { codigoBodega: 'LOT1-W', fecha: '2026-09-01', antoWX: 900 },   // loads last
  ];
  const picked = pickWineByCodigo(wine);
  assert.equal(picked['LOT1-W'].antoWX, 1500, 'should pick peak, not last');
  assert.equal(picked['LOT1-W'].fecha, '2026-08-15');
});

test('MT.38 a real antoWX always beats a below-detection (null) sample, any order', () => {
  const nullFirst = pickWineByCodigo([
    { codigoBodega: 'LOT2-W', antoWX: null },
    { codigoBodega: 'LOT2-W', antoWX: 600 },
  ]);
  assert.equal(nullFirst['LOT2-W'].antoWX, 600);

  const nullLast = pickWineByCodigo([
    { codigoBodega: 'LOT3-W', antoWX: 600 },
    { codigoBodega: 'LOT3-W', antoWX: null },
  ]);
  assert.equal(nullLast['LOT3-W'].antoWX, 600, 'null must not overwrite a real peak');
});

test('MT.38 KEEPS a código whose samples are all below-detection (divergence from MT.30)', () => {
  const wine = [
    { codigoBodega: 'LOT4-W', fecha: '2026-08-01', antoWX: null },
    { codigoBodega: 'LOT4-W', fecha: '2026-08-15', antoWX: 'bad' },
  ];
  const picked = pickWineByCodigo(wine);
  assert.ok('LOT4-W' in picked, 'all-null código must still keep a point for other compounds');
  // First-seen wins among non-numeric values (deterministic, not last-loaded).
  assert.equal(picked['LOT4-W'].fecha, '2026-08-01');
});

test('MT.38 handles multiple distinct codigoBodega values independently', () => {
  const wine = [
    { codigoBodega: 'LOT-A', antoWX: 1000 },
    { codigoBodega: 'LOT-A', antoWX: 800 },
    { codigoBodega: 'LOT-B', antoWX: 600 },
    { codigoBodega: 'LOT-B', antoWX: 1200 },
  ];
  const picked = pickWineByCodigo(wine);
  assert.equal(picked['LOT-A'].antoWX, 1000);
  assert.equal(picked['LOT-B'].antoWX, 1200);
});

test('MT.38 ignores rows with no codigoBodega', () => {
  const wine = [
    { codigoBodega: '', antoWX: 999 },
    { antoWX: 999 },
    { codigoBodega: 'LOT5-W', antoWX: 500 },
  ];
  const picked = pickWineByCodigo(wine);
  assert.deepEqual(Object.keys(picked), ['LOT5-W']);
});
