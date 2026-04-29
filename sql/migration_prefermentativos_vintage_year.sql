-- sql/migration_prefermentativos_vintage_year.sql
-- Round 33 — Add vintage_year column to prefermentativos.
--
-- The parser at js/upload/recepcion.js has been writing vintage_year into
-- prefermentativos rows for some time, and api/upload.js whitelists the
-- column for that table — but sql/schema.sql never declared it. The bug
-- was masked by Round 33's heterogeneous-keys defect (PostgREST aborted
-- the batch insert before Postgres could reject the unknown column).
-- After the keys-mismatch fix lands, this migration is required for the
-- preferment upload to succeed.
--
-- IF NOT EXISTS is idempotent in both possible production states:
--   (a) schema drift — column was added directly via Supabase UI without
--       a migration: this script is a no-op and just documents the state.
--   (b) always-broken — column doesn't exist anywhere: this script adds
--       it cleanly.
--
-- Mirrors tank_receptions.vintage_year (sql/schema.sql:78), so downstream
-- queries that already filter receptions by vintage can extend to
-- prefermentativos without additional schema work.

ALTER TABLE public.prefermentativos
  ADD COLUMN IF NOT EXISTS vintage_year INTEGER;

CREATE INDEX IF NOT EXISTS prefermentativos_vintage_idx
  ON public.prefermentativos (vintage_year);
