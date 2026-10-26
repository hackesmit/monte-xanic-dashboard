-- La etapa de un movimiento queda congelada como el resto de la fila (xd-qrn.9).
--
-- migration_tanques_etapa agrego la columna `etapa` y
-- migration_tanques_etapa_escritura deja que un movimiento nuevo la declare,
-- pero el trigger movimientos_tanque_append_only congela una tupla EXPLICITA
-- de columnas (la de migration_tanques_escritura) y etapa no estaba en ella:
-- un UPDATE con la service key o el SQL editor reescribia la etapa guardada sin
-- anular nada, y cambiaba en silencio la historia de etapas que deriva
-- js/tanques/estado.js. Aqui se reemplaza la funcion con etapa agregada a las
-- columnas congeladas, igual que migration_tanques_escritura agrego client_id.
-- Cambiar la etapa de un movimiento es anularlo e insertar el corregido.
--
-- Guardas: la columna etapa tiene que existir (sin ella la funcion falla en
-- cada UPDATE, incluido el de anular). Los dos triggers se vuelven a crear,
-- porque la carga de inventario del 2026-10-15 los deshabilito dentro de una
-- transaccion: que la funcion exista no prueba que el trigger este activo, y
-- crearlo de nuevo lo deja habilitado y apuntando a esta funcion.
--
-- Advertencia de re-corrida: re-correr migration_tanques.sql o
-- migration_tanques_escritura.sql DESPUES de esta devolveria una version de la
-- funcion sin etapa. Si alguna vez se re-corre alguna de las dos, re-correr
-- esta tambien.
--
-- Idempotente y transaccional: seguro de re-correr.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.movimientos_tanque'::regclass
      AND attname = 'etapa' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'falta movimientos_tanque.etapa: corre migration_tanques_etapa antes';
  END IF;
END
$$;

-- Misma funcion que en migration_tanques_escritura.sql, con etapa agregada a
-- las columnas congeladas. Todo lo demas es identico.
CREATE OR REPLACE FUNCTION public.movimientos_tanque_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- TRUNCATE no dispara un trigger FOR EACH ROW, asi que se frena aparte (abajo).
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION
      'movimientos_tanque es append-only: TRUNCATE borraria la historia de la bodega';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'movimientos_tanque es append-only: usa anulado = true en lugar de DELETE (id %)', OLD.id;
  END IF;

  IF OLD.anulado AND NOT NEW.anulado THEN
    RAISE EXCEPTION 'un movimiento anulado no se puede reactivar (id %)', OLD.id;
  END IF;

  IF (NEW.id, NEW.fecha, NEW.tipo, NEW.origen, NEW.destino, NEW.lot_code,
      NEW.vintage_year, NEW.volumen_l, NEW.merma_l, NEW.nota, NEW.fuente,
      NEW.creado_por, NEW.created_at, NEW.client_id, NEW.etapa)
     IS DISTINCT FROM
     (OLD.id, OLD.fecha, OLD.tipo, OLD.origen, OLD.destino, OLD.lot_code,
      OLD.vintage_year, OLD.volumen_l, OLD.merma_l, OLD.nota, OLD.fuente,
      OLD.creado_por, OLD.created_at, OLD.client_id, OLD.etapa)
  THEN
    RAISE EXCEPTION
      'movimientos_tanque solo admite cambiar anulado: anula el id % e inserta el movimiento corregido', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS movimientos_tanque_append_only ON public.movimientos_tanque;
CREATE TRIGGER movimientos_tanque_append_only
  BEFORE UPDATE OR DELETE ON public.movimientos_tanque
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_tanque_append_only();

DROP TRIGGER IF EXISTS movimientos_tanque_no_truncate ON public.movimientos_tanque;
CREATE TRIGGER movimientos_tanque_no_truncate
  BEFORE TRUNCATE ON public.movimientos_tanque
  FOR EACH STATEMENT EXECUTE FUNCTION public.movimientos_tanque_append_only();

-- CREATE OR REPLACE conserva los permisos; se repite por si se recreo por fuera.
REVOKE ALL ON FUNCTION public.movimientos_tanque_append_only() FROM anon, authenticated;

INSERT INTO public.applied_migrations (name) VALUES ('migration_tanques_etapa_append_only')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
