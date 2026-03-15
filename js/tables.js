// ── Table Rendering ──

const Tables = {
  sortField: null,
  sortDir: 'desc',
  _lastBerryData: [],
  _lastWineData: [],
  _lastPrefermentData: [],
  _lastExtractionData: [],

  // Berry data table
  updateBerryTable(data) {
    const container = document.getElementById('berry-table-body');
    const countEl = document.getElementById('berry-table-count');
    if (!container) return;

    // Sort
    let sorted = [...data];
    if (this.sortField) {
      sorted.sort((a, b) => {
        let va = a[this.sortField];
        let vb = b[this.sortField];
        if (va === null || va === undefined) va = this.sortDir === 'asc' ? Infinity : -Infinity;
        if (vb === null || vb === undefined) vb = this.sortDir === 'asc' ? Infinity : -Infinity;
        if (typeof va === 'string') {
          return this.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return this.sortDir === 'asc' ? va - vb : vb - va;
      });
    } else {
      // Default: sort by date descending
      sorted.sort((a, b) => {
        if (!a.sampleDate || !b.sampleDate) return 0;
        return new Date(b.sampleDate) - new Date(a.sampleDate);
      });
    }

    const display = sorted.slice(0, 300);
    this._lastBerryData = sorted;
    if (countEl) {
      countEl.textContent = `${data.length} registros${data.length > 300 ? ' · mostrando 300' : ''}`;
    }

    container.innerHTML = display.map(d => {
      const varColor = CONFIG.varietyColors[d.variety] || '#888';
      const origColor = CONFIG.originColors[d.appellation] || '#888';
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${d.sampleId || '—'}</td>
        <td>${d.sampleDate || '—'}</td>
        <td>${d.vintage || '—'}</td>
        <td><span class="badge badge-variety" style="border-color:${varColor}55;color:${varColor}">${d.variety || '—'}</span></td>
        <td><span class="badge badge-origin" style="border-color:${origColor}55;color:${origColor}">${d.appellation || '—'}</span></td>
        <td class="${this.brixClass(d.brix)}">${d.brix !== null && d.brix !== undefined ? d.brix.toFixed(1) : '—'}</td>
        <td style="${this.phStyle(d.pH)}">${d.pH !== null && d.pH !== undefined ? d.pH.toFixed(2) : '—'}</td>
        <td>${d.ta !== null && d.ta !== undefined ? d.ta.toFixed(1) : '—'}</td>
        <td>${d.tANT !== null && typeof d.tANT === 'number' ? Math.round(d.tANT) : '—'}</td>
        <td>${d.berryFW !== null && d.berryFW !== undefined ? d.berryFW.toFixed(2) : '—'}</td>
        <td>${d.daysPostCrush !== null && d.daysPostCrush !== undefined ? d.daysPostCrush : '—'}</td>
      </tr>`;
    }).join('');
  },

  brixClass(v) {
    if (v === null || v === undefined) return '';
    if (v >= 24) return 'style="color:#E07070;font-weight:400"';
    if (v >= 21) return 'style="color:#7EC87A"';
    return 'style="color:var(--gold)"';
  },

  phStyle(v) {
    if (v === null || v === undefined) return '';
    if (v > 4.5) return 'color:var(--flag-error);font-weight:400';
    if (v > 3.9) return 'color:var(--flag-alert)';
    return '';
  },

  // Format numeric helper
  fmtNum(v, dec) {
    if (v === null || v === undefined || typeof v !== 'number' || isNaN(v)) return '—';
    return dec === 0 ? Math.round(v) : v.toFixed(dec);
  },

  // Wine reception table
  updateWineTable(data) {
    const container = document.getElementById('wine-table-body');
    const countEl = document.getElementById('wine-table-count');
    if (!container) return;

    if (countEl) countEl.textContent = `${data.length} registros`;
    this._lastWineData = data;

    container.innerHTML = data.map(d => {
      const varColor = CONFIG.varietyColors[d.variedad] || '#888';
      const origColor = CONFIG.originColors[d.proveedor] || '#888';
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${d.codigoBodega || '—'}</td>
        <td>${d.fecha || '—'}</td>
        <td>${d.tanque || '—'}</td>
        <td><span class="badge badge-variety" style="border-color:${varColor}55;color:${varColor}">${d.variedad || '—'}</span></td>
        <td><span class="badge badge-origin" style="border-color:${origColor}55;color:${origColor}">${d.proveedor || '—'}</span></td>
        <td style="font-size:10px;color:var(--muted)">${d.sampleType || '—'}</td>
        <td>${this.fmtNum(d.antoWX, 0)}</td>
        <td>${this.fmtNum(d.freeANT, 0)}</td>
        <td>${this.fmtNum(d.pTAN, 0)}</td>
        <td>${this.fmtNum(d.iptSpica, 0)}</td>
        <td>${d.daysPostCrush !== null && d.daysPostCrush !== undefined ? d.daysPostCrush : '—'}</td>
      </tr>`;
    }).join('');
  },

  // Prefermentative (Must) table
  updatePrefermentTable(data) {
    const container = document.getElementById('preferment-table-body');
    const countEl = document.getElementById('preferment-table-count');
    if (!container) return;

    if (countEl) countEl.textContent = `${data.length} registros`;
    this._lastPrefermentData = data;

    container.innerHTML = data.map(d => {
      const varColor = CONFIG.varietyColors[d.variedad] || '#888';
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${d.codigoBodega || '—'}</td>
        <td>${d.fecha || '—'}</td>
        <td>${d.tanque || '—'}</td>
        <td><span class="badge badge-variety" style="border-color:${varColor}55;color:${varColor}">${d.variedad || '—'}</span></td>
        <td>${d.proveedor || '—'}</td>
        <td>${this.fmtNum(d.antoWX, 0)}</td>
        <td>${this.fmtNum(d.freeANT, 0)}</td>
        <td>${this.fmtNum(d.pTAN, 0)}</td>
        <td>${this.fmtNum(d.iptSpica, 0)}</td>
        <td>${d.daysPostCrush !== null && d.daysPostCrush !== undefined ? d.daysPostCrush : '—'}</td>
      </tr>`;
    }).join('');
  },

  // Sort handler
  setSort(field) {
    if (this.sortField === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDir = 'desc';
    }
    // Update sort arrows in UI
    document.querySelectorAll('.data-table th .sort-arrow').forEach(el => {
      el.textContent = '';
    });
    const arrow = document.querySelector(`th[data-sort="${field}"] .sort-arrow`);
    if (arrow) {
      arrow.textContent = this.sortDir === 'asc' ? '▲' : '▼';
    }
    App.refresh();
  },

  exportCSV(type) {
    const configs = {
      bayas: {
        data: this._lastBerryData,
        filename: 'bayas_datos.csv',
        columns: [
          { key: 'sampleId', header: 'ID Muestra' },
          { key: 'sampleDate', header: 'Fecha' },
          { key: 'vintage', header: 'Vendimia' },
          { key: 'variety', header: 'Variedad' },
          { key: 'appellation', header: 'Origen' },
          { key: 'brix', header: 'Brix (°Bx)' },
          { key: 'pH', header: 'pH' },
          { key: 'ta', header: 'A.T. (g/L)' },
          { key: 'tANT', header: 'tANT (ppm)' },
          { key: 'berryFW', header: 'Peso Baya (g)' },
          { key: 'daysPostCrush', header: 'Días Post-Cosecha' }
        ]
      },
      vino: {
        data: this._lastWineData,
        filename: 'vino_recepcion.csv',
        columns: [
          { key: 'codigoBodega', header: 'Código Bodega' },
          { key: 'fecha', header: 'Fecha' },
          { key: 'tanque', header: 'Tanque' },
          { key: 'variedad', header: 'Variedad' },
          { key: 'proveedor', header: 'Proveedor' },
          { key: 'sampleType', header: 'Tipo Muestra' },
          { key: 'antoWX', header: 'Antocianinas WX' },
          { key: 'freeANT', header: 'fANT' },
          { key: 'pTAN', header: 'pTAN' },
          { key: 'iptSpica', header: 'IPT' },
          { key: 'daysPostCrush', header: 'Días Post-Cosecha' }
        ]
      },
      prefermentativos: {
        data: this._lastPrefermentData,
        filename: 'prefermentativos.csv',
        columns: [
          { key: 'codigoBodega', header: 'Código Bodega' },
          { key: 'fecha', header: 'Fecha' },
          { key: 'tanque', header: 'Tanque' },
          { key: 'variedad', header: 'Variedad' },
          { key: 'proveedor', header: 'Proveedor' },
          { key: 'antoWX', header: 'Antocianinas WX' },
          { key: 'freeANT', header: 'fANT' },
          { key: 'pTAN', header: 'pTAN' },
          { key: 'iptSpica', header: 'IPT' },
          { key: 'daysPostCrush', header: 'Días Post-Cosecha' }
        ]
      },
      extraccion: {
        data: this._lastExtractionData,
        filename: 'extraccion.csv',
        columns: [
          { key: 'variety', header: 'Variedad' },
          { key: 'appellation', header: 'Origen' },
          { key: 'berryTANT', header: 'tANT Baya (ppm)' },
          { key: 'wineTANT', header: 'tANT Vino (ppm)' },
          { key: 'extractionPct', header: 'Extracción (%)' }
        ]
      }
    };

    const cfg = configs[type];
    if (!cfg || !cfg.data.length) return;

    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const header = cfg.columns.map(c => escape(c.header)).join(',');
    const rows = cfg.data.map(d =>
      cfg.columns.map(c => escape(d[c.key])).join(',')
    );

    const csv = '\uFEFF' + header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cfg.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
