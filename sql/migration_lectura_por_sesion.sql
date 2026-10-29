-- ==================================================================
-- migration_lectura_por_sesion
--
-- Las tablas de laboratorio confidenciales dejan de leerse con la llave anon
-- (auditoria de seguridad 2026-10, bead xd-0lt.1).
--
-- /api/config entrega la llave anon a una sesion valida, y RLS concedia
-- SELECT USING (true) sobre estas tablas a todo rol. La llave anon no caduca
-- con la sesion: quien tuvo una sesion una vez seguia leyendo todo despues de
-- cerrar sesion, de la lista negra o de rotar contrasenas o SESSION_SECRET.
-- Ahora el tablero lee por api/datos.js, que revisa la sesion (con lista
-- negra) en cada peticion y lee con la service key, como mona_* y tanques.
--
-- Fuera de alcance a proposito:
--   meteorology: datos publicos de Open-Meteo, y js/weather.js todavia hace
--     upsert con la llave anon (el upsert necesita SELECT); el bead xd-0lt.2
--     mueve esa escritura a una ruta con sesion.
--   dim_* y applied_migrations: catalogos de referencia y nombres de
--     migraciones, no datos de laboratorio.
--
-- ORDEN DE DESPLIEGUE: primero el codigo (api/datos.js y js/dataLoader.js),
-- despues esta migracion. Al reves, el tablero desplegado leeria tablas vacias.

DROP POLICY IF EXISTS "public_read" ON public.wine_samples;
DROP POLICY IF EXISTS "public_read" ON public.tank_receptions;
DROP POLICY IF EXISTS "public_read" ON public.reception_lots;
DROP POLICY IF EXISTS "public_read" ON public.prefermentativos;
DROP POLICY IF EXISTS "public_read" ON public.berry_samples;
DROP POLICY IF EXISTS "public_read" ON public.mediciones_tecnicas;
DROP POLICY IF EXISTS "public_read" ON public.harvest_target_overrides;

-- RLS activo sin politicas y sin grants para anon ni authenticated: la tabla se
-- lee y se escribe solo con la service key, desde las rutas de api/.
ALTER TABLE public.wine_samples             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tank_receptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_lots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prefermentativos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berry_samples            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mediciones_tecnicas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harvest_target_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wine_samples             FROM anon, authenticated;
REVOKE ALL ON public.tank_receptions          FROM anon, authenticated;
REVOKE ALL ON public.reception_lots           FROM anon, authenticated;
REVOKE ALL ON public.prefermentativos         FROM anon, authenticated;
REVOKE ALL ON public.berry_samples            FROM anon, authenticated;
REVOKE ALL ON public.mediciones_tecnicas      FROM anon, authenticated;
REVOKE ALL ON public.harvest_target_overrides FROM anon, authenticated;

INSERT INTO public.applied_migrations (name) VALUES ('migration_lectura_por_sesion')
  ON CONFLICT (name) DO NOTHING;
