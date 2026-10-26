-- Login rate limit: a failed stale sweep no longer cancels the count (bead xd-tqx, round 2).
--
-- migration_login_rate_limit_atomic ran the stale-row sweep in the same block as
-- the upsert. Any error in the sweep (DELETE revoked from service_role, a
-- trigger, a policy) raised out of login_rate_limit_hit, which rolled back the
-- increment too. api/_lib/loginRateLimit.js then fell back to its per-instance
-- in-memory map, so the persistent limit stopped holding: 10 attempts per
-- instance instead of 10 per IP. The old client code tolerated a failed sweep;
-- the move into Postgres had lost that.
--
-- The sweep now runs in its own BEGIN ... EXCEPTION block. Postgres runs that
-- block under a savepoint, so an error there rolls back only the DELETE and the
-- upsert above it stands. The function logs a WARNING and returns the verdict
-- as before. Everything else is byte for byte migration_login_rate_limit_atomic.

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

  -- Housekeeping only: its failure must not undo the count above.
  BEGIN
    DELETE FROM public.rate_limits
     WHERE ip IN (SELECT s.ip FROM public.rate_limits s
                   WHERE s.window_start < v_cutoff AND s.ip <> p_ip
                   FOR UPDATE SKIP LOCKED);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'login_rate_limit_hit: stale sweep failed, count kept: % (%)', SQLERRM, SQLSTATE;
  END;

  RETURN v_attempts <= p_max;
END;
$$;

-- CREATE OR REPLACE keeps the existing grants; restate them so this file is
-- correct on its own.
REVOKE EXECUTE ON FUNCTION public.login_rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.login_rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;

INSERT INTO public.applied_migrations (name) VALUES ('migration_login_rate_limit_sweep_isolated')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
