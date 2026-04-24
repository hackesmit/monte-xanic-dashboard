-- sql/migration_pre_receptions.sql
-- Creates pre_receptions table for the Pre-recepción upstream dataset.
-- Distinct from mediciones_tecnicas (which stays form-owned and unchanged).

CREATE TABLE IF NOT EXISTS public.pre_receptions (
  id                BIGSERIAL PRIMARY KEY,

  -- identity
  report_code       TEXT NOT NULL,          -- "No. Reporte" (e.g., MT-24-001)
  UNIQUE (report_code),

  -- context
  vintrace          TEXT,                   -- Vintrace reference / "PENDIENTE"
  reception_date    DATE,                   -- Fecha recepción de uva
  medicion_date     DATE,                   -- Fecha medición técnica
  vintage_year      INT,
  supplier          TEXT,                   -- Proveedor
  variety           TEXT,
  lot_code          TEXT,                   -- Lote de campo

  -- load characteristics
  total_bins        INT,                    -- Total bins/jabas
  bin_unit          TEXT,                   -- "bins" | "jabas"
  tons_received     NUMERIC,                -- Toneladas totales
  bin_temp_c        NUMERIC,                -- Temperatura bins/jabas
  truck_temp_c      NUMERIC,                -- Temperatura camión

  -- morphology
  bunch_avg_weight_g    NUMERIC,            -- Peso promedio racimos (g)
  berry_length_avg_cm   NUMERIC,            -- Longitud promedio por baya (cm)
  berries_200_weight_g  NUMERIC,            -- Peso de 200 bayas (g)
  berry_avg_weight_g    NUMERIC,            -- Peso promedio por baya (g)

  -- health counts
  health_madura         INT,
  health_inmadura       INT,
  health_sobremadura    INT,
  health_picadura       INT,
  health_enfermedad     INT,
  health_pasificada     INT,
  health_aceptable      INT,
  health_no_aceptable   INT,

  -- lab chemistry
  lab_date          DATE,                   -- Fecha análisis laboratorio
  brix              NUMERIC,
  ph                NUMERIC,
  at                NUMERIC,                -- g/L
  ag                NUMERIC,                -- g/L
  am                NUMERIC,                -- g/L
  polifenoles       NUMERIC,                -- mg/L
  catequinas        NUMERIC,                -- mg/L
  antocianos        NUMERIC,                -- mg/L

  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pre_receptions_vintage_variety
  ON public.pre_receptions (vintage_year, variety);
CREATE INDEX IF NOT EXISTS pre_receptions_reception_date
  ON public.pre_receptions (reception_date);
CREATE INDEX IF NOT EXISTS pre_receptions_supplier
  ON public.pre_receptions (supplier);
