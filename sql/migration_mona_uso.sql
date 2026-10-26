-- migration_mona_uso.sql — shared daily spend ceiling for /api/mona (xd-aiz).
--
-- /api/mona is the only endpoint that spends money per request (Anthropic, on
-- the winery's key). Its old limit was an in-memory Map per Vercel instance, so
-- the real ceiling was N x instance-count. The counter now lives here, shared by
-- every instance: one row per user per day (America/Tijuana), requests and
-- tokens. Server-only: RLS on, no policies, and the two functions are callable
-- by service_role alone (api/mona.js holds the service key).

CREATE TABLE IF NOT EXISTS public.mona_uso (
  username    text        NOT NULL,
  dia         date        NOT NULL,
  peticiones  integer     NOT NULL DEFAULT 0,
  tokens      bigint      NOT NULL DEFAULT 0,
  actualizado timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, dia)
);

ALTER TABLE public.mona_uso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mona_uso FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mona_uso TO service_role;

-- Reserve one request for p_username today. Atomic: the row lock taken by the
-- UPDATE serialises concurrent calls, so N parallel requests at the edge of the
-- cap admit exactly the ones that fit. Refuses once either the request count or
-- the tokens already spent reach their cap. Returns
-- { permitido, dia, peticiones, tokens }; dia goes back to mona_uso_sumar_tokens
-- so a stream that crosses midnight is charged to the day it was admitted on.
CREATE OR REPLACE FUNCTION public.mona_uso_reservar(
  p_username text, p_max_peticiones integer, p_max_tokens bigint
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_dia date := (now() AT TIME ZONE 'America/Tijuana')::date;
  v_row public.mona_uso%ROWTYPE;
BEGIN
  IF p_username IS NULL OR p_username = '' THEN
    RAISE EXCEPTION 'mona_uso_reservar: username requerido';
  END IF;

  INSERT INTO public.mona_uso (username, dia) VALUES (p_username, v_dia)
    ON CONFLICT (username, dia) DO NOTHING;

  UPDATE public.mona_uso u
     SET peticiones = u.peticiones + 1, actualizado = now()
   WHERE u.username = p_username AND u.dia = v_dia
     AND u.peticiones < p_max_peticiones AND u.tokens < p_max_tokens
  RETURNING u.* INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('permitido', true, 'dia', v_dia,
      'peticiones', v_row.peticiones, 'tokens', v_row.tokens);
  END IF;

  SELECT * INTO v_row FROM public.mona_uso u WHERE u.username = p_username AND u.dia = v_dia;
  RETURN jsonb_build_object('permitido', false, 'dia', v_dia,
    'peticiones', v_row.peticiones, 'tokens', v_row.tokens);
END;
$$;

-- Add the tokens one finished (or aborted) stream actually used.
CREATE OR REPLACE FUNCTION public.mona_uso_sumar_tokens(
  p_username text, p_dia date, p_tokens bigint
) RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.mona_uso
     SET tokens = tokens + GREATEST(COALESCE(p_tokens, 0), 0), actualizado = now()
   WHERE username = p_username AND dia = p_dia;
$$;

REVOKE ALL ON FUNCTION public.mona_uso_reservar(text, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mona_uso_sumar_tokens(text, date, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mona_uso_reservar(text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.mona_uso_sumar_tokens(text, date, bigint) TO service_role;

INSERT INTO public.applied_migrations (name) VALUES ('migration_mona_uso')
  ON CONFLICT (name) DO NOTHING;
