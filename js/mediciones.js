// ── Mediciones Tecnicas — form, table, charts ──
import Chart from 'chart.js/auto';
import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { DemoMode } from './demoMode.js';
import { Charts } from './charts.js';

// ── Pure helpers (exported for tests; used by methods on Mediciones below) ──

export function collectDirty(initial, current) {
  const out = {};
  const keys = new Set([...Object.keys(initial || {}), ...Object.keys(current || {})]);
  for (const k of keys) {
    const a = initial?.[k];
    const b = current?.[k];
    // Treat null/undefined as equivalent so a never-touched blank field
    // doesn't register as dirty when the input emits an empty-string value.
    if ((a === null || a === undefined) && (b === null || b === undefined)) continue;
    if (a !== b) out[k] = b;
  }
  return out;
}

export function ariaSortFor(activeField, ascending, columnField) {
  if (activeField !== columnField) return null;
  return ascending ? 'ascending' : 'descending';
}

export function shouldShowSourceBanner(row) {
  return !!row && row.source === 'upload';
}

export const Mediciones = {
  _sortField: 'date',
  _sortAsc: false,

  initDropdowns() {
    const varietyEl = document.getElementById('med-variety');
    const originEl = document.getElementById('med-origin');
    if (!varietyEl || !originEl) return;

    const allVarieties = [...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white].sort();
    varietyEl.innerHTML = '<option value="">— Seleccionar —</option>' +
      allVarieties.map(v => `<option value="${v}">${v}</option>`).join('');

    const origins = Object.keys(CONFIG.originColors).sort();
    originEl.innerHTML = '<option value="">— Seleccionar —</option>' +
      origins.map(o => `<option value="${o}">${o}</option>`).join('');

    const dateEl = document.getElementById('med-date');
    if (dateEl && !dateEl.value) {
      dateEl.value = new Date().toISOString().split('T')[0];
    }
  },

  async submitForm() {
    const code = document.getElementById('med-code')?.value.trim();
    const date = document.getElementById('med-date')?.value;
    const vintage = parseInt(document.getElementById('med-vintage')?.value, 10);
    const variety = document.getElementById('med-variety')?.value;
    const appellation = document.getElementById('med-origin')?.value;
    const lotCode = document.getElementById('med-lot')?.value.trim() || null;
    const tons = parseFloat(document.getElementById('med-tons')?.value) || null;
    const weight = parseFloat(document.getElementById('med-weight')?.value) || null;
    const diameter = parseFloat(document.getElementById('med-diameter')?.value) || null;
    const grade = document.getElementById('med-grade')?.value || null;
    const phenolicMaturity = document.getElementById('med-phenolic-maturity')?.value || null;
    const measuredBy = document.getElementById('med-by')?.value.trim() || null;
    const notes = document.getElementById('med-notes')?.value.trim() || null;

    const hMadura = parseInt(document.getElementById('med-h-madura')?.value, 10) || 0;
    const hInmadura = parseInt(document.getElementById('med-h-inmadura')?.value, 10) || 0;
    const hSobremadura = parseInt(document.getElementById('med-h-sobremadura')?.value, 10) || 0;
    const hPicadura = parseInt(document.getElementById('med-h-picadura')?.value, 10) || 0;
    const hEnfermedad = parseInt(document.getElementById('med-h-enfermedad')?.value, 10) || 0;
    const hQuemadura = parseInt(document.getElementById('med-h-quemadura')?.value, 10) || 0;

    if (!code || !date || !vintage || !variety || !appellation) {
      this._setStatus('Campos obligatorios: codigo, fecha, vendimia, variedad, origen', 'error');
      return;
    }

    const berryTotal = hMadura + hInmadura + hSobremadura + hPicadura + hEnfermedad + hQuemadura;

    const row = {
      medicion_code: code,
      source: 'form',
      medicion_date: date,
      vintage_year: vintage,
      variety,
      appellation,
      lot_code: lotCode,
      tons_received: tons,
      berry_count_sample: berryTotal || null,
      berry_avg_weight_g: weight,
      berry_diameter_mm: diameter,
      health_grade: grade,
      health_madura: hMadura,
      health_inmadura: hInmadura,
      health_sobremadura: hSobremadura,
      health_picadura: hPicadura,
      health_enfermedad: hEnfermedad,
      health_quemadura: hQuemadura,
      phenolic_maturity: phenolicMaturity,
      measured_by: measuredBy,
      notes
    };

    const btn = document.querySelector('#medicion-form .btn-gold');
    if (btn) btn.disabled = true;
    this._setStatus('Guardando...', '');

    try {
      const token = localStorage.getItem('xanic_session_token');
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': token || ''
        },
        body: JSON.stringify({ table: 'mediciones_tecnicas', rows: [row] })
      });
      const data = await res.json();
      if (data.ok) {
        this._setStatus('Medicion guardada correctamente', 'success');
        document.getElementById('medicion-form')?.reset();
        const dateEl = document.getElementById('med-date');
        if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
        await DataStore.loadMediciones();
        this.refresh();
      } else {
        console.error('[Mediciones] Upload failed:', res.status, data);
        this._setStatus(data.error || `Error al guardar (${res.status})`, 'error');
      }
    } catch (e) {
      console.error('[Mediciones] Network error:', e);
      this._setStatus('Error de conexion: ' + e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  _setStatus(msg, type) {
    const el = document.getElementById('med-form-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'form-status' + (type ? ' ' + type : '');
  },

  // ── Edit modal ──
  _editing: null,        // the row being edited (deep-clone snapshot)
  _editingId: null,      // medicion_code (immutable while modal is open)

  openEditModal(medicion_code) {
    const row = (DataStore.medicionesData || []).find(r => r.code === medicion_code);
    if (!row) return;
    this._editing = JSON.parse(JSON.stringify(row));
    this._editingId = medicion_code;

    document.getElementById('med-edit-code').textContent = medicion_code;
    document.getElementById('med-edit-code-input').value = medicion_code;

    // Audit line
    const auditEl = document.getElementById('med-edit-audit');
    if (row.lastEditedAt) {
      const dt = new Date(row.lastEditedAt).toLocaleString('es-MX', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
      auditEl.textContent = `Última edición: ${dt}${row.lastEditedBy ? ' por ' + row.lastEditedBy : ''}`;
    } else {
      auditEl.textContent = 'Sin ediciones previas';
    }

    // Source banner
    const banner = document.getElementById('med-edit-source-banner');
    if (banner) banner.hidden = !shouldShowSourceBanner({ source: row.source });

    // Populate fields from the row
    document.getElementById('med-edit-date').value     = row.date || '';
    document.getElementById('med-edit-vintage').value  = row.vintage ?? '';
    this._populateEditDropdowns(row);
    document.getElementById('med-edit-lot').value      = row.lotCode || '';
    document.getElementById('med-edit-tons').value     = row.tons ?? '';
    document.getElementById('med-edit-weight').value   = row.berryWeight ?? '';
    document.getElementById('med-edit-diameter').value = row.berryDiameter ?? '';
    document.getElementById('med-edit-h-madura').value      = row.healthMadura      ?? 0;
    document.getElementById('med-edit-h-inmadura').value    = row.healthInmadura    ?? 0;
    document.getElementById('med-edit-h-sobremadura').value = row.healthSobremadura ?? 0;
    document.getElementById('med-edit-h-picadura').value    = row.healthPicadura    ?? 0;
    document.getElementById('med-edit-h-enfermedad').value  = row.healthEnfermedad  ?? 0;
    document.getElementById('med-edit-h-quemadura').value   = row.healthQuemadura   ?? 0;
    document.getElementById('med-edit-grade').value           = row.healthGrade      || '';
    document.getElementById('med-edit-phenolic-maturity').value = row.phenolicMaturity || '';
    document.getElementById('med-edit-by').value    = row.measuredBy || '';
    document.getElementById('med-edit-notes').value = row.notes      || '';

    this._editStatus('', '');
    this._refreshDirtyState();

    document.getElementById('med-edit-modal').showModal();
  },

  closeEditModal({ force = false } = {}) {
    const dirtyKeys = Object.keys(this._collectFormDirty());
    if (!force && dirtyKeys.length) {
      if (!confirm('Hay cambios sin guardar. ¿Descartar?')) return;
    }
    this._editing = null;
    this._editingId = null;
    document.getElementById('med-edit-modal').close();
  },

  _populateEditDropdowns(row) {
    const varietyEl = document.getElementById('med-edit-variety');
    const originEl  = document.getElementById('med-edit-origin');
    if (!varietyEl.options.length || varietyEl.options.length < 2) {
      const allVarieties = [...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white].sort();
      varietyEl.innerHTML = '<option value="">— Seleccionar —</option>' +
        allVarieties.map(v => `<option value="${v}">${v}</option>`).join('');
      const origins = Object.keys(CONFIG.originColors).sort();
      originEl.innerHTML = '<option value="">— Seleccionar —</option>' +
        origins.map(o => `<option value="${o}">${o}</option>`).join('');
    }
    varietyEl.value = row.variety || '';
    originEl.value  = row.appellation || '';
  },

  _editStatus(msg, type) {
    const el = document.getElementById('med-edit-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'form-status' + (type ? ' ' + type : '');
  },

  // Read current form values, mapped to the same shape as DataStore.medicionesData.
  _readEditForm() {
    const num = (id) => {
      const v = document.getElementById(id)?.value;
      return v === '' || v == null ? null : parseFloat(v);
    };
    const intv = (id) => {
      const v = document.getElementById(id)?.value;
      return v === '' || v == null ? null : parseInt(v, 10);
    };
    const str = (id) => {
      const v = document.getElementById(id)?.value;
      return v === '' || v == null ? null : v.trim();
    };
    return {
      date:           document.getElementById('med-edit-date').value || null,
      vintage:        intv('med-edit-vintage'),
      variety:        str('med-edit-variety'),
      appellation:    str('med-edit-origin'),
      lotCode:        str('med-edit-lot'),
      tons:           num('med-edit-tons'),
      berryWeight:    num('med-edit-weight'),
      berryDiameter: num('med-edit-diameter'),
      healthMadura:      intv('med-edit-h-madura')      ?? 0,
      healthInmadura:    intv('med-edit-h-inmadura')    ?? 0,
      healthSobremadura: intv('med-edit-h-sobremadura') ?? 0,
      healthPicadura:    intv('med-edit-h-picadura')    ?? 0,
      healthEnfermedad:  intv('med-edit-h-enfermedad')  ?? 0,
      healthQuemadura:   intv('med-edit-h-quemadura')   ?? 0,
      healthGrade:       str('med-edit-grade'),
      phenolicMaturity: str('med-edit-phenolic-maturity'),
      measuredBy: str('med-edit-by'),
      notes:      str('med-edit-notes'),
    };
  },

  // Compare current form against the snapshot taken at openEditModal.
  _collectFormDirty() {
    if (!this._editing) return {};
    return collectDirty(this._editing, this._readEditForm());
  },

  // Update Save button + dirty-class outlines on every input event.
  _refreshDirtyState() {
    const dirty = this._collectFormDirty();
    const saveBtn = document.getElementById('med-edit-save');
    if (saveBtn) saveBtn.disabled = Object.keys(dirty).length === 0;

    // Toggle .field-dirty on the form-group of each dirty input. Map of
    // dirty-row-key → DOM element id is tracked here for clarity.
    const fieldMap = {
      date: 'med-edit-date',                vintage: 'med-edit-vintage',
      variety: 'med-edit-variety',          appellation: 'med-edit-origin',
      lotCode: 'med-edit-lot',              tons: 'med-edit-tons',
      berryWeight: 'med-edit-weight',       berryDiameter: 'med-edit-diameter',
      healthMadura: 'med-edit-h-madura',    healthInmadura: 'med-edit-h-inmadura',
      healthSobremadura: 'med-edit-h-sobremadura', healthPicadura: 'med-edit-h-picadura',
      healthEnfermedad: 'med-edit-h-enfermedad',   healthQuemadura: 'med-edit-h-quemadura',
      healthGrade: 'med-edit-grade',        phenolicMaturity: 'med-edit-phenolic-maturity',
      measuredBy: 'med-edit-by',            notes: 'med-edit-notes',
    };
    Object.entries(fieldMap).forEach(([rowKey, inputId]) => {
      const el = document.getElementById(inputId);
      if (!el) return;
      const group = el.closest('.form-group');
      if (!group) return;
      group.classList.toggle('field-dirty', rowKey in dirty);
    });
  },

  async submitEdit() {
    if (!this._editingId) return;
    if (DemoMode.isActive()) {
      this._editStatus('Modo demo — no se pueden guardar cambios', 'error');
      return;
    }
    const dirty = this._collectFormDirty();
    if (!Object.keys(dirty).length) return;

    // Map UI keys → DB columns
    const dbRow = { medicion_code: this._editingId };
    if ('date'             in dirty) dbRow.medicion_date     = dirty.date;
    if ('vintage'          in dirty) dbRow.vintage_year      = dirty.vintage;
    if ('variety'          in dirty) dbRow.variety           = dirty.variety;
    if ('appellation'      in dirty) dbRow.appellation       = dirty.appellation;
    if ('lotCode'          in dirty) dbRow.lot_code          = dirty.lotCode;
    if ('tons'             in dirty) dbRow.tons_received     = dirty.tons;
    if ('berryWeight'      in dirty) dbRow.berry_avg_weight_g = dirty.berryWeight;
    if ('berryDiameter'    in dirty) dbRow.berry_diameter_mm = dirty.berryDiameter;
    if ('healthMadura'     in dirty) dbRow.health_madura     = dirty.healthMadura;
    if ('healthInmadura'   in dirty) dbRow.health_inmadura   = dirty.healthInmadura;
    if ('healthSobremadura' in dirty) dbRow.health_sobremadura = dirty.healthSobremadura;
    if ('healthPicadura'   in dirty) dbRow.health_picadura   = dirty.healthPicadura;
    if ('healthEnfermedad' in dirty) dbRow.health_enfermedad = dirty.healthEnfermedad;
    if ('healthQuemadura'  in dirty) dbRow.health_quemadura  = dirty.healthQuemadura;
    if ('healthGrade'      in dirty) dbRow.health_grade      = dirty.healthGrade;
    if ('phenolicMaturity' in dirty) dbRow.phenolic_maturity = dirty.phenolicMaturity;
    if ('measuredBy'       in dirty) dbRow.measured_by       = dirty.measuredBy;
    if ('notes'            in dirty) dbRow.notes             = dirty.notes;

    const saveBtn = document.getElementById('med-edit-save');
    if (saveBtn) saveBtn.disabled = true;
    this._editStatus('Guardando...', '');

    try {
      const token = localStorage.getItem('xanic_session_token');
      const res = await fetch('/api/row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
        body: JSON.stringify({ table: 'mediciones_tecnicas', action: 'update', row: dbRow }),
      });
      const data = await res.json();
      if (data.ok) {
        await DataStore.loadMediciones();   // re-fetch so the join with berry data re-runs
        this.refresh();
        this.closeEditModal({ force: true });
      } else {
        this._editStatus(data.error || `Error (${res.status})`, 'error');
        if (saveBtn) saveBtn.disabled = false;
      }
    } catch (e) {
      console.error('[Mediciones] submitEdit network error:', e);
      this._editStatus('Error de conexión: ' + e.message, 'error');
      if (saveBtn) saveBtn.disabled = false;
    }
  },

  async submitDelete() {
    if (!this._editingId) return;
    if (DemoMode.isActive()) {
      this._editStatus('Modo demo — no se pueden guardar cambios', 'error');
      return;
    }
    if (!confirm(`¿Eliminar medición ${this._editingId}? Esta acción no se puede deshacer.`)) return;

    this._editStatus('Eliminando...', '');
    try {
      const token = localStorage.getItem('xanic_session_token');
      const res = await fetch('/api/row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
        body: JSON.stringify({
          table: 'mediciones_tecnicas', action: 'delete',
          row: { medicion_code: this._editingId },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        await DataStore.loadMediciones();
        this.refresh();
        this.closeEditModal({ force: true });
      } else {
        this._editStatus(data.error || `Error (${res.status})`, 'error');
      }
    } catch (e) {
      console.error('[Mediciones] submitDelete network error:', e);
      this._editStatus('Error de conexión: ' + e.message, 'error');
    }
  },

  // ── Table ──

  renderTable(data) {
    const tbody = document.getElementById('med-table-body');
    const countEl = document.getElementById('med-table-count');
    const noData = document.getElementById('med-no-data');
    if (!tbody) return;

    if (countEl) countEl.textContent = `${data.length} registros`;
    if (noData) noData.style.display = data.length ? 'none' : '';

    const sorted = [...data].sort((a, b) => {
      let va = a[this._sortField], vb = b[this._sortField];
      if (va === null || va === undefined) va = '';
      if (vb === null || vb === undefined) vb = '';
      if (typeof va === 'number' && typeof vb === 'number') return this._sortAsc ? va - vb : vb - va;
      return this._sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });

    const esc = (s) => {
      if (s === null || s === undefined) return '—';
      const div = document.createElement('div');
      div.textContent = String(s);
      return div.innerHTML;
    };

    tbody.innerHTML = sorted.map(d => {
      const total = d.healthMadura + d.healthInmadura + d.healthSobremadura +
                    d.healthPicadura + d.healthEnfermedad + d.healthQuemadura;
      const pct = (v) => total > 0 ? ((v / total) * 100).toFixed(0) : 0;
      const bar = total > 0
        ? `<div class="health-mini-bar" title="Madura ${pct(d.healthMadura)}% | Inmadura ${pct(d.healthInmadura)}% | Sobremad. ${pct(d.healthSobremadura)}% | Picadura ${pct(d.healthPicadura)}% | Enferm. ${pct(d.healthEnfermedad)}% | Quemad. ${pct(d.healthQuemadura)}%">` +
          `<span class="hb-madura" style="width:${pct(d.healthMadura)}%"></span>` +
          `<span class="hb-inmadura" style="width:${pct(d.healthInmadura)}%"></span>` +
          `<span class="hb-sobremadura" style="width:${pct(d.healthSobremadura)}%"></span>` +
          `<span class="hb-picadura" style="width:${pct(d.healthPicadura)}%"></span>` +
          `<span class="hb-enfermedad" style="width:${pct(d.healthEnfermedad)}%"></span>` +
          `<span class="hb-quemadura" style="width:${pct(d.healthQuemadura)}%"></span>` +
          `</div>`
        : '—';
      return `<tr>
        <td>${esc(d.code)}</td>
        <td>${esc(d.date)}</td>
        <td>${esc(d.variety)}</td>
        <td>${esc(d.appellation)}</td>
        <td>${d.tons !== null ? d.tons.toFixed(2) : '—'}</td>
        <td>${d.berryWeight !== null ? d.berryWeight.toFixed(2) : '—'}</td>
        <td>${d.berryDiameter !== null ? d.berryDiameter.toFixed(1) : '—'}</td>
        <td>${bar}</td>
        <td>${esc(d.healthGrade)}</td>
        <td>${esc(this._madurezShort(d.phenolicMaturity))}</td>
      </tr>`;
    }).join('');
  },

  _madurezShort(v) {
    if (v === 'Sobresaliente')    return 'Sobr.';
    if (v === 'Parcial')          return 'Parc.';
    if (v === 'No sobresaliente') return 'No sobr.';
    return '—';
  },

  sortBy(field) {
    if (this._sortField === field) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortField = field;
      this._sortAsc = true;
    }
    this.refresh();
  },

  // ── KPIs ──

  updateKPIs(data) {
    const countEl = document.getElementById('med-kpi-count');
    const tonsEl = document.getElementById('med-kpi-tons');
    const weightEl = document.getElementById('med-kpi-weight');
    const healthEl = document.getElementById('med-kpi-health');

    if (countEl) countEl.textContent = data.length || '—';

    const totalTons = data.reduce((s, d) => s + (d.tons || 0), 0);
    if (tonsEl) tonsEl.textContent = totalTons > 0 ? totalTons.toFixed(1) + ' t' : '—';

    const weights = data.filter(d => d.berryWeight > 0).map(d => d.berryWeight);
    if (weightEl) weightEl.textContent = weights.length
      ? (weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(2) + ' g' : '—';

    const maduraPcts = data.map(d => {
      const total = d.healthMadura + d.healthInmadura + d.healthSobremadura +
                    d.healthPicadura + d.healthEnfermedad + d.healthQuemadura;
      return total > 0 ? (d.healthMadura / total) * 100 : null;
    }).filter(v => v !== null);
    if (healthEl) healthEl.textContent = maduraPcts.length
      ? (maduraPcts.reduce((a, b) => a + b, 0) / maduraPcts.length).toFixed(0) + '%' : '—';
  },

  // ── Refresh ──

  refresh() {
    const data = DataStore.medicionesData || [];
    this.updateKPIs(data);
    this.renderTable(data);
    this.renderCharts(data);
  },

  // ── Charts ──

  renderCharts(data) {
    this._chartTonnage(data);
    this._chartWeightTimeline(data);
    this._chartHealthDistribution(data);
  },

  _chartTonnage(data) {
    const canvasId = 'chartMedTons';
    if (Charts.instances[canvasId]) { Charts.instances[canvasId].destroy(); delete Charts.instances[canvasId]; }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const byVariety = {};
    data.forEach(d => {
      if (!d.tons) return;
      byVariety[d.variety] = (byVariety[d.variety] || 0) + d.tons;
    });

    const varieties = Object.keys(byVariety).sort((a, b) => byVariety[b] - byVariety[a]);
    if (!varieties.length) return;

    const colors = varieties.map(v => CONFIG.varietyColors[v] || '#888');

    try {
      Charts.instances[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: varieties,
          datasets: [{
            label: 'Toneladas',
            data: varieties.map(v => byVariety[v]),
            backgroundColor: colors.map(c => c + 'CC'),
            borderColor: colors,
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              title: { display: true, text: 'Toneladas', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9 } },
              grid: { color: CONFIG.chartDefaults.gridColor }
            },
            y: {
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 10 } },
              grid: { display: false }
            }
          }
        }
      });
    } catch (e) { console.error('[Mediciones] tonnage chart error:', e); }
  },

  _chartWeightTimeline(data) {
    const canvasId = 'chartMedWeight';
    if (Charts.instances[canvasId]) { Charts.instances[canvasId].destroy(); delete Charts.instances[canvasId]; }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const byVariety = {};
    data.forEach(d => {
      if (!d.berryWeight || !d.date) return;
      if (!byVariety[d.variety]) byVariety[d.variety] = [];
      byVariety[d.variety].push({ x: d.date, y: d.berryWeight });
    });

    const datasets = Object.keys(byVariety).sort().map(v => ({
      label: v,
      data: byVariety[v],
      backgroundColor: (CONFIG.varietyColors[v] || '#888') + 'CC',
      borderColor: CONFIG.varietyColors[v] || '#888',
      pointRadius: 5,
      pointHoverRadius: 7
    }));

    if (!datasets.length) return;

    try {
      Charts.instances[canvasId] = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, labels: { color: CONFIG.chartDefaults.tickColor, font: { size: 10 }, boxWidth: 12, padding: 8 } }
          },
          scales: {
            x: {
              type: 'category',
              title: { display: true, text: 'Fecha', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9 }, maxRotation: 45 },
              grid: { color: CONFIG.chartDefaults.gridColor }
            },
            y: {
              title: { display: true, text: 'Peso Baya (g)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9 } },
              grid: { color: CONFIG.chartDefaults.gridColor }
            }
          }
        }
      });
    } catch (e) { console.error('[Mediciones] weight chart error:', e); }
  },

  _chartHealthDistribution(data) {
    const canvasId = 'chartMedHealth';
    if (Charts.instances[canvasId]) { Charts.instances[canvasId].destroy(); delete Charts.instances[canvasId]; }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const categories = [
      { key: 'healthMadura',      label: 'Madura',      color: '#7EC87A' },
      { key: 'healthInmadura',    label: 'Inmadura',    color: '#60A8C0' },
      { key: 'healthSobremadura', label: 'Sobremadura', color: '#F5C542' },
      { key: 'healthPicadura',    label: 'Picadura',    color: '#E07060' },
      { key: 'healthEnfermedad',  label: 'Enfermedad',  color: '#9B59B6' },
      { key: 'healthQuemadura',   label: 'Quemadura',   color: '#E67E22' }
    ];

    const byVariety = {};
    data.forEach(d => {
      const total = d.healthMadura + d.healthInmadura + d.healthSobremadura +
                    d.healthPicadura + d.healthEnfermedad + d.healthQuemadura;
      if (total <= 0) return;
      if (!byVariety[d.variety]) byVariety[d.variety] = { count: 0 };
      const v = byVariety[d.variety];
      v.count++;
      categories.forEach(c => {
        v[c.key] = (v[c.key] || 0) + (d[c.key] / total) * 100;
      });
    });

    const varieties = Object.keys(byVariety).sort();
    if (!varieties.length) return;

    varieties.forEach(v => {
      categories.forEach(c => {
        byVariety[v][c.key] = byVariety[v][c.key] / byVariety[v].count;
      });
    });

    const datasets = categories.map(c => ({
      label: c.label,
      data: varieties.map(v => byVariety[v][c.key] || 0),
      backgroundColor: c.color + 'CC',
      borderColor: c.color,
      borderWidth: 1
    }));

    try {
      Charts.instances[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: { labels: varieties, datasets },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, labels: { color: CONFIG.chartDefaults.tickColor, font: { size: 10 }, boxWidth: 12, padding: 8 } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` } }
          },
          scales: {
            x: {
              stacked: true,
              max: 100,
              title: { display: true, text: '% Promedio', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9 }, callback: v => v + '%' },
              grid: { color: CONFIG.chartDefaults.gridColor }
            },
            y: {
              stacked: true,
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 10 } },
              grid: { display: false }
            }
          }
        }
      });
    } catch (e) { console.error('[Mediciones] health chart error:', e); }
  }
};
