// tests/mt33-forecast-range-end.test.mjs
// MT.33 — WeatherStore.getForecastRangeEnd: uncapped natural end-of-timeframe
// used for forecast filtering. Distinct from getDateRange().end which caps at
// today for the current vintage (no future observations exist).
//
// Regression guard for #7: createWeatherTimeSeries + createRainfallChart used
// to reuse getDateRange().end as the forecast filter bound. For the current
// vintage in 'season' or 'year' tf, that capped value collapsed the forecast
// filter to `r.date > today && r.date <= today` → empty, so the toggle "did
// nothing" visually even though network fetches succeeded.

import test from 'node:test';
import assert from 'node:assert/strict';

// Import lazily so the test focuses on the pure helper (no DOM, no fetch).
const { WeatherStore } = await import('../js/weather.js');

test('MT.33 getForecastRangeEnd: season → vintage-10-31 (uncapped)', () => {
  assert.equal(WeatherStore.getForecastRangeEnd(2026, 'season'), '2026-10-31');
  assert.equal(WeatherStore.getForecastRangeEnd(2025, 'season'), '2025-10-31');
});

test('MT.33 getForecastRangeEnd: year → vintage-12-31 (uncapped)', () => {
  assert.equal(WeatherStore.getForecastRangeEnd(2026, 'year'), '2026-12-31');
});

test('MT.33 getForecastRangeEnd: 30d → null (no forecast on backward window)', () => {
  assert.equal(WeatherStore.getForecastRangeEnd(null, '30d'), null);
});

test('MT.33 getForecastRangeEnd: custom → user-provided end', () => {
  const r = WeatherStore.getForecastRangeEnd(null, 'custom', { start: '2026-06-01', end: '2026-07-15' });
  assert.equal(r, '2026-07-15');
});

test('MT.33 getForecastRangeEnd: custom with missing range → null', () => {
  assert.equal(WeatherStore.getForecastRangeEnd(null, 'custom', null), null);
  assert.equal(WeatherStore.getForecastRangeEnd(null, 'custom', { start: '2026-06-01' }), null);
});

test('MT.33 getForecastRangeEnd: unknown timeframe defaults to season-end', () => {
  // Defensive: future timeframes shouldn't silently drop forecasts.
  assert.equal(WeatherStore.getForecastRangeEnd(2026, 'unknown-tf'), '2026-10-31');
});

// ── Regression: forecast survives filter when uncapped end is used ─────

test('MT.33 forecastWithinRange: forecast rows past today are KEPT when rangeEnd is uncapped season-end', () => {
  // Simulate the bug scenario: today is mid-season, observed data up through today,
  // forecast rows for the next 7 days. Pre-fix the caller passed capped end (=today)
  // and the filter excluded all forecast rows. With the new helper, callers pass the
  // uncapped season-end and forecast rows survive.
  const today = new Date().toISOString().split('T')[0];
  const plus = (days) => {
    const d = new Date(today); d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };
  const forecastRows = [
    { date: plus(1), temp_avg: 28, isForecast: true },
    { date: plus(3), temp_avg: 30, isForecast: true },
    { date: plus(7), temp_avg: 27, isForecast: true },
  ];
  const lastObs = today;

  // Pre-fix shape: rangeEnd capped at today → empty.
  const buggy = WeatherStore.forecastWithinRange(forecastRows, lastObs, today);
  assert.equal(buggy.length, 0, 'sanity-check: capped rangeEnd reproduces the bug');

  // Post-fix shape: uncapped season-end → all three rows survive.
  const year = parseInt(today.slice(0, 4), 10);
  const fixed = WeatherStore.forecastWithinRange(
    forecastRows,
    lastObs,
    WeatherStore.getForecastRangeEnd(year, 'season')
  );
  assert.equal(fixed.length, 3, 'fix: uncapped rangeEnd keeps forecast rows');
});
