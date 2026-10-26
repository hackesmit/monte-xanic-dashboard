-- Migration: Add sample_seq column for same-day duplicate handling
-- Allows multiple measurements of the same sample on the same date.
-- Run this in Supabase SQL Editor.

-- 1. Add sample_seq column (default 1 for existing rows)
ALTER TABLE wine_samples
ADD COLUMN IF NOT EXISTS sample_seq INTEGER NOT NULL DEFAULT 1;

-- 2. Drop old unique constraint if it exists
-- Note: migration_overhaul.sql named this wine_samples_sample_id_date_key
ALTER TABLE wine_samples
DROP CONSTRAINT IF EXISTS wine_samples_sample_id_date_key;
ALTER TABLE wine_samples
DROP CONSTRAINT IF EXISTS wine_samples_sample_id_sample_date_key;

-- 3. Create new composite unique constraint. Guarded because sql/schema.sql
-- now creates it on a fresh install (xd-ajy), and replaying this file there
-- must not fail on a constraint that already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.wine_samples'::regclass
      AND conname = 'wine_samples_sample_id_sample_date_seq_key'
  ) THEN
    ALTER TABLE wine_samples
    ADD CONSTRAINT wine_samples_sample_id_sample_date_seq_key
    UNIQUE (sample_id, sample_date, sample_seq);
  END IF;
END $$;

-- 4. Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_wine_samples_sample_seq
ON wine_samples (sample_id, sample_date, sample_seq);
