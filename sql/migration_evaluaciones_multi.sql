-- sql/migration_evaluaciones_multi.sql
-- Vendimia 2026: a medicion is graded by 1..N evaluators, not one.
--
-- Background. Grado Sanitario and Madurez fenolica were single scalar columns
-- filled by one person. The Prerecepcion Vendimia 2026 workbook ships three
-- evaluator columns per axis, and Daniel asked (2026-08-12) that the panel be
-- unbounded, with the quality weighting driven by the average of everyone who
-- graded. This migration makes the panel the source of truth.
--
--   1. Add `evaluaciones` JSONB: [{ evaluador, sanidad, madurez }].
--   2. Widen both CHECK constraints to the 2026 vocabulary.
--   3. Rename the pre-2026 sanitary vocabulary in place.
--   4. Backfill `evaluaciones` from the existing scalars.
--
-- health_grade and phenolic_maturity survive as the derived consensus label so
-- existing readers (mediciones table, map tooltips, Mona, exports) keep working.
-- js/classification.js reads `evaluaciones` when present and falls back to the
-- scalars otherwise, so this migration and the code are order-independent.
--
-- Idempotent: every step is guarded, so a re-run is a no-op.
--
-- Wrapped in one transaction. Between the DROP CONSTRAINT and the ADD there is
-- a window with no vocabulary check at all, and the renames run inside it; a
-- concurrent write of a pre-2026 label in that window would fail the new
-- constraint and could leave the table migrated but unconstrained. DDL is
-- transactional in Postgres, so a single transaction holds the lock through
-- the whole thing and rolls back cleanly on any failure (lucy, 2026-08-12).

BEGIN;

-- 1. The panel column, plus acidez volatil.
-- The 2026 workbook carries an 'AV (g/L)' column that the table had nowhere to
-- put, so it was parsed and discarded on every upload.
ALTER TABLE public.mediciones_tecnicas
  ADD COLUMN IF NOT EXISTS evaluaciones JSONB,
  ADD COLUMN IF NOT EXISTS av           NUMERIC;

-- 2. Widen the CHECK constraints.
-- The constraints were created inline (migration_mediciones.sql,
-- migration_phenolic_maturity.sql) so Postgres auto-named them. Drop whatever
-- check currently constrains each column rather than guessing the name.
--
-- Two narrowing conditions, both needed, and both learned from review.
--
-- conkey, not the constraint text: matching on pg_get_constraintdef would also
-- catch a composite check that merely mentions the column, for instance
--   CHECK (health_grade IN (...) AND berry_count >= 0),
-- and dropping that would silently discard the berry_count rule, which this
-- migration would never put back.
--
-- And single-column is still not specific enough: an installation could carry
-- an unrelated single-column rule such as CHECK (health_grade <> 'Contaminado').
-- Naming one label is not specific enough either, because that rule names one
-- too. So the definition must contain the COMPLETE vocabulary this migration
-- replaces, every label of the old set or every label of the new one. Only a
-- membership check over the whole vocabulary does that; a business rule about
-- a single grade cannot (lucy, 2026-08-14).
--
-- Labels are matched with their surrounding quotes so 'Limpio' cannot match
-- inside 'Muy limpio' or 'Parcialmente limpio'.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'mediciones_tecnicas'
      AND con.contype = 'c'
      AND array_length(con.conkey, 1) = 1
      AND (
        SELECT att.attname
        FROM pg_attribute att
        WHERE att.attrelid = con.conrelid
          AND att.attnum = con.conkey[1]
      ) IN ('health_grade', 'phenolic_maturity')
      AND (
        -- the complete pre-2026 sanitary vocabulary
        (    pg_get_constraintdef(con.oid) LIKE '%''Excelente''%'
         AND pg_get_constraintdef(con.oid) LIKE '%''Bueno''%'
         AND pg_get_constraintdef(con.oid) LIKE '%''Regular''%'
         AND pg_get_constraintdef(con.oid) LIKE '%''Malo''%')
        -- or the complete 2026 one, so a re-run still finds its own constraint
        OR (    pg_get_constraintdef(con.oid) LIKE '%''Muy limpio''%'
            AND pg_get_constraintdef(con.oid) LIKE '%''Limpio''%'
            AND pg_get_constraintdef(con.oid) LIKE '%''Parcialmente limpio''%'
            AND pg_get_constraintdef(con.oid) LIKE '%''Sucio''%'
            AND pg_get_constraintdef(con.oid) LIKE '%''Contaminado''%')
        -- the complete madurez vocabulary, original three or the 2026 five
        OR (    pg_get_constraintdef(con.oid) LIKE '%''Sobresaliente''%'
            AND pg_get_constraintdef(con.oid) LIKE '%''Parcial''%'
            AND pg_get_constraintdef(con.oid) LIKE '%''No sobresaliente''%')
      )
  LOOP
    RAISE NOTICE 'dropping vocabulary constraint %', c.conname;
    EXECUTE format('ALTER TABLE public.mediciones_tecnicas DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- 3. Rename the pre-2026 sanitary vocabulary.
-- Excelente and Bueno both scored 3 on the old 1-3 scale. The 2026 scale
-- separates them, so Excelente becomes the new top grade and Bueno the next
-- one down. Daniel confirmed this mapping on 2026-08-12.
UPDATE public.mediciones_tecnicas SET health_grade = 'Muy limpio'          WHERE health_grade = 'Excelente';
UPDATE public.mediciones_tecnicas SET health_grade = 'Limpio'              WHERE health_grade = 'Bueno';
UPDATE public.mediciones_tecnicas SET health_grade = 'Parcialmente limpio' WHERE health_grade = 'Regular';
UPDATE public.mediciones_tecnicas SET health_grade = 'Sucio'               WHERE health_grade = 'Malo';

-- Madurez fenolica keeps all three original labels with their original
-- weights, so there is nothing to rename. The vocabulary only gains
-- 'Buena' (+1) and 'Baja' (-1) between the existing tiers.

-- 4. Re-add the widened constraints, now that the data conforms.
ALTER TABLE public.mediciones_tecnicas
  ADD CONSTRAINT mediciones_tecnicas_health_grade_check
  CHECK (health_grade IS NULL OR health_grade IN
    ('Muy limpio','Limpio','Parcialmente limpio','Sucio','Contaminado'));

ALTER TABLE public.mediciones_tecnicas
  ADD CONSTRAINT mediciones_tecnicas_phenolic_maturity_check
  CHECK (phenolic_maturity IS NULL OR phenolic_maturity IN
    ('Sobresaliente','Buena','Parcial','Baja','No sobresaliente'));

-- 5. Backfill the panel from the scalars.
-- Only rows that have a grade and no panel yet, so a re-run cannot duplicate
-- an evaluator and the average stays correct. evaluador is NULL because the
-- pre-2026 rows never recorded who graded them; measured_by is the closest
-- thing but it names whoever took the measurements, not the visual grader.
UPDATE public.mediciones_tecnicas
SET evaluaciones = jsonb_build_array(
      jsonb_build_object(
        'evaluador', NULL,
        'sanidad',   health_grade,
        'madurez',   phenolic_maturity
      )
    )
WHERE evaluaciones IS NULL
  AND (health_grade IS NOT NULL OR phenolic_maturity IS NOT NULL);

-- Panel lookups are read-mostly and small, but the quality view filters on
-- "has anyone graded this" often enough to earn an index.
CREATE INDEX IF NOT EXISTS idx_mediciones_evaluaciones
  ON public.mediciones_tecnicas USING GIN (evaluaciones);

-- Recorded inside the transaction, so the ledger entry and the schema change
-- either both land or neither does.
INSERT INTO public.applied_migrations (name) VALUES ('migration_evaluaciones_multi')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
