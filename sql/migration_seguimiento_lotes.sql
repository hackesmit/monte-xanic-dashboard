-- sql/migration_seguimiento_lotes.sql
-- Per-lot table for the 2026 "Seguimiento de Maduración" workbook. The pivoted
-- calendar's per-(lot,date) CHEMISTRY is unpivoted into berry_samples; the
-- per-LOT forecast/tonnage/status has no home there and lands here.
--
-- The tonnage design is deliberate and load-bearing (see xd-6r7):
--   cantidad_proyectada       — the FORECAST (workbook col "Cantidad proyectada")
--   tons_seguimiento          — the workbook's running total, RECOMPUTED from the
--                               dated TONS cells (preferred over the cached
--                               +SUM(...) formula, which can be saved stale).
--                               PROVISIONAL, lab-entered.
--   tons_seguimiento_cached   — the cached formula result, kept for audit.
--   tons_mismatch             — true when recomputed != cached (surfaced, not
--                               silently reconciled).
-- NEITHER cantidad_proyectada NOR tons_seguimiento is the authoritative
-- harvested tonnage. The authoritative figure arrives via pre-recepción and is
-- untouched by this pipeline; the tonnage-weighted means weight by THAT figure
-- only. Do not wire these columns into any harvested-tonnage or weighting path.

CREATE TABLE IF NOT EXISTS public.seguimiento_lotes (
  id                       BIGSERIAL PRIMARY KEY,

  lot_code                 TEXT NOT NULL,
  vintage_year             INT  NOT NULL,
  UNIQUE (lot_code, vintage_year),

  variety                  TEXT,
  proveedor                TEXT,
  status                   TEXT,          -- 'Recibido' / 'No Recibido' (workbook's own statement)
  ant_target               NUMERIC,
  codigo                   TEXT,

  cantidad_proyectada      NUMERIC,       -- forecast
  tons_seguimiento         NUMERIC,       -- recomputed running total (provisional)
  tons_seguimiento_cached  NUMERIC,       -- cached +SUM(...) formula result
  tons_mismatch            BOOLEAN DEFAULT false,

  created_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seguimiento_lotes_vintage
  ON public.seguimiento_lotes (vintage_year);

-- Security (matches migration_rls_lockdown's category 3, server-only tables).
-- This table holds supplier names and commercial forecasts — the winery's 2026
-- harvest plan. It is written ONLY through /api/upload with the service key
-- (which bypasses RLS) and is NOT read client-side (no dataLoader/consumer
-- references it). So it needs no anon/authenticated access at all: enable RLS
-- with NO policies (default-deny) and revoke the default table grants the
-- public schema hands the anon/authenticated roles, so neither the anon key nor
-- a logged-in session can read the forecast or supplier list. Add a narrow
-- public_read SELECT policy here ONLY if a future client view needs it.
ALTER TABLE public.seguimiento_lotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seguimiento_lotes FROM anon, authenticated;

INSERT INTO public.applied_migrations (name) VALUES ('migration_seguimiento_lotes')
  ON CONFLICT (name) DO NOTHING;
