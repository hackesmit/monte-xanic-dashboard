// ── Prefermentativos row edit descriptor (Phase 10 / Stage 7.5) ────
//
// Edits prefermentativos rows. Single conflict key (report_code) — much
// simpler than the composite-key path the berry/wine modals use.
//
// DataStore.winePreferment is a *merged* dataset: wine_samples Must rows
// (which carry codigoBodega + sampleSeq) and prefermentativos rows
// (which carry reportCode). The row-click handler in events.js routes
// each row to the correct modal: wine_samples Must → WineEdit;
// prefermentativos → PrefermentEdit (this module).

import { CONFIG, JS_TO_DB_PREF } from './config.js';
import { DataStore } from './dataLoader.js';
import { DemoMode } from './demoMode.js';
import { RowEditor } from './rowEditor.js';
import { App } from './app.js';

const FIELD_MAP = {
  fecha:        'pref-edit-date',
  codigoBodega: 'pref-edit-batch',
  tanque:       'pref-edit-tanque',
  variedad:     'pref-edit-variety',
  vintage:      'pref-edit-vintage',
  brix:         'pref-edit-brix',
  pH:           'pref-edit-ph',
  at:           'pref-edit-ta',
  temp:         'pref-edit-temp',
  antoWX:       'pref-edit-tant',
  notes:        'pref-edit-notes',
};

const NUM_FIELDS = new Set(['brix', 'pH', 'at', 'temp', 'antoWX']);
const INT_FIELDS = new Set(['vintage']);

function num(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const v = el.value;
  return v === '' || v == null ? null : parseFloat(v);
}
function intv(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const v = el.value;
  return v === '' || v == null ? null : parseInt(v, 10);
}
function str(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const v = el.value;
  return v === '' || v == null ? null : String(v).trim();
}

function populateVarietyDropdown(row) {
  const variety = document.getElementById('pref-edit-variety');
  if (variety && (!variety.options.length || variety.options.length < 2)) {
    const allVarieties = [...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white].sort();
    variety.innerHTML = '<option value="">— Seleccionar —</option>' +
      allVarieties.map(v => `<option value="${v}">${v}</option>`).join('');
  }
  if (variety) variety.value = row.variedad || '';
}

export const PrefermentEdit = {
  descriptor: {
    table:        'prefermentativos',
    conflictKeys: ['report_code'],
    jsToDb:       JS_TO_DB_PREF,
    modalId:      'pref-edit-modal',
    formId:       'pref-edit-form',
    fieldMap:     FIELD_MAP,
    auditEl:      'pref-edit-audit',
    statusEl:     'pref-edit-status',
    saveBtn:      'pref-edit-save',
    deleteBtn:    'pref-edit-delete',

    populateForm(row) {
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val === null || val === undefined) ? '' : val;
      };
      const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val === null || val === undefined) ? '—' : val;
      };

      setText('pref-edit-code',     row.reportCode);
      set('pref-edit-code-input',   row.reportCode);

      set('pref-edit-date',         row.fecha);
      set('pref-edit-batch',        row.codigoBodega);
      set('pref-edit-tanque',       row.tanque);
      populateVarietyDropdown(row);
      set('pref-edit-vintage',      row.vintage);
      set('pref-edit-brix',         row.brix);
      set('pref-edit-ph',           row.pH);
      set('pref-edit-ta',           row.at);
      set('pref-edit-temp',         row.temp);
      set('pref-edit-tant',         row.antoWX);
      set('pref-edit-notes',        row.notes);
    },

    readForm() {
      const out = {};
      for (const key of Object.keys(FIELD_MAP)) {
        const id = FIELD_MAP[key];
        if (NUM_FIELDS.has(key))      out[key] = num(id);
        else if (INT_FIELDS.has(key)) out[key] = intv(id);
        else                          out[key] = str(id);
      }
      return out;
    },

    formatRowLabel(row) {
      return `pre-fermentativo ${row.codigoBodega || row.reportCode}`;
    },

    isDemoMode: () => DemoMode.isActive(),
    reload:     () => DataStore.loadFromSupabase(),
    afterSave:  () => App.refresh(),
  },

  open(jsRow) { RowEditor.open(this.descriptor, jsRow); },
  close(opts) { RowEditor.close(this.descriptor, opts); },
  refreshDirty() { RowEditor.refreshDirty(this.descriptor); },
  submit() { return RowEditor.submit(this.descriptor); },
  remove() { return RowEditor.remove(this.descriptor); },
};
