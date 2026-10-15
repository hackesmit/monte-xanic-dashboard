-- Etapa enologica explicita en movimientos_tanque (xd-qrn.9).
--
-- js/tanques/estado.js ya lee `etapa` de cada fila: una etapa explicita gana,
-- y si no la hay la etapa viaja con el vino (recepcion -> rec, descube -> des,
-- un tanque vacio toma la del origen). La columna la escribe la carga de
-- inventario (la etapa sale de la columna ESTADO ENO. de la ficha del
-- laboratorio, o de sus parametros cuando la ficha no la nombra). El POST de
-- api/tanques.js todavia no la acepta.
--
-- Nula = sin etapa conocida. El CHECK repite ETAPAS de js/tanques/estado.js.

BEGIN;

ALTER TABLE public.movimientos_tanque ADD COLUMN IF NOT EXISTS etapa TEXT;

ALTER TABLE public.movimientos_tanque DROP CONSTRAINT IF EXISTS movimientos_tanque_etapa_chk;
ALTER TABLE public.movimientos_tanque ADD  CONSTRAINT movimientos_tanque_etapa_chk
  CHECK (etapa IS NULL OR etapa IN ('rec', 'mac', 'fa', 'des', 'fml', 'cri', 'emb'));

INSERT INTO public.applied_migrations (name) VALUES ('migration_tanques_etapa')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
