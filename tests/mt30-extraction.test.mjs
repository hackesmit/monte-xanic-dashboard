// tests/mt30-extraction.test.mjs
// MT.30 — Extraction numerator picks PEAK antoWX per codigoBodega.
// Regression guard for the 2026-05-29 fix: the previous "wineByCodigo[code] = d"
// overwrite picked whichever wine sample loaded last, not the one with peak ANT.

import test from 'node:test';
import assert from 'node:assert/strict';

// Helper: replicates the production loop pattern so we test the pattern itself
// rather than reaching into Charts/App (which require DOM + Filters).
function pickPeakByCodigoBodega(wineRows) {
  const wineByCodigo = {};
  for (const d of wineRows) {
    if (!d.codigoBodega || d.antoWX === null || typeof d.antoWX !== 'number') continue;
    const prev = wineByCodigo[d.codigoBodega];
    if (!prev || d.antoWX > prev.antoWX) {
      wineByCodigo[d.codigoBodega] = d;
    }
  }
  return wineByCodigo;
}

test('MT.30 picks the sample with max antoWX when last-by-load-order is lower', () => {
  const wine = [
    { codigoBodega: 'LOT1-W', fecha: '2026-08-01', antoWX: 800 },
    { codigoBodega: 'LOT1-W', fecha: '2026-08-15', antoWX: 1500 },  // peak
    { codigoBodega: 'LOT1-W', fecha: '2026-09-01', antoWX: 900 },   // loads last
  ];
  const picked = pickPeakByCodigoBodega(wine);
  assert.equal(picked['LOT1-W'].antoWX, 1500, 'should pick peak, not last');
  assert.equal(picked['LOT1-W'].fecha, '2026-08-15');
});

test('MT.30 picks the sample with max antoWX when peak is loaded last', () => {
  const wine = [
    { codigoBodega: 'LOT2-W', antoWX: 500 },
    { codigoBodega: 'LOT2-W', antoWX: 1200 },  // peak (also last)
  ];
  const picked = pickPeakByCodigoBodega(wine);
  assert.equal(picked['LOT2-W'].antoWX, 1200);
});

test('MT.30 skips rows with null or non-numeric antoWX', () => {
  const wine = [
    { codigoBodega: 'LOT3-W', antoWX: null },
    { codigoBodega: 'LOT3-W', antoWX: 'bad' },
    { codigoBodega: 'LOT3-W', antoWX: 700 },
  ];
  const picked = pickPeakByCodigoBodega(wine);
  assert.equal(picked['LOT3-W'].antoWX, 700);
});

test('MT.30 handles multiple distinct codigoBodega values independently', () => {
  const wine = [
    { codigoBodega: 'LOT-A', antoWX: 1000 },
    { codigoBodega: 'LOT-A', antoWX: 800 },
    { codigoBodega: 'LOT-B', antoWX: 600 },
    { codigoBodega: 'LOT-B', antoWX: 1200 },
  ];
  const picked = pickPeakByCodigoBodega(wine);
  assert.equal(picked['LOT-A'].antoWX, 1000);
  assert.equal(picked['LOT-B'].antoWX, 1200);
});
