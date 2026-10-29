// js/migrations-manifest.js
// Canonical list of SQL migrations the deployed code expects to be applied
// against the live Supabase database. Compared at boot against
// public.applied_migrations (via /api/migrations-status). Drift surfaces a
// banner naming the missing migration so we never again ship code that
// references columns the live DB doesn't have (Round 35 unify_mediciones).
//
// Workflow when adding a new migration:
//   1. Add the migration file to sql/
//   2. End the migration with:
//        INSERT INTO public.applied_migrations (name) VALUES ('migration_<name>')
//          ON CONFLICT (name) DO NOTHING;
//   3. Append the same name to MIGRATIONS below
//   4. Run the file in Supabase SQL Editor
//
// Order doesn't matter for the diff check, but we keep chronological order
// for readability.

export const MIGRATIONS = [
  'migration_overhaul',
  'migration_token_blacklist',
  'migration_rate_limits',
  'migration_mediciones',
  'migration_sample_seq',
  'migration_phenolic_maturity',
  'migration_reception_lots_upsert',
  'migration_berry_samples',
  'migration_total_bins_numeric',
  'migration_pre_receptions',
  'migration_prefermentativos_vintage_year',
  'migration_unify_mediciones',
  'migration_applied_log',
  'migration_mediciones_audit',
  'migration_row_audit_columns',
  'migration_harvest_target_overrides',
  'migration_harvest_target_overrides_ph',
  'migration_rls_lockdown',
  'migration_mona_chat',
  'migration_mona_views_knowledge',
  'migration_evaluaciones_multi',
  'migration_wine_samples_brix',
  'migration_seguimiento_lotes',
  'migration_dim_catalogs',
  'migration_seguimiento_origen_envero',
  'migration_tanques',
  'migration_tanques_escritura',
  'migration_tanques_descartes',
  'migration_tanques_etapa',
  'migration_login_rate_limit_atomic',
  'migration_login_rate_limit_sweep_isolated',
  'migration_sample_date_not_null',
  'migration_tanques_etapa_escritura',
  'migration_tanques_etapa_append_only',
  'migration_sync_lease',
  'migration_token_blacklist_sweep',
  'migration_mona_uso',
  'migration_mona_uso_reserva',
  'migration_lectura_por_sesion',
];
