-- ══════════════════════════════════════════════════════════════════
-- Monte Xanic Dashboard — Data & Schema Overhaul Migration
-- Run this against Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Origin Naming: Update appellations to ranch-first format ──

UPDATE wine_samples SET appellation = 'Monte Xanic (VDG)' WHERE appellation = 'Valle de Guadalupe (Monte Xanic)';
UPDATE wine_samples SET appellation = 'Olé (VDG)' WHERE appellation = 'Valle de Guadalupe (Olé)' OR appellation = 'Valle de Guadalupe (Ole)';
UPDATE wine_samples SET appellation = 'Siete Leguas (VDG)' WHERE appellation = 'Valle de Guadalupe (Siete Leguas)';
UPDATE wine_samples SET appellation = 'Rancho 14 (VDG)' WHERE appellation = 'Valle de Ojos Negros (Rancho 14)';
UPDATE wine_samples SET appellation = 'Kompali (VON)' WHERE appellation = 'Valle de Ojos Negros (Kompali)';
UPDATE wine_samples SET appellation = 'Viña Alta (VON)' WHERE appellation IN ('Valle de Ojos Negros (Viña Alta)', 'Valle de Ojos Negros (Vina Alta)');
UPDATE wine_samples SET appellation = 'Ojos Negros (VON)' WHERE appellation = 'Valle de Ojos Negros (Ojos Negros)';
UPDATE wine_samples SET appellation = 'Dominio de las Abejas (VON)' WHERE appellation = 'Valle de Ojos Negros (Dominio de las Abejas)';
UPDATE wine_samples SET appellation = 'Dubacano (SV)' WHERE appellation = 'Valle de Ojos Negros (Dubacano)';
UPDATE wine_samples SET appellation = 'Camino Corazón (VP)' WHERE appellation IN ('Camino Corazón (Valle de Parras)', 'Camino Corazon (Valle de Parras)');
UPDATE wine_samples SET appellation = 'San Gerónimo' WHERE appellation IN ('San Geronimo', 'San Gerónimo');

-- Resolve bare "Valle de Guadalupe" using sample_id code patterns
UPDATE wine_samples SET appellation = 'Monte Xanic (VDG)' WHERE appellation = 'Valle de Guadalupe' AND (sample_id ~* '^\d{2}(CS|CF|SY|ME|MA|GR|PV|TE|CA|MS|DU|NB|SB|CH|VG|CB|MV)MX' OR sample_id ~* '^\d{2}\w*VDG');
UPDATE wine_samples SET appellation = 'Olé (VDG)' WHERE appellation = 'Valle de Guadalupe' AND sample_id ~* '^\d{2}\w*OLE';
UPDATE wine_samples SET appellation = 'Siete Leguas (VDG)' WHERE appellation = 'Valle de Guadalupe' AND sample_id ~* '^\d{2}\w*7L';
UPDATE wine_samples SET appellation = 'Rancho 14 (VDG)' WHERE appellation = 'Valle de Guadalupe' AND sample_id ~* '^\d{2}\w*R14';
-- Fallback: remaining bare VDG → Monte Xanic
UPDATE wine_samples SET appellation = 'Monte Xanic (VDG)' WHERE appellation = 'Valle de Guadalupe';

-- Resolve bare "Valle de Ojos Negros" using sample_id code patterns
UPDATE wine_samples SET appellation = 'Kompali (VON)' WHERE appellation = 'Valle de Ojos Negros' AND sample_id ~* '^\d{2}K';
UPDATE wine_samples SET appellation = 'Viña Alta (VON)' WHERE appellation = 'Valle de Ojos Negros' AND sample_id ~* '^\d{2}\w*VA';
UPDATE wine_samples SET appellation = 'Ojos Negros (VON)' WHERE appellation = 'Valle de Ojos Negros' AND sample_id ~* '^\d{2}\w*ON';
UPDATE wine_samples SET appellation = 'Dominio de las Abejas (VON)' WHERE appellation = 'Valle de Ojos Negros' AND (sample_id ~* '^\d{2}\w*DA' OR sample_id ~* '^\d{2}\w*DLA');
-- Fallback: remaining bare VON → Ojos Negros
UPDATE wine_samples SET appellation = 'Ojos Negros (VON)' WHERE appellation = 'Valle de Ojos Negros';

-- ── 2. Petite Sirah → Durif ──

UPDATE wine_samples SET variety = 'Durif' WHERE variety = 'Petite Sirah';

-- ── 3. Remove experimental, California, and specific samples ──

DELETE FROM wine_samples WHERE sample_id IN ('24ROSEMX-5', '24CABERNETMERLOT-1', '25ROSEMX-1');
DELETE FROM wine_samples WHERE sample_id ~* 'EXP|EXPERIMENTO' OR sample_id = 'NORMAL';
DELETE FROM wine_samples WHERE appellation = 'California';

-- ── 4. Composite key for sample evolution ──
-- First check for and remove exact duplicates on (sample_id, sample_date)

DELETE FROM wine_samples a USING wine_samples b
WHERE a.id < b.id
  AND a.sample_id = b.sample_id
  AND a.sample_date = b.sample_date;

ALTER TABLE wine_samples DROP CONSTRAINT IF EXISTS wine_samples_sample_id_key;
ALTER TABLE wine_samples ADD CONSTRAINT wine_samples_sample_id_date_key UNIQUE (sample_id, sample_date);

-- ── 5. Meteorology: add location column for valley-specific weather ──

ALTER TABLE meteorology ADD COLUMN IF NOT EXISTS location TEXT DEFAULT 'VDG';

-- Update existing data: tag as VDG (Valle de Guadalupe — the original location)
UPDATE meteorology SET location = 'VDG' WHERE location IS NULL;

-- Replace single-column constraint with composite
ALTER TABLE meteorology DROP CONSTRAINT IF EXISTS meteorology_date_key;
ALTER TABLE meteorology ADD CONSTRAINT meteorology_date_location_key UNIQUE (date, location);

-- ══════════════════════════════════════════════════════════════════
-- Verification queries (run after migration)
-- ══════════════════════════════════════════════════════════════════

-- Check no old-format appellations remain
-- SELECT DISTINCT appellation FROM wine_samples ORDER BY appellation;

-- Check no Petite Sirah remains
-- SELECT COUNT(*) FROM wine_samples WHERE variety = 'Petite Sirah';

-- Check no excluded samples remain
-- SELECT COUNT(*) FROM wine_samples WHERE sample_id IN ('24ROSEMX-5','24CABERNETMERLOT-1','25ROSEMX-1');
-- SELECT COUNT(*) FROM wine_samples WHERE sample_id ~* 'EXP|EXPERIMENTO' OR sample_id = 'NORMAL';
-- SELECT COUNT(*) FROM wine_samples WHERE appellation = 'California';

-- Check composite key works
-- SELECT sample_id, sample_date, COUNT(*) FROM wine_samples GROUP BY sample_id, sample_date HAVING COUNT(*) > 1;
