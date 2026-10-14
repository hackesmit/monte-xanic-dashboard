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

/**
 * Harvested tonnage per vintage year, from mediciones_tecnicas rows
 * (tons_received, the authoritative figure that arrives via pre-recepcion).
 * Rows with no positive, finite tons are skipped. A row without a vintage
 * falls back to the year of its date (YYYY-MM-DD).
 * @param {Array<object>} rows - mediciones in DataStore shape ({ tons, vintage, date, variety, lotCode })
 * @returns {{ years: number[], varieties: string[], byYear: Object<number, { total: number, lots: number, byVariety: Object<string, number> }> }}
 *   years ascending; varieties by total tonnage, largest first.
 */
export function tonnageByVintage(rows) {
  const byYear = {};
  const varietyTotals = {};
  for (const r of rows || []) {
    const tons = typeof r?.tons === 'string' ? parseFloat(r.tons) : r?.tons;
    if (typeof tons !== 'number' || !Number.isFinite(tons) || tons <= 0) continue;
    let year = Number(r.vintage);
    if (!Number.isInteger(year) || year <= 0) {
      const m = /^(\d{4})-/.exec(String(r.date || ''));
      if (!m) continue;
      year = Number(m[1]);
    }
    const variety = r.variety || 'Sin variedad';
    const y = byYear[year] || (byYear[year] = { total: 0, lots: 0, byVariety: {}, _lots: new Set() });
    y.total += tons;
    y.byVariety[variety] = (y.byVariety[variety] || 0) + tons;
    y._lots.add(r.lotCode || r.code || `${variety}-${y._lots.size}`);
    varietyTotals[variety] = (varietyTotals[variety] || 0) + tons;
  }
  for (const y of Object.values(byYear)) { y.lots = y._lots.size; delete y._lots; }
  return {
    years: Object.keys(byYear).map(Number).sort((a, b) => a - b),
    varieties: Object.keys(varietyTotals).sort((a, b) => varietyTotals[b] - varietyTotals[a]),
    byYear
  };
}
