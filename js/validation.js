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
      'health_enfermedad', 'health_quemadura',
      'health_pasificada', 'health_aceptable', 'health_no_aceptable',
    ]),
    // Sanitary berry counts are tallies: a negative count is impossible and,
    // left unguarded, a negative health_picadura yields a negative damage share
    // that can win the cleanest sanitary bucket (xd-b0o). Reject < 0 at this
    // server-authoritative gate, mirroring the scoreSanitaryPct parseCount guard.
    // Every sanitary count in intCols above appears here; the next new tally
    // must be added to both sets or the parameterized MT.18 test fails.
    nonNegativeIntCols: new Set([
      'health_madura', 'health_inmadura', 'health_sobremadura', 'health_picadura',
      'health_enfermedad', 'health_quemadura',
      'health_pasificada', 'health_aceptable', 'health_no_aceptable',
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
    // crush_date is the envero date the maturity timeline is measured from, so a
    // coerced or malformed value would silently shift a whole lot's series.
    // sample_date is deliberately NOT listed here: every writer already routes
    // it through normalizeDate (ISO or null), and validateColumnTypes is shared
    // with the row-editor path, so adding it is an unscoped behaviour change.
    // Tracked as a follow-up rather than smuggled into this bead.
    dateCols: new Set(['crush_date']),
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
  harvest_target_overrides: {
    intCols: new Set(),
    numericCols: new Set([
      'brix_target', 'brix_target_lower', 'brix_upper', 'anthocyanin_target',
      'ph_target',
    ]),
    requiredOnInsert: new Set(['variety', 'valley']),
  },
  // berry_samples type-guard for the Seguimiento de Maduración parser (WineXRay
  // berry rows are not type-validated at parse time; the 2026 workbook rows are,
  // to keep non-numeric lab entries out of Postgres numeric columns).
  berry_samples: {
    intCols: new Set(['vintage_year']),
    numericCols: new Set([
      'brix', 'ph', 'ta', 'malic_acid', 'berries_weight_g',
      'berry_anthocyanins_mg_100b',
    ]),
    requiredOnInsert: new Set(['sample_id']),
  },
  seguimiento_lotes: {
    intCols: new Set(['vintage_year']),
    numericCols: new Set([
      'ant_target', 'cantidad_proyectada',
      'tons_seguimiento', 'tons_seguimiento_cached',
    ]),
    // xd-49p.2 — the 2026 workbook's "Fecha de envero" column. Nullable by
    // design: lots not yet received legitimately have no envero, and their
    // chemistry must still ingest.
    dateCols: new Set(['fecha_envero']),
    requiredOnInsert: new Set(['lot_code']),
  },
};

export { validateColumnTypes };

export function validateRow(table, row, { action = 'update' } = {}) {
  const spec = COLUMN_TYPES[table];
  if (!spec) return { ok: false, error: `Tabla no soportada: ${table}` };

  const typeError = validateColumnTypes(row, spec);
  if (typeError) return { ok: false, error: typeError };

  // validateColumnTypes already enforces integer-ness for these columns; this
  // adds the non-negative floor a berry tally must satisfy. Number.isSafeInteger
  // also rejects values above 2^53-1 where integer arithmetic silently loses
  // precision, mirroring the scoreSanitaryPct parseCount guard so a payload
  // that survives here cannot then fabricate a NaN percentage downstream.
  if (spec.nonNegativeIntCols) {
    for (const col of spec.nonNegativeIntCols) {
      const v = row[col];
      if (v === null || v === undefined) continue;
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
        return { ok: false, error: `${col}=${v}: debe ser entero no negativo` };
      }
    }
  }

  if (action === 'insert') {
    for (const f of spec.requiredOnInsert) {
      if (row[f] === undefined || row[f] === null || row[f] === '') {
        return { ok: false, error: `Campo requerido: ${f}` };
      }
    }
  }
  return { ok: true };
}
