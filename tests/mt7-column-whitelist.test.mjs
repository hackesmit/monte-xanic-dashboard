// MT.7 — Server-side column whitelist and required-field validation
// Tests the validation logic from api/upload.js (ALLOWED_TABLES config).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Extract table config from api/upload.js for Node.js testing ──

const ALLOWED_TABLES = {
  wine_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    maxRows: 500,
    required: ['sample_id'],
    columns: new Set([
      'sample_id','vessel_id','sample_type','sample_date',
      'crush_date','days_post_crush','vintage_year','variety','appellation',
      'tant','fant','bant','ptan','irps','ipt','ph','ta','brix',
      'l_star','a_star','b_star','color_i','color_t','berry_weight',
      'berry_anthocyanins','berry_sugars_mg','alcohol','va','malic_acid',
      'rs','below_detection','notes','sample_seq'
    ])
  },
  tank_receptions: {
    conflict: 'report_code',
    maxRows: 200,
    required: ['report_code'],
    columns: new Set([
      'report_code','reception_date','batch_code','tank_id','supplier',
      'variety','brix','ph','ta','ag','am','av','so2','nfa',
      'temperature','solidos_pct','polifenoles_wx','antocianinas_wx',
      'poli_spica','anto_spica','ipt_spica','acidificado','p010_kg',
      'vintage_year'
    ])
  },
  reception_lots: {
    conflict: null,
    maxRows: 2000,
    required: ['reception_id','lot_code'],
    columns: new Set(['reception_id','lot_code','lot_position'])
  },
  prefermentativos: {
    conflict: 'report_code,measurement_date',
    maxRows: 200,
    required: ['report_code'],
    columns: new Set([
      'report_code','measurement_date','batch_code','tank_id','variety',
      'brix','ph','ta','temperature','tant','notes','vintage_year'
    ])
  },
  mediciones_tecnicas: {
    conflict: 'medicion_code',
    maxRows: 200,
    required: ['medicion_code'],
    columns: new Set([
      'medicion_code','medicion_date','vintage_year','variety','appellation',
      'lot_code','tons_received','berry_count_sample','berry_avg_weight_g',
      'berry_diameter_mm','health_grade','health_madura','health_inmadura',
      'health_sobremadura','health_picadura','health_enfermedad',
      'health_quemadura','measured_by','notes'
    ])
  }
};

// ── Extracted validation logic matching api/upload.js ──

function stripUnknownColumns(table, rows) {
  const { columns } = ALLOWED_TABLES[table];
  if (!columns) return;
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.has(key)) delete row[key];
    }
  }
}

function validateRequired(table, rows) {
  const { required } = ALLOWED_TABLES[table];
  if (!required || !required.length) return null;
  for (let i = 0; i < rows.length; i++) {
    for (const field of required) {
      if (rows[i][field] === undefined || rows[i][field] === null || rows[i][field] === '') {
        return { error: `Fila ${i + 1}: campo requerido '${field}' falta o está vacío`, row: i };
      }
    }
  }
  return null;
}

// ── Tests ──

describe('MT.7 — column whitelist (strip unknown fields)', () => {
  it('strips unknown columns from wine_samples rows', () => {
    const rows = [
      { sample_id: '25CSMX-1', brix: 24.5, evil_col: 'malicious', __proto_hack: true }
    ];
    stripUnknownColumns('wine_samples', rows);
    assert.equal(rows[0].sample_id, '25CSMX-1');
    assert.equal(rows[0].brix, 24.5);
    assert.equal(rows[0].evil_col, undefined);
    assert.equal(rows[0].__proto_hack, undefined);
  });

  it('preserves all valid wine_samples columns', () => {
    const row = {
      sample_id: '25CSMX-1', vessel_id: 'T1', sample_type: 'Wine',
      sample_date: '2025-08-15', brix: 24.5, ph: 3.5, ta: 6.0,
      vintage_year: 2025, variety: 'Cabernet Sauvignon', sample_seq: 1
    };
    const rows = [{ ...row }];
    stripUnknownColumns('wine_samples', rows);
    assert.deepEqual(rows[0], row);
  });

  it('strips unknown columns from tank_receptions', () => {
    const rows = [{ report_code: 'R001', brix: 22, injected: 'bad' }];
    stripUnknownColumns('tank_receptions', rows);
    assert.equal(rows[0].report_code, 'R001');
    assert.equal(rows[0].brix, 22);
    assert.equal(rows[0].injected, undefined);
  });

  it('strips unknown columns from reception_lots', () => {
    const rows = [{ reception_id: 1, lot_code: 'L1', lot_position: 1, extra: 'x' }];
    stripUnknownColumns('reception_lots', rows);
    assert.equal(rows[0].reception_id, 1);
    assert.equal(rows[0].lot_code, 'L1');
    assert.equal(rows[0].extra, undefined);
  });

  it('strips unknown columns from prefermentativos', () => {
    const rows = [{ report_code: 'R001', brix: 20, hack: true }];
    stripUnknownColumns('prefermentativos', rows);
    assert.equal(rows[0].hack, undefined);
    assert.equal(rows[0].brix, 20);
  });

  it('strips unknown columns from mediciones_tecnicas', () => {
    const rows = [{ medicion_code: 'M001', tons_received: 5, admin_flag: true }];
    stripUnknownColumns('mediciones_tecnicas', rows);
    assert.equal(rows[0].admin_flag, undefined);
    assert.equal(rows[0].tons_received, 5);
  });

  it('handles rows with only unknown columns — results in empty object', () => {
    const rows = [{ bad1: 'a', bad2: 'b' }];
    stripUnknownColumns('wine_samples', rows);
    assert.deepEqual(Object.keys(rows[0]), []);
  });
});

describe('MT.7 — required field validation', () => {
  it('accepts rows with all required fields present', () => {
    const rows = [{ sample_id: '25CSMX-1', brix: 24 }];
    assert.equal(validateRequired('wine_samples', rows), null);
  });

  it('rejects rows missing required fields with Spanish error', () => {
    const rows = [{ brix: 24 }]; // missing sample_id
    const result = validateRequired('wine_samples', rows);
    assert.notEqual(result, null);
    assert.match(result.error, /campo requerido/);
    assert.match(result.error, /sample_id/);
    assert.equal(result.row, 0);
  });

  it('rejects null required fields', () => {
    const rows = [{ sample_id: null }];
    const result = validateRequired('wine_samples', rows);
    assert.notEqual(result, null);
  });

  it('rejects empty string required fields', () => {
    const rows = [{ sample_id: '' }];
    const result = validateRequired('wine_samples', rows);
    assert.notEqual(result, null);
  });

  it('reports correct row number (1-indexed) in error message', () => {
    const rows = [
      { sample_id: '25CSMX-1' },
      { sample_id: '25CSMX-2' },
      { brix: 24 }, // row 3 missing sample_id
    ];
    const result = validateRequired('wine_samples', rows);
    assert.match(result.error, /Fila 3/);
    assert.equal(result.row, 2);
  });

  it('validates multiple required fields (reception_lots)', () => {
    const rows = [{ reception_id: 1 }]; // missing lot_code
    const result = validateRequired('reception_lots', rows);
    assert.notEqual(result, null);
    assert.match(result.error, /lot_code/);
  });

  it('accepts valid reception_lots row', () => {
    const rows = [{ reception_id: 1, lot_code: 'L1', lot_position: 1 }];
    assert.equal(validateRequired('reception_lots', rows), null);
  });

  it('validates mediciones_tecnicas required field', () => {
    const rows = [{ variety: 'Merlot' }]; // missing medicion_code
    const result = validateRequired('mediciones_tecnicas', rows);
    assert.notEqual(result, null);
    assert.match(result.error, /medicion_code/);
  });
});

describe('MT.7 — table configuration integrity', () => {
  it('all tables have required array', () => {
    for (const [name, config] of Object.entries(ALLOWED_TABLES)) {
      assert.ok(Array.isArray(config.required), `${name} missing required array`);
    }
  });

  it('all tables have columns Set', () => {
    for (const [name, config] of Object.entries(ALLOWED_TABLES)) {
      assert.ok(config.columns instanceof Set, `${name} missing columns Set`);
    }
  });

  it('required fields are included in columns whitelist', () => {
    for (const [name, config] of Object.entries(ALLOWED_TABLES)) {
      for (const req of config.required) {
        assert.ok(config.columns.has(req), `${name}: required field '${req}' not in columns whitelist`);
      }
    }
  });

  it('conflict columns are included in columns whitelist', () => {
    for (const [name, config] of Object.entries(ALLOWED_TABLES)) {
      if (!config.conflict) continue;
      for (const col of config.conflict.split(',')) {
        assert.ok(config.columns.has(col), `${name}: conflict column '${col}' not in columns whitelist`);
      }
    }
  });
});
