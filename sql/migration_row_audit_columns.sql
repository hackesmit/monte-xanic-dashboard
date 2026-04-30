-- Phase 10 / Stage 7.1: extend the Round-37 mediciones audit pattern to the
-- other editable tables (wine_samples, prefermentativos). Both columns are
-- NULLable so historical rows (which have no edit history) remain valid.
-- Apply manually in Supabase SQL Editor before lab users start editing
-- berry / recepción / preferment rows.

ALTER TABLE public.wine_samples
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

ALTER TABLE public.prefermentativos
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_row_audit_columns')
  ON CONFLICT (name) DO NOTHING;
