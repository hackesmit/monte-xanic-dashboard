-- One-time cleanup: remove lab extraction tests and non-grape samples from wine_samples
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- Preview what will be deleted (run this first to verify):
SELECT id, sample_id, sample_type, variety, sample_date
FROM wine_samples
WHERE sample_id ~* '(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)'
   OR sample_type ~* '(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)'
ORDER BY sample_id;

-- Once verified, uncomment and run the DELETE:
-- DELETE FROM wine_samples
-- WHERE sample_id ~* '(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)'
--    OR sample_type ~* '(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)';
