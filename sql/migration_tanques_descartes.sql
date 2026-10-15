-- ==================================================================
-- migration_tanques_descartes
--
-- Propuestas de trasiego DESCARTADAS por una persona (bead xd-qrn.6, spec
-- state/specs/xd-tanques/SPEC.md, apartado "Lab inference").
--
-- La bandeja de entrada de la pestana Tanques propone trasiegos a partir de
-- wine_samples.vessel_id: un lote muestreado en D5 hasta el 11 de noviembre y
-- en E1 desde el 12 se movio. Confirmar una propuesta escribe un movimiento con
-- fuente 'lab' en movimientos_tanque; descartarla no escribe nada ahi, porque
-- un "no" no es un movimiento y movimientos_tanque es append-only de hechos.
-- De ahi esta tabla: la memoria de los "no".
--
-- Por que una tabla y no una fuente 'descartado' en movimientos_tanque
-- (decision del coordinador, 2026-10-15): el replay de js/tanques/estado.js
-- aplica toda fila viva de la bitacora, asi que una fila "descartado" tendria
-- que llevar volumen_l > 0 (el CHECK lo exige) y el replay la moveria de
-- verdad. Filtrarla en el replay seria una regla de tanques nueva en el modulo
-- que a proposito no tiene ninguna sobre el origen del dato.
--
-- La clave es la identidad estable de la propuesta, construida por
-- js/tanques/inferencia.js (clavePropuesta):
--
--   lot_code|origen|destino|fecha     p.ej. '25CSKMP-4|D5|E1|2025-11-12'
--
-- Esos cuatro campos y nada mas: las muestras detras de una propuesta pueden
-- crecer (llega otra muestra al destino) sin que el "no" del usuario vuelva a
-- ser una pregunta. La tabla NO lleva llave foranea a dim_tanque: guarda el
-- texto de una propuesta que ya no existe en cuanto se descarta, y un tanque
-- dado de baja del catalogo no debe resucitar propuestas viejas.
--
-- Acceso: solo api/tanques.js con la service key (GET devuelve la lista,
-- POST action 'descartar' escribe, rol lab, idempotente por clave). RLS activo
-- sin politicas y sin grants para anon ni authenticated, igual que las otras
-- tablas del epic.
--
-- No toca public.tanques_version a proposito: ese contador serializa las
-- escrituras de la bitacora (lo que cambia el contenido derivado de un tanque),
-- y un descarte no cambia ningun litro. Incluirlo convertiria cada "no" en un
-- conflicto para quien estuviera registrando un movimiento en ese momento.
--
-- Idempotente y transaccional: seguro de re-correr.
-- ==================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tanques_propuestas_descartadas (
  clave          TEXT        PRIMARY KEY,
  descartado_por TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los CHECK y los NOT NULL van en ALTER para que una instalacion previa de la
-- tabla los reciba tambien: CREATE TABLE IF NOT EXISTS se salta una tabla que
-- ya existe y nunca llevaria una restriccion nueva (misma razon que en
-- migration_tanques.sql).
ALTER TABLE public.tanques_propuestas_descartadas
  ALTER COLUMN descartado_por SET NOT NULL,
  ALTER COLUMN created_at     SET NOT NULL,
  ALTER COLUMN created_at     SET DEFAULT now();

-- Una clave en blanco descartaria "la propuesta sin nombre", que coincide con
-- ninguna y ocupa la primary key. El tope de 200 es muy holgado para
-- lote|origen|destino|fecha (los codigos de lote mas largos en produccion
-- rondan los 13 caracteres) y evita que un cliente use la tabla de almacen.
ALTER TABLE public.tanques_propuestas_descartadas
  DROP CONSTRAINT IF EXISTS tanques_descartes_clave_chk;
ALTER TABLE public.tanques_propuestas_descartadas
  ADD  CONSTRAINT tanques_descartes_clave_chk
  CHECK (btrim(clave) <> '' AND length(clave) <= 200);

ALTER TABLE public.tanques_propuestas_descartadas
  DROP CONSTRAINT IF EXISTS tanques_descartes_por_chk;
ALTER TABLE public.tanques_propuestas_descartadas
  ADD  CONSTRAINT tanques_descartes_por_chk
  CHECK (btrim(descartado_por) <> '' AND length(descartado_por) <= 120);

COMMENT ON TABLE public.tanques_propuestas_descartadas IS
  'Propuestas de trasiego (inferidas de wine_samples.vessel_id) que una persona descarto. clave = lot_code|origen|destino|fecha.';
COMMENT ON COLUMN public.tanques_propuestas_descartadas.clave IS
  'Identidad estable de la propuesta, la que construye clavePropuesta() en js/tanques/inferencia.js.';
COMMENT ON COLUMN public.tanques_propuestas_descartadas.descartado_por IS
  'Usuario del token de sesion, nunca del cuerpo de la peticion.';

-- RLS activo sin politicas y sin grants para anon ni authenticated: la tabla se
-- lee y se escribe solo con la service key, desde api/tanques.js.
ALTER TABLE public.tanques_propuestas_descartadas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tanques_propuestas_descartadas FROM anon, authenticated;
-- Sin DELETE a proposito: api/tanques.js solo lee y agrega (action 'descartar',
-- idempotente por clave). La bandeja pregunta antes de descartar en lugar de
-- ofrecer un deshacer, asi que un privilegio de borrado no tendria quien lo use.
GRANT SELECT, INSERT ON public.tanques_propuestas_descartadas TO service_role;

INSERT INTO public.applied_migrations (name) VALUES ('migration_tanques_descartes')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
