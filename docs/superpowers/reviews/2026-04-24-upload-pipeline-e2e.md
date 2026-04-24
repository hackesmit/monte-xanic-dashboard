# E2E Verification — Upload Bulletproof Pipeline

**Date:** 2026-04-24
**Branch:** `upload-bulletproof-pipeline`
**Commits:** `f6d9a43` … `935e458` (17 commits)
**Spec:** `docs/superpowers/specs/2026-04-24-upload-berry-wine-split-design.md`
**Plan:** `docs/superpowers/plans/2026-04-24-upload-bulletproof-pipeline.md`

## Scope of verification

User ran the three recurring uploads against the real `Xanic info/` files after applying the 3 SQL migrations in Supabase.

- **WineXRay** (`result (2).csv`) → `wine_samples` + `berry_samples`: ✅ works
- **Recepción de Tanque** (`Recepcion_de_Tanque_2025.xlsx`) → `tank_receptions` + `reception_lots` + `prefermentativos`: ✅ works
- **Pre-recepción** (`prerecepcion_actualizado (1).xlsx`) → `pre_receptions`: ✅ works

Idempotency (re-uploading the same file produces "0 nuevas · N actualizadas"): not individually confirmed row-by-row in the E2E pass, but the upsert keys are in place and tested at the unit layer (mt13–mt17).

## Automated check results

- `npm test` — **266/266 tests pass** including new mt13–mt17 suites
- `npm run build` — **success** (pre-existing chunk-size warning only, unrelated)

## Known follow-up: quality map doesn't recognize samples

User reported that the **quality map view is not recognizing samples** after the migration. The rest of the dashboard behaves correctly. This regression is explicitly deferred; the user approved landing this branch first and filing the map fix separately.

Likely root cause (hypothesis — not verified):

- `js/maps.js` renders a quality score per sample via `js/classification.js`, which operates on `DataStore.wineData`.
- The WineXRay parser now routes `Sample Type = 'Berries'` rows to `berry_samples` instead of dumping them into `wine_samples`. If `classification.js` / `maps.js` were silently picking up berry rows via `sample_id → appellation/ranch` joins and those rows no longer flow into `wine_samples`, the map would come up empty for lots that used to be identified by their berry samples.
- Alternative cause: `dataLoader.js` doesn't yet query `berry_samples` at all, so any view that relied on the old "all rows in `wine_samples`" model will show gaps where berry rows used to be.

Not debugged in this branch. Recommended next spec: "Berry-aware downstream views: dataLoader + maps + classification updates." See plan §14 (follow-up scope) in the spec document.

## MOSTOS one-off import

`scripts/import-mostos-2024.js` is ready but not yet run against production. User will invoke manually when convenient. Not a blocker for shipping this branch.
