// ── Map Store: SVG vineyard heatmaps with metric color coding ──
import { CONFIG } from './config.js';

export const MapStore = {
  currentRanch: 'MX',
  currentMetric: 'brix',
  currentVintage: null,
  sectionData: {},        // sectionId → { brix, pH, ta, tANT, lotCount, ... }
  sectionLots: {},        // sectionId → [berryRow, ...]
  detailOpen: false,

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },

  // ── Field Lot → Section ID resolution ──

  resolveSection(fieldLot) {
    if (!fieldLot) return null;
    const lot = String(fieldLot).trim();

    // 1. Check explicit overrides
    if (CONFIG.fieldLotToSection[lot]) return CONFIG.fieldLotToSection[lot];

    // 2. Try stripping trailing suffixes and check again
    // e.g. CFVA-2B-S1 → CFVA-2B, CSKMP-S8-1-ABA → CSKMP-S8-1, CSMX-5B-1 → CSMX-5B
    let stripped = lot.replace(/-\d+$/, '');
    if (CONFIG.fieldLotToSection[stripped]) return CONFIG.fieldLotToSection[stripped];
    stripped = stripped.replace(/-S\d+$/, '').replace(/-[A-Z]+$/, '');
    if (CONFIG.fieldLotToSection[stripped]) return CONFIG.fieldLotToSection[stripped];

    // 3. Pattern-based extraction
    for (const p of CONFIG.fieldLotRanchPatterns) {
      const m = lot.match(p.regex);
      if (m) {
        let section = m[1];
        // Clean up section: remove sub-lot suffixes like -S1, -CONT, -R
        section = section.replace(/-(CONT|BIO|MAT|ABA|BIOTEKSA|R|RALEO|ALIVIO)$/i, '').replace(/-\d+$/, '');
        // Add S prefix for Kompali if section starts with a number
        if (p.prefix === 'K' && /^\d/.test(section)) {
          return `K-S${section}`;
        }
        return `${p.prefix}-${section}`;
      }
    }
    return null;
  },

  // ── Aggregate grape_receptions data by section ──

  aggregateBySection(data, vintage) {
    this.sectionData = {};
    this.sectionLots = {};

    const filtered = vintage
      ? data.filter(d => d.vintage === vintage)
      : data;

    for (const row of filtered) {
      const fieldLot = row.fieldLot || row.field_lot || row.lotCode;
      const sectionId = this.resolveSection(fieldLot);
      if (!sectionId) continue;

      if (!this.sectionLots[sectionId]) this.sectionLots[sectionId] = [];
      this.sectionLots[sectionId].push(row);
    }

    // Compute weighted averages per section
    for (const [sectionId, lots] of Object.entries(this.sectionLots)) {
      const agg = { lotCount: lots.length };

      const chemFields = ['brix','pH','ta','tANT','berryFW',
        'ag','am','av','ipt','polyphenols','anthocyanins'];

      for (const f of chemFields) {
        let sumW = 0, totalW = 0;
        for (const lot of lots) {
          const val = lot[f];
          const w = 1;
          if (val !== null && val !== undefined && !isNaN(val)) {
            sumW += val * w;
            totalW += w;
          }
        }
        agg[f] = totalW > 0 ? sumW / totalW : null;
      }

      this.sectionData[sectionId] = agg;
    }
  },

  // ── Color Scale ──

  getColor(value, metricKey) {
    const m = CONFIG.mapMetrics[metricKey];
    if (!m || value === null || value === undefined) return 'rgba(128,128,128,0.2)';

    const { min, max, stops } = m;
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const idx = t * (stops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, stops.length - 1);
    const frac = idx - lo;

    return this._interpolateColor(stops[lo], stops[hi], frac);
  },

  _interpolateColor(c1, c2, t) {
    const r1 = parseInt(c1.slice(1,3),16), g1 = parseInt(c1.slice(3,5),16), b1 = parseInt(c1.slice(5,7),16);
    const r2 = parseInt(c2.slice(1,3),16), g2 = parseInt(c2.slice(3,5),16), b2 = parseInt(c2.slice(5,7),16);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  },

  // ── SVG Map Generation ──

  _getSectionsForRanch(ranchCode) {
    return CONFIG.vineyardSections.filter(s => s.ranchCode === ranchCode);
  },

  // Generate SVG map for a ranch using polygon coordinates from CONFIG
  generateSVG(ranchCode, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const sections = this._getSectionsForRanch(ranchCode);
    if (!sections.length) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">Sin secciones para este rancho</div>';
      return;
    }

    const vb = CONFIG.ranchViewBoxes[ranchCode] || { width: 600, height: 450 };
    const pad = 20;
    const svgW = vb.width + pad * 2;
    const svgH = vb.height + pad * 2;
    const svgNS = 'http://www.w3.org/2000/svg';

    let svg = `<svg xmlns="${svgNS}" viewBox="0 0 ${svgW} ${svgH}" class="vineyard-map-svg">`;

    for (const section of sections) {
      if (!section.points || !section.points.length) continue;

      const sectionId = section.sectionId;
      const data = this.sectionData[sectionId];
      const metricVal = data ? data[this.currentMetric] : null;
      const fillColor = this.getColor(metricVal, this.currentMetric);

      // Build polygon points string with padding offset
      const pts = section.points.map(([x, y]) => `${x + pad},${y + pad}`).join(' ');

      // Calculate centroid for label placement
      const cx = section.points.reduce((s, p) => s + p[0], 0) / section.points.length + pad;
      const cy = section.points.reduce((s, p) => s + p[1], 0) / section.points.length + pad;

      // Estimate section size for font scaling
      const xs = section.points.map(p => p[0]);
      const ys = section.points.map(p => p[1]);
      const bw = Math.max(...xs) - Math.min(...xs);
      const bh = Math.max(...ys) - Math.min(...ys);
      const labelSize = Math.max(8, Math.min(14, Math.min(bw, bh) / 4));
      const varSize = Math.max(6, labelSize * 0.65);

      svg += `<g class="map-section-group" data-section="${sectionId}" style="cursor:pointer">`;
      svg += `<polygon points="${pts}" fill="${fillColor}" stroke="var(--border-gold)" stroke-width="1.5" class="section-rect"/>`;

      // Section label at centroid
      svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--white)" font-size="${labelSize}" font-family="Sackers Gothic Medium, sans-serif">${section.sectionLabel}</text>`;

      // Variety abbreviation
      const varAbbr = (section.variety || '').length > 12
        ? (section.variety || '').split(/[\s\/]+/).map(w => w[0]).join('')
        : section.variety;
      svg += `<text x="${cx}" y="${cy + varSize + 2}" text-anchor="middle" fill="var(--muted)" font-size="${varSize}" font-family="Sackers Gothic Medium, sans-serif">${varAbbr}</text>`;

      // Metric value
      if (metricVal !== null && metricVal !== undefined) {
        const valStr = metricVal >= 100 ? Math.round(metricVal) : metricVal.toFixed(1);
        svg += `<text x="${cx}" y="${cy + varSize * 2 + 6}" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="${varSize}">${valStr}</text>`;
      }

      svg += '</g>';
    }

    svg += '</svg>';
    container.innerHTML = svg;

    // Hover effects
    container.querySelectorAll('.map-section-group').forEach(g => {
      g.addEventListener('mouseenter', () => {
        g.querySelector('.section-rect').style.strokeWidth = '3';
        g.querySelector('.section-rect').style.stroke = 'var(--gold)';
      });
      g.addEventListener('mouseleave', () => {
        g.querySelector('.section-rect').style.strokeWidth = '1.5';
        g.querySelector('.section-rect').style.stroke = 'var(--border-gold)';
      });
    });
  },

  // ── Color Scale Legend ──

  renderLegend(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const m = CONFIG.mapMetrics[this.currentMetric];
    if (!m) { container.innerHTML = ''; return; }

    const { label, min, max, stops } = m;
    const gradientStops = stops.map((c, i) => `${c} ${(i / (stops.length - 1) * 100).toFixed(0)}%`).join(', ');

    container.innerHTML = `
      <div class="scale-label">${label}</div>
      <div class="scale-bar-wrap">
        <span class="scale-tick">${min}</span>
        <div class="scale-gradient" style="background:linear-gradient(to right, ${gradientStops})"></div>
        <span class="scale-tick">${max}</span>
      </div>
    `;
  },

  // ── Detail Panel ──

  showDetail(sectionId) {
    const panel = document.getElementById('section-detail-panel');
    if (!panel) return;

    const section = CONFIG.vineyardSections.find(s => s.sectionId === sectionId);
    const data = this.sectionData[sectionId];
    const lots = this.sectionLots[sectionId] || [];

    if (!section) { this.hideDetail(); return; }

    const fmt = (v, dec) => v !== null && v !== undefined && !isNaN(v) ? (dec === 0 ? Math.round(v) : Number(v).toFixed(dec)) : '—';

    let html = `
      <div class="detail-header">
        <div>
          <div class="detail-title">${section.sectionId}</div>
          <div class="detail-sub">${section.ranch} · ${section.variety}${section.hectares ? ' · ' + section.hectares + ' ha' : ''}</div>
        </div>
        <button class="detail-close">&times;</button>
      </div>
      <div class="detail-body">
    `;

    if (data) {
      html += `
        <div class="detail-section-label">Métricas Agregadas</div>
        <div class="detail-metrics">
          <div class="detail-metric"><span class="dm-label">Muestras</span><span class="dm-value">${data.lotCount}</span></div>
          <div class="detail-metric"><span class="dm-label">Brix</span><span class="dm-value">${fmt(data.brix, 1)} °Bx</span></div>
          <div class="detail-metric"><span class="dm-label">pH</span><span class="dm-value">${fmt(data.pH, 2)}</span></div>
          <div class="detail-metric"><span class="dm-label">AT</span><span class="dm-value">${fmt(data.ta, 2)} g/L</span></div>
          <div class="detail-metric"><span class="dm-label">tANT</span><span class="dm-value">${fmt(data.tANT, 0)} ppm</span></div>
          <div class="detail-metric"><span class="dm-label">Peso Baya</span><span class="dm-value">${fmt(data.berryFW, 2)} g</span></div>
        </div>
      `;

    } else {
      html += '<div style="padding:20px;color:var(--muted);text-align:center">Sin datos para esta sección</div>';
    }

    // Sub-lot breakdown
    if (lots.length > 0) {
      html += `<div class="detail-section-label" style="margin-top:16px">Lotes de Campo (${lots.length})</div>`;
      html += '<div class="detail-lots-table"><table class="data-table"><thead><tr><th>Lote</th><th>Brix</th><th>pH</th><th>AT</th><th>tANT</th></tr></thead><tbody>';
      for (const lot of lots) {
        html += `<tr>
          <td style="color:var(--gold-lt)">${this._esc(lot.fieldLot || lot.field_lot || lot.lotCode || lot.sampleId || '—')}</td>
          <td>${fmt(lot.brix, 1)}</td>
          <td>${fmt(lot.pH, 2)}</td>
          <td>${fmt(lot.ta, 2)}</td>
          <td>${fmt(lot.tANT, 0)}</td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }

    html += '</div>';
    panel.innerHTML = html;
    panel.classList.add('open');
    this.detailOpen = true;
  },

  hideDetail() {
    const panel = document.getElementById('section-detail-panel');
    if (panel) panel.classList.remove('open');
    this.detailOpen = false;
  },

  // ── KPIs for selected ranch ──

  getRanchKPIs(ranchCode) {
    const sections = this._getSectionsForRanch(ranchCode);
    const sectionIds = sections.map(s => s.sectionId);
    const relevantData = sectionIds.filter(id => this.sectionData[id]).map(id => this.sectionData[id]);

    if (!relevantData.length) return { totalSamples: 0, sections: 0, avgBrix: null, avgPH: null };

    const sectionsWithData = relevantData.length;

    // Weighted average by lot count per section
    const avg = (field) => {
      let sumW = 0, totalW = 0;
      for (const d of relevantData) {
        if (d[field] !== null && d[field] !== undefined) {
          const w = d.lotCount || 1;
          sumW += d[field] * w;
          totalW += w;
        }
      }
      return totalW > 0 ? sumW / totalW : null;
    };

    // Total sample count across all sections
    const totalSamples = relevantData.reduce((s, d) => s + (d.lotCount || 0), 0);

    return {
      totalSamples,
      sections: sectionsWithData,
      totalSections: sections.length,
      avgBrix: avg('brix'),
      avgPH: avg('pH'),
      avgTA: avg('ta')
    };
  },

  // ── Ranch tab labels ──
  _ranchLabels: {
    'MX': 'Monte Xanic', 'K': 'Kompali', 'VA': 'Viña Alta',
    'ON': 'Ojos Negros', 'OLE': 'Olé', '7L': 'Siete Leguas',
    'DUB': 'Dubacano', 'DA': 'Dom. Abejas', 'R14': 'Rancho 14',
    'LLC': 'Llano Colorado', 'SG': 'San Gerónimo'
  },

  _renderRanchTabs() {
    const container = document.getElementById('ranch-tabs');
    if (!container) return;
    const codes = [...new Set(CONFIG.vineyardSections.map(s => s.ranchCode))];

    // Only rebuild if tab count changed; otherwise just toggle active class
    if (container.children.length === codes.length) {
      container.querySelectorAll('.ranch-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ranch === this.currentRanch);
      });
      return;
    }

    container.innerHTML = codes.map(code => {
      const label = this._ranchLabels[code] || code;
      const active = code === this.currentRanch ? ' active' : '';
      return `<button class="ranch-tab${active}" data-ranch="${code}">${label}</button>`;
    }).join('');
  },

  // ── Main render ──

  render() {
    this._renderRanchTabs();
    this.generateSVG(this.currentRanch, 'map-svg-container');
    this.renderLegend('map-color-scale');
    this._updateKPIs();
  },

  _updateKPIs() {
    const kpis = this.getRanchKPIs(this.currentRanch);
    const fmt = (v, d) => v !== null && v !== undefined ? (d === 0 ? Math.round(v) : Number(v).toFixed(d)) : '—';

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('map-kpi-samples', kpis.totalSamples);
    el('map-kpi-sections', `${kpis.sections}/${kpis.totalSections || 0}`);
    el('map-kpi-brix', fmt(kpis.avgBrix, 1));
    el('map-kpi-ph', fmt(kpis.avgPH, 2));
    el('map-kpi-ta', fmt(kpis.avgTA, 1));
  },

  // ── Event Handlers ──

  setRanch(ranchCode) {
    this.currentRanch = ranchCode;
    this.hideDetail();
    this.render();
  },

  setMetric(metric) {
    this.currentMetric = metric;
    const sel = document.getElementById('map-metric-select');
    if (sel) sel.value = metric;
    this.render();
  }
};
