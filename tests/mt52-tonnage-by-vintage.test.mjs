// MT.52: harvested tonnage per vintage for the Vendimias view (tonnageByVintage).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tonnageByVintage } from '../js/aggregations.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

describe('tonnageByVintage', () => {
  it('sums tons per year and per variety, years ascending', () => {
    const agg = tonnageByVintage([
      { vintage: 2025, variety: 'Syrah', lotCode: 'A', tons: 10 },
      { vintage: 2025, variety: 'Merlot', lotCode: 'B', tons: 2.5 },
      { vintage: 2024, variety: 'Syrah', lotCode: 'C', tons: 4 },
      { vintage: 2025, variety: 'Syrah', lotCode: 'A', tons: 1 },
    ]);
    assert.deepEqual(agg.years, [2024, 2025]);
    close(agg.byYear[2025].total, 13.5);
    close(agg.byYear[2025].byVariety.Syrah, 11);
    close(agg.byYear[2024].total, 4);
    assert.equal(agg.byYear[2025].lots, 2);
    assert.deepEqual(agg.varieties, ['Syrah', 'Merlot']);
  });

  it('falls back to the date year when vintage is blank', () => {
    const agg = tonnageByVintage([
      { vintage: null, date: '2026-08-25', variety: 'Syrah', lotCode: 'A', tons: 3 },
      { vintage: '', date: '2026-09-01', variety: 'Syrah', lotCode: 'B', tons: 2 },
    ]);
    assert.deepEqual(agg.years, [2026]);
    close(agg.byYear[2026].total, 5);
  });

  it('skips rows without positive finite tons or any year', () => {
    const agg = tonnageByVintage([
      { vintage: 2025, variety: 'Syrah', tons: null },
      { vintage: 2025, variety: 'Syrah', tons: 0 },
      { vintage: 2025, variety: 'Syrah', tons: -3 },
      { vintage: 2025, variety: 'Syrah', tons: NaN },
      { vintage: null, date: null, variety: 'Syrah', tons: 5 },
      { vintage: 2025, variety: 'Syrah', lotCode: 'A', tons: '2.5' },
    ]);
    assert.deepEqual(agg.years, [2025]);
    close(agg.byYear[2025].total, 2.5);
  });

  it('labels a missing variety and handles empty input', () => {
    assert.deepEqual(tonnageByVintage([]), { years: [], varieties: [], byYear: {} });
    assert.deepEqual(tonnageByVintage(undefined).years, []);
    const agg = tonnageByVintage([{ vintage: 2024, lotCode: 'X', tons: 1 }]);
    assert.deepEqual(agg.varieties, ['Sin variedad']);
  });
});
