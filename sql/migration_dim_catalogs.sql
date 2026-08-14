-- ==================================================================
-- migration_dim_catalogs
--
-- Conformed reference dimensions for Monte Xanic: valley, ranch, parcel and
-- varietal, plus the synonym tables that let SQL reproduce the same
-- normalization the dashboard performs in js/config.js.
--
-- Purpose: revenue and field cost can only be combined into margin if both
-- sides key on the same catalogs. Until now these catalogs existed only in
-- browser JavaScript, so Power BI, dbt and any external vendor had no way to
-- join on them. Additive migration: no existing table is altered and no
-- current read path depends on these tables yet.
--
-- GENERATED FILE. Do not edit by hand.
--   Source:    js/config.js
--   Generator: scripts/gen-dim-catalogs.mjs
--   Guard:     tests/mt43-dim-catalogs.test.mjs fails if this file drifts.
--
-- Idempotent and transactional: safe to re-run.
-- ==================================================================

BEGIN;

-- --- dim_valle ---
CREATE TABLE IF NOT EXISTS public.dim_valle (
  valle_code   TEXT PRIMARY KEY,
  valle_nombre TEXT NOT NULL,
  lat          NUMERIC,
  lon          NUMERIC
);
COMMENT ON TABLE public.dim_valle IS
  'Valles vitivinicolas. lat/lon solo para los valles con serie meteorologica.';

INSERT INTO public.dim_valle (valle_code, valle_nombre, lat, lon) VALUES
  ('SV', 'San Vicente', 32.05, -116.45),
  ('VDG', 'Valle de Guadalupe', 32.08, -116.62),
  ('VON', 'Valle de Ojos Negros', 32, -116.25),
  ('VP', 'Valle de Parras', NULL, NULL)
ON CONFLICT (valle_code) DO UPDATE
  SET valle_nombre = EXCLUDED.valle_nombre,
      lat          = EXCLUDED.lat,
      lon          = EXCLUDED.lon;

-- --- dim_rancho ---
-- La llave es el nombre canonico en formato rancho-primero, porque es el
-- valor que las tablas de hechos ya guardan en su columna appellation.
CREATE TABLE IF NOT EXISTS public.dim_rancho (
  rancho       TEXT PRIMARY KEY,
  valle_code   TEXT REFERENCES public.dim_valle(valle_code)
);
COMMENT ON COLUMN public.dim_rancho.valle_code IS
  'NULL cuando el origen no pertenece a un valle catalogado (p. ej. California).';

INSERT INTO public.dim_rancho (rancho, valle_code) VALUES
  ('California', NULL),
  ('Camino Corazón (VP)', 'VP'),
  ('Dominio de las Abejas (VON)', 'VON'),
  ('Dubacano (SV)', 'SV'),
  ('Kompali (VON)', 'VON'),
  ('Llano Colorado (SV)', 'SV'),
  ('Monte Xanic (VDG)', 'VDG'),
  ('Ojos Negros (VON)', 'VON'),
  ('Olé (VDG)', 'VDG'),
  ('Rancho 14 (VDG)', 'VDG'),
  ('San Gerónimo', NULL),
  ('Siete Leguas (VDG)', 'VDG'),
  ('Viña Alta (VON)', 'VON')
ON CONFLICT (rancho) DO UPDATE SET valle_code = EXCLUDED.valle_code;

-- --- dim_rancho_sinonimo ---
-- Etiquetas historicas y prefijos de codigo de muestra que resuelven a un
-- rancho canonico. Permite que un consumidor SQL repita la normalizacion.
CREATE TABLE IF NOT EXISTS public.dim_rancho_sinonimo (
  sinonimo TEXT PRIMARY KEY,
  rancho   TEXT NOT NULL REFERENCES public.dim_rancho(rancho)
);

INSERT INTO public.dim_rancho_sinonimo (sinonimo, rancho) VALUES
  ('7L', 'Siete Leguas (VDG)'),
  ('Camino Corazon (Valle de Parras)', 'Camino Corazón (VP)'),
  ('Camino Corazón (Valle de Parras)', 'Camino Corazón (VP)'),
  ('DA', 'Dominio de las Abejas (VON)'),
  ('DLA', 'Dominio de las Abejas (VON)'),
  ('DOMINIO', 'Dominio de las Abejas (VON)'),
  ('Dominio de las Abejas', 'Dominio de las Abejas (VON)'),
  ('DUB', 'Dubacano (SV)'),
  ('Dubacano', 'Dubacano (SV)'),
  ('KMP', 'Kompali (VON)'),
  ('Kompali', 'Kompali (VON)'),
  ('Llano Colorado', 'Llano Colorado (SV)'),
  ('LLC', 'Llano Colorado (SV)'),
  ('Monte Xanic', 'Monte Xanic (VDG)'),
  ('MX', 'Monte Xanic (VDG)'),
  ('Ojos Negros', 'Ojos Negros (VON)'),
  ('Ole', 'Olé (VDG)'),
  ('OLE', 'Olé (VDG)'),
  ('Olé', 'Olé (VDG)'),
  ('ON', 'Ojos Negros (VON)'),
  ('R14', 'Rancho 14 (VDG)'),
  ('Rancho 14', 'Rancho 14 (VDG)'),
  ('San Geronimo', 'San Gerónimo'),
  ('SG', 'San Gerónimo'),
  ('Siete Leguas', 'Siete Leguas (VDG)'),
  ('UC', 'Dominio de las Abejas (VON)'),
  ('VA', 'Viña Alta (VON)'),
  ('Valle de Guadalupe (Monte Xanic)', 'Monte Xanic (VDG)'),
  ('Valle de Guadalupe (Ole)', 'Olé (VDG)'),
  ('Valle de Guadalupe (Olé)', 'Olé (VDG)'),
  ('Valle de Guadalupe (Siete Leguas)', 'Siete Leguas (VDG)'),
  ('Valle de Ojos Negros (Dominio de las Abejas)', 'Dominio de las Abejas (VON)'),
  ('Valle de Ojos Negros (Dubacano)', 'Dubacano (SV)'),
  ('Valle de Ojos Negros (Kompali)', 'Kompali (VON)'),
  ('Valle de Ojos Negros (Ojos Negros)', 'Ojos Negros (VON)'),
  ('Valle de Ojos Negros (Rancho 14)', 'Rancho 14 (VDG)'),
  ('Valle de Ojos Negros (Vina Alta)', 'Viña Alta (VON)'),
  ('Valle de Ojos Negros (Viña Alta)', 'Viña Alta (VON)'),
  ('VDG', 'Monte Xanic (VDG)'),
  ('Vina Alta', 'Viña Alta (VON)'),
  ('Viña Alta', 'Viña Alta (VON)')
ON CONFLICT (sinonimo) DO UPDATE SET rancho = EXCLUDED.rancho;

-- --- dim_variedad ---
CREATE TABLE IF NOT EXISTS public.dim_variedad (
  variedad TEXT PRIMARY KEY
);

INSERT INTO public.dim_variedad (variedad) VALUES
  ('Cabernet Franc'),
  ('Cabernet Sauvignon'),
  ('Caladoc'),
  ('Chardonnay'),
  ('Chenin Blanc'),
  ('Durif'),
  ('Grenache'),
  ('Malbec'),
  ('Marselan'),
  ('Merlot'),
  ('Mourvèdre'),
  ('Nebbiolo'),
  ('Petit Verdot'),
  ('Sauvignon Blanc'),
  ('Syrah'),
  ('Tempranillo'),
  ('Viognier')
ON CONFLICT (variedad) DO NOTHING;

-- --- dim_variedad_sinonimo ---
-- Abreviaturas de codigo de muestra y sinonimos de nombre (Petite Sirah es
-- Durif). Misma funcion que dim_rancho_sinonimo, para varietales.
CREATE TABLE IF NOT EXISTS public.dim_variedad_sinonimo (
  sinonimo TEXT PRIMARY KEY,
  variedad TEXT NOT NULL REFERENCES public.dim_variedad(variedad)
);

INSERT INTO public.dim_variedad_sinonimo (sinonimo, variedad) VALUES
  ('CA', 'Caladoc'),
  ('CAL', 'Caladoc'),
  ('CB', 'Chenin Blanc'),
  ('CF', 'Cabernet Franc'),
  ('CH', 'Chardonnay'),
  ('CS', 'Cabernet Sauvignon'),
  ('DU', 'Durif'),
  ('GR', 'Grenache'),
  ('GRE', 'Grenache'),
  ('MA', 'Malbec'),
  ('ME', 'Merlot'),
  ('MRS', 'Marselan'),
  ('MS', 'Marselan'),
  ('MV', 'Mourvèdre'),
  ('NB', 'Nebbiolo'),
  ('Petite Sirah', 'Durif'),
  ('PS', 'Durif'),
  ('PV', 'Petit Verdot'),
  ('SB', 'Sauvignon Blanc'),
  ('SY', 'Syrah'),
  ('TE', 'Tempranillo'),
  ('TEM', 'Tempranillo'),
  ('VG', 'Viognier')
ON CONFLICT (sinonimo) DO UPDATE SET variedad = EXCLUDED.variedad;

-- --- dim_parcela ---
-- variedad_plantada conserva la etiqueta curada tal cual; variedad es la
-- resolucion a catalogo y queda NULL en bloques mixtos o de plantas madre,
-- porque repartir un bloque mixto entre varietales exige una regla de
-- prorrateo que todavia no existe.
CREATE TABLE IF NOT EXISTS public.dim_parcela (
  parcela_code      TEXT PRIMARY KEY,
  rancho            TEXT NOT NULL REFERENCES public.dim_rancho(rancho),
  etiqueta          TEXT,
  variedad_plantada TEXT,
  variedad          TEXT REFERENCES public.dim_variedad(variedad),
  hectareas         NUMERIC
);
COMMENT ON COLUMN public.dim_parcela.variedad IS
  'NULL en bloques mixtos (dos varietales) y en Plantas Madre.';

INSERT INTO public.dim_parcela (parcela_code, rancho, etiqueta, variedad_plantada, variedad, hectareas) VALUES
  ('7L-1', 'Siete Leguas (VDG)', '1', 'Chenin Blanc', 'Chenin Blanc', 5.48),
  ('7L-2', 'Siete Leguas (VDG)', '2', 'Syrah', 'Syrah', 1.7),
  ('DA-L13', 'Dominio de las Abejas (VON)', 'L13', 'Syrah', 'Syrah', NULL),
  ('DA-L5', 'Dominio de las Abejas (VON)', 'L5', 'Syrah', 'Syrah', NULL),
  ('DUB-1', 'Dubacano (SV)', '1', 'Malbec / Syrah', NULL, NULL),
  ('K-S1', 'Kompali (VON)', 'S1', 'Cab. Franc / Temp.', NULL, NULL),
  ('K-S2A', 'Kompali (VON)', 'S2A', 'Cabernet Sauvignon', 'Cabernet Sauvignon', NULL),
  ('K-S2B', 'Kompali (VON)', 'S2B', 'Cab. Sauv. / Durif', NULL, NULL),
  ('K-S3A', 'Kompali (VON)', 'S3A', 'Petit Verdot / Chenin', NULL, NULL),
  ('K-S3B', 'Kompali (VON)', 'S3B', 'Caladoc / Sauv. Blanc', NULL, NULL),
  ('K-S4', 'Kompali (VON)', 'S4', 'Chardonnay', 'Chardonnay', 6.33),
  ('K-S5', 'Kompali (VON)', 'S5', 'Marselan', 'Marselan', NULL),
  ('K-S6', 'Kompali (VON)', 'S6', 'Merlot', 'Merlot', NULL),
  ('K-S7', 'Kompali (VON)', 'S7', 'Syrah / Durif', NULL, NULL),
  ('K-S8', 'Kompali (VON)', 'S8', 'Cabernet Sauvignon', 'Cabernet Sauvignon', NULL),
  ('MX-10', 'Monte Xanic (VDG)', '10', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 1.49),
  ('MX-11A', 'Monte Xanic (VDG)', '11A', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 1.29),
  ('MX-11B', 'Monte Xanic (VDG)', '11B', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 0.29),
  ('MX-12', 'Monte Xanic (VDG)', '12', 'Plantas Madre', NULL, NULL),
  ('MX-1A', 'Monte Xanic (VDG)', '1A', 'Sauvignon Blanc', 'Sauvignon Blanc', 2.02),
  ('MX-1B', 'Monte Xanic (VDG)', '1B', 'Sauvignon Blanc', 'Sauvignon Blanc', 2),
  ('MX-1C', 'Monte Xanic (VDG)', '1C', 'Sauvignon Blanc', 'Sauvignon Blanc', 2.02),
  ('MX-1D', 'Monte Xanic (VDG)', '1D', 'Sauvignon Blanc', 'Sauvignon Blanc', 2.02),
  ('MX-1E', 'Monte Xanic (VDG)', '1E', 'Caladoc', 'Caladoc', NULL),
  ('MX-2A', 'Monte Xanic (VDG)', '2A', 'Sauvignon Blanc', 'Sauvignon Blanc', 2.17),
  ('MX-2B', 'Monte Xanic (VDG)', '2B', 'Sauvignon Blanc', 'Sauvignon Blanc', 2.42),
  ('MX-2C', 'Monte Xanic (VDG)', '2C', 'Sauvignon Blanc', 'Sauvignon Blanc', 2.01),
  ('MX-3A', 'Monte Xanic (VDG)', '3A', 'Sauvignon Blanc', 'Sauvignon Blanc', 2.17),
  ('MX-3B', 'Monte Xanic (VDG)', '3B', 'Sauvignon Blanc', 'Sauvignon Blanc', 1.56),
  ('MX-4A', 'Monte Xanic (VDG)', '4A', 'Sauvignon Blanc', 'Sauvignon Blanc', 1.37),
  ('MX-4B', 'Monte Xanic (VDG)', '4B', 'Sauvignon Blanc', 'Sauvignon Blanc', 1.73),
  ('MX-5A', 'Monte Xanic (VDG)', '5A', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 1.6),
  ('MX-5B', 'Monte Xanic (VDG)', '5B', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 1.99),
  ('MX-5C', 'Monte Xanic (VDG)', '5C', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 0.77),
  ('MX-6', 'Monte Xanic (VDG)', '6', 'Cabernet Sauvignon', 'Cabernet Sauvignon', NULL),
  ('MX-7A', 'Monte Xanic (VDG)', '7A', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 1.94),
  ('MX-7B', 'Monte Xanic (VDG)', '7B', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 1.01),
  ('MX-8', 'Monte Xanic (VDG)', '8', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 1.01),
  ('MX-9', 'Monte Xanic (VDG)', '9', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 1.45),
  ('OLE-1', 'Olé (VDG)', '1', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 4.04),
  ('OLE-2', 'Olé (VDG)', '2', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 4.81),
  ('OLE-3', 'Olé (VDG)', '3', 'Viognier', 'Viognier', 0.44),
  ('OLE-4', 'Olé (VDG)', '4', 'Syrah', 'Syrah', NULL),
  ('ON-1', 'Ojos Negros (VON)', '1', 'Merlot', 'Merlot', 1.8),
  ('ON-2', 'Ojos Negros (VON)', '2', 'Malbec', 'Malbec', 2.86),
  ('ON-3', 'Ojos Negros (VON)', '3', 'Cabernet Sauvignon', 'Cabernet Sauvignon', 3.13),
  ('ON-4', 'Ojos Negros (VON)', '4', 'Syrah', 'Syrah', 2.55),
  ('ON-5', 'Ojos Negros (VON)', '5', 'Tempranillo', 'Tempranillo', 3.85),
  ('ON-6', 'Ojos Negros (VON)', '6', 'Grenache', 'Grenache', 1.11),
  ('VA-1A', 'Viña Alta (VON)', '1A', 'Merlot', 'Merlot', 2.18),
  ('VA-1B', 'Viña Alta (VON)', '1B', 'Syrah', 'Syrah', 2.53),
  ('VA-1C', 'Viña Alta (VON)', '1C', 'Petit Verdot', 'Petit Verdot', 2.13),
  ('VA-1D', 'Viña Alta (VON)', '1D', 'Syrah', 'Syrah', NULL),
  ('VA-1E', 'Viña Alta (VON)', '1E', 'Syrah', 'Syrah', NULL),
  ('VA-2A', 'Viña Alta (VON)', '2A', 'Merlot', 'Merlot', 1.75),
  ('VA-2B', 'Viña Alta (VON)', '2B', 'Cabernet Franc', 'Cabernet Franc', 1.65),
  ('VA-2C', 'Viña Alta (VON)', '2C', 'Syrah', 'Syrah', NULL),
  ('VA-2D', 'Viña Alta (VON)', '2D', 'Syrah', 'Syrah', NULL),
  ('VA-3B', 'Viña Alta (VON)', '3B', 'Grenache', 'Grenache', 1.61),
  ('VA-3C', 'Viña Alta (VON)', '3C', 'Syrah', 'Syrah', NULL),
  ('VA-3D', 'Viña Alta (VON)', '3D', 'Syrah', 'Syrah', NULL),
  ('VA-4A', 'Viña Alta (VON)', '4A', 'Grenache', 'Grenache', 1.65),
  ('VA-4B', 'Viña Alta (VON)', '4B', 'Grenache', 'Grenache', 1.31),
  ('VA-4C', 'Viña Alta (VON)', '4C', 'Syrah', 'Syrah', NULL),
  ('VA-4D', 'Viña Alta (VON)', '4D', 'Syrah', 'Syrah', NULL),
  ('VA-5A', 'Viña Alta (VON)', '5A', 'Cabernet Franc', 'Cabernet Franc', NULL),
  ('VA-5B', 'Viña Alta (VON)', '5B', 'Cabernet Franc', 'Cabernet Franc', NULL)
ON CONFLICT (parcela_code) DO UPDATE
  SET rancho            = EXCLUDED.rancho,
      etiqueta          = EXCLUDED.etiqueta,
      variedad_plantada = EXCLUDED.variedad_plantada,
      variedad          = EXCLUDED.variedad,
      hectareas         = EXCLUDED.hectareas;

CREATE INDEX IF NOT EXISTS dim_parcela_rancho_idx   ON public.dim_parcela (rancho);
CREATE INDEX IF NOT EXISTS dim_parcela_variedad_idx ON public.dim_parcela (variedad);
CREATE INDEX IF NOT EXISTS dim_rancho_valle_idx     ON public.dim_rancho (valle_code);

-- --- Lectura publica, escritura cerrada ---
-- Catalogos de referencia: se leen desde el dashboard con la llave anon y
-- solo se modifican corriendo esta migracion.
ALTER TABLE public.dim_valle             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_rancho            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_rancho_sinonimo   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_variedad          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_variedad_sinonimo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_parcela           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dim_valle_read             ON public.dim_valle;
DROP POLICY IF EXISTS dim_rancho_read            ON public.dim_rancho;
DROP POLICY IF EXISTS dim_rancho_sinonimo_read   ON public.dim_rancho_sinonimo;
DROP POLICY IF EXISTS dim_variedad_read          ON public.dim_variedad;
DROP POLICY IF EXISTS dim_variedad_sinonimo_read ON public.dim_variedad_sinonimo;
DROP POLICY IF EXISTS dim_parcela_read           ON public.dim_parcela;

CREATE POLICY dim_valle_read             ON public.dim_valle             FOR SELECT USING (true);
CREATE POLICY dim_rancho_read            ON public.dim_rancho            FOR SELECT USING (true);
CREATE POLICY dim_rancho_sinonimo_read   ON public.dim_rancho_sinonimo   FOR SELECT USING (true);
CREATE POLICY dim_variedad_read          ON public.dim_variedad          FOR SELECT USING (true);
CREATE POLICY dim_variedad_sinonimo_read ON public.dim_variedad_sinonimo FOR SELECT USING (true);
CREATE POLICY dim_parcela_read           ON public.dim_parcela           FOR SELECT USING (true);

INSERT INTO public.applied_migrations (name) VALUES ('migration_dim_catalogs')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
