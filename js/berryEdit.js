// ── Berry-row edit descriptor (Phase 10 / Stage 7.3) ──────────────
//
// Thin per-table module that supplies the populate/read/reload glue and
// then delegates open / close / submit / remove to the shared RowEditor.
// Mirrors the structure of js/mediciones.js's edit half but runs against
// wine_samples (sample_type ∈ {Berries, Berry}) instead of mediciones.

import { CONFIG, JS_TO_DB_BERRY } from './config.js';
import { DataStore } from './dataLoader.js';
import { DemoMode } from './demoMode.js';
import { RowEditor } from './rowEditor.js';
import { App } from './app.js';

// JS field → DOM input id. Only fields the form exposes are listed —
// composite-key columns (sampleId/sampleDate/sampleSeq) live in jsToDb
// but not here, so they never count toward the dirty set.
const FIELD_MAP = {
  vintage:        'berry-edit-vintage',
  variety:        'berry-edit-variety',
  appellation:    'berry-edit-origin',
  crushDate:      'berry-edit-crush-date',
  daysPostCrush:  'berry-edit-dpc',
  brix:           'berry-edit-brix',
  pH:             'berry-edit-ph',
  ta:             'berry-edit-ta',
  tANT:           'berry-edit-tant',
  berryFW:        'berry-edit-fw',
  anthocyanins:   'berry-edit-antho',
  colorL:         'berry-edit-l',
  colorA:         'berry-edit-a',
  colorB:         'berry-edit-b',
  colorI:         'berry-edit-ci',
  colorT:         'berry-edit-ct',
  belowDetection: 'berry-edit-bd',
  notes:          'berry-edit-notes',
};

const NUM_FIELDS = new Set([
  'brix', 'pH', 'ta', 'tANT', 'berryFW', 'anthocyanins',
  'colorL', 'colorA', 'colorB', 'colorI', 'colorT',
]);
const INT_FIELDS = new Set(['vintage', 'daysPostCrush']);

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

function populateDropdowns(row) {
  const variety = document.getElementById('berry-edit-variety');
  const origin  = document.getElementById('berry-edit-origin');
  if (variety && (!variety.options.length || variety.options.length < 2)) {
    const allVarieties = [...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white].sort();
    variety.innerHTML = '<option value="">— Seleccionar —</option>' +
      allVarieties.map(v => `<option value="${v}">${v}</option>`).join('');
  }
  if (origin && (!origin.options.length || origin.options.length < 2)) {
    const origins = Object.keys(CONFIG.originColors).sort();
    origin.innerHTML = '<option value="">— Seleccionar —</option>' +
      origins.map(o => `<option value="${o}">${o}</option>`).join('');
  }
  if (variety) variety.value = row.variety || '';
  if (origin)  origin.value  = row.appellation || '';
}

export const BerryEdit = {
  descriptor: {
    table:        'wine_samples',
    conflictKeys: ['sample_id', 'sample_date', 'sample_seq'],
    jsToDb:       JS_TO_DB_BERRY,
    modalId:      'berry-edit-modal',
    formId:       'berry-edit-form',
    fieldMap:     FIELD_MAP,
    auditEl:      'berry-edit-audit',
    statusEl:     'berry-edit-status',
    saveBtn:      'berry-edit-save',
    deleteBtn:    'berry-edit-delete',

    populateForm(row) {
      // Read-only composite-key display + editable fields.
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val === null || val === undefined) ? '' : val;
      };
      const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val === null || val === undefined) ? '—' : val;
      };

      setText('berry-edit-sample-id', row.sampleId);
      set('berry-edit-sample-id-input', row.sampleId);
      set('berry-edit-sample-date',    row.sampleDate);
      set('berry-edit-sample-seq',     row.sampleSeq);

      set('berry-edit-vintage',        row.vintage);
      populateDropdowns(row);
      set('berry-edit-crush-date',     row.crushDate);
      set('berry-edit-dpc',             row.daysPostCrush);
      set('berry-edit-brix',           row.brix);
      set('berry-edit-ph',             row.pH);
      set('berry-edit-ta',             row.ta);
      set('berry-edit-tant',           row.tANT);
      set('berry-edit-fw',             row.berryFW);
      set('berry-edit-antho',          row.anthocyanins);
      set('berry-edit-l',              row.colorL);
      set('berry-edit-a',              row.colorA);
      set('berry-edit-b',              row.colorB);
      set('berry-edit-ci',             row.colorI);
      set('berry-edit-ct',             row.colorT);
      set('berry-edit-notes',          row.notes);

      const bd = document.getElementById('berry-edit-bd');
      if (bd) bd.checked = !!row.belowDetection;
    },

    readForm() {
      const out = {};
      for (const key of Object.keys(FIELD_MAP)) {
        const id = FIELD_MAP[key];
        if (key === 'belowDetection') {
          const el = document.getElementById(id);
          out[key] = !!(el && el.checked);
        } else if (NUM_FIELDS.has(key)) {
          out[key] = num(id);
        } else if (INT_FIELDS.has(key)) {
          out[key] = intv(id);
        } else {
          out[key] = str(id);
        }
      }
      return out;
    },

    formatRowLabel(row) {
      return `muestra ${row.sampleId}`;
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
