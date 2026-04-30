// ── Wine-Recepción row edit descriptor (Phase 10 / Stage 7.4) ──────
//
// Edits wine_samples rows where sample_type !== 'Berries' / 'Berry'
// (Recepción / Aging / Bottle, etc.). Only wine_samples columns are
// editable in this stage; tank_receptions joined fields (AG / AM / AV /
// SO2 / NFA / temperature / sólidos / polifenoles_wx / antocianinas_wx)
// are deferred to Stage 7.6 because they live in a different table.

import { CONFIG, JS_TO_DB_WINE } from './config.js';
import { DataStore } from './dataLoader.js';
import { DemoMode } from './demoMode.js';
import { RowEditor } from './rowEditor.js';
import { App } from './app.js';

const FIELD_MAP = {
  vintage:       'wine-edit-vintage',
  variedad:      'wine-edit-variety',
  proveedor:     'wine-edit-origin',
  tanque:        'wine-edit-tanque',
  crushDate:     'wine-edit-crush-date',
  daysPostCrush: 'wine-edit-dpc',
  brix:          'wine-edit-brix',
  pH:            'wine-edit-ph',
  at:            'wine-edit-ta',
  antoWX:        'wine-edit-tant',
  freeANT:       'wine-edit-fant',
  boundANT:      'wine-edit-bant',
  pTAN:          'wine-edit-ptan',
  iRPs:          'wine-edit-irps',
  iptSpica:      'wine-edit-ipt',
  colorL:        'wine-edit-l',
  colorA:        'wine-edit-a',
  colorB:        'wine-edit-b',
  colorI:        'wine-edit-ci',
  colorT:        'wine-edit-ct',
  notes:         'wine-edit-notes',
};

const NUM_FIELDS = new Set([
  'brix', 'pH', 'at',
  'antoWX', 'freeANT', 'boundANT', 'pTAN', 'iRPs', 'iptSpica',
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
  const variety = document.getElementById('wine-edit-variety');
  const origin  = document.getElementById('wine-edit-origin');
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
  if (variety) variety.value = row.variedad  || '';
  if (origin)  origin.value  = row.proveedor || '';
}

export const WineEdit = {
  descriptor: {
    table:        'wine_samples',
    conflictKeys: ['sample_id', 'sample_date', 'sample_seq'],
    jsToDb:       JS_TO_DB_WINE,
    modalId:      'wine-edit-modal',
    formId:       'wine-edit-form',
    fieldMap:     FIELD_MAP,
    auditEl:      'wine-edit-audit',
    statusEl:     'wine-edit-status',
    saveBtn:      'wine-edit-save',
    deleteBtn:    'wine-edit-delete',

    populateForm(row) {
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val === null || val === undefined) ? '' : val;
      };
      const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val === null || val === undefined) ? '—' : val;
      };

      setText('wine-edit-code',           row.codigoBodega);
      set('wine-edit-code-input',         row.codigoBodega);
      set('wine-edit-fecha',              row.fecha);
      set('wine-edit-seq',                row.sampleSeq);
      setText('wine-edit-type-badge',     row.sampleType);

      set('wine-edit-vintage',            row.vintage);
      populateDropdowns(row);
      set('wine-edit-tanque',             row.tanque);
      set('wine-edit-crush-date',         row.crushDate);
      set('wine-edit-dpc',                row.daysPostCrush);
      set('wine-edit-brix',               row.brix);
      set('wine-edit-ph',                 row.pH);
      set('wine-edit-ta',                 row.at);
      set('wine-edit-tant',               row.antoWX);
      set('wine-edit-fant',               row.freeANT);
      set('wine-edit-bant',               row.boundANT);
      set('wine-edit-ptan',               row.pTAN);
      set('wine-edit-irps',               row.iRPs);
      set('wine-edit-ipt',                row.iptSpica);
      set('wine-edit-l',                  row.colorL);
      set('wine-edit-a',                  row.colorA);
      set('wine-edit-b',                  row.colorB);
      set('wine-edit-ci',                 row.colorI);
      set('wine-edit-ct',                 row.colorT);
      set('wine-edit-notes',              row.notes);
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
      return `recepción ${row.codigoBodega}`;
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
