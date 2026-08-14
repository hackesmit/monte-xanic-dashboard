-- sql/migration_wine_samples_brix.sql
-- Adds brix column to wine_samples.
--
-- WineXRay Must and wine (Young/Aging/Bottled) upload paths already write
-- brix into wine_samples: js/config.js maps the '°Brix'/'Brix (...)' inputs
-- to a 'brix' target for wine_samples, js/validation.js declares brix in
-- COLUMN_TYPES.wine_samples.numericCols, and api/upload.js whitelists brix
-- in the wine_samples column list so it survives the pre-upsert strip.
-- But sql/schema.sql never declared the column, so a fresh install from
-- committed sql/ would fail the Round-36 symptom on any upload carrying
-- Brix: PostgREST "Could not find the 'brix' column of 'wine_samples' in
-- the schema cache".
--
-- Prod already has the column (verified via GET
-- /rest/v1/wine_samples?select=brix&limit=1 -> 200 [{"brix":22.5}]), so
-- this ADD COLUMN IF NOT EXISTS is a no-op there and only matters for
-- disaster recovery and new environments. Same idempotency argument as
-- migration_prefermentativos_vintage_year.

-- Wrapped in one transaction so a client that continues past an error cannot
-- record the migration as applied when the ALTER never landed. Matches the
-- pattern in migration_evaluaciones_multi.sql.

BEGIN;

ALTER TABLE public.wine_samples
  ADD COLUMN IF NOT EXISTS brix NUMERIC;

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_wine_samples_brix')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
