-- La escritura de movimientos_tanque acepta la etapa (xd-qrn.9).
--
-- migration_tanques_etapa agrego la columna `etapa` (nula o una de las siete
-- ETAPAS de js/tanques/estado.js) y la lleno con la carga de inventario. Esta
-- migracion deja que un movimiento NUEVO la declare: api/tanques.js la acepta en
-- el POST y la pasa en p_fila, y aqui se reemplazan las dos funciones de
-- migration_tanques_escritura para que la lean:
--   tanques_misma_intencion  compara tambien la etapa, asi que repetir un
--                            client_id con otra etapa es client_id_distinto
--                            (409), nunca "ya estaba guardado".
--   tanques_escribir         inserta la etapa de p_fila.
-- El resto de las dos funciones es identico a migration_tanques_escritura.
--
-- Guardas: la columna y su CHECK se vuelven a asegurar (idempotente), porque
-- sin ellas el INSERT de abajo falla en cada escritura, y la tabla de version
-- tiene que existir, porque sin ella tanques_escribir no serializa nada.

BEGIN;

ALTER TABLE public.movimientos_tanque ADD COLUMN IF NOT EXISTS etapa TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'movimientos_tanque_etapa_chk'
      AND conrelid = 'public.movimientos_tanque'::regclass
  ) THEN
    ALTER TABLE public.movimientos_tanque ADD CONSTRAINT movimientos_tanque_etapa_chk
      CHECK (etapa IS NULL OR etapa IN ('rec', 'mac', 'fa', 'des', 'fml', 'cri', 'emb'));
  END IF;
  IF to_regclass('public.tanques_version') IS NULL THEN
    RAISE EXCEPTION 'falta public.tanques_version: corre migration_tanques_escritura antes';
  END IF;
END
$$;

-- --- tanques_misma_intencion ---
-- Si la fila guardada con un client_id es la MISMA intencion que p_fila. Se
-- comparan las columnas de la lista blanca (mas creado_por, que el endpoint
-- toma del token) con los tipos de la tabla: numeric contra numeric (asi 5000
-- y 5000.000 son iguales), date contra date, y merma_l ausente como 0, igual
-- que el INSERT de abajo. Un p_fila con un valor que no se puede convertir
-- lanza error, como lo haria el INSERT.
CREATE OR REPLACE FUNCTION public.tanques_misma_intencion(
  p_guardada public.movimientos_tanque,
  p_fila     JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT (p_guardada.fecha, p_guardada.tipo, p_guardada.origen, p_guardada.destino,
          p_guardada.lot_code, p_guardada.vintage_year, p_guardada.volumen_l,
          p_guardada.merma_l, p_guardada.nota, p_guardada.fuente, p_guardada.creado_por,
          p_guardada.etapa)
         IS NOT DISTINCT FROM
         ((p_fila ->> 'fecha')::date, p_fila ->> 'tipo', p_fila ->> 'origen',
          p_fila ->> 'destino', p_fila ->> 'lot_code', (p_fila ->> 'vintage_year')::int,
          (p_fila ->> 'volumen_l')::numeric, COALESCE((p_fila ->> 'merma_l')::numeric, 0),
          p_fila ->> 'nota', p_fila ->> 'fuente', p_fila ->> 'creado_por',
          p_fila ->> 'etapa')
$$;

-- --- tanques_escribir ---
-- p_version: la `v` que el endpoint leyo antes de leer la bitacora.
-- p_accion:  'crear' (inserta p_fila) o 'anular' (marca p_id).
-- Devuelve jsonb con `resultado`:
--   conflicto   la bitacora cambio; trae la `version` actual. Nada se escribio.
--   creado      con `fila`.
--   duplicado   el client_id ya estaba con los mismos datos; `fila` es la
--               existente. Nada se escribio.
--   client_id_distinto  el client_id ya estaba con OTROS datos; `fila` es la
--               existente. Nada se escribio (el endpoint responde 409).
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
      IF public.tanques_misma_intencion(v_fila, p_fila) THEN
        RETURN jsonb_build_object('resultado', 'duplicado', 'fila', to_jsonb(v_fila));
      END IF;
      -- La clave ya registro OTRO movimiento. Contestar duplicado diria "tu
      -- movimiento esta guardado" cuando lo guardado es distinto.
      RETURN jsonb_build_object('resultado', 'client_id_distinto', 'fila', to_jsonb(v_fila));
    END IF;

    IF p_version IS DISTINCT FROM v_actual THEN
      RETURN jsonb_build_object('resultado', 'conflicto', 'version', v_actual);
    END IF;

    INSERT INTO public.movimientos_tanque
      (fecha, tipo, origen, destino, lot_code, vintage_year, volumen_l, merma_l,
       nota, fuente, creado_por, client_id, etapa)
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
       v_cliente,
       p_fila ->> 'etapa')
    ON CONFLICT (client_id) DO NOTHING
    RETURNING * INTO v_fila;

    IF NOT FOUND THEN
      -- Solo posible si alguien inserto la misma clave por fuera de esta
      -- funcion entre la busqueda y el INSERT; se juzga igual que arriba.
      SELECT * INTO v_fila FROM public.movimientos_tanque WHERE client_id = v_cliente;
      IF public.tanques_misma_intencion(v_fila, p_fila) THEN
        RETURN jsonb_build_object('resultado', 'duplicado', 'fila', to_jsonb(v_fila));
      END IF;
      RETURN jsonb_build_object('resultado', 'client_id_distinto', 'fila', to_jsonb(v_fila));
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

-- CREATE OR REPLACE conserva los permisos; se repiten por si alguna de las dos
-- se recreo por fuera. Solo service_role las ejecuta.
REVOKE EXECUTE ON FUNCTION public.tanques_escribir(BIGINT, TEXT, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tanques_escribir(BIGINT, TEXT, JSONB, BIGINT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.tanques_misma_intencion(public.movimientos_tanque, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tanques_misma_intencion(public.movimientos_tanque, JSONB) TO service_role;

INSERT INTO public.applied_migrations (name) VALUES ('migration_tanques_etapa_escritura')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
