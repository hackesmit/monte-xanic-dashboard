// ── Mediciones Tecnicas — form, table, charts ──
import Chart from 'chart.js/auto';
import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { DemoMode } from './demoMode.js';
import { Charts } from './charts.js';
import { Filters } from './filters.js';
import { Identity } from './identity.js';
import { Auth } from './auth.js';
import { attachModalHygiene } from './modalHygiene.js';
import {
  scoreFromMedicion,
  averageEvaluations,
  canonicalSanitaryLabel,
  consensusSanitaryLabel,
  consensusMadurezLabel,
} from './classification.js';
import { escapeHtml } from './utils.js';
import { MAX_EVALUADORES } from './quality-scale.js';

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

// Evaluator panel (Vendimia 2026).
//
// Grado Sanitario and Madurez fenolica used to be one dropdown each. Daniel
// asked for as many evaluators as the tasting needs, with the average of all
// of them driving the quality weighting, so both axes became a repeatable
// row. The panel is rendered from state rather than read from the DOM, so
// adding or removing a person never depends on the markup already present.

// Blank means "this evaluator did not grade this axis". It is deliberately
// distinct from 'Contaminado' (0) and 'No sobresaliente' (-3), which are
// grades, so a person who only judged one axis does not drag the other down.
const SIN_EVALUAR = '';

export function evaluadorPanelOptions() {
  return {
    sanidad: Object.keys(CONFIG.sanitaryThresholds.visual),
    madurez: Object.keys(CONFIG.madurezOverlay),
  };
}

// Always hands back at least one row, so the form opens ready to type in.
export function normalizeEvaluadorPanel(panel) {
  const rows = (Array.isArray(panel) ? panel : [])
    .filter(e => e && typeof e === 'object')
    .map(e => ({
      evaluador: e.evaluador ?? null,
      sanidad:   e.sanidad   ?? null,
      madurez:   e.madurez   ?? null,
    }));
  return rows.length ? rows : [{ evaluador: null, sanidad: null, madurez: null }];
}

// Builds the panel the edit modal opens with.
//
// The engine falls back to a legacy scalar for any axis the panel leaves
// empty, per axis and independently. The modal has to seed the same way or it
// quietly destroys data: a row whose panel grades only sanidad, with madurez
// living on the old phenolic_maturity column, would otherwise open showing no
// madurez, derive null for it, mark the field dirty, and wipe a +3 the user
// never touched. Reported by lucy in review on 2026-08-12.
//
// Labels are canonicalised because the selects only offer the 2026 vocabulary:
// handed a pre-2026 label, a select matches no option and falls back to blank,
// losing a grade that is on record.
export function seedEvaluadorPanel(evaluaciones, healthGrade, phenolicMaturity) {
  // canonicalSanitaryLabel returns null for a label it cannot place, so fall
  // back to the raw value: renaming a legacy label is the point, discarding an
  // unrecognised one is not.
  const keepSanidad = (v) => canonicalSanitaryLabel(v) ?? (v || null);
  const panel = (Array.isArray(evaluaciones) ? evaluaciones : []).map(e => ({
    evaluador: e?.evaluador ?? null,
    sanidad:   keepSanidad(e?.sanidad),
    madurez:   e?.madurez ?? null,
  }));
  if (!panel.length) {
    return [{
      evaluador: null,
      sanidad:   keepSanidad(healthGrade),
      madurez:   phenolicMaturity || null,
    }];
  }
  // Graft each orphaned scalar onto the first row, matching the engine's
  // own per-axis fallback rule so the form and the score agree.
  if (!panel.some(e => e.sanidad)) {
    const s = keepSanidad(healthGrade);
    if (s) panel[0].sanidad = s;
  }
  if (!panel.some(e => e.madurez)) {
    if (phenolicMaturity) panel[0].madurez = phenolicMaturity;
  }
  return panel;
}

// Drops rows nobody filled in, so an untouched spare row never reaches the DB.
export function compactEvaluadorPanel(panel) {
  return (Array.isArray(panel) ? panel : []).filter(
    e => e && (e.evaluador || e.sanidad || e.madurez)
  );
}

// One-line summary of where the panel landed, shown under the rows so the
// person entering data sees the number the score will actually use.
export function evaluadorPanelSummary(panel) {
  const compact = compactEvaluadorPanel(panel);
  if (!compact.length) return 'Sin evaluaciones';
  const avg = averageEvaluations({ evaluaciones: compact });
  const parts = [];
  if (avg.sanidad === null) {
    parts.push('Sanidad: sin calificar');
  } else {
    parts.push(`Sanidad: ${avg.sanidad.toFixed(2)} de 4 (${consensusSanitaryLabel(avg.sanidad)})`);
  }
  if (avg.madurez === null) {
    parts.push('Madurez: sin calificar');
  } else {
    const signed = avg.madurez > 0 ? `+${avg.madurez.toFixed(2)}` : avg.madurez.toFixed(2);
    parts.push(`Madurez: ${signed} (${consensusMadurezLabel(avg.madurez)})`);
  }
  // Everyone who graded at least one axis, not the larger of the two axis
  // counts, which under-reports a panel where different people covered
  // different axes (lucy, 2026-08-12).
  const n = avg.evaluadorCount;
  parts.push(`${n} ${n === 1 ? 'evaluador' : 'evaluadores'}`);
  return parts.join(' · ');
}

// Narrows an edit snapshot to the fields the form actually owns.
//
// The snapshot is a deep clone of the whole DataStore row, so it also carries
// keys the form never produces: identity (id, code), provenance (source) and
// audit (lastEditedAt, lastEditedBy). collectDirty unions the keys of both
// sides, so every one of those counted as a permanent edit. The effect was a
// Save button lit from the moment the modal opened and a discard prompt on a
// modal nobody had touched, which trains people to dismiss the prompt without
// reading it. Comparing only the form's own fields fixes the whole class,
// including any column a future migration adds to the row.
export function projectSnapshot(snapshot, current) {
  const out = {};
  for (const k of Object.keys(current || {})) out[k] = snapshot?.[k];
  return out;
}

// Adds `value` to a <select> as its own option when the list does not already
// offer it, so an unrecognised stored value stays visible and intact instead
// of collapsing to blank. Returns true when it had to add one.
export function ensureOption(selectEl, value) {
  if (!selectEl || !value) return false;
  const v = String(value);
  if ([...selectEl.options].some(o => o.value === v)) return false;
  const opt = document.createElement('option');
  opt.value = v;
  opt.textContent = `${v} (no reconocido)`;
  selectEl.appendChild(opt);
  return true;
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

  // Search state — populated by events.js on input.
  _searchTerm: '',

  // Evaluator panel state, keyed by the container id so the new-medicion form
  // and the edit modal each keep their own. Rendered from here, never read
  // back out of the DOM for structure.
  _panels: {},

  // Renders one evaluator panel and its running average.
  renderEvaluadores(panelId, panel) {
    const host = document.getElementById(panelId);
    if (!host) return;
    if (panel) this._panels[panelId] = normalizeEvaluadorPanel(panel);
    const rows = this._panels[panelId] || normalizeEvaluadorPanel(null);
    this._panels[panelId] = rows;

    const { sanidad, madurez } = evaluadorPanelOptions();
    // A label the vocabulary does not know (a typo carried in from a
    // workbook, say) still gets an option of its own, marked as such and
    // pre-selected. Without it the select falls back to blank, and the next
    // unrelated edit to the row saves that blank over the original
    // evaluation, destroying it (lucy, 2026-08-12). The engine already
    // ignores the label for scoring; this only keeps it visible and intact
    // until somebody corrects it on purpose.
    const opts = (list, selected) => {
      const unknown = selected && !list.includes(selected);
      return '<option value="">(Sin calificar)</option>' +
        (unknown
          ? `<option value="${escapeHtml(selected)}" selected>` +
            `${escapeHtml(selected)} (no reconocido)</option>`
          : '') +
        list.map(v => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>` +
                      `${escapeHtml(v)}</option>`).join('');
    };

    host.innerHTML = rows.map((e, i) => `
      <div class="evaluador-row" data-panel="${escapeHtml(panelId)}" data-index="${i}">
        <div class="form-group">
          <label>Evaluador ${i + 1}</label>
          <input type="text" data-field="evaluador" placeholder="Nombre"
                 value="${escapeHtml(e.evaluador ?? '')}">
        </div>
        <div class="form-group">
          <label>Grado Sanitario</label>
          <select data-field="sanidad">${opts(sanidad, e.sanidad ?? SIN_EVALUAR)}</select>
        </div>
        <div class="form-group">
          <label>Madurez Fenólica</label>
          <select data-field="madurez">${opts(madurez, e.madurez ?? SIN_EVALUAR)}</select>
        </div>
        <button type="button" class="evaluador-remove" data-action="evaluador-remove"
                data-panel="${escapeHtml(panelId)}" data-index="${i}"
                title="Quitar evaluador" aria-label="Quitar evaluador ${i + 1}"
                ${rows.length === 1 ? 'disabled' : ''}>Quitar</button>
      </div>`).join('');

    this._updateEvaluadorSummary(panelId);
  },

  _updateEvaluadorSummary(panelId) {
    const rows = this._panels[panelId] || [];
    const el = document.getElementById(`${panelId}-avg`);
    if (el) el.textContent = evaluadorPanelSummary(rows);
    const addBtn = document.querySelector(
      `[data-action="evaluador-add"][data-panel="${panelId}"]`);
    if (addBtn) {
      const full = rows.length >= MAX_EVALUADORES;
      addBtn.disabled = full;
      addBtn.title = full ? `Maximo ${MAX_EVALUADORES} evaluadores` : '';
    }
  },

  // Pulls the typed values back into panel state. Called on every input so
  // the average, the dirty check, and the live score all see current values.
  syncEvaluadores(panelId) {
    const host = document.getElementById(panelId);
    if (!host) return [];
    const rows = [...host.querySelectorAll('.evaluador-row')].map(row => {
      const val = (field) => {
        const el = row.querySelector(`[data-field="${field}"]`);
        const v = el ? String(el.value).trim() : '';
        return v === '' ? null : v;
      };
      return { evaluador: val('evaluador'), sanidad: val('sanidad'), madurez: val('madurez') };
    });
    this._panels[panelId] = rows.length ? rows : normalizeEvaluadorPanel(null);
    this._updateEvaluadorSummary(panelId);
    return this._panels[panelId];
  },

  addEvaluador(panelId) {
    this.syncEvaluadores(panelId);
    const rows = this._panels[panelId] || [];
    // The server caps the stored panel, so the form caps at the same number.
    // Letting the UI run past it would average over rows the database drops,
    // leaving the score shown before saving different from the one after.
    if (rows.length >= MAX_EVALUADORES) return;
    rows.push({ evaluador: null, sanidad: null, madurez: null });
    this.renderEvaluadores(panelId, rows);
    // Put the cursor in the name field of the row just added.
    const host = document.getElementById(panelId);
    host?.querySelector('.evaluador-row:last-child [data-field="evaluador"]')?.focus();
  },

  removeEvaluador(panelId, index) {
    this.syncEvaluadores(panelId);
    const rows = this._panels[panelId] || [];
    if (rows.length <= 1) return;   // the last row is cleared, never removed
    rows.splice(index, 1);
    this.renderEvaluadores(panelId, rows);
  },

  // The panel as it should reach the database: spare rows dropped.
  readEvaluadores(panelId) {
    this.syncEvaluadores(panelId);
    return compactEvaluadorPanel(this._panels[panelId] || []);
  },

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

    // One empty evaluator row, so the panel is ready to type into.
    this.renderEvaluadores('med-evaluadores', null);
  },

  async submitForm() {
    if (DemoMode.isActive()) {
      this._setStatus('Modo demo — no se pueden guardar cambios', 'error');
      return;
    }
    const code = document.getElementById('med-code')?.value.trim();
    const date = document.getElementById('med-date')?.value;
    const vintage = parseInt(document.getElementById('med-vintage')?.value, 10);
    const variety = document.getElementById('med-variety')?.value;
    const appellation = document.getElementById('med-origin')?.value;
    const lotCode = document.getElementById('med-lot')?.value.trim() || null;
    const tons = parseFloat(document.getElementById('med-tons')?.value) || null;
    const weight = parseFloat(document.getElementById('med-weight')?.value) || null;
    const diameter = parseFloat(document.getElementById('med-diameter')?.value) || null;
    // Vendimia 2026: both qualitative axes come from the evaluator panel. The
    // scalar columns are written alongside it as the consensus label so the
    // table, the map tooltips, and the exports keep a value to show; the panel
    // stays the source of truth and the engine prefers it.
    const evaluaciones = this.readEvaluadores('med-evaluadores');
    const panelAvg = averageEvaluations({ evaluaciones });
    const grade = consensusSanitaryLabel(panelAvg.sanidad);
    const phenolicMaturity = consensusMadurezLabel(panelAvg.madurez);
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
      evaluaciones,
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
        // form.reset() only restores the markup's initial values, and the
        // panel's rows are generated, so it has to be rebuilt explicitly.
        this._panels['med-evaluadores'] = null;
        this.renderEvaluadores('med-evaluadores', null);
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

    // The panel is an array, and collectDirty compares with !==, so it is
    // compared as a canonical JSON string instead. The snapshot is seeded with
    // exactly what readEvaluadores will return for the freshly rendered panel,
    // so simply opening the modal never registers as an edit.
    // The seed is canonicalised because the selects only offer the 2026
    // vocabulary: handed a pre-2026 label, the select matches no option and
    // silently falls back to blank, losing a grade that is on record. The
    // snapshot is canonicalised to the same value so a row the SQL migration
    // has not reached does not read as dirty the moment the modal opens.
    const seed = compactEvaluadorPanel(
      seedEvaluadorPanel(row.evaluaciones, row.healthGrade, row.phenolicMaturity)
    );
    this._editing.evaluacionesJson = JSON.stringify(seed);
    this._editing.healthGrade = canonicalSanitaryLabel(row.healthGrade);
    this._seededPanel = seed;
    // The raw array stays on the snapshot for the live-score fallback. It is
    // not compared: evaluacionesJson is the comparable representation, and
    // projectSnapshot only compares fields the form itself produces.

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
    // A row written before the panel existed has only the two scalars; seed
    // the panel from them so opening the modal shows the grade already on
    // record instead of an empty form.
    this.renderEvaluadores('med-edit-evaluadores', this._seededPanel);
    document.getElementById('med-edit-by').value    = row.measuredBy || '';
    document.getElementById('med-edit-notes').value = row.notes      || '';

    this._editStatus('', '');
    this._refreshDirtyState();

    const modal = document.getElementById('med-edit-modal');
    modal.showModal();
    // ESC + backdrop click are wired in js/events.js (route through closeEditModal
    // to fire dirty-state confirm). Hygiene helper handles scroll lock, focus
    // trap, and autofocus only.
    attachModalHygiene(modal, { firstFieldId: 'med-edit-date' });
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
    // A stored value that is not among the options would leave the select
    // blank, and the blank then reads as an edit and saves null over a real
    // value on the next unrelated change. Same failure the evaluator panel
    // had with pre-2026 labels, so it gets the same treatment: keep the
    // value as its own option, marked, until somebody changes it on purpose.
    ensureOption(varietyEl, row.variety);
    ensureOption(originEl, row.appellation);
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
      // Derived from the panel, not from their own inputs: the two dropdowns
      // they used to come from are gone. They still travel to the database so
      // the readers that predate the panel keep a label to display.
      ...(() => {
        const evaluaciones = this.readEvaluadores('med-edit-evaluadores');
        const avg = averageEvaluations({ evaluaciones });
        return {
          healthGrade:       consensusSanitaryLabel(avg.sanidad),
          phenolicMaturity:  consensusMadurezLabel(avg.madurez),
          evaluacionesJson:  JSON.stringify(evaluaciones),
        };
      })(),
      measuredBy: str('med-edit-by'),
      notes:      str('med-edit-notes'),
    };
  },

  // Compare current form against the snapshot taken at openEditModal.
  _collectFormDirty() {
    if (!this._editing) return {};
    const current = this._readEditForm();
    return collectDirty(projectSnapshot(this._editing, current), current);
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
      measuredBy: 'med-edit-by',            notes: 'med-edit-notes',
    };
    // healthGrade and phenolicMaturity are absent on purpose: they no longer
    // have inputs of their own, so there is no form-group to outline. The
    // panel signals its own changes through the running average beneath it.
    Object.entries(fieldMap).forEach(([rowKey, inputId]) => {
      const el = document.getElementById(inputId);
      if (!el) return;
      const group = el.closest('.form-group');
      if (!group) return;
      group.classList.toggle('field-dirty', rowKey in dirty);
    });

    // Live re-score the calidad badge based on current form values.
    this._updateLiveScore();
  },

  // Build a synthetic medicion from current form values so the live grade
  // reflects unsaved edits, then re-run scoreFromMedicion using the berry
  // index captured during refresh().
  _updateLiveScore() {
    const el = document.getElementById('med-edit-score');
    if (!el) return;
    const editing = this._editing || {};
    const form = this._readEditForm();
    const synthetic = {
      // Keep berry-lookup keys + rubric inputs from the saved snapshot if the
      // form lacks them (e.g., lotCode lives on snapshot only — though the
      // edit form does expose it as 'med-edit-lot', prefer form value when set).
      lotCode:     form.lotCode     ?? editing.lotCode,
      vintage:     form.vintage     ?? editing.vintage,
      variety:     form.variety     ?? editing.variety,
      appellation: form.appellation ?? editing.appellation,
      tons:              form.tons              ?? editing.tons,
      healthGrade:       form.healthGrade       ?? editing.healthGrade,
      healthMadura:      form.healthMadura      ?? editing.healthMadura,
      healthInmadura:    form.healthInmadura    ?? editing.healthInmadura,
      healthSobremadura: form.healthSobremadura ?? editing.healthSobremadura,
      healthPicadura:    form.healthPicadura    ?? editing.healthPicadura,
      healthEnfermedad:  form.healthEnfermedad  ?? editing.healthEnfermedad,
      healthQuemadura:   form.healthQuemadura   ?? editing.healthQuemadura,
      phenolicMaturity:  form.phenolicMaturity  ?? editing.phenolicMaturity,
      // The engine prefers the panel, so the live badge reacts to an evaluator
      // being added, removed, or re-graded, not just to the consensus label.
      evaluaciones:      JSON.parse(form.evaluacionesJson || '[]'),
    };
    const score = scoreFromMedicion(synthetic, this._berryByLot);
    el.innerHTML = this._renderGradeBadge(score);
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
    // The panel and its two derived labels travel together, so a reader that
    // only knows the scalars can never disagree with the engine, which reads
    // the panel. Lucy flagged this drift in review on 2026-08-12.
    if ('evaluacionesJson' in dirty) {
      dbRow.evaluaciones      = JSON.parse(dirty.evaluacionesJson);
      dbRow.health_grade      = this._readEditForm().healthGrade;
      dbRow.phenolic_maturity = this._readEditForm().phenolicMaturity;
    }
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
    if (noData) {
      noData.style.display = data.length ? 'none' : '';
      const hasFilter = (Filters.state?.vintages?.size || Filters.state?.varieties?.size ||
                        Filters.state?.origins?.size || Filters.state?.lots?.size ||
                        (this._searchTerm || '').trim().length > 0);
      noData.textContent = hasFilter
        ? 'No hay mediciones que coincidan con los filtros actuales.'
        : 'No hay mediciones registradas. Use el formulario para agregar la primera.';
    }

    // Sort indicator — driven by aria-sort, styled in CSS
    const table = document.getElementById('mediciones-table');
    if (table) {
      table.querySelectorAll('th[data-sort]').forEach(th => th.removeAttribute('aria-sort'));
      const active = table.querySelector(`th[data-sort="${this._sortField}"]`);
      const sort = ariaSortFor(this._sortField, this._sortAsc, this._sortField);
      if (active && sort) active.setAttribute('aria-sort', sort);
    }

    const sorted = [...data].sort((a, b) => {
      let va = this._sortField === 'score36' ? (a._score?.score36 ?? -Infinity) : a[this._sortField];
      let vb = this._sortField === 'score36' ? (b._score?.score36 ?? -Infinity) : b[this._sortField];
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
      return `<tr class="${Auth.canWrite() && !DemoMode.isActive() ? 'row-clickable' : ''}" data-code="${esc(d.code)}">
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
        <td>${this._renderGradeBadge(d._score)}</td>
      </tr>`;
    }).join('');
  },

  _renderGradeBadge(score) {
    if (!score || score.grade === null) return '<span class="muted">—</span>';
    const grade = score.grade;
    const cls = grade === 'A+' ? 'a-plus'
              : grade === 'A'  ? 'a'
              : grade === 'B'  ? 'b'
              :                  'c';
    const num = score.score36 != null ? score.score36.toFixed(0) : '—';
    // Partial grade (reception chemistry still missing) → asterisk + tooltip
    const star = score.partial
      ? `<sup title="Clasificación parcial — faltan datos de recepción (av/ag/polifenoles)">*</sup>`
      : '';
    return `<span class="pred-badge pred-badge-${cls}">${grade}${star}<small>${num}</small></span>`;
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
    const raw = DataStore.medicionesData || [];

    // Build berry index once per refresh so renderTable + edit-modal live score
    // can resolve calidad without re-scanning DataStore.berryData on every row.
    const berryByLot = new Map();
    for (const b of (DataStore.berryData || [])) {
      if (b.lotCode && b.vintage != null) {
        const key = `${b.lotCode}||${b.vintage}`;
        // Multiple berries per lot is normal — first match wins; any of them
        // carries the same chemistry context for scoring.
        if (!berryByLot.has(key)) berryByLot.set(key, b);
      }
    }
    this._berryByLot = berryByLot;
    raw.forEach(d => { d._score = scoreFromMedicion(d, berryByLot); });

    const filtered = this._applyGlobalFilters(raw);
    this.updateKPIs(filtered);
    this.renderCharts(filtered);
    this.renderTable(this._applySearch(filtered));  // search affects table only
  },

  _applyGlobalFilters(rows) {
    const s = Filters.state || {};
    // Filters.state.vintages holds NUMBERS (Supabase vintage_year) and
    // state.lots holds sampleIds — compare on the same types/keys, or any
    // berry-view selection silently blanks the whole Mediciones view.
    const lotCodes = s.lots?.size
      ? new Set([...s.lots].map(id => Identity.extractLotCode(id)).filter(Boolean))
      : null;
    return rows.filter(r => {
      if (s.vintages?.size  && !s.vintages.has(Number(r.vintage))) return false;
      if (s.varieties?.size && !s.varieties.has(r.variety))        return false;
      if (s.origins?.size   && !s.origins.has(r.appellation))      return false;
      if (lotCodes && r.lotCode && !lotCodes.has(r.lotCode)) return false;
      return true;
    });
  },

  _applySearch(rows) {
    const term = (this._searchTerm || '').trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r => {
      const haystack = [r.code, r.variety, r.appellation, r.lotCode, r.notes, r.measuredBy]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  },

  setSearch(term) {
    this._searchTerm = term;
    // Re-render only the table (KPIs / charts already reflect the filtered set).
    this.renderTable(this._applySearch(this._applyGlobalFilters(DataStore.medicionesData || [])));
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
