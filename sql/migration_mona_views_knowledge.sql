-- Migration: Mona saved views + knowledge base (server-only, RLS locked)
--
-- mona_saved_views: per-user pinned charts/tables (spec jsonb rendered client-side).
-- mona_knowledge:   winery facts Mona reads on every chat. Facts are proposed
--                   (status 'pending') by users or Mona and only injected into
--                   Mona's context once a lab/admin approves them (status 'approved').
-- Both accessed ONLY through /api/mona-data (service key). RLS on, no anon policies.

CREATE TABLE IF NOT EXISTS public.mona_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  title text NOT NULL,
  view_type text NOT NULL,          -- 'chart' | 'table'
  spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mona_saved_views_user_idx
  ON public.mona_saved_views (username, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mona_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact text NOT NULL,
  status text NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved'
  proposed_by text,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mona_knowledge_status_idx
  ON public.mona_knowledge (status);

ALTER TABLE public.mona_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mona_knowledge   ENABLE ROW LEVEL SECURITY;

INSERT INTO public.applied_migrations (name) VALUES ('migration_mona_views_knowledge')
  ON CONFLICT (name) DO NOTHING;
