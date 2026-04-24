-- sql/migration_berry_samples.sql
-- Creates berry_samples table for berry-specific measurements from WineXRay.
-- Separate from wine_samples because berry rows have entirely different
-- meaningful columns (morphology, per-berry composition) vs. wine rows
-- (phenolic chemistry, color). Identity pattern mirrors wine_samples.

CREATE TABLE IF NOT EXISTS public.berry_samples (
  id               BIGSERIAL PRIMARY KEY,

  -- identity (mirrors wine_samples)
  sample_id        TEXT NOT NULL,
  sample_date      DATE NOT NULL,
  sample_seq       INT  NOT NULL DEFAULT 0,
  UNIQUE (sample_id, sample_date, sample_seq),

  -- context
  vintage_year     INT,
  variety          TEXT,
  appellation      TEXT,
  sample_type      TEXT DEFAULT 'Berries',
  crush_date       DATE,
  days_post_crush  INT,
  batch_id         TEXT,
  notes            TEXT,
  below_detection  BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW(),

  -- berry morphology
  berry_count                  INT,
  berries_weight_g             NUMERIC,
  extracted_juice_ml           NUMERIC,
  extracted_juice_g            NUMERIC,
  extracted_phenolics_ml       NUMERIC,
  berry_fresh_weight_g         NUMERIC,
  berry_anthocyanins_mg_100b   NUMERIC,

  -- per-berry composition (mg/berry)
  berry_sugars_mg              NUMERIC,
  berry_acids_mg               NUMERIC,
  berry_water_mg               NUMERIC,
  berry_skins_seeds_mg         NUMERIC,

  -- per-berry composition (weight %)
  berry_sugars_pct             NUMERIC,
  berry_acids_pct              NUMERIC,
  berry_water_pct              NUMERIC,
  berry_skins_seeds_pct        NUMERIC,

  -- per-berry composition (grams)
  berry_sugars_g               NUMERIC,
  berry_acids_g                NUMERIC,
  berry_water_g                NUMERIC,
  berry_skins_seeds_g          NUMERIC,

  -- phenolics/color measured on extracted juice (populated when present)
  ipt     NUMERIC,
  tant    NUMERIC,
  fant    NUMERIC,
  bant    NUMERIC,
  ptan    NUMERIC,
  irps    NUMERIC,
  l_star  NUMERIC,
  a_star  NUMERIC,
  b_star  NUMERIC,
  color_i NUMERIC,
  color_t NUMERIC,
  brix    NUMERIC,
  ph      NUMERIC,
  ta      NUMERIC
);

CREATE INDEX IF NOT EXISTS berry_samples_vintage_variety
  ON public.berry_samples (vintage_year, variety);
CREATE INDEX IF NOT EXISTS berry_samples_appellation
  ON public.berry_samples (appellation);
