-- Migration: wine_samples.sample_date NOT NULL (xd-ajy)
-- sample_date is part of the upsert key (sample_id, sample_date, sample_seq).
-- A NULL date never matches in a UNIQUE, so two NULL-date rows of one sample
-- would both be kept and every re-upload would add another. api/upload and
-- api/row already refuse a row without a date; this makes the database refuse
-- it too. berry_samples.sample_date is already NOT NULL.
-- Run this in Supabase SQL Editor. Safe to run more than once.

-- 1. Stop with a clear message if any row still has no date, instead of the
--    bare "column contains null values" error from step 2.
DO $$
DECLARE
  sin_fecha bigint;
BEGIN
  SELECT count(*) INTO sin_fecha FROM public.wine_samples WHERE sample_date IS NULL;
  IF sin_fecha > 0 THEN
    RAISE EXCEPTION 'wine_samples tiene % filas sin sample_date; corrígelas o bórralas antes de aplicar migration_sample_date_not_null', sin_fecha;
  END IF;
END $$;

-- 2. SET NOT NULL is a no-op when the column already has it.
ALTER TABLE public.wine_samples ALTER COLUMN sample_date SET NOT NULL;

INSERT INTO public.applied_migrations (name) VALUES ('migration_sample_date_not_null')
  ON CONFLICT (name) DO NOTHING;
