-- migration_sync_lease.sql (xd-wh7)
--
-- A cross-instance lease for the WineXRay sync (api/winexray-sync.js). The
-- in-memory in-flight guard only collapses requests that land on the same warm
-- Vercel instance; two instances still ran two fetches and the later writer
-- overwrote the fresher snapshot. The lease lives here because Postgres is the
-- one thing every instance shares, and its clock is the one clock that decides
-- expiry.
--
-- One row per named job. A caller takes the row only when it is free or its
-- expires_at has passed, in ONE statement, so two callers can never both win:
-- the second INSERT waits on the first's row lock and then re-checks the WHERE
-- against the committed row. Expiry is enforced by that WHERE, not advisory: a
-- run that crashed without releasing is replaced once its time is up.
--
-- Access: service role only. RLS on with no policy, and EXECUTE revoked from
-- PUBLIC, anon and authenticated, because the anon key ships in the client and
-- must not be able to wedge or steal the lease.

CREATE TABLE IF NOT EXISTS public.sync_lease (
  name       text        PRIMARY KEY,
  owner      text        NOT NULL,
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.sync_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_lease FROM PUBLIC, anon, authenticated;

-- true when p_owner now holds p_name until now() + p_ttl_seconds; false when
-- another owner holds an unexpired lease. Re-acquiring a lease you hold is
-- refused like any other: a holder never extends itself by accident.
CREATE OR REPLACE FUNCTION public.sync_lease_acquire(p_name text, p_owner text, p_ttl_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  got integer;
BEGIN
  IF p_name IS NULL OR p_name = '' OR p_owner IS NULL OR p_owner = '' THEN
    RAISE EXCEPTION 'sync_lease_acquire: name and owner are required';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'sync_lease_acquire: ttl must be 1 to 3600 seconds, got %', p_ttl_seconds;
  END IF;

  INSERT INTO public.sync_lease AS l (name, owner, expires_at)
  VALUES (p_name, p_owner, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (name) DO UPDATE
    SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
    WHERE l.expires_at <= now();
  GET DIAGNOSTICS got = ROW_COUNT;
  RETURN got = 1;
END;
$$;

-- true when p_owner held p_name and it is now free. A caller whose lease
-- already expired and was taken over gets false and frees nothing: release is
-- by owner, so a late finally never drops someone else's lease.
CREATE OR REPLACE FUNCTION public.sync_lease_release(p_name text, p_owner text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  got integer;
BEGIN
  DELETE FROM public.sync_lease WHERE name = p_name AND owner = p_owner;
  GET DIAGNOSTICS got = ROW_COUNT;
  RETURN got = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_lease_acquire(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_lease_release(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_lease_acquire(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_lease_release(text, text) TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_lease TO service_role;

INSERT INTO public.applied_migrations (name) VALUES ('migration_sync_lease')
  ON CONFLICT (name) DO NOTHING;
