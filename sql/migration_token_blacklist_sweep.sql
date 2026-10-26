-- token_blacklist sweep in bounded batches (bead xd-mqy, round 2).
--
-- migration_token_blacklist promised an auto-cleanup that never existed, so
-- every revocation stayed forever. This function deletes at most p_limit rows
-- whose token has expired and returns how many it deleted. The daily cron
-- /api/sweep-blacklist calls it again and again, each call its own
-- transaction, so a large backlog makes progress batch by batch and a timeout
-- loses one batch, never the work already done. It runs only from that cron,
-- never on the logout or verify path.
--
-- The window is 3 h: api/login.js gives a token 2 h of life, and the extra
-- hour covers skew between the login host's clock (which stamps exp) and this
-- database's now() (which stamps invalidated_at). A row younger than that may
-- still guard a live token, so it is never deleted (tests/mt74 pins the window
-- against login.js).
--
-- Idempotent: a call with nothing old enough deletes 0 rows. FOR UPDATE SKIP
-- LOCKED lets two overlapping runs split the rows instead of waiting on each
-- other. The ORDER BY on invalidated_at uses idx_token_blacklist_time.

BEGIN;

CREATE OR REPLACE FUNCTION public.token_blacklist_sweep(p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'token_blacklist_sweep: p_limit must be between 1 and 10000, got %', p_limit;
  END IF;

  DELETE FROM public.token_blacklist
   WHERE token_hash IN (SELECT b.token_hash FROM public.token_blacklist b
                         WHERE b.invalidated_at < now() - interval '3 hours'
                         ORDER BY b.invalidated_at
                         LIMIT p_limit
                         FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.token_blacklist_sweep(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.token_blacklist_sweep(INTEGER) TO service_role;

INSERT INTO public.applied_migrations (name) VALUES ('migration_token_blacklist_sweep')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
