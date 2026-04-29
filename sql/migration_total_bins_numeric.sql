-- sql/migration_total_bins_numeric.sql
-- Round 32 — Widen pre_receptions.total_bins from INT to NUMERIC.
--
-- Reason: the source data legitimately includes fractional values
-- (half-bin / mixed-lot scenarios; live row MT-24-011 has total_bins=37.5).
-- The original INT declaration in migration_pre_receptions.sql was too tight;
-- Postgres rejected the row with `invalid input syntax for type integer:
-- "37.5"` and blocked the entire pre-recepción upload batch.
--
-- This is a lossless widening — existing INT rows remain valid under NUMERIC,
-- there are zero JS consumers of total_bins (no KPI, no chart, no query),
-- and tons_received in the same table is already NUMERIC.

ALTER TABLE public.pre_receptions
  ALTER COLUMN total_bins TYPE NUMERIC;
