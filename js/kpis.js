// ── KPI Calculations ──
import { weightedMean, weightedMeanStats } from './aggregations.js';

export const KPIs = {
  // Unweighted arithmetic mean - legacy path for callers without row context.
  avg(arr) {
    const valid = arr.filter(x => typeof x === 'number' && !isNaN(x));
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  },

  // Tonnage-weighted mean over sample rows. Uses row._weight (tagged in
  // dataLoader._tagSampleWeights from mediciones.tons_received). When tonnage
  // is only partially known the figure falls back to a plain unweighted mean
  // rather than mixing scales - see aggregations.weightedMeanStats.
  weightedAvg(rows, key) {
    return weightedMean(rows, key);
  },

  // Same mean plus coverage/weighted metadata so the KPI can be qualified.
  weightedAvgStats(rows, key) {
    return weightedMeanStats(rows, key);
  },

  updateBerryKPIs(data) {
    const brix = this.weightedAvgStats(data, 'brix');
    const ph = this.weightedAvgStats(data, 'pH');
    const ta = this.weightedAvgStats(data, 'ta');
    const tant = this.weightedAvgStats(data, 'tANT');
    const fw = this.weightedAvgStats(data, 'berryFW');

    this.setKPI('kpi-avg-brix', brix.mean, 1, '°Bx', brix);
    this.setKPI('kpi-avg-ph', ph.mean, 2, '', ph);
    this.setKPI('kpi-avg-ta', ta.mean, 1, 'g/L', ta);
    this.setKPI('kpi-avg-tant', tant.mean, 0, 'ppm', tant);
    this.setKPI('kpi-avg-fw', fw.mean, 2, 'g', fw);

    // Header KPIs
    const el = (id) => document.getElementById(id);
    if (el('hdr-muestras')) el('hdr-muestras').textContent = data.length;
    if (el('hdr-lotes')) el('hdr-lotes').textContent = new Set(data.map(d => d.sampleId).filter(Boolean)).size;
    if (el('hdr-varietales')) el('hdr-varietales').textContent = new Set(data.map(d => d.variety).filter(Boolean)).size;
    if (el('hdr-origenes')) el('hdr-origenes').textContent = new Set(data.map(d => d.appellation).filter(Boolean)).size;
  },

  // Decide, from weightedMeanStats metadata, whether a rendered KPI needs the
  // "not tonnage-weighted" qualifier and what tooltip explains it. Pure (no DOM)
  // so it can be unit-tested. `weighted === false` ALWAYS qualifies: a mean with
  // zero tonnage coverage is no more tonnage-weighted than a partial one, so it
  // must never render as an unqualified tonnage KPI (that was the very dishonesty
  // this bead fixes). Coverage counts value-rows (measurements), not unique lots,
  // so the wording says "mediciones", not "lotes".
  // @returns {{ marked: boolean, title: string|null }}
  weightedQualifier(meta) {
    if (!meta || meta.weighted !== false) return { marked: false, title: null };
    if (meta.coverage > 0) {
      const pct = Math.round(meta.coverage * 100);
      return { marked: true, title: `Promedio sin ponderar por tonelaje: tonelaje conocido en ${pct}% de las mediciones` };
    }
    // Zero coverage: distinct wording so it is not read as merely partial.
    return { marked: true, title: 'Promedio sin ponderar: tonelaje sin fuente en ninguna medición' };
  },

  // `meta` (optional) = { coverage, weighted } from weightedMeanStats. When a
  // figure could not be tonnage-weighted, mark it with a `*` and a Spanish
  // tooltip so users don't read a plain average as a tonnage-weighted KPI.
  setKPI(id, value, decimals, unit, meta) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value === null || value === undefined) {
      el.innerHTML = '-';
      el.removeAttribute('title');
      return;
    }
    const formatted = decimals === 0 ? Math.round(value) : value.toFixed(decimals);
    let html = unit ? `${formatted}<span class="kpi-unit">${unit}</span>` : `${formatted}`;
    const q = this.weightedQualifier(meta);
    if (q.marked) {
      html += `<span class="kpi-note" aria-label="${q.title}">*</span>`;
      el.setAttribute('title', q.title);
    } else {
      el.removeAttribute('title');
    }
    el.innerHTML = html;
  },

  updateWineKPIs(recepcion) {
    const tant = this.weightedAvgStats(recepcion, 'antoWX');
    const fant = this.weightedAvgStats(recepcion, 'freeANT');
    const ptan = this.weightedAvgStats(recepcion, 'pTAN');
    const ipt = this.weightedAvgStats(recepcion, 'iptSpica');

    this.setKPI('wine-kpi-tant', tant.mean, 0, 'ppm', tant);
    this.setKPI('wine-kpi-fant', fant.mean, 0, 'ppm', fant);
    this.setKPI('wine-kpi-ptan', ptan.mean, 0, 'ppm', ptan);
    this.setKPI('wine-kpi-ipt', ipt.mean, 0, '', ipt);

    // Count
    const el = document.getElementById('wine-kpi-count');
    if (el) el.innerHTML = `${recepcion.length}<span class="kpi-unit">muestras</span>`;
  }
};
