// Shared validation module — used by api/row.js (server-authoritative gate)
// and by the mediciones edit modal (client UX). Pure ESM so it runs in both
// Node and the browser without polyfills.
//
// Round 37: factored from inline INT_COLUMNS / NUMERIC_COLUMNS definitions
// previously duplicated across each parser. Keep the per-table sets here so
// adding a column updates parsers and the editor in one place.

import { validateColumnTypes } from './upload/normalize.js';

export const COLUMN_TYPES = {
  mediciones_tecnicas: {
    intCols: new Set([
      'vintage_year', 'berry_count_sample',
      'health_madura', 'health_inmadura', 'health_sobremadura',
      'health_picadura', 'health_enfermedad', 'health_quemadura',
      'total_bins', 'health_pasificada', 'health_aceptable',
      'health_no_aceptable',
    ]),
    numericCols: new Set([
      'tons_received', 'berry_avg_weight_g', 'berry_diameter_mm',
      'bin_temp_c', 'truck_temp_c', 'bunch_avg_weight_g',
      'berry_length_avg_cm', 'berries_200_weight_g',
      'brix', 'ph', 'at', 'ag', 'am',
      'polifenoles', 'catequinas', 'antocianos',
    ]),
    requiredOnInsert: new Set([
      'medicion_code', 'medicion_date', 'vintage_year',
      'variety', 'appellation',
    ]),
  },
};

export { validateColumnTypes };

export function validateRow(table, row, { action = 'update' } = {}) {
  const spec = COLUMN_TYPES[table];
  if (!spec) return { ok: false, error: `Tabla no soportada: ${table}` };

  const typeError = validateColumnTypes(row, spec);
  if (typeError) return { ok: false, error: typeError };

  if (action === 'insert') {
    for (const f of spec.requiredOnInsert) {
      if (row[f] === undefined || row[f] === null || row[f] === '') {
        return { ok: false, error: `Campo requerido: ${f}` };
      }
    }
  }
  return { ok: true };
}
