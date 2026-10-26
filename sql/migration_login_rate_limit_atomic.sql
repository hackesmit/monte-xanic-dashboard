-- Atomic login rate limit (bead xd-tqx).
--
-- api/_lib/loginRateLimit.js used to read the rate_limits row, add 1 in JS and
-- PATCH it back. Overlapping logins from one IP all read the same count and all
-- passed, so the 10-per-15-minutes limit did not hold under parallel load.
--
-- login_rate_limit_hit does the whole step in one statement: INSERT ... ON
-- CONFLICT DO UPDATE takes the row lock, so a second attempt for the same IP
-- waits there and then sees the incremented count. It returns TRUE when the
-- caller is still within p_max for the current window.
--
-- A window older than p_window_seconds restarts at 1. While blocked the count
-- is capped at p_max + 1 so a flood cannot overflow INTEGER.
--
-- The stale-row sweep runs AFTER the upsert and uses FOR UPDATE SKIP LOCKED:
-- it never waits on a row another attempt holds, so the only lock wait is the
-- single upsert above and two attempts cannot deadlock each other.
--
-- SECURITY INVOKER: runs with the caller's rights, and only service_role may
-- call it (EXECUTE revoked from PUBLIC, anon and authenticated, below).

BEGIN;

CREATE OR REPLACE FUNCTION public.login_rate_limit_hit(
  p_ip             TEXT,
  p_window_seconds INTEGER,
  p_max            INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cutoff   TIMESTAMPTZ := now() - make_interval(secs => p_window_seconds);
  v_attempts INTEGER;
BEGIN
  INSERT INTO public.rate_limits AS r (ip, attempts, window_start)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip) DO UPDATE SET
    attempts     = CASE WHEN r.window_start < v_cutoff THEN 1
                        ELSE LEAST(r.attempts + 1, p_max + 1) END,
    window_start = CASE WHEN r.window_start < v_cutoff THEN now()
                        ELSE r.window_start END
  RETURNING r.attempts INTO v_attempts;

  DELETE FROM public.rate_limits
   WHERE ip IN (SELECT s.ip FROM public.rate_limits s
                 WHERE s.window_start < v_cutoff AND s.ip <> p_ip
                 FOR UPDATE SKIP LOCKED);

  RETURN v_attempts <= p_max;
END;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase also
-- to anon and authenticated through default privileges. Remove all three.
REVOKE EXECUTE ON FUNCTION public.login_rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.login_rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;

INSERT INTO public.applied_migrations (name) VALUES ('migration_login_rate_limit_atomic')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
