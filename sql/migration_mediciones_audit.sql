-- Round 37: lightweight audit stamps for in-dashboard editing of
-- mediciones_tecnicas. Both columns are NULLable so historical rows
-- (which have no edit history) remain valid.

ALTER TABLE public.mediciones_tecnicas
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_mediciones_audit')
  ON CONFLICT (name) DO NOTHING;
