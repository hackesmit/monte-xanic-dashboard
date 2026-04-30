// ── Table Rendering ──
import { CONFIG } from './config.js';
import { App } from './app.js';
import { Auth } from './auth.js';
import { DemoMode } from './demoMode.js';

export const Tables = {
  sortField: null,
  sortDir: 'desc',

  _esc(val) {
    if (val == null) return '';
    const d = document.createElement('div');
    d.textContent = String(val);
    return d.innerHTML;
  },

  // Berry data table
  updateBerryTable(data) {
    const container = document.getElementById('berry-table-body');
    const countEl = document.getElementById('berry-table-count');
    if (!container) return;

    if (!data.length) {
      container.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:24px;font-style:italic">No hay datos para los filtros seleccionados</td></tr>';
      if (countEl) countEl.textContent = '0 registros';
      const footnoteEl = document.getElementById('berry-table-footnote');
      if (footnoteEl) footnoteEl.style.display = 'none';
      return;
    }

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

    let hasBelowDetection = false;
    const editable = Auth.canWrite() && !DemoMode.isActive();
    container.innerHTML = display.map(d => {
      const varColor = CONFIG.varietyColors[d.variety] || '#888';
      const origColor = CONFIG.resolveOriginColor(d.appellation);
      const bdMark = d.belowDetection ? '<span title="Valores bajo límite de detección" style="color:var(--gold);cursor:help"> †</span>' : '';
      const editMark = (editable && d.lastEditedAt) ? '<span title="Editado" style="color:var(--gold);margin-left:4px">✎</span>' : '';
      if (d.belowDetection) hasBelowDetection = true;
      const trAttrs = editable
        ? `class="row-clickable" data-sample-id="${this._esc(d.sampleId)}" data-sample-date="${this._esc(d.sampleDate)}" data-sample-seq="${this._esc(d.sampleSeq)}"`
        : '';
      return `<tr ${trAttrs}>
        <td style="font-weight:400;color:var(--gold-lt)">${this._esc(d.sampleId) || '—'}${bdMark}${editMark}</td>
        <td>${this._esc(d.sampleDate) || '—'}</td>
        <td>${this._esc(d.vintage) || '—'}</td>
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

    // Below-detection footnote
    const footnoteEl = document.getElementById('berry-table-footnote');
    if (footnoteEl) footnoteEl.style.display = hasBelowDetection ? '' : 'none';
  },

  brixStyle(v) {
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

    if (!data.length) {
      container.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:24px;font-style:italic">No hay datos para los filtros seleccionados</td></tr>';
      if (countEl) countEl.textContent = '0 registros';
      return;
    }

    if (countEl) countEl.textContent = `${data.length} registros`;

    container.innerHTML = data.map(d => {
      const varColor = CONFIG.varietyColors[d.variedad] || '#888';
      const origColor = CONFIG.resolveOriginColor(d.proveedor);
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${this._esc(d.codigoBodega) || '—'}</td>
        <td>${this._esc(d.fecha) || '—'}</td>
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

    if (!data.length) {
      container.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px;font-style:italic">No hay datos para los filtros seleccionados</td></tr>';
      if (countEl) countEl.textContent = '0 registros';
      return;
    }

    if (countEl) countEl.textContent = `${data.length} registros`;

    container.innerHTML = data.map(d => {
      const varColor = CONFIG.varietyColors[d.variedad] || '#888';
      return `<tr>
        <td style="font-weight:400;color:var(--gold-lt)">${this._esc(d.codigoBodega) || '—'}</td>
        <td>${this._esc(d.fecha) || '—'}</td>
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
