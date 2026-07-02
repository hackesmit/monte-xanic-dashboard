-- Migration: Mona chat history (server-only, RLS locked)
--
-- mona_conversations / mona_messages hold per-user chat history. They are
-- accessed ONLY through /api/mona-data using the service key. Consistent with
-- migration_rls_lockdown: RLS enabled with NO anon policies, so the anon key
-- cannot read another user's private conversations.

CREATE TABLE IF NOT EXISTS public.mona_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  title text NOT NULL DEFAULT 'Conversación',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mona_conversations_user_idx
  ON public.mona_conversations (username, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.mona_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.mona_conversations (id) ON DELETE CASCADE,
  role text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mona_messages_conv_idx
  ON public.mona_messages (conversation_id, created_at);

ALTER TABLE public.mona_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mona_messages      ENABLE ROW LEVEL SECURITY;

INSERT INTO public.applied_migrations (name) VALUES ('migration_mona_chat')
  ON CONFLICT (name) DO NOTHING;
