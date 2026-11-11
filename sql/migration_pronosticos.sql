-- migration_pronosticos.sql (xd-2ov.2)
--
-- Forecasts as they were issued, so a season can be scored against what the
-- dashboard actually said, not against a later replay. One row per lot, per
-- cutoff (the day of the last sample the forecast used), per model version and
-- target: a new sample is a new row; reloading the page writes nothing new.
--
-- tipo names the forecast. This bead adds 'brix_objetivo' (date the lot
-- reaches its target Brix, js/pronostico/brix.js). The phenology and yield
-- beads of epic xd-2ov add their own tipo with their own migration.
--
-- Only api/pronostico.js writes, with the service key. The anon and
-- authenticated roles get nothing: RLS on, no policy, privileges revoked.
-- Idempotent: safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pronosticos (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo             text    NOT NULL CHECK (tipo IN ('brix_objetivo')),
  lote             text    NOT NULL CHECK (lote <> ''),
  vendimia         integer NOT NULL CHECK (vendimia BETWEEN 2000 AND 2100),
  fecha_corte      date    NOT NULL,
  n_muestras       integer NOT NULL CHECK (n_muestras >= 3),
  valor_ultimo     numeric,
  objetivo         numeric NOT NULL,
  estado           text    NOT NULL,
  fecha_pronostico date,
  banda_dias       numeric CHECK (banda_dias IS NULL OR banda_dias >= 0),
  modelo           text    NOT NULL,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pronosticos_fecha_con_banda
    CHECK ((fecha_pronostico IS NULL) = (banda_dias IS NULL)),
  CONSTRAINT pronosticos_una_por_corte
    UNIQUE (tipo, lote, vendimia, fecha_corte, modelo, objetivo)
);

CREATE INDEX IF NOT EXISTS pronosticos_vendimia_idx
  ON public.pronosticos (tipo, vendimia, lote);

ALTER TABLE public.pronosticos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pronosticos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.pronosticos_id_seq FROM PUBLIC, anon, authenticated;

INSERT INTO public.applied_migrations (name) VALUES ('migration_pronosticos')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
