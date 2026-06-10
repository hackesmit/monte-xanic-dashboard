-- Migration: RLS lockdown (security audit 2026-06)
--
-- 1) wine_samples / tank_receptions / reception_lots / prefermentativos:
--    all writes go through /api/upload and /api/row using the service key
--    (which bypasses RLS), so the blanket anon INSERT/UPDATE policies only
--    served to let any holder of the anon key bypass the lab/admin role
--    checks. Drop them. meteorology keeps its anon write policies because
--    the client-side weather sync (js/weather.js) upserts it directly.
--
-- 2) berry_samples / mediciones_tecnicas / harvest_target_overrides:
--    RLS was never enabled, leaving them fully writable with the anon key.
--    Enable RLS with read-only public access (the dashboard loads them
--    client-side); writes stay service-key only.
--
-- 3) rate_limits / token_blacklist / pre_receptions: server-only tables.
--    Enable RLS with NO anon policies — without this, an attacker with the
--    anon key could un-revoke blacklisted sessions or reset login
--    rate-limit buckets.

-- (1) Drop anon write policies on API-managed tables
DROP POLICY IF EXISTS "anon_insert" ON public.wine_samples;
DROP POLICY IF EXISTS "anon_update" ON public.wine_samples;
DROP POLICY IF EXISTS "anon_insert" ON public.tank_receptions;
DROP POLICY IF EXISTS "anon_update" ON public.tank_receptions;
DROP POLICY IF EXISTS "anon_insert" ON public.reception_lots;
DROP POLICY IF EXISTS "anon_update" ON public.reception_lots;
DROP POLICY IF EXISTS "anon_insert" ON public.prefermentativos;
DROP POLICY IF EXISTS "anon_update" ON public.prefermentativos;

-- (2) Client-readable tables: RLS on, SELECT only
ALTER TABLE public.berry_samples            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mediciones_tecnicas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harvest_target_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read" ON public.berry_samples;
DROP POLICY IF EXISTS "public_read" ON public.mediciones_tecnicas;
DROP POLICY IF EXISTS "public_read" ON public.harvest_target_overrides;
CREATE POLICY "public_read" ON public.berry_samples            FOR SELECT USING (true);
CREATE POLICY "public_read" ON public.mediciones_tecnicas      FOR SELECT USING (true);
CREATE POLICY "public_read" ON public.harvest_target_overrides FOR SELECT USING (true);

-- (3) Server-only tables: RLS on, no anon policies at all
ALTER TABLE public.rate_limits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_receptions  ENABLE ROW LEVEL SECURITY;

INSERT INTO public.applied_migrations (name) VALUES ('migration_rls_lockdown')
  ON CONFLICT (name) DO NOTHING;
