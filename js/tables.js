// ── Table Rendering ──

const Tables = {
  sortField: null,
  sortDir: 'desc',

  _esc(val) { return Utils.esc(val); },

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
        if (typeof va === 'string' && typeof vb === 'string') return this.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        if (typeof va === 'string') return this.sortDir === 'asc' ? 1 : -1;
        if (typeof vb === 'string') return this.sortDir === 'asc' ? -1 : 1;
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
    if (countEl) {
      countEl.textContent = `${data.length} registros${data.length > 300 ? ' · mostrando 300' : ''}`;
    }

    container.innerHTML = display.map(d => {
      const varColor = CONFIG.varietyColors[d.variety] || '#888';
      const origColor = CONFIG.resolveOriginColor(d.appellation);
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${this._esc(d.sampleId) || '—'}</td>
        <td>${d.sampleDate || '—'}</td>
        <td>${d.vintage || '—'}</td>
        <td><span class="badge badge-variety" style="border-color:${varColor}55;color:${varColor}">${this._esc(d.variety) || '—'}</span></td>
        <td><span class="badge badge-origin" style="border-color:${origColor}55;color:${origColor}">${this._esc(d.appellation) || '—'}</span></td>
        <td ${this.brixStyle(d.brix)}>${d.brix !== null && d.brix !== undefined ? d.brix.toFixed(1) : '—'}</td>
        <td style="${this.phStyle(d.pH)}">${d.pH !== null && d.pH !== undefined ? d.pH.toFixed(2) : '—'}</td>
        <td>${d.ta !== null && d.ta !== undefined ? d.ta.toFixed(1) : '—'}</td>
        <td>${d.tANT !== null && typeof d.tANT === 'number' ? Math.round(d.tANT) : '—'}</td>
        <td>${d.berryFW !== null && d.berryFW !== undefined ? d.berryFW.toFixed(2) : '—'}</td>
        <td>${d.daysPostCrush !== null && d.daysPostCrush !== undefined ? d.daysPostCrush : '—'}</td>
      </tr>`;
    }).join('');
  },

  brixStyle(v) {
    if (v === null || v === undefined) return '';
    if (v >= CONFIG.thresholds.brixHigh) return 'style="color:#E07070;font-weight:400"';
    if (v >= CONFIG.thresholds.brixMed) return 'style="color:#7EC87A"';
    return 'style="color:var(--gold)"';
  },

  phStyle(v) {
    if (v === null || v === undefined) return '';
    if (v > CONFIG.thresholds.phError) return 'color:var(--flag-error);font-weight:400';
    if (v > CONFIG.thresholds.phAlert) return 'color:var(--flag-alert)';
    return '';
  },

  fmtNum(v, dec) { return Utils.fmtNum(v, dec); },

  // Wine reception table
  updateWineTable(data) {
    const container = document.getElementById('wine-table-body');
    const countEl = document.getElementById('wine-table-count');
    if (!container) return;

    if (countEl) countEl.textContent = `${data.length} registros`;

    container.innerHTML = data.map(d => {
      const varColor = CONFIG.varietyColors[d.variedad] || '#888';
      const origColor = CONFIG.resolveOriginColor(d.proveedor);
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${this._esc(d.codigoBodega) || '—'}</td>
        <td>${d.fecha || '—'}</td>
        <td>${this._esc(d.tanque) || '—'}</td>
        <td><span class="badge badge-variety" style="border-color:${varColor}55;color:${varColor}">${this._esc(d.variedad) || '—'}</span></td>
        <td><span class="badge badge-origin" style="border-color:${origColor}55;color:${origColor}">${this._esc(d.proveedor) || '—'}</span></td>
        <td style="font-size:10px;color:var(--muted)">${this._esc(d.sampleType) || '—'}</td>
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

    container.innerHTML = data.map(d => {
      const varColor = CONFIG.varietyColors[d.variedad] || '#888';
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${this._esc(d.codigoBodega) || '—'}</td>
        <td>${d.fecha || '—'}</td>
        <td>${this._esc(d.tanque) || '—'}</td>
        <td><span class="badge badge-variety" style="border-color:${varColor}55;color:${varColor}">${this._esc(d.variedad) || '—'}</span></td>
        <td>${this._esc(d.proveedor) || '—'}</td>
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
  }
};
