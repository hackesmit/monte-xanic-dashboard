# Round 38 — Harvest predictor smoke checklist

After running `sql/migration_harvest_target_overrides.sql` in the Supabase SQL Editor and deploying the Vercel preview, verify each of the following.

The feature ships behind `CONFIG.harvestPredictorEnabled` (`js/config.js`). Set it to `true` locally for smoke; flip it on in the deployed config once the lab team has validated against the live vintage for one week (per spec §9.5 rollout).

## Pre-flight

- [ ] Apply migration in Supabase SQL Editor → `SELECT name FROM applied_migrations WHERE name = 'migration_harvest_target_overrides';` returns one row.
- [ ] `npm test` passes locally (mt23, mt24, mt25, mt26 all green).
- [ ] `CONFIG.harvestPredictorEnabled = true`; reload the app in the browser.

## As `lab` user

- [ ] The **Predicción** chip appears in `#nav-tabs`, immediately after Mediciones.
- [ ] Click **Predicción** → view renders, cards are sorted ascending by days-until. Any `ya-en-ventana` cards appear at the top; `pocos-datos-temporada` placeholders appear at the bottom.
- [ ] Click chip **VDG** → only VDG cards remain. Click **Todas** → full grid returns.
- [ ] Open one card visually — the solid line traces through the observed dots, a dashed projection extends to the right, the translucent gray cone widens with horizon, the dashed green target line is visible.
- [ ] Cards for white varietals (e.g. Sauvignon Blanc) show ONE chart (Brix only) — no Antocianinas section.
- [ ] Cards in the `riesgo-sobremadurez` or `no-alcanzar-A` state render with the amber `pred-card-alert` border and Spanish reason copy in place of the date.
- [ ] A varietal-ranch with `n=1` (or none in the current vintage) renders as a dashed `pred-card-empty` placeholder showing "Pocos datos esta temporada · se requiere n ≥ 2".

## Settings — `lab`

- [ ] Click **⚙ Ajustes de objetivos** in the Predicción header → settings page opens.
- [ ] Settings table renders one row per `(variety, valley)` combo that has a rubric entry. Each numeric input is editable.
- [ ] Empty inputs show the rubric-inherited value as a dimmed placeholder.
- [ ] White varietals show **"no aplica"** in the ANT column (no `<input>` rendered).
- [ ] The meta line under the header reads either "Última actualización: <user> · <date>" or "Sin overrides registrados — todos los valores se heredan de la rúbrica."
- [ ] Change Brix objetivo for **Cabernet Sauvignon · VON** to 23.6 → click **Guardar cambios**. No error alert.
- [ ] DevTools Network tab shows a POST to `/api/row` with `{ table: 'harvest_target_overrides', action: 'upsert', row: { variety: 'Cabernet Sauvignon', valley: 'VON', brix_target: 23.6 } }` and the response is `{ ok: true, row: { ... } }`.
- [ ] Click **← Volver a Predicción** → return to the view. The CS · Kompali (VON) card's recommended date has shifted (slightly earlier, since the new midpoint 23.6 is lower).
- [ ] Re-enter Settings → the CS · VON row's note column reads **"heredado: Brix mín, Brix tope, ANT (..)"** and the Brix objetivo cell shows `23.6` (not the placeholder).

## Settings — non-`lab`

- [ ] As an `admin` or `viewer` user, open Settings → all `<input>` controls are disabled; **Guardar cambios** is disabled.
- [ ] Editing is blocked client-side; if a viewer crafts a POST to `/api/row` with `action: 'upsert'` against this table, the server returns 403 (`Sin permisos para editar datos`).

## Map view sanity

- [ ] Switch from Predicción to Mapa → filter sidebars / map renders as before. No console errors from the predictor view leaking into other views.

## Mobile (≤ 720px)

- [ ] Predicción grid collapses to one card per row; each card's charts shrink but stay readable.
- [ ] Settings table scrolls horizontally; Varietal / Valle columns remain visible.

## Performance

- [ ] First render of Predicción with the full berry dataset completes in well under one second on a typical laptop. (If it stalls noticeably, capture a CPU profile — the predictor is expected to be < 50 ms per spec §4 compute strategy.)

## Demo mode

- [ ] Toggle demo mode on → Predicción card grid still renders (against the demo-overlay berry data) without crashing. Demo mode stubs `loadHarvestTargetOverrides()` to a no-op, so the override array is whatever was loaded before demo mode activated.

## Rollout follow-ups (post-smoke)

- [ ] Lab team uses Predicción against the live vintage for one week.
- [ ] Replace the synthetic samples in `tests/fixtures/prediction-2024-kompali-cs.json` with real 2024 CS Kompali WineXRay rows; re-run `npm test` and confirm MAE assertions in `tests/mt26-prediction-backtest.test.mjs` still pass.
- [ ] Add additional `tests/fixtures/prediction-*.json` files for other varietal-ranches to expand backtest coverage.
- [ ] Flip `CONFIG.harvestPredictorEnabled = true` in `js/config.js`; commit and deploy. Remove the flag entirely in the next cleanup PR (no v1/v2 shims per spec §9.5).
