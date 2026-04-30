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
      'vintage_year',
      'health_madura', 'health_inmadura', 'health_sobremadura', 'health_picadura',
      'health_enfermedad', 'health_pasificada', 'health_aceptable', 'health_no_aceptable',
    ]),
    numericCols: new Set([
      'total_bins', 'tons_received', 'bin_temp_c', 'truck_temp_c',
      'bunch_avg_weight_g', 'berry_length_avg_cm', 'berries_200_weight_g', 'berry_avg_weight_g',
      'brix', 'ph', 'at', 'ag', 'am', 'polifenoles', 'catequinas', 'antocianos',
    ]),
    requiredOnInsert: new Set(['medicion_code']),
  },
  wine_samples: {
    intCols: new Set(['vintage_year', 'days_post_crush', 'berry_count']),
    numericCols: new Set([
      // wine_samples + shared with berry_samples
      'brix', 'ph', 'ta', 'ipt',
      'tant', 'fant', 'bant', 'ptan', 'irps',
      'l_star', 'a_star', 'b_star', 'color_i', 'color_t',
      'alcohol', 'va', 'malic_acid', 'rs',
      'berry_weight', 'berry_anthocyanins', 'berry_sugars_mg',
      // berry_samples only
      'berries_weight_g', 'extracted_juice_ml', 'extracted_juice_g',
      'extracted_phenolics_ml', 'berry_fresh_weight_g', 'berry_anthocyanins_mg_100b',
      'berry_acids_mg', 'berry_water_mg', 'berry_skins_seeds_mg',
      'berry_sugars_pct', 'berry_acids_pct', 'berry_water_pct', 'berry_skins_seeds_pct',
      'berry_sugars_g', 'berry_acids_g', 'berry_water_g', 'berry_skins_seeds_g',
    ]),
    requiredOnInsert: new Set(['sample_id']),
  },
  tank_receptions: {
    intCols: new Set(['vintage_year']),
    numericCols: new Set([
      'brix', 'ph', 'ta', 'ag', 'am', 'av', 'so2', 'nfa',
      'temperature', 'solidos_pct',
      'polifenoles_wx', 'antocianinas_wx',
      'poli_spica', 'anto_spica', 'ipt_spica', 'p010_kg',
    ]),
    requiredOnInsert: new Set(['report_code']),
  },
  prefermentativos: {
    intCols: new Set(['vintage_year']),
    numericCols: new Set([
      'brix', 'ph', 'ta', 'temperature', 'tant',
    ]),
    requiredOnInsert: new Set(['report_code']),
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
