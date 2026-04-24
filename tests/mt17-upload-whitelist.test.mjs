// MT.17 — Extended ALLOWED_TABLES whitelist for berry_samples, pre_receptions,
// and fixed reception_lots. Mirrors the shape of mt7 (column-whitelist test).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_TABLES } from '../api/upload.js';

const EXPECTED_TABLES = {
  berry_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    required: ['sample_id'],
    hasColumn: ['sample_id', 'sample_date', 'berry_count', 'berry_sugars_mg',
                'berry_sugars_pct', 'extracted_juice_ml', 'ipt', 'l_star',
                'below_detection', 'sample_seq'],
  },
  pre_receptions: {
    conflict: 'report_code',
    required: ['report_code'],
    hasColumn: ['report_code', 'vintrace', 'reception_date', 'medicion_date',
                'supplier', 'variety', 'lot_code', 'tons_received',
                'bunch_avg_weight_g', 'berry_avg_weight_g', 'health_madura',
                'health_pasificada', 'lab_date', 'brix', 'ph', 'polifenoles',
                'antocianos'],
  },
  reception_lots: {
    conflict: 'report_code,lot_position',
    required: ['report_code', 'lot_code'],
    hasColumn: ['report_code', 'lot_code', 'lot_position'],
  },
};

describe('MT.17 — API whitelist for new and fixed tables', () => {
  for (const [table, expected] of Object.entries(EXPECTED_TABLES)) {
    describe(table, () => {
      it('is registered', () => {
        assert.ok(ALLOWED_TABLES[table], `${table} missing from ALLOWED_TABLES`);
      });

      it(`has conflict key = ${expected.conflict}`, () => {
        assert.equal(ALLOWED_TABLES[table].conflict, expected.conflict);
      });

      it(`has required = ${JSON.stringify(expected.required)}`, () => {
        assert.deepEqual(ALLOWED_TABLES[table].required, expected.required);
      });

      for (const col of expected.hasColumn) {
        it(`whitelists column: ${col}`, () => {
          assert.ok(ALLOWED_TABLES[table].columns.has(col),
            `${col} missing from ${table} column whitelist`);
        });
      }
    });
  }
});
