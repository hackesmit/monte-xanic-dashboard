-- sql/migration_phenolic_maturity.sql
-- Adds optional winemaker-assessed phenolic maturity tier to mediciones_tecnicas.
-- Consumed by the quality classification engine (js/classification.js) as a
-- +3/0/-3 overlay on the 36-pt score. NULL means "not assessed" and is treated
-- as 0 adjustment.

ALTER TABLE mediciones_tecnicas
  ADD COLUMN IF NOT EXISTS phenolic_maturity TEXT
  CHECK (phenolic_maturity IN ('Sobresaliente','Parcial','No sobresaliente'));
