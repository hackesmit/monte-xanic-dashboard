-- sql/migration_reception_lots_upsert.sql
-- Fixes pre-existing bug: reception_lots had UNIQUE (reception_id, lot_code)
-- but api/upload.js has conflict:null and required:['reception_id'] while the
-- client sends report_code. The path never worked. Switch to report_code as
-- the link column and make the table upsert-able.

ALTER TABLE public.reception_lots
  ADD COLUMN IF NOT EXISTS report_code TEXT;

-- Backfill from FK for any existing rows
UPDATE public.reception_lots rl
  SET report_code = tr.report_code
  FROM public.tank_receptions tr
  WHERE rl.reception_id = tr.id
    AND rl.report_code IS NULL;

-- Going forward, report_code is required; reception_id becomes optional
ALTER TABLE public.reception_lots ALTER COLUMN report_code SET NOT NULL;
ALTER TABLE public.reception_lots ALTER COLUMN reception_id DROP NOT NULL;

-- Replace old uniqueness key with the new upsert key
ALTER TABLE public.reception_lots
  DROP CONSTRAINT IF EXISTS reception_lots_reception_id_lot_code_key;

ALTER TABLE public.reception_lots
  ADD CONSTRAINT reception_lots_upsert_key
  UNIQUE (report_code, lot_position);
