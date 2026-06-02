// ── KPI Calculations ──
import { weightedMean } from './aggregations.js';

export const KPIs = {
  // Unweighted arithmetic mean — legacy path for callers without row context.
  avg(arr) {
    const valid = arr.filter(x => typeof x === 'number' && !isNaN(x));
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  },

  // Tonnage-weighted mean over sample rows. Uses row._weight (tagged in
  // dataLoader._tagSampleWeights from mediciones.tons_received). Rows without
  // a matching medicion fall back to weight=1 via aggregations.weightedMean.
  weightedAvg(rows, key) {
    return weightedMean(rows, key);
  },

  updateBerryKPIs(data) {
    const avgBrix = this.weightedAvg(data, 'brix');
    const avgPH = this.weightedAvg(data, 'pH');
    const avgTA = this.weightedAvg(data, 'ta');
    const avgTANT = this.weightedAvg(data, 'tANT');
    const avgFW = this.weightedAvg(data, 'berryFW');

    this.setKPI('kpi-avg-brix', avgBrix, 1, '°Bx');
    this.setKPI('kpi-avg-ph', avgPH, 2, '');
    this.setKPI('kpi-avg-ta', avgTA, 1, 'g/L');
    this.setKPI('kpi-avg-tant', avgTANT, 0, 'ppm');
    this.setKPI('kpi-avg-fw', avgFW, 2, 'g');

    // Header KPIs
    const el = (id) => document.getElementById(id);
    if (el('hdr-muestras')) el('hdr-muestras').textContent = data.length;
    if (el('hdr-lotes')) el('hdr-lotes').textContent = new Set(data.map(d => d.sampleId).filter(Boolean)).size;
    if (el('hdr-varietales')) el('hdr-varietales').textContent = new Set(data.map(d => d.variety).filter(Boolean)).size;
    if (el('hdr-origenes')) el('hdr-origenes').textContent = new Set(data.map(d => d.appellation).filter(Boolean)).size;
  },

  setKPI(id, value, decimals, unit) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value === null || value === undefined) {
      el.innerHTML = '—';
    } else {
      const formatted = decimals === 0 ? Math.round(value) : value.toFixed(decimals);
      el.innerHTML = unit ? `${formatted}<span class="kpi-unit">${unit}</span>` : formatted;
    }
  },

  updateWineKPIs(recepcion) {
    const avgTANT = this.weightedAvg(recepcion, 'antoWX');
    const avgFANT = this.weightedAvg(recepcion, 'freeANT');
    const avgPTAN = this.weightedAvg(recepcion, 'pTAN');
    const avgIPT = this.weightedAvg(recepcion, 'iptSpica');

    this.setKPI('wine-kpi-tant', avgTANT, 0, 'ppm');
    this.setKPI('wine-kpi-fant', avgFANT, 0, 'ppm');
    this.setKPI('wine-kpi-ptan', avgPTAN, 0, 'ppm');
    this.setKPI('wine-kpi-ipt', avgIPT, 0, '');

    // Count
    const el = document.getElementById('wine-kpi-count');
    if (el) el.innerHTML = `${recepcion.length}<span class="kpi-unit">muestras</span>`;
  }
};
