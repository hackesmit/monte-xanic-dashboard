-- ==================================================================
-- migration_tanques_escritura
--
-- Serializa las escrituras a movimientos_tanque y las vuelve idempotentes
-- (decision del coordinador en xd-qrn.8, implementada en xd-qrn.3 ronda 2).
--
-- El problema: /api/tanques valida un movimiento leyendo el catalogo y la
-- bitacora entera, derivando el estado con js/tanques/estado.js y luego
-- escribiendo. Sin nada que serialice, dos escrituras en vuelo se juzgan cada
-- una contra la bitacora que leyeron, y dos salidas de 6000 L de un tanque con
-- 10000 L entran las dos. La derivacion NO se copia a SQL (vive solo en
-- estado.js), asi que la base no puede validar; lo que si puede es decir "la
-- bitacora cambio desde que la leiste".
--
-- Tres piezas:
--   tanques_version      una fila con un contador `v`. Un trigger AFTER INSERT
--                        OR UPDATE sobre movimientos_tanque lo incrementa en la
--                        misma transaccion que la escritura.
--   client_id            UUID que el cliente genera una vez por intencion. Es
--                        UNIQUE, asi que repetir un POST cuyo acuse se perdio
--                        devuelve la fila que ya existe en lugar de duplicarla.
--   tanques_escribir()   la unica escritura del endpoint. Toma la fila de
--                        tanques_version FOR UPDATE (eso serializa), compara `v`
--                        con la version que el endpoint leyo ANTES de leer la
--                        bitacora, y si difiere devuelve conflicto sin escribir:
--                        el endpoint relee, revalida y reintenta.
--
-- Orden de las comprobaciones en tanques_escribir: primero la idempotencia
-- (client_id ya registrado, fila inexistente o ya anulada), despues la version.
-- Asi un reintento de una escritura que SI entro contesta duplicado aunque la
-- version ya haya avanzado por esa misma escritura, en vez de gastar reintentos
-- en conflictos que no lo son.
--
-- Advertencia de re-corrida: esta migracion redefine
-- movimientos_tanque_append_only() para congelar tambien client_id. Re-correr
-- migration_tanques.sql DESPUES de esta devolveria la version anterior de la
-- funcion (sin client_id). Si alguna vez se re-corre aquella, re-correr esta
-- tambien.
--
-- Idempotente y transaccional: seguro de re-correr.
-- ==================================================================

BEGIN;

-- --- tanques_version ---
CREATE TABLE IF NOT EXISTS public.tanques_version (
  id INT    PRIMARY KEY DEFAULT 1,
  v  BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE public.tanques_version DROP CONSTRAINT IF EXISTS tanques_version_una_fila_chk;
ALTER TABLE public.tanques_version ADD  CONSTRAINT tanques_version_una_fila_chk CHECK (id = 1);

INSERT INTO public.tanques_version (id, v) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.tanques_version IS
  'Contador de cambios de movimientos_tanque. tanques_escribir() lo bloquea y lo compara para serializar escrituras.';

-- El incremento es un upsert para que una fila borrada a mano se recree en
-- lugar de dejar el contador congelado en silencio (un UPDATE sobre cero filas
-- no falla, y una version que nunca cambia aprobaria cualquier escritura vieja).
CREATE OR REPLACE FUNCTION public.tanques_version_incrementar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.tanques_version AS tv (id, v) VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE SET v = tv.v + 1;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS movimientos_tanque_version ON public.movimientos_tanque;
CREATE TRIGGER movimientos_tanque_version
  AFTER INSERT OR UPDATE ON public.movimientos_tanque
  FOR EACH ROW EXECUTE FUNCTION public.tanques_version_incrementar();

-- --- client_id ---
-- Nullable: las filas anteriores y las que se inserten desde el SQL editor no
-- lo traen, y UNIQUE admite varios NULL. El endpoint lo exige en cada crear.
ALTER TABLE public.movimientos_tanque ADD COLUMN IF NOT EXISTS client_id UUID;

ALTER TABLE public.movimientos_tanque DROP CONSTRAINT IF EXISTS movimientos_tanque_client_id_key;
ALTER TABLE public.movimientos_tanque ADD  CONSTRAINT movimientos_tanque_client_id_key UNIQUE (client_id);

COMMENT ON COLUMN public.movimientos_tanque.client_id IS
  'Clave de idempotencia generada por el cliente una vez por intencion; un reintento con la misma clave devuelve la fila existente.';

-- Misma funcion que en migration_tanques.sql, con client_id agregado a las
-- columnas congeladas: una clave de idempotencia que se pudiera reescribir
-- dejaria de identificar la intencion que registro la fila. Todo lo demas es
-- identico.
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
      NEW.creado_por, NEW.created_at, NEW.client_id)
     IS DISTINCT FROM
     (OLD.id, OLD.fecha, OLD.tipo, OLD.origen, OLD.destino, OLD.lot_code,
      OLD.vintage_year, OLD.volumen_l, OLD.merma_l, OLD.nota, OLD.fuente,
      OLD.creado_por, OLD.created_at, OLD.client_id)
  THEN
    RAISE EXCEPTION
      'movimientos_tanque solo admite cambiar anulado: anula el id % e inserta el movimiento corregido', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

-- --- tanques_escribir ---
-- p_version: la `v` que el endpoint leyo antes de leer la bitacora.
-- p_accion:  'crear' (inserta p_fila) o 'anular' (marca p_id).
-- Devuelve jsonb con `resultado`:
--   conflicto   la bitacora cambio; trae la `version` actual. Nada se escribio.
--   creado      con `fila`.
--   duplicado   el client_id ya estaba; `fila` es la existente. Nada se escribio.
--   anulado     con `fila`.
--   ya_anulado  con `fila`. Nada se escribio.
--   no_existe   no hay fila con ese id.
-- Del jsonb solo se leen las columnas de la lista: id, anulado y created_at
-- nunca llegan de afuera aunque vengan en p_fila.
-- SECURITY INVOKER: corre con los permisos de quien llama, y solo service_role
-- puede llamarla (EXECUTE revocado a PUBLIC, anon y authenticated, abajo).
CREATE OR REPLACE FUNCTION public.tanques_escribir(
  p_version BIGINT,
  p_accion  TEXT,
  p_fila    JSONB  DEFAULT NULL,
  p_id      BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actual  BIGINT;
  v_cliente UUID;
  v_fila    public.movimientos_tanque%ROWTYPE;
BEGIN
  -- El candado que serializa: una segunda llamada espera aqui hasta que la
  -- primera termine y entonces lee la `v` ya incrementada.
  SELECT tv.v INTO v_actual FROM public.tanques_version tv WHERE tv.id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tanques_version no tiene fila: corre migration_tanques_escritura';
  END IF;

  IF p_accion = 'crear' THEN
    IF p_fila IS NULL OR jsonb_typeof(p_fila) <> 'object' THEN
      RAISE EXCEPTION 'tanques_escribir crear: p_fila debe ser un objeto';
    END IF;
    v_cliente := (p_fila ->> 'client_id')::uuid;
    IF v_cliente IS NULL THEN
      RAISE EXCEPTION 'tanques_escribir crear: falta client_id';
    END IF;

    SELECT * INTO v_fila FROM public.movimientos_tanque WHERE client_id = v_cliente;
    IF FOUND THEN
      RETURN jsonb_build_object('resultado', 'duplicado', 'fila', to_jsonb(v_fila));
    END IF;

    IF p_version IS DISTINCT FROM v_actual THEN
      RETURN jsonb_build_object('resultado', 'conflicto', 'version', v_actual);
    END IF;

    INSERT INTO public.movimientos_tanque
      (fecha, tipo, origen, destino, lot_code, vintage_year, volumen_l, merma_l,
       nota, fuente, creado_por, client_id)
    VALUES
      ((p_fila ->> 'fecha')::date,
       p_fila ->> 'tipo',
       p_fila ->> 'origen',
       p_fila ->> 'destino',
       p_fila ->> 'lot_code',
       (p_fila ->> 'vintage_year')::int,
       (p_fila ->> 'volumen_l')::numeric,
       COALESCE((p_fila ->> 'merma_l')::numeric, 0),
       p_fila ->> 'nota',
       p_fila ->> 'fuente',
       p_fila ->> 'creado_por',
       v_cliente)
    ON CONFLICT (client_id) DO NOTHING
    RETURNING * INTO v_fila;

    IF NOT FOUND THEN
      -- Solo posible si alguien inserto la misma clave por fuera de esta
      -- funcion entre la busqueda y el INSERT; sigue siendo un duplicado.
      SELECT * INTO v_fila FROM public.movimientos_tanque WHERE client_id = v_cliente;
      RETURN jsonb_build_object('resultado', 'duplicado', 'fila', to_jsonb(v_fila));
    END IF;
    RETURN jsonb_build_object('resultado', 'creado', 'fila', to_jsonb(v_fila));

  ELSIF p_accion = 'anular' THEN
    SELECT * INTO v_fila FROM public.movimientos_tanque WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('resultado', 'no_existe');
    END IF;
    IF v_fila.anulado THEN
      RETURN jsonb_build_object('resultado', 'ya_anulado', 'fila', to_jsonb(v_fila));
    END IF;

    IF p_version IS DISTINCT FROM v_actual THEN
      RETURN jsonb_build_object('resultado', 'conflicto', 'version', v_actual);
    END IF;

    UPDATE public.movimientos_tanque SET anulado = true WHERE id = p_id
      RETURNING * INTO v_fila;
    RETURN jsonb_build_object('resultado', 'anulado', 'fila', to_jsonb(v_fila));
  END IF;

  RAISE EXCEPTION 'tanques_escribir: accion no valida %', p_accion;
END;
$$;

-- --- Seguridad ---
-- tanques_version es de servidor, igual que las tablas de migration_tanques:
-- RLS activo sin politicas y sin grants para anon ni authenticated.
ALTER TABLE public.tanques_version ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tanques_version FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tanques_version TO service_role;

-- Postgres le da EXECUTE a PUBLIC en cada funcion nueva, y Supabase ademas a
-- anon y authenticated por privilegios por omision. Se quitan los tres.
REVOKE EXECUTE ON FUNCTION public.tanques_escribir(BIGINT, TEXT, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tanques_escribir(BIGINT, TEXT, JSONB, BIGINT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.tanques_version_incrementar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.movimientos_tanque_append_only() FROM anon, authenticated;

INSERT INTO public.applied_migrations (name) VALUES ('migration_tanques_escritura')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
