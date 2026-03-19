// ── KPI Calculations ──

const KPIs = {
  updateBerryKPIs(data) {
    // Filter out pH outliers for clean averages
    const clean = data.filter(d => !(typeof d.pH === 'number' && (d.pH < CONFIG.thresholds.phMin || d.pH > CONFIG.thresholds.phMax)));

    const avgBrix = Utils.avg(clean.map(d => d.brix));
    const avgPH = Utils.avg(clean.map(d => d.pH));
    const avgTA = Utils.avg(clean.map(d => d.ta));
    const avgTANT = Utils.avg(clean.map(d => d.tANT));
    const avgFW = Utils.avg(clean.map(d => d.berryFW));

    this.setKPI('kpi-avg-brix', avgBrix, 1, '°Bx');
    this.setKPI('kpi-avg-ph', avgPH, 2, '');
    this.setKPI('kpi-avg-ta', avgTA, 1, 'g/L');
    this.setKPI('kpi-avg-tant', avgTANT, 0, 'ppm');
    this.setKPI('kpi-avg-fw', avgFW, 2, 'g');

    // Header KPIs
    const el = Utils.el;
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
    const avgTANT = Utils.avg(recepcion.map(d => d.antoWX));
    const avgFANT = Utils.avg(recepcion.map(d => d.freeANT));
    const avgPTAN = Utils.avg(recepcion.map(d => d.pTAN));
    const avgIPT = Utils.avg(recepcion.map(d => d.iptSpica));

    this.setKPI('wine-kpi-tant', avgTANT, 0, 'ppm');
    this.setKPI('wine-kpi-fant', avgFANT, 0, 'ppm');
    this.setKPI('wine-kpi-ptan', avgPTAN, 0, 'ppm');
    this.setKPI('wine-kpi-ipt', avgIPT, 0, '');

    // Count
    const el = document.getElementById('wine-kpi-count');
    if (el) el.innerHTML = `${recepcion.length}<span class="kpi-unit">muestras</span>`;
  }
};
