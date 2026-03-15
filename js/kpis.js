// ── KPI Calculations ──

const KPIs = {
  avg(arr) {
    const valid = arr.filter(x => typeof x === 'number' && !isNaN(x));
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  },

  range(arr) {
    const valid = arr.filter(x => typeof x === 'number' && !isNaN(x));
    if (!valid.length) return { min: null, max: null };
    return { min: Math.min(...valid), max: Math.max(...valid) };
  },

  fmt(v, decimals) {
    return v !== null && v !== undefined ? v.toFixed(decimals) : '—';
  },

  updateBerryKPIs(data) {
    // Filter out pH outliers for clean averages
    const clean = data.filter(d => !(typeof d.pH === 'number' && (d.pH < 2.5 || d.pH > 5.0)));

    const avgBrix = this.avg(clean.map(d => d.brix));
    const avgPH = this.avg(clean.map(d => d.pH));
    const avgTA = this.avg(clean.map(d => d.ta));
    const avgTANT = this.avg(clean.map(d => d.tANT));
    const avgFW = this.avg(clean.map(d => d.berryFW));

    this.setKPI('kpi-avg-brix', avgBrix, 1, '°Bx');
    this.setKPI('kpi-avg-ph', avgPH, 2, '');
    this.setKPI('kpi-avg-ta', avgTA, 1, 'g/L');
    this.setKPI('kpi-avg-tant', avgTANT, 0, 'ppm');
    this.setKPI('kpi-avg-fw', avgFW, 2, 'g');

    this.setRange('kpi-range-brix', this.range(clean.map(d => d.brix)), 1);
    this.setRange('kpi-range-ph', this.range(clean.map(d => d.pH)), 2);
    this.setRange('kpi-range-ta', this.range(clean.map(d => d.ta)), 1);
    this.setRange('kpi-range-tant', this.range(clean.map(d => d.tANT)), 0);
    this.setRange('kpi-range-fw', this.range(clean.map(d => d.berryFW)), 2);

    // Header KPIs
    const el = (id) => document.getElementById(id);
    if (el('hdr-muestras')) el('hdr-muestras').textContent = data.length;
    if (el('hdr-lotes')) el('hdr-lotes').textContent = new Set(data.map(d => d.sampleId)).size;
    if (el('hdr-varietales')) el('hdr-varietales').textContent = new Set(data.map(d => d.variety)).size;
    if (el('hdr-origenes')) el('hdr-origenes').textContent = new Set(data.map(d => d.appellation)).size;
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

  setRange(id, range, decimals) {
    const el = document.getElementById(id);
    if (!el) return;
    if (range.min === null || range.max === null) {
      el.textContent = '—';
    } else {
      const fmtMin = decimals === 0 ? Math.round(range.min) : range.min.toFixed(decimals);
      const fmtMax = decimals === 0 ? Math.round(range.max) : range.max.toFixed(decimals);
      el.textContent = `${fmtMin} – ${fmtMax}`;
    }
  },

  updateWineKPIs(recepcion) {
    const avgTANT = this.avg(recepcion.map(d => d.antoWX));
    const avgFANT = this.avg(recepcion.map(d => d.freeANT));
    const avgPTAN = this.avg(recepcion.map(d => d.pTAN));
    const avgIPT = this.avg(recepcion.map(d => d.iptSpica));

    this.setKPI('wine-kpi-tant', avgTANT, 0, 'ppm');
    this.setKPI('wine-kpi-fant', avgFANT, 0, 'ppm');
    this.setKPI('wine-kpi-ptan', avgPTAN, 0, 'ppm');
    this.setKPI('wine-kpi-ipt', avgIPT, 0, '');

    // Count
    const el = document.getElementById('wine-kpi-count');
    if (el) el.innerHTML = `${recepcion.length}<span class="kpi-unit">muestras</span>`;
  }
};
