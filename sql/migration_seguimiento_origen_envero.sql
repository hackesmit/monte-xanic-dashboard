-- sql/migration_seguimiento_origen_envero.sql
-- The winery's "Seguimiento de Maduración Vendimia 2026" workbook gained two
-- per-lot columns in the revision received 2026-08-31: "Origen" and
-- "Fecha de envero". Both are inserted BEFORE "Código", which is why the
-- fixed-index parser refused the file outright (see xd-49p.3).
--
-- The per-SAMPLE home for both already exists on wine_samples and needs no
-- migration: appellation, crush_date and days_post_crush are real columns,
-- already mapped in CONFIG.supabaseToBerryJS, and days_post_crush is already
-- in COLUMN_TYPES.wine_samples.intCols. This migration only adds the per-LOT
-- copy, which seguimiento_lotes had nowhere to put.
--
-- origen stores the NORMALIZED ranch-first name (CONFIG.normalizeAppellation),
-- never the raw workbook string. The raw values are the old full-valley format
-- ("Valle de Guadalupe (Monte Xanic) ", note the trailing space) and storing
-- them unnormalized would split these lots from every historical origin series.
--
-- fecha_envero is the veraison date. It is the winery's own statement, not a
-- derived value, and it is what finally lets the 2026 vintage reach the
-- maturity timeline charts (every one of which plots x = días post-envero).
-- It is NULLABLE on purpose: the workbook legitimately ships lots with no
-- envero yet (the "No Recibido" ones), and their chemistry must still ingest.

ALTER TABLE public.seguimiento_lotes
  ADD COLUMN IF NOT EXISTS origen       TEXT,
  ADD COLUMN IF NOT EXISTS fecha_envero DATE;

COMMENT ON COLUMN public.seguimiento_lotes.origen IS
  'Normalized ranch-first appellation (CONFIG.normalizeAppellation), from the workbook "Origen" column. Never the raw workbook string.';
COMMENT ON COLUMN public.seguimiento_lotes.fecha_envero IS
  'Veraison date from the workbook "Fecha de envero" column. Nullable: lots not yet received legitimately have none.';

-- RLS posture is UNCHANGED and deliberate: migration_seguimiento_lotes enables
-- RLS with NO policies and revokes anon/authenticated, because this table holds
-- supplier names and commercial forecasts and is written only through
-- /api/upload with the service key. Adding columns does not alter that; do not
-- add a public_read policy here.

-- ------------------------------------------------------------------
-- Catalog backfill: the two Rancho 14 synonyms.
--
-- xd-49p.1 added 'Valle de Guadalupe (R14)' and 'Valle de Guadalupe (Rancho 14)'
-- to CONFIG.appellationFixes, and sql/migration_dim_catalogs.sql is GENERATED
-- from config.js, so regenerating it picked them up. But that migration is
-- already recorded in applied_migrations on any existing installation, so the
-- runner will never execute it again and the database catalog would stay behind
-- the JavaScript one -- exactly the JS/SQL drift dim_catalogs exists to prevent.
-- Editing an already-applied migration is not a delivery mechanism, so the two
-- rows are inserted here as well.
--
-- Guarded on the table existing, because a FRESH installation may run this
-- before migration_dim_catalogs has created it; there the generated file
-- already carries both rows and this block is correctly skipped. Idempotent
-- either way.
DO $$
BEGIN
  IF to_regclass('public.dim_rancho_sinonimo') IS NOT NULL THEN
    INSERT INTO public.dim_rancho_sinonimo (sinonimo, rancho) VALUES
      ('Valle de Guadalupe (R14)',        'Rancho 14 (VDG)'),
      ('Valle de Guadalupe (Rancho 14)',  'Rancho 14 (VDG)')
    ON CONFLICT (sinonimo) DO UPDATE SET rancho = EXCLUDED.rancho;
  END IF;
END $$;

INSERT INTO public.applied_migrations (name) VALUES ('migration_seguimiento_origen_envero')
  ON CONFLICT (name) DO NOTHING;
