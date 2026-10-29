-- ==================================================================
-- migration_meteorologia_sin_escritura_anon
--
-- La llave anon deja de escribir en meteorology (auditoria de seguridad
-- 2026-10, bead xd-0lt.2).
--
-- js/weather.js consultaba Open-Meteo en el navegador y hacia upsert con la
-- llave anon, asi que RLS daba anon_insert WITH CHECK (true) y anon_update
-- USING (true) a todo rol. La llave anon no caduca con la sesion: quien la tuvo
-- una vez podia reescribir el clima de cualquier dia y valle para todos, y la
-- sincronizacion nunca vuelve a pedir un dia ya guardado. Ahora escribe solo
-- api/meteorologia.js: revisa la sesion (con lista negra), consulta Open-Meteo
-- en el servidor, valida los rangos y escribe con la service key.
--
-- La lectura anon (public_read) se queda: son datos publicos de Open-Meteo y
-- js/weather.js los carga con la llave anon.
--
-- ORDEN DE DESPLIEGUE: primero el codigo (api/meteorologia.js y
-- js/weather.js), despues esta migracion. Al reves, el tablero desplegado
-- intentaria el upsert anon y no llenaria los dias que faltan.

DROP POLICY IF EXISTS "anon_insert" ON public.meteorology;
DROP POLICY IF EXISTS "anon_update" ON public.meteorology;

ALTER TABLE public.meteorology ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.meteorology FROM anon, authenticated;

INSERT INTO public.applied_migrations (name) VALUES ('migration_meteorologia_sin_escritura_anon')
  ON CONFLICT (name) DO NOTHING;
