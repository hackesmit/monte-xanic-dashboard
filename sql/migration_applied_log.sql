-- sql/migration_applied_log.sql
-- Round 36 — Migration tracking guardrail.
--
-- Creates an applied_migrations table that records which `sql/migration_*.sql`
-- files have been executed against this database. The deployed frontend
-- compares this list against js/migrations-manifest.js on boot and shows a
-- banner to lab/admin users if any expected migration is missing — closing
-- the recurring failure mode where code references columns that exist in
-- the repo's migration files but were never actually run on Supabase
-- (Round 35 unify_mediciones surfaced this against the live `ag` column).
--
-- Going forward, every new migration file MUST end with:
--   INSERT INTO public.applied_migrations (name) VALUES ('migration_<name>')
--     ON CONFLICT (name) DO NOTHING;
-- and add the same name to js/migrations-manifest.js.
--
-- Idempotent — re-running this file is a no-op once bootstrapped.

CREATE TABLE IF NOT EXISTS public.applied_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;

-- Public read so the /api/migrations-status endpoint (anon key, server-side)
-- and any future client-side check can see the list. No insert/update policy
-- — only the service role (used by SQL Editor migrations) writes here.
DROP POLICY IF EXISTS "public_read" ON public.applied_migrations;
CREATE POLICY "public_read" ON public.applied_migrations
  FOR SELECT USING (true);

-- Bootstrap: every migration that was applied BEFORE this guardrail existed.
-- migration_unify_mediciones is intentionally excluded because as of Round 35
-- it was committed but not yet executed on production. Run that migration
-- separately; its trailing self-insert will register it.
INSERT INTO public.applied_migrations (name) VALUES
  ('migration_overhaul'),
  ('migration_token_blacklist'),
  ('migration_rate_limits'),
  ('migration_mediciones'),
  ('migration_sample_seq'),
  ('migration_phenolic_maturity'),
  ('migration_reception_lots_upsert'),
  ('migration_berry_samples'),
  ('migration_total_bins_numeric'),
  ('migration_pre_receptions'),
  ('migration_prefermentativos_vintage_year'),
  ('migration_applied_log')
ON CONFLICT (name) DO NOTHING;
