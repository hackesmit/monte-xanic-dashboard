-- sql/migration_harvest_target_overrides_ph.sql
-- Adds ph_target column to harvest_target_overrides.
-- Used by the harvest predictor for white varieties (Brix + pH model).
-- Reds keep ph_target = NULL (predictor ignores it for them).

ALTER TABLE public.harvest_target_overrides
  ADD COLUMN IF NOT EXISTS ph_target NUMERIC;

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_harvest_target_overrides_ph')
  ON CONFLICT (name) DO NOTHING;
