// ── Map Store: SVG vineyard heatmaps with metric color coding ──

const MapStore = {
  currentRanch: 'VDG',
  currentMetric: 'brix',
  currentVintage: null,
  sectionData: {},        // sectionId → { brix, pH, ta, tonnage, ... }
  sectionLots: {},        // sectionId → [{ fieldLot, tonnage, ... }]
  detailOpen: false,

  // ── Field Lot → Section ID resolution ──

  resolveSection(fieldLot) {
    if (!fieldLot) return null;
    const lot = String(fieldLot).trim();

    // 1. Check explicit overrides
    if (CONFIG.fieldLotToSection[lot]) return CONFIG.fieldLotToSection[lot];

    // 2. Try stripping sub-lot suffixes and check again
    // e.g. CFVA-2B-S1 → CFVA-2B, CSKMP-S8-1-ABA → CSKMP-S8-1
    const stripped = lot.replace(/-S\d+$/, '').replace(/-[A-Z]+$/, '');
    if (CONFIG.fieldLotToSection[stripped]) return CONFIG.fieldLotToSection[stripped];

    // 3. Pattern-based extraction
    for (const p of CONFIG.fieldLotRanchPatterns) {
      const m = lot.match(p.regex);
      if (m) {
        let section = m[1];
        // Clean up section: remove sub-lot suffixes like -S1, -CONT, -R
        section = section.replace(/-S\d+$/, '').replace(/-(CONT|BIO|MAT|ABA|BIOTEKSA|R|RALEO|ALIVIO)$/i, '');
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
      ? data.filter(d => d.vintageYear === vintage || d.vintage_year === vintage)
      : data;

    for (const row of filtered) {
      const fieldLot = row.fieldLot || row.field_lot;
      const sectionId = this.resolveSection(fieldLot);
      if (!sectionId) continue;

      if (!this.sectionLots[sectionId]) this.sectionLots[sectionId] = [];
      this.sectionLots[sectionId].push(row);
    }

    // Compute weighted averages per section
    for (const [sectionId, lots] of Object.entries(this.sectionLots)) {
      const totalTonnage = lots.reduce((s, l) => s + (l.tonnage || 0), 0);
      const agg = { tonnage: totalTonnage, lotCount: lots.length };

      const chemFields = ['brix','pH','ta','ag','am','av','winexraySM','winexrayPR',
        'polyphenols','anthocyanins','ipt','pctAcceptable','pctDisease',
        'pctSeedsGreen','berryAvgWeight','clusterWeight'];

      for (const f of chemFields) {
        let sumW = 0, totalW = 0;
        for (const lot of lots) {
          const val = lot[f];
          const w = lot.tonnage || 1;
          if (val !== null && val !== undefined && !isNaN(val)) {
            sumW += val * w;
            totalW += w;
          }
        }
        agg[f] = totalW > 0 ? sumW / totalW : null;
      }

      // Integer count fields — simple sum
      const countFields = ['berriesPunctured','berriesDiseased','berriesImmature',
        'berriesMature','berriesOverripe','berriesRaisined','berriesAcceptable','berriesRejected',
        'seedsGreen','seedsVeined','seedsBrown'];
      for (const f of countFields) {
        agg[f] = lots.reduce((s, l) => s + (l[f] || 0), 0);
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

  // Generate schematic SVG map for a ranch
  generateSVG(ranchCode, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const sections = this._getSectionsForRanch(ranchCode);
    if (!sections.length) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">Sin secciones para este rancho</div>';
      return;
    }

    // Layout: grid of rectangular sections
    const layouts = this._getLayout(ranchCode, sections);
    const { cells, width, height } = layouts;

    const svgNS = 'http://www.w3.org/2000/svg';
    const padding = 20;
    const svgW = width + padding * 2;
    const svgH = height + padding * 2;

    let svg = `<svg xmlns="${svgNS}" viewBox="0 0 ${svgW} ${svgH}" class="vineyard-map-svg">`;

    for (const cell of cells) {
      const sectionId = cell.sectionId;
      const data = this.sectionData[sectionId];
      const metricVal = data ? data[this.currentMetric] : null;
      const fillColor = this.getColor(metricVal, this.currentMetric);
      const section = sections.find(s => s.sectionId === sectionId);
      const label = section ? section.sectionLabel : sectionId;
      const variety = section ? section.variety : '';

      const x = cell.x + padding;
      const y = cell.y + padding;

      svg += `<g class="map-section-group" data-section="${sectionId}" style="cursor:pointer" onclick="MapStore.showDetail('${sectionId}')">`;
      svg += `<rect x="${x}" y="${y}" width="${cell.w}" height="${cell.h}" fill="${fillColor}" stroke="var(--border-gold)" stroke-width="1.5" rx="2" class="section-rect"/>`;

      // Label
      const fontSize = Math.min(14, cell.w / 4);
      svg += `<text x="${x + cell.w/2}" y="${y + cell.h/2 - 4}" text-anchor="middle" fill="var(--white)" font-size="${fontSize}" font-family="Sackers Gothic Medium, sans-serif" font-weight="400">${label}</text>`;

      // Variety abbreviation
      const varSize = Math.min(9, cell.w / 6);
      svg += `<text x="${x + cell.w/2}" y="${y + cell.h/2 + varSize + 2}" text-anchor="middle" fill="var(--muted)" font-size="${varSize}" font-family="Sackers Gothic Medium, sans-serif">${variety}</text>`;

      // Value overlay
      if (metricVal !== null && metricVal !== undefined) {
        const valStr = metricVal >= 100 ? Math.round(metricVal) : metricVal.toFixed(1);
        svg += `<text x="${x + cell.w/2}" y="${y + cell.h - 6}" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="${varSize}" font-family="Sackers Gothic Medium, sans-serif">${valStr}</text>`;
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

  // Layout algorithms per ranch
  _getLayout(ranchCode, sections) {
    const cellW = 80;
    const cellH = 65;
    const gap = 4;

    switch (ranchCode) {
      case 'VDG': return this._layoutMX(sections, cellW, cellH, gap);
      case 'KMP': return this._layoutKompali(sections, cellW, cellH, gap);
      default:    return this._layoutGrid(sections, cellW, cellH, gap);
    }
  },

  // Monte Xanic: SB sections top rows, CS sections bottom rows (matching vineyard layout)
  _layoutMX(sections, w, h, gap) {
    const cells = [];
    // Row 1: 1A, 1B, 1C, 1D, 1E (SB + Caladoc)
    const row1 = ['MX-1A','MX-1B','MX-1C','MX-1D','MX-1E'];
    // Row 2: 2A, 2B, 2C, 3A, 3B
    const row2 = ['MX-2A','MX-2B','MX-2C','MX-3A','MX-3B'];
    // Row 3: 4A, 4B, 5A, 5B, 5C
    const row3 = ['MX-4A','MX-4B','MX-5A','MX-5B','MX-5C'];
    // Row 4: 6, 7A, 7B, 8
    const row4 = ['MX-6','MX-7A','MX-7B','MX-8'];
    // Row 5: 9, 10, 11A, 11B, 12
    const row5 = ['MX-9','MX-10','MX-11A','MX-11B','MX-12'];

    const rows = [row1, row2, row3, row4, row5];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const sid = rows[r][c];
        if (sections.find(s => s.sectionId === sid)) {
          cells.push({ sectionId: sid, x: c * (w + gap), y: r * (h + gap), w, h });
        }
      }
    }

    return { cells, width: 5 * (w + gap) - gap, height: rows.length * (h + gap) - gap };
  },

  // Kompali: S1-S8 in two columns or approximate position
  _layoutKompali(sections, w, h, gap) {
    const cells = [];
    const bigW = w * 1.5;
    const bigH = h * 1.2;

    // Two columns: left (S1-S4), right (S5-S8)
    const col1 = ['K-S1','K-S2A','K-S2B','K-S3A','K-S3B','K-S4'];
    const col2 = ['K-S5','K-S6','K-S7','K-S8'];

    for (let i = 0; i < col1.length; i++) {
      const sid = col1[i];
      if (sections.find(s => s.sectionId === sid)) {
        cells.push({ sectionId: sid, x: 0, y: i * (bigH + gap), w: bigW, h: bigH });
      }
    }
    for (let i = 0; i < col2.length; i++) {
      const sid = col2[i];
      if (sections.find(s => s.sectionId === sid)) {
        cells.push({ sectionId: sid, x: bigW + gap * 4, y: i * (bigH + gap), w: bigW, h: bigH });
      }
    }

    const totalH = Math.max(col1.length, col2.length) * (bigH + gap) - gap;
    return { cells, width: 2 * bigW + gap * 4, height: totalH };
  },

  // Generic grid layout for smaller ranchos
  _layoutGrid(sections, w, h, gap) {
    const cells = [];
    const cols = Math.min(sections.length, 4);
    for (let i = 0; i < sections.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      cells.push({ sectionId: sections[i].sectionId, x: col * (w + gap), y: row * (h + gap), w, h });
    }
    const rows = Math.ceil(sections.length / cols);
    return { cells, width: cols * (w + gap) - gap, height: rows * (h + gap) - gap };
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
        <button class="detail-close" onclick="MapStore.hideDetail()">&times;</button>
      </div>
      <div class="detail-body">
    `;

    if (data) {
      html += `
        <div class="detail-section-label">Métricas Agregadas</div>
        <div class="detail-metrics">
          <div class="detail-metric"><span class="dm-label">Tonelaje</span><span class="dm-value">${fmt(data.tonnage, 2)} ton</span></div>
          <div class="detail-metric"><span class="dm-label">Brix</span><span class="dm-value">${fmt(data.brix, 1)} °Bx</span></div>
          <div class="detail-metric"><span class="dm-label">pH</span><span class="dm-value">${fmt(data.pH, 2)}</span></div>
          <div class="detail-metric"><span class="dm-label">AT</span><span class="dm-value">${fmt(data.ta, 2)} g/L</span></div>
          <div class="detail-metric"><span class="dm-label">A.G.</span><span class="dm-value">${fmt(data.ag, 2)} g/L</span></div>
          <div class="detail-metric"><span class="dm-label">A.M.</span><span class="dm-value">${fmt(data.am, 2)} g/L</span></div>
          <div class="detail-metric"><span class="dm-label">A.V.</span><span class="dm-value">${fmt(data.av, 2)} g/L</span></div>
          <div class="detail-metric"><span class="dm-label">WX SM</span><span class="dm-value">${fmt(data.winexraySM, 0)}</span></div>
          <div class="detail-metric"><span class="dm-label">WX PR</span><span class="dm-value">${fmt(data.winexrayPR, 0)}</span></div>
          <div class="detail-metric"><span class="dm-label">Polifenoles</span><span class="dm-value">${fmt(data.polyphenols, 0)} mg/L</span></div>
          <div class="detail-metric"><span class="dm-label">Antocianinas</span><span class="dm-value">${fmt(data.anthocyanins, 0)} mg/L</span></div>
          <div class="detail-metric"><span class="dm-label">IPT</span><span class="dm-value">${fmt(data.ipt, 1)}</span></div>
          <div class="detail-metric"><span class="dm-label">% Aceptadas</span><span class="dm-value">${fmt(data.pctAcceptable, 1)}%</span></div>
          <div class="detail-metric"><span class="dm-label">% Enfermedad</span><span class="dm-value">${fmt(data.pctDisease, 1)}%</span></div>
          <div class="detail-metric"><span class="dm-label">% Semilla Verde</span><span class="dm-value">${fmt(data.pctSeedsGreen, 1)}%</span></div>
          <div class="detail-metric"><span class="dm-label">Peso Baya</span><span class="dm-value">${fmt(data.berryAvgWeight, 2)} g</span></div>
          <div class="detail-metric"><span class="dm-label">Peso Racimo</span><span class="dm-value">${fmt(data.clusterWeight, 0)} g</span></div>
        </div>
      `;

      // Berry condition breakdown
      if (data.berriesAcceptable || data.berriesRejected) {
        const total = (data.berriesAcceptable || 0) + (data.berriesRejected || 0);
        html += `
          <div class="detail-section-label" style="margin-top:16px">Condición de Bayas</div>
          <div class="detail-metrics">
            <div class="detail-metric"><span class="dm-label">Maduras</span><span class="dm-value">${data.berriesMature || 0}</span></div>
            <div class="detail-metric"><span class="dm-label">Sobremaduras</span><span class="dm-value">${data.berriesOverripe || 0}</span></div>
            <div class="detail-metric"><span class="dm-label">Inmaduras</span><span class="dm-value">${data.berriesImmature || 0}</span></div>
            <div class="detail-metric"><span class="dm-label">Enfermas</span><span class="dm-value">${data.berriesDiseased || 0}</span></div>
            <div class="detail-metric"><span class="dm-label">Picadas</span><span class="dm-value">${data.berriesPunctured || 0}</span></div>
            <div class="detail-metric"><span class="dm-label">Pasas</span><span class="dm-value">${data.berriesRaisined || 0}</span></div>
          </div>
        `;
      }

      // Seed maturity
      if (data.seedsGreen || data.seedsVeined || data.seedsBrown) {
        html += `
          <div class="detail-section-label" style="margin-top:16px">Madurez de Semilla</div>
          <div class="detail-metrics">
            <div class="detail-metric"><span class="dm-label">Verde</span><span class="dm-value">${data.seedsGreen || 0}</span></div>
            <div class="detail-metric"><span class="dm-label">Veteada</span><span class="dm-value">${data.seedsVeined || 0}</span></div>
            <div class="detail-metric"><span class="dm-label">Café</span><span class="dm-value">${data.seedsBrown || 0}</span></div>
          </div>
        `;
      }
    } else {
      html += '<div style="padding:20px;color:var(--muted);text-align:center">Sin datos para esta sección</div>';
    }

    // Sub-lot breakdown
    if (lots.length > 0) {
      html += `<div class="detail-section-label" style="margin-top:16px">Lotes de Campo (${lots.length})</div>`;
      html += '<div class="detail-lots-table"><table class="data-table"><thead><tr><th>Lote</th><th>Ton</th><th>Brix</th><th>pH</th><th>AT</th></tr></thead><tbody>';
      for (const lot of lots) {
        html += `<tr>
          <td style="color:var(--gold-lt)">${lot.fieldLot || lot.field_lot || '—'}</td>
          <td>${fmt(lot.tonnage, 2)}</td>
          <td>${fmt(lot.brix, 1)}</td>
          <td>${fmt(lot.pH, 2)}</td>
          <td>${fmt(lot.ta, 2)}</td>
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

    if (!relevantData.length) return { tonnage: 0, sections: 0, avgBrix: null, avgPH: null };

    const totalTonnage = relevantData.reduce((s, d) => s + (d.tonnage || 0), 0);
    const sectionsWithData = relevantData.length;

    const avg = (field) => {
      const vals = relevantData.filter(d => d[field] !== null && d[field] !== undefined).map(d => d[field]);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    return {
      tonnage: totalTonnage,
      sections: sectionsWithData,
      totalSections: sections.length,
      avgBrix: avg('brix'),
      avgPH: avg('pH'),
      avgTA: avg('ta'),
      avgPctAcceptable: avg('pctAcceptable')
    };
  },

  // ── Main render ──

  render() {
    this.generateSVG(this.currentRanch, 'map-svg-container');
    this.renderLegend('map-color-scale');
    this._updateKPIs();
  },

  _updateKPIs() {
    const kpis = this.getRanchKPIs(this.currentRanch);
    const fmt = (v, d) => v !== null && v !== undefined ? (d === 0 ? Math.round(v) : Number(v).toFixed(d)) : '—';

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('map-kpi-tonnage', fmt(kpis.tonnage, 1));
    el('map-kpi-sections', `${kpis.sections}/${kpis.totalSections || 0}`);
    el('map-kpi-brix', fmt(kpis.avgBrix, 1));
    el('map-kpi-ph', fmt(kpis.avgPH, 2));
    el('map-kpi-ta', fmt(kpis.avgTA, 1));
    el('map-kpi-acceptable', kpis.avgPctAcceptable !== null ? fmt(kpis.avgPctAcceptable, 1) + '%' : '—');
  },

  // ── Event Handlers ──

  setRanch(ranchCode) {
    this.currentRanch = ranchCode;
    // Update ranch tab active state
    document.querySelectorAll('.ranch-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.ranch === ranchCode);
    });
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
