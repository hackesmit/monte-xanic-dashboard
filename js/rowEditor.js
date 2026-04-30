// ── RowEditor — table-agnostic edit/delete glue for /api/row ──────
//
// Shared modal helper used by berryEdit / wineEdit / prefermentEdit. Keeps
// per-table knowledge in the *descriptor* the caller passes in: DOM ids,
// JS↔DB column map, conflict keys, and the populate/read/reload callbacks.
// The helper itself owns only DOM + fetch glue — it never touches DataStore,
// DemoMode, or any per-table shape directly. Mediciones is intentionally
// not refactored onto this helper (Phase 10 plan: kept as the proven
// reference). See PLAN.md "Stage 7.2".

// Pure helper: dirty diff with union semantics. Mirrors collectDirty in
// js/mediciones.js so MT.21 can verify parity.
export function collectDirty(initial, current) {
  const out = {};
  const keys = new Set([...Object.keys(initial || {}), ...Object.keys(current || {})]);
  for (const k of keys) {
    const a = initial?.[k];
    const b = current?.[k];
    if ((a === null || a === undefined) && (b === null || b === undefined)) continue;
    if (a !== b) out[k] = b;
  }
  return out;
}

// Pure helper: translate JS-shape keys to DB column names via the descriptor
// map. Keys absent from the map are dropped — that's how ghost-dirty keys
// from the snapshot (id, derived fields, audit columns) never reach the API.
export function jsRowToDbRow(jsRow, jsToDbMap) {
  const out = {};
  if (!jsRow || !jsToDbMap) return out;
  for (const k of Object.keys(jsRow)) {
    if (k in jsToDbMap) out[jsToDbMap[k]] = jsRow[k];
  }
  return out;
}

function $(id) {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}

function setStatus(descriptor, msg, type) {
  const el = $(descriptor.statusEl);
  if (!el) return;
  el.textContent = msg;
  el.className = 'form-status' + (type ? ' ' + type : '');
}

function setAuditLine(descriptor, jsRow) {
  const el = $(descriptor.auditEl);
  if (!el) return;
  if (jsRow && jsRow.lastEditedAt) {
    let dt;
    try {
      dt = new Date(jsRow.lastEditedAt).toLocaleString('es-MX', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { dt = String(jsRow.lastEditedAt); }
    el.textContent = `Última edición: ${dt}${jsRow.lastEditedBy ? ' por ' + jsRow.lastEditedBy : ''}`;
  } else {
    el.textContent = 'Sin ediciones previas';
  }
}

function getToken() {
  if (typeof localStorage === 'undefined' || !localStorage) return '';
  try { return localStorage.getItem('xanic_session_token') || ''; }
  catch (_) { return ''; }
}

function buildKeyRow(descriptor, jsRow) {
  const dbBase = jsRowToDbRow(jsRow, descriptor.jsToDb);
  const out = {};
  for (const col of descriptor.conflictKeys || []) out[col] = dbBase[col];
  return out;
}

export const RowEditor = {
  open(descriptor, jsRow) {
    if (!descriptor || !jsRow) return;
    descriptor._state = { initial: JSON.parse(JSON.stringify(jsRow)) };
    if (typeof descriptor.populateForm === 'function') descriptor.populateForm(jsRow);
    setAuditLine(descriptor, jsRow);
    setStatus(descriptor, '', '');
    this.refreshDirty(descriptor);
    const modal = $(descriptor.modalId);
    if (modal && typeof modal.showModal === 'function') modal.showModal();
  },

  close(descriptor, { force = false } = {}) {
    if (!descriptor) return;
    const dirty = this._currentDirty(descriptor);
    if (!force && Object.keys(dirty).length) {
      const ok = (typeof confirm === 'function')
        ? confirm('Hay cambios sin guardar. ¿Descartar?')
        : true;
      if (!ok) return;
    }
    descriptor._state = null;
    const modal = $(descriptor.modalId);
    if (modal && typeof modal.close === 'function') modal.close();
  },

  refreshDirty(descriptor) {
    if (!descriptor) return;
    const dirty = this._currentDirty(descriptor);
    const saveBtn = $(descriptor.saveBtn);
    if (saveBtn) saveBtn.disabled = Object.keys(dirty).length === 0;
    const fieldMap = descriptor.fieldMap || {};
    Object.entries(fieldMap).forEach(([key, inputId]) => {
      const el = $(inputId);
      if (!el || typeof el.closest !== 'function') return;
      const group = el.closest('.form-group');
      if (!group) return;
      group.classList.toggle('field-dirty', key in dirty);
    });
  },

  // Internal: dirty against the snapshot, restricted to keys in fieldMap so
  // snapshot-only keys (id, derived fields, audit columns) never count.
  _currentDirty(descriptor) {
    if (!descriptor || !descriptor._state) return {};
    const initial = descriptor._state.initial;
    const current = (typeof descriptor.readForm === 'function')
      ? (descriptor.readForm() || {})
      : {};
    const out = {};
    const keys = Object.keys(descriptor.fieldMap || {});
    for (const k of keys) {
      const a = initial?.[k];
      const b = current?.[k];
      if ((a === null || a === undefined) && (b === null || b === undefined)) continue;
      if (a !== b) out[k] = b;
    }
    return out;
  },

  async submit(descriptor) {
    if (!descriptor || !descriptor._state) return;
    if (typeof descriptor.isDemoMode === 'function' && descriptor.isDemoMode()) {
      setStatus(descriptor, 'Modo demo — no se pueden guardar cambios', 'error');
      return;
    }
    const dirty = this._currentDirty(descriptor);
    if (!Object.keys(dirty).length) return;

    const dbDirty = jsRowToDbRow(dirty, descriptor.jsToDb);
    const dbRow = { ...buildKeyRow(descriptor, descriptor._state.initial), ...dbDirty };

    const saveBtn = $(descriptor.saveBtn);
    if (saveBtn) saveBtn.disabled = true;
    setStatus(descriptor, 'Guardando...', '');

    try {
      const res = await fetch('/api/row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() },
        body: JSON.stringify({ table: descriptor.table, action: 'update', row: dbRow }),
      });
      const data = await res.json();
      if (data && data.ok) {
        if (typeof descriptor.reload === 'function') await descriptor.reload();
        if (typeof descriptor.afterSave === 'function') descriptor.afterSave(data.row);
        this.close(descriptor, { force: true });
      } else {
        setStatus(descriptor, (data && data.error) || `Error (${res.status})`, 'error');
        if (saveBtn) saveBtn.disabled = false;
      }
    } catch (e) {
      console.error(`[RowEditor:${descriptor.table}] submit error:`, e);
      setStatus(descriptor, 'Error de conexión: ' + (e?.message || ''), 'error');
      if (saveBtn) saveBtn.disabled = false;
    }
  },

  async remove(descriptor) {
    if (!descriptor || !descriptor._state) return;
    if (typeof descriptor.isDemoMode === 'function' && descriptor.isDemoMode()) {
      setStatus(descriptor, 'Modo demo — no se pueden guardar cambios', 'error');
      return;
    }
    const label = (typeof descriptor.formatRowLabel === 'function')
      ? descriptor.formatRowLabel(descriptor._state.initial)
      : '';
    const prompt = label
      ? `¿Eliminar ${label}? Esta acción no se puede deshacer.`
      : '¿Eliminar fila? Esta acción no se puede deshacer.';
    const ok = (typeof confirm === 'function') ? confirm(prompt) : true;
    if (!ok) return;

    const keyRow = buildKeyRow(descriptor, descriptor._state.initial);
    setStatus(descriptor, 'Eliminando...', '');
    try {
      const res = await fetch('/api/row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() },
        body: JSON.stringify({ table: descriptor.table, action: 'delete', row: keyRow }),
      });
      const data = await res.json();
      if (data && data.ok) {
        if (typeof descriptor.reload === 'function') await descriptor.reload();
        if (typeof descriptor.afterSave === 'function') descriptor.afterSave(null);
        this.close(descriptor, { force: true });
      } else {
        setStatus(descriptor, (data && data.error) || `Error (${res.status})`, 'error');
      }
    } catch (e) {
      console.error(`[RowEditor:${descriptor.table}] remove error:`, e);
      setStatus(descriptor, 'Error de conexión: ' + (e?.message || ''), 'error');
    }
  },
};
