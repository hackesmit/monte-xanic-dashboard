-- sql/migration_harvest_target_overrides.sql
-- Per (variety, valley) override of the rubric-derived harvest-readiness
-- targets used by the Predicción de cosecha view. Rows with NULL fields
-- fall back to the rubric values from js/config.js.

CREATE TABLE IF NOT EXISTS public.harvest_target_overrides (
  id                  BIGSERIAL PRIMARY KEY,
  variety             TEXT NOT NULL,
  valley              TEXT NOT NULL,            -- 'VDG' | 'VON' | 'VSV'
  brix_target         NUMERIC,                  -- midpoint of ideal range
  brix_target_lower   NUMERIC,                  -- window open (lower edge)
  brix_upper          NUMERIC,                  -- window close (upper edge)
  anthocyanin_target  NUMERIC,                  -- ANT ≥ this is A-grade
  updated_by          TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (variety, valley)
);

CREATE INDEX IF NOT EXISTS harvest_target_overrides_variety_valley
  ON public.harvest_target_overrides (variety, valley);

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_harvest_target_overrides')
  ON CONFLICT (name) DO NOTHING;
