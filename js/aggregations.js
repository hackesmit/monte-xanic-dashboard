// js/aggregations.js
// Pure aggregation utilities. No DOM, no globals.
// Used by KPIs, charts, maps for tonnage-weighted means via
// mediciones_tecnicas.tons_received (tagged onto sample rows as _weight
// in dataLoader._enrichData; see Wave 1 #1).

/**
 * Weighted arithmetic mean with an explicit all-or-nothing tonnage policy.
 *
 * Tonnage weighting is only meaningful when every contributing lot's tonnage
 * is known. When it is only partially known we must NOT invent a weight (the
 * old `fallbackWeight = 1` behaviour): substituting 1 ton for an unknown lot
 * lets real-tonnage lots swamp the rest, producing a figure that is neither a
 * tonnage-weighted mean nor an unweighted one (e.g. a 20 Bx null-weight lot
 * next to a 30 Bx / 100 t lot yielded ~29.9 instead of the honest 25).
 *
 * Policy:
 *   - Every value-row carries a valid weight  -> tonnage-weighted mean.
 *   - Any value-row is missing a valid weight  -> plain unweighted mean over
 *     all value-rows (each lot counts once). No invented tonnage, no mixing.
 * `coverage` (fraction of value-rows with a real weight) is reported so the UI
 * can visibly qualify a figure that fell back to unweighted.
 *
 * @param {Array<object>} rows
 * @param {string} valueKey - property name to average (e.g. 'brix')
 * @param {string} [weightKey='_weight'] - property name for the weight
 * @returns {{mean: number|null, coverage: number, weighted: boolean}}
 */
export function weightedMeanStats(rows, valueKey, weightKey = '_weight') {
  let valueRows = 0;
  let weightedRows = 0;
  let plainSum = 0;   // sum v            (unweighted)
  let wNum = 0;       // sum v * w        (weighted numerator)
  let wDen = 0;       // sum w            (weighted denominator)
  for (const r of rows) {
    const v = r[valueKey];
    // Parse strictly: only a finite number is a usable value. Infinity/NaN are
    // discarded, not smuggled through - a non-finite value would poison both the
    // plain and weighted sums (same coercion trap fixed in the predictor and the
    // sanitary counts). Test loosely (v > 0) and Infinity slips in.
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    valueRows++;
    plainSum += v;
    const rawW = r[weightKey];
    // A weight must be finite AND positive. `rawW > 0` alone admits Infinity,
    // which makes wNum and wDen both Infinity and their ratio NaN - a NaN KPI
    // that renders as garbage and silently grades C downstream.
    if (typeof rawW === 'number' && Number.isFinite(rawW) && rawW > 0) {
      weightedRows++;
      wNum += v * rawW;
      wDen += rawW;
    }
  }
  if (valueRows === 0) return { mean: null, coverage: 0, weighted: false };
  const coverage = weightedRows / valueRows;
  const fullyWeighted = weightedRows === valueRows && wDen > 0;
  const mean = fullyWeighted ? wNum / wDen : plainSum / valueRows;
  // Never let a non-finite aggregate propagate to a KPI. With finite values and
  // finite positive weights this cannot fire, but guard rather than trust.
  if (!Number.isFinite(mean)) return { mean: null, coverage, weighted: false };
  return { mean, coverage, weighted: fullyWeighted };
}

/**
 * Weighted arithmetic mean (see {@link weightedMeanStats} for the policy).
 * @param {Array<object>} rows
 * @param {string} valueKey - property name to average (e.g. 'brix')
 * @param {string} [weightKey='_weight'] - property name for the weight
 * @returns {number|null} weighted (or unweighted-fallback) mean, or null if no valid rows
 */
export function weightedMean(rows, valueKey, weightKey = '_weight') {
  return weightedMeanStats(rows, valueKey, weightKey).mean;
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
