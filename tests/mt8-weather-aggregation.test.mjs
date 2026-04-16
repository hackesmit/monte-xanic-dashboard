// MT.8 — Weather aggregation and date range helpers
// Tests WeatherStore.aggregate(), getDateRange(), dayInRange(), _isoWeek()
// Extracted logic tested without DOM or network dependencies.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WeatherStore } from '../js/weather.js';

// ── Sample data: 14 days of weather from Jul 1–14, 2025 ──
function sampleRows() {
  const rows = [];
  for (let d = 1; d <= 14; d++) {
    rows.push({
      date: `2025-07-${String(d).padStart(2, '0')}`,
      location: 'VDG',
      temp_max: 30 + d,
      temp_min: 15 + d,
      temp_avg: 22 + d,
      rainfall_mm: d % 3 === 0 ? d * 0.5 : 0,
      humidity_pct: 50 + d,
      uv_index: 8,
      wind_speed: 10
    });
  }
  return rows;
}

describe('MT.8 — Weather aggregation', () => {

  it('day mode returns rows unchanged', () => {
    const rows = sampleRows();
    const result = WeatherStore.aggregate(rows, 'day');
    assert.equal(result.length, rows.length);
    assert.deepEqual(result, rows);
  });

  it('null/undefined mode returns rows unchanged', () => {
    const rows = sampleRows();
    assert.deepEqual(WeatherStore.aggregate(rows, null), rows);
    assert.deepEqual(WeatherStore.aggregate(rows, undefined), rows);
  });

  it('week mode groups into ISO weeks', () => {
    const rows = sampleRows();
    const result = WeatherStore.aggregate(rows, 'week');
    // Jul 1 (Tue) and Jul 7 (Mon) → likely 2 weeks, Jul 8-14 → 1 week
    assert.ok(result.length >= 2 && result.length <= 3, `Expected 2-3 weeks, got ${result.length}`);
    // Each aggregated row has _periodLabel starting with "Sem"
    for (const r of result) {
      assert.ok(r._periodLabel.startsWith('Sem'), `Label: ${r._periodLabel}`);
    }
  });

  it('month mode groups by YYYY-MM', () => {
    const rows = sampleRows();
    const result = WeatherStore.aggregate(rows, 'month');
    assert.equal(result.length, 1, 'All 14 days in July → 1 month group');
    assert.equal(result[0]._periodLabel, 'Jul');
  });

  it('aggregation averages temperatures', () => {
    const rows = sampleRows(); // temp_avg: 23,24,...,36
    const result = WeatherStore.aggregate(rows, 'month');
    const expectedAvg = (23 + 24 + 25 + 26 + 27 + 28 + 29 + 30 + 31 + 32 + 33 + 34 + 35 + 36) / 14;
    assert.ok(Math.abs(result[0].temp_avg - expectedAvg) < 0.01);
  });

  it('aggregation sums rainfall', () => {
    const rows = sampleRows();
    // d%3===0 means d=3,6,9,12 → rainfall = 1.5, 3.0, 4.5, 6.0 = 15.0
    const result = WeatherStore.aggregate(rows, 'month');
    assert.ok(Math.abs(result[0].rainfall_mm - 15.0) < 0.01);
  });

  it('aggregation computes _gddContribution correctly', () => {
    const rows = sampleRows(); // temp_avg: 23..36, all > 10°C
    const result = WeatherStore.aggregate(rows, 'month');
    // GDD = sum(max(0, temp_avg - 10)) = (13+14+15+16+17+18+19+20+21+22+23+24+25+26) = 273
    const expected = Array.from({ length: 14 }, (_, i) => 23 + i - 10).reduce((a, b) => a + b, 0);
    assert.equal(result[0]._gddContribution, expected);
  });

  it('aggregation handles empty input', () => {
    assert.deepEqual(WeatherStore.aggregate([], 'week'), []);
    assert.deepEqual(WeatherStore.aggregate([], 'month'), []);
  });

  it('aggregation handles null values', () => {
    const rows = [
      { date: '2025-07-01', location: 'VDG', temp_avg: null, rainfall_mm: 5, humidity_pct: 60, uv_index: 8, wind_speed: 10, temp_max: null, temp_min: null },
      { date: '2025-07-02', location: 'VDG', temp_avg: 25, rainfall_mm: null, humidity_pct: 55, uv_index: 7, wind_speed: 12, temp_max: 30, temp_min: 20 }
    ];
    const result = WeatherStore.aggregate(rows, 'month');
    assert.equal(result.length, 1);
    assert.equal(result[0].temp_avg, 25); // only non-null value
    assert.equal(result[0].rainfall_mm, 5); // only non-null value
  });
});

describe('MT.8 — Date range helpers', () => {

  it('season range is Jul 1 – Oct 31', () => {
    const { start, end } = WeatherStore.getDateRange(2024, 'season');
    assert.equal(start, '2024-07-01');
    assert.equal(end, '2024-10-31');
  });

  it('year range is Jan 1 – Dec 31 (for past year)', () => {
    const { start, end } = WeatherStore.getDateRange(2024, 'year');
    assert.equal(start, '2024-01-01');
    assert.equal(end, '2024-12-31');
  });

  it('30d range ends today', () => {
    const { start, end } = WeatherStore.getDateRange(null, '30d');
    const today = new Date().toISOString().split('T')[0];
    assert.equal(end, today);
    // start should be 29 days before today
    const s = new Date(start);
    const e = new Date(end);
    const diff = Math.round((e - s) / 86400000);
    assert.equal(diff, 29);
  });

  it('custom range uses provided dates', () => {
    const custom = { start: '2025-03-01', end: '2025-03-31' };
    const { start, end } = WeatherStore.getDateRange(null, 'custom', custom);
    assert.equal(start, '2025-03-01');
    assert.equal(end, '2025-03-31');
  });

  it('custom range without dates falls back to season', () => {
    const { start, end } = WeatherStore.getDateRange(2024, 'custom', null);
    assert.equal(start, '2024-07-01');
    assert.equal(end, '2024-10-31');
  });

  it('dayInRange returns 1 for range start', () => {
    assert.equal(WeatherStore.dayInRange('2025-07-01', '2025-07-01'), 1);
  });

  it('dayInRange matches dayOfSeason for Jul dates', () => {
    assert.equal(WeatherStore.dayInRange('2025-07-15', '2025-07-01'), WeatherStore.dayOfSeason('2025-07-15'));
    assert.equal(WeatherStore.dayInRange('2025-10-31', '2025-07-01'), WeatherStore.dayOfSeason('2025-10-31'));
  });

  it('dayInRange for year mode', () => {
    assert.equal(WeatherStore.dayInRange('2025-01-01', '2025-01-01'), 1);
    assert.equal(WeatherStore.dayInRange('2025-01-31', '2025-01-01'), 31);
    assert.equal(WeatherStore.dayInRange('2025-02-01', '2025-01-01'), 32);
  });
});

describe('MT.8 — ISO week helper', () => {

  it('returns correct ISO week format', () => {
    const w = WeatherStore._isoWeek('2025-07-01');
    assert.match(w, /^\d{4}-W\d{2}$/);
  });

  it('consecutive days in same week have same key', () => {
    // 2025-07-07 is Monday, 2025-07-13 is Sunday → same ISO week
    const mon = WeatherStore._isoWeek('2025-07-07');
    const sun = WeatherStore._isoWeek('2025-07-13');
    assert.equal(mon, sun);
  });

  it('Monday and previous Sunday are different weeks', () => {
    const sun = WeatherStore._isoWeek('2025-07-06');
    const mon = WeatherStore._isoWeek('2025-07-07');
    assert.notEqual(sun, mon);
  });
});

describe('MT.8 — x-axis title helper', () => {

  it('season title mentions Jul', () => {
    assert.ok(WeatherStore._xAxisTitle('season').includes('Jul'));
  });

  it('year title mentions Ene', () => {
    assert.ok(WeatherStore._xAxisTitle('year').includes('Ene'));
  });

  it('30d title mentions 30', () => {
    assert.ok(WeatherStore._xAxisTitle('30d').includes('30'));
  });

  it('default is season', () => {
    assert.equal(WeatherStore._xAxisTitle(), WeatherStore._xAxisTitle('season'));
  });
});
