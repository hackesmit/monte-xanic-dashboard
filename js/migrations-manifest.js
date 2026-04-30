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
];
