// js/aggregations.js
// Pure aggregation utilities. No DOM, no globals.
// Used by KPIs, charts, maps for tonnage-weighted means via
// mediciones_tecnicas.tons_received (tagged onto sample rows as _weight
// in dataLoader._enrichData; see Wave 1 #1).

/**
 * Weighted arithmetic mean.
 * @param {Array<object>} rows
 * @param {string} valueKey — property name to average (e.g. 'brix')
 * @param {string} [weightKey='_weight'] — property name for the weight
 * @param {object} [opts]
 * @param {number} [opts.fallbackWeight=1] — used when row[weightKey] is null/0/NaN
 * @returns {number|null} weighted mean, or null if no valid rows
 */
export function weightedMean(rows, valueKey, weightKey = '_weight', { fallbackWeight = 1 } = {}) {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const v = r[valueKey];
    if (v === null || v === undefined || Number.isNaN(v) || typeof v !== 'number') continue;
    const rawW = r[weightKey];
    const w = (typeof rawW === 'number' && rawW > 0 && !Number.isNaN(rawW)) ? rawW : fallbackWeight;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * Returns the row with maximum value at `key`. Ties keep first encountered.
 * Skips null / undefined / NaN values. Returns null on empty/all-skipped.
 */
export function peakBy(rows, key) {
  let best = null;
  let bestVal = -Infinity;
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined || Number.isNaN(v) || typeof v !== 'number') continue;
    if (v > bestVal) { bestVal = v; best = r; }
  }
  return best;
}
