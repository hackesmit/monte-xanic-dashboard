-- sql/migration_unify_mediciones.sql
-- Round 35 — Unify pre_receptions into mediciones_tecnicas as one canonical table.
--
-- Background. Two tables modeled the same domain object (technical reception
-- measurements): mediciones_tecnicas (form-entered) and pre_receptions
-- (Excel-uploaded). The pre_receptions data was invisible to the UI — no read
-- path connected it to the dashboard. This migration consolidates them onto
-- mediciones_tecnicas as the single source of truth.
--
--   1. Add the 23 pre_receptions-unique columns plus a `source` provenance flag.
--   2. Add `phenolic_maturity` (silently written by the form for some time but
--      never declared in migration_mediciones.sql — drift fix bundled here).
--   3. Drop NOT NULL on appellation/medicion_date/vintage_year/variety so
--      upload-sourced rows that lack these can land. Form path still
--      enforces them at the input layer (mediciones.js:52).
--   4. Backfill from pre_receptions with source='upload', ON CONFLICT DO NOTHING
--      so re-running the migration is idempotent.
--   5. Annotate pre_receptions as deprecated. Do NOT drop yet — kept as audit
--      trail until the dashboard renders all upload-sourced rows correctly.
--
-- Idempotent in both possible production states:
--   (a) fresh run — all column adds and backfill happen
--   (b) re-run — IF NOT EXISTS / ON CONFLICT DO NOTHING make every step a no-op

-- ── 1. Schema expansion ───────────────────────────────────────────
ALTER TABLE public.mediciones_tecnicas
  ADD COLUMN IF NOT EXISTS source               TEXT DEFAULT 'form'
    CHECK (source IN ('form','upload')),
  ADD COLUMN IF NOT EXISTS vintrace             TEXT,
  ADD COLUMN IF NOT EXISTS reception_date       DATE,
  ADD COLUMN IF NOT EXISTS supplier             TEXT,
  ADD COLUMN IF NOT EXISTS total_bins           NUMERIC,
  ADD COLUMN IF NOT EXISTS bin_unit             TEXT,
  ADD COLUMN IF NOT EXISTS bin_temp_c           NUMERIC,
  ADD COLUMN IF NOT EXISTS truck_temp_c         NUMERIC,
  ADD COLUMN IF NOT EXISTS bunch_avg_weight_g   NUMERIC,
  ADD COLUMN IF NOT EXISTS berry_length_avg_cm  NUMERIC,
  ADD COLUMN IF NOT EXISTS berries_200_weight_g NUMERIC,
  ADD COLUMN IF NOT EXISTS health_pasificada    INT,
  ADD COLUMN IF NOT EXISTS health_aceptable     INT,
  ADD COLUMN IF NOT EXISTS health_no_aceptable  INT,
  ADD COLUMN IF NOT EXISTS lab_date             DATE,
  ADD COLUMN IF NOT EXISTS brix                 NUMERIC,
  ADD COLUMN IF NOT EXISTS ph                   NUMERIC,
  ADD COLUMN IF NOT EXISTS at                   NUMERIC,
  ADD COLUMN IF NOT EXISTS ag                   NUMERIC,
  ADD COLUMN IF NOT EXISTS am                   NUMERIC,
  ADD COLUMN IF NOT EXISTS polifenoles          NUMERIC,
  ADD COLUMN IF NOT EXISTS catequinas           NUMERIC,
  ADD COLUMN IF NOT EXISTS antocianos           NUMERIC,
  ADD COLUMN IF NOT EXISTS phenolic_maturity    TEXT;

CREATE INDEX IF NOT EXISTS idx_mediciones_source        ON public.mediciones_tecnicas (source);
CREATE INDEX IF NOT EXISTS idx_mediciones_supplier      ON public.mediciones_tecnicas (supplier);
CREATE INDEX IF NOT EXISTS idx_mediciones_reception_date ON public.mediciones_tecnicas (reception_date);

-- ── 2. Relax NOT NULL constraints on form-only fields ─────────────
-- The Excel upload path doesn't always carry an appellation (only supplier
-- is known on the source sheet) and the date/vintage/variety values are
-- only present when the user fills them in the source workbook. The form
-- still enforces all four at the input layer (mediciones.js:52), so this
-- only loosens the upload path.
ALTER TABLE public.mediciones_tecnicas ALTER COLUMN appellation     DROP NOT NULL;
ALTER TABLE public.mediciones_tecnicas ALTER COLUMN medicion_date   DROP NOT NULL;
ALTER TABLE public.mediciones_tecnicas ALTER COLUMN vintage_year    DROP NOT NULL;
ALTER TABLE public.mediciones_tecnicas ALTER COLUMN variety         DROP NOT NULL;

-- ── 3. Backfill from pre_receptions ───────────────────────────────
-- pre_receptions.report_code → mediciones_tecnicas.medicion_code (UNIQUE).
-- ON CONFLICT preserves whatever's already in mediciones_tecnicas (form
-- entries take precedence on collision — should be zero in practice
-- because medicion_code namespaces don't overlap).
INSERT INTO public.mediciones_tecnicas (
  medicion_code, source, medicion_date, vintage_year, variety, lot_code,
  tons_received, berry_avg_weight_g,
  health_madura, health_inmadura, health_sobremadura, health_picadura, health_enfermedad,
  vintrace, reception_date, supplier, total_bins, bin_unit, bin_temp_c, truck_temp_c,
  bunch_avg_weight_g, berry_length_avg_cm, berries_200_weight_g,
  health_pasificada, health_aceptable, health_no_aceptable,
  lab_date, brix, ph, at, ag, am, polifenoles, catequinas, antocianos, notes
)
SELECT
  report_code, 'upload', medicion_date, vintage_year, variety, lot_code,
  tons_received, berry_avg_weight_g,
  health_madura, health_inmadura, health_sobremadura, health_picadura, health_enfermedad,
  vintrace, reception_date, supplier, total_bins, bin_unit, bin_temp_c, truck_temp_c,
  bunch_avg_weight_g, berry_length_avg_cm, berries_200_weight_g,
  health_pasificada, health_aceptable, health_no_aceptable,
  lab_date, brix, ph, at, ag, am, polifenoles, catequinas, antocianos, notes
FROM public.pre_receptions
ON CONFLICT (medicion_code) DO NOTHING;

-- Pre-existing mediciones_tecnicas rows pre-date the `source` column. The
-- DEFAULT 'form' on ADD COLUMN already populates the value for new rows, but
-- existing rows show up with NULL until a row update touches them. Set them
-- explicitly so filters and provenance queries are reliable.
UPDATE public.mediciones_tecnicas SET source = 'form' WHERE source IS NULL;

-- ── 4. Deprecate pre_receptions ───────────────────────────────────
-- Kept as audit trail. Drop only after verifying the dashboard renders all
-- upload-sourced rows correctly (read path is dataLoader.js — no change
-- needed; the rows now live in mediciones_tecnicas).
COMMENT ON TABLE public.pre_receptions
  IS 'DEPRECATED 2026-04-29 (Round 35): Use mediciones_tecnicas with source=''upload''. Kept as audit trail.';

-- ── 5. Register in applied_migrations log ─────────────────────────
-- Skipped silently if the log table doesn't exist yet (i.e. user runs this
-- before migration_applied_log.sql). The log migration's bootstrap inserts
-- a row for unify_mediciones too, with ON CONFLICT DO NOTHING for safety.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'applied_migrations') THEN
    INSERT INTO public.applied_migrations (name)
      VALUES ('migration_unify_mediciones')
      ON CONFLICT (name) DO NOTHING;
  END IF;
END
$$;
