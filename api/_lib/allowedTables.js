// api/_lib/allowedTables.js
// The write whitelist: per-table conflict key, row cap, column whitelist and
// required fields. Lives in _lib (rather than in api/upload.js) so both the
// manual upload handler and the WineXRay sync handler import one definition.
// A table absent from here cannot be written by any client-facing path.
export const ALLOWED_TABLES = {
  wine_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    // sample_seq carries a deterministic DB default (1); it may be omitted from
    // the payload without breaking upsert dedup. sample_id + sample_date are the
    // meaningful key and must be present — see the key-integrity guard below.
    keyDefault: new Set(['sample_seq']),
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
  berry_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    keyDefault: new Set(['sample_seq']),
    maxRows: 1000,
    required: ['sample_id'],
    columns: new Set([
      'sample_id','sample_date','sample_seq','sample_type',
      'vintage_year','variety','appellation','crush_date','days_post_crush',
      'batch_id','notes','below_detection',
      'berry_count','berries_weight_g','extracted_juice_ml','extracted_juice_g',
      'extracted_phenolics_ml','berry_fresh_weight_g','berry_anthocyanins_mg_100b',
      'berry_sugars_mg','berry_acids_mg','berry_water_mg','berry_skins_seeds_mg',
      'berry_sugars_pct','berry_acids_pct','berry_water_pct','berry_skins_seeds_pct',
      'berry_sugars_g','berry_acids_g','berry_water_g','berry_skins_seeds_g',
      'ipt','tant','fant','bant','ptan','irps',
      'l_star','a_star','b_star','color_i','color_t',
      'brix','ph','ta',
    ]),
  },

  // 2026 "Seguimiento de Maduración" per-lot forecast/tonnage/status. The
  // pivoted workbook's per-(lot,date) chemistry goes to wine_samples (the table
  // the dashboard reads, sample_type='Berries'); this holds the per-lot data
  // wine_samples has no columns for. tons_seguimiento and
  // cantidad_proyectada are PROVISIONAL/forecast — never authoritative harvested
  // tonnage (see sql/migration_seguimiento_lotes.sql).
  seguimiento_lotes: {
    conflict: 'lot_code,vintage_year',
    maxRows: 500,
    required: ['lot_code'],
    columns: new Set([
      'lot_code','vintage_year','variety','proveedor','status',
      'ant_target','codigo','cantidad_proyectada',
      'tons_seguimiento','tons_seguimiento_cached','tons_mismatch',
    ]),
  },

  // DEPRECATED (Round 35): pre_receptions was unified into mediciones_tecnicas
  // (sql/migration_unify_mediciones.sql). The Pre-recepción parser now writes
  // to mediciones_tecnicas with source='upload'. This whitelist is preserved
  // only to avoid breaking ad-hoc historical inserts; remove once the
  // pre_receptions audit table is dropped.
  pre_receptions: {
    conflict: 'report_code',
    maxRows: 500,
    required: ['report_code'],
    columns: new Set([
      'report_code','vintrace','reception_date','medicion_date','vintage_year',
      'supplier','variety','lot_code',
      'total_bins','bin_unit','tons_received','bin_temp_c','truck_temp_c',
      'bunch_avg_weight_g','berry_length_avg_cm','berries_200_weight_g','berry_avg_weight_g',
      'health_madura','health_inmadura','health_sobremadura','health_picadura',
      'health_enfermedad','health_pasificada','health_aceptable','health_no_aceptable',
      'lab_date','brix','ph','at','ag','am','polifenoles','catequinas','antocianos',
      'notes',
    ]),
  },

  reception_lots: {
    conflict: 'report_code,lot_position',
    maxRows: 2000,
    required: ['report_code','lot_code'],
    columns: new Set(['report_code','lot_code','lot_position','reception_id']),
  },
  prefermentativos: {
    conflict: 'report_code',
    maxRows: 200,
    required: ['report_code'],
    columns: new Set([
      'report_code','measurement_date','batch_code','tank_id','variety',
      'brix','ph','ta','temperature','tant','notes','vintage_year'
    ])
  },
  // Round 35: unified table — accepts both form-entered (source='form') and
  // Pre-recepción upload-entered (source='upload') rows. Schema expanded to
  // a superset of the legacy pre_receptions table by
  // sql/migration_unify_mediciones.sql.
  mediciones_tecnicas: {
    conflict: 'medicion_code',
    maxRows: 500,
    required: ['medicion_code'],
    columns: new Set([
      // Identity / provenance
      'medicion_code','source',
      // Form-original columns
      'medicion_date','vintage_year','variety','appellation',
      'lot_code','tons_received','berry_count_sample','berry_avg_weight_g',
      'berry_diameter_mm','health_grade','health_madura','health_inmadura',
      'health_sobremadura','health_picadura','health_enfermedad',
      'health_quemadura','phenolic_maturity','measured_by','notes',
      // Vendimia 2026: evaluator panel [{evaluador, sanidad, madurez}]
      'evaluaciones',
      // Round 35 — absorbed from pre_receptions
      'vintrace','reception_date','supplier',
      'total_bins','bin_unit','bin_temp_c','truck_temp_c',
      'bunch_avg_weight_g','berry_length_avg_cm','berries_200_weight_g',
      'health_pasificada','health_aceptable','health_no_aceptable',
      'lab_date','brix','ph','at','ag','am','av','polifenoles','catequinas','antocianos',
    ])
  },
  harvest_target_overrides: {
    conflict: 'variety,valley',
    columns: new Set([
      'variety', 'valley',
      'brix_target', 'brix_target_lower', 'brix_upper',
      'anthocyanin_target', 'ph_target',
      'updated_by', 'updated_at',
    ]),
  },
};
