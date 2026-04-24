# Upload Redesign: Split Berry and Wine Samples from a Single WineXRay CSV

**Status:** Design approved, awaiting user review before implementation plan
**Date:** 2026-04-24
**Owner:** Planner (this doc) → Builder (implementation)
**Related:** `js/upload.js`, `api/upload.js`, `js/config.js`, `sql/`

---

## 1. Problem

Today the upload pipeline is gated on file extension: `.csv` is always treated as a WineXRay export destined for `wine_samples`, and `.xlsx` is always Recepción de Tanque destined for `tank_receptions` + `reception_lots` + `prefermentativos`. That works for the Recepción path, but the WineXRay CSV path is broken in two ways:

1. A single WineXRay export mixes sample types in one file. The reference file `result (2).csv` has 3,528 rows with `Sample Type` values of `Berries` (920), `Must` (1,169), `Young Wine` (943), `Aging Wine` (36), `Bottled Wine` (23), `Control Wine` (280), plus ~140 rows where vessel codes (`BIN`, `E2`, `A5`, `D1`, `F2`, …) were accidentally entered into the Sample Type column.
2. Every non-`Control Wine` row is dumped into `wine_samples` with the same schema. `Berries` rows have entirely different meaningful measurements (berry count, extracted juice volume, per-berry sugars/acids/water/skins) than wine rows (IPT, tANT, fANT, pTAN, color L\*a\*b\*, alcohol, VA, malic). Today the berry columns that *do* land in `wine_samples` are a small fraction of what the CSV actually provides; the rest is dropped on the floor.

The upload also gives the operator no safety net: rows are silently filtered, and there is no per-upload report of what made it in versus what was rejected.

This spec redesigns the WineXRay CSV path only. The `.xlsx` Recepción path is out of scope. Future file formats are explicitly deferred.

## 2. Goals

- A single WineXRay CSV produces rows in two destination tables: `wine_samples` (unchanged) and a new `berry_samples` table.
- Classification is explicit and deterministic: one whitelist mapping `Sample Type` → destination. No heuristics.
- Operator sees a preview card with bucket counts before anything is written, and can cancel without side effects.
- Rejected rows (unknown `Sample Type`, missing `sample_id`) are downloadable as `rechazados.csv` with a per-row reason.
- Known-excluded rows (Control Wine, lab tests, California, hard-excluded sample IDs) are reported as a single count, not per row.
- All downstream views (KPIs, charts, maps, classification, Modo Demo) continue to work on wine data unchanged.

## 3. Non-goals

- Downstream analytics for berry data. `berry_samples` lands clean; KPIs, charts, maps, and `classification.js` remain wine-only. A separate spec covers what berry analytics the dashboard should surface.
- A unified preview UX for `.xlsx` Recepción uploads. That path stays on direct-insert.
- A pluggable parser registry. If a third format appears, that is when we revisit generalization.
- Historical backfill of `Berries` rows already in `wine_samples`. A one-time migration script can follow if needed, but is not part of this change.
- Automatic salvage of malformed rows. A row with a vessel code in `Sample Type` is rejected so the lab fixes the source file.

## 4. Architecture

Three pieces change. Everything else stays as-is.

### 4.1 New database table: `berry_samples`

A first-class table alongside `wine_samples`. Not a view, not a partition. Berry rows never touch `wine_samples`. Identity pattern mirrors `wine_samples` exactly so the existing `Identity.canonicalSeqAssign` module works unchanged.

### 4.2 Rewritten classifier in `js/upload.js`

The current `parseWineXRay(rows)` is decomposed into:

- `classifyWineXRay(rows) → { wineBatch, berryBatch, excluded, rejected, counts }`
- `shapeWineRow(row, headers, headerIndex) → object` — today's `wine_samples` payload
- `shapeBerryRow(row, headers, headerIndex) → object` — new berry payload

The classifier does a single dumb lookup against a `CONFIG.sampleTypeRouting` whitelist and dispatches to the appropriate shaper or error bucket.

### 4.3 Preview card in the dropzone UI

A new DOM-rendered card replaces the "success/error" inline status for `.csv` uploads only. `.xlsx` uploads keep current behavior. The card shows aggregated counts per destination, a rechazados CSV download link, and `Cancelar` / `Confirmar e insertar` buttons. Nothing writes to Supabase until `Confirmar` is clicked.

### 4.4 API surface

`/api/upload` already accepts any whitelisted table + rows. `berry_samples` is added to its `ALLOWED_TABLES` map with the new column set and `(sample_id, sample_date, sample_seq)` conflict key. No new endpoint is introduced.

### 4.5 File responsibilities (unchanged boundaries)

| File | Change |
|------|--------|
| `js/upload.js` | Refactored parse → classify + shape; adds `_pendingUpload` preview state and `confirmPendingUpload()` / `cancelPendingUpload()` methods |
| `js/config.js` | Adds `sampleTypeRouting` constant and berry column map (`wxToBerry`) |
| `js/events.js` | Adds Confirm/Cancel click handlers for the preview card |
| `api/upload.js` | Extends `ALLOWED_TABLES` with `berry_samples` |
| `sql/migration_berry_samples.sql` | New migration |
| `css/` | Styles for the preview card |
| `index.html` | Container element for the preview card (inside existing upload status area) |

## 5. Data flow

```
User drops file on DB upload zone
         │
         ▼
handleUpload(file)
  – size ≤ 10 MB
  – client-side role check (lab/admin)
  – extension routing: .csv → WineXRay, .xlsx → Recepción (unchanged)
         │
         ▼ (.csv path only)
DataStore.loadFile(file)  → rows[][]
         │
         ▼
classifyWineXRay(rows) → { wineBatch, berryBatch, excluded, rejected, counts }
         │
         ▼
Identity.canonicalSeqAssign(wineBatch)
Identity.canonicalSeqAssign(berryBatch)
         │
         ▼
_detectDuplicates('wine_samples',  wineBatch,  [sample_id, sample_date, sample_seq])
_detectDuplicates('berry_samples', berryBatch, [sample_id, sample_date, sample_seq])
         │
         ▼
Render preview card:
  { wine:  new/update counts,
    berry: new/update counts,
    excluded: { control_wine, lab_tests, california, hard_excluded },
    rejected: [ { row, motivo_rechazo }, ... ] }
_pendingUpload = { file, wineBatch, berryBatch, rejected }
NO DB WRITES YET
         │
    ┌────┴────┐
    │         │
[Cancelar] [Confirmar]
    │         │
    ▼         ▼
clear      upsertRows('wine_samples',  wineBatch)   ← sequential
state      upsertRows('berry_samples', berryBatch)  ← sequential
           │
           ▼
Summary: "2,171 muestras de vino y 920 muestras de baya insertadas.
          422 filas omitidas (280 Control Wine · 142 rechazadas)."
DataStore.cacheData() invalidated
App.refreshAllViews()
```

**Key properties:**

- Parse-preview-confirm is entirely client-side. No DB writes occur until Confirm.
- `UploadManager._uploading` stays engaged through both phases; a second drop cannot interrupt a pending preview.
- Duplicates are checked *before* preview so the card can show "new vs. update" per destination.
- Identity assignment runs per-bucket. A berry `sample_id` colliding with a wine `sample_id` is fine because they land in different tables with independent conflict keys.
- Errors at preview stage (header mismatch, file unreadable, 0 classified rows) produce a Spanish error in the status area and **no Confirm button is offered**.
- Errors during Confirm are partial-tolerant: wine writes run first, berry second. If berry fails after wine succeeded, the card is replaced with a warning that names both outcomes and keeps the rechazados download available. No auto-retry, no rollback.
- After full success, existing side effects run unchanged: `DataStore.cacheData()` invalidated, `App.refreshAllViews()` re-renders KPIs/charts/maps.

## 6. Schema: `berry_samples`

```sql
-- sql/migration_berry_samples.sql
create table public.berry_samples (
  id               bigserial primary key,

  -- identity (mirrors wine_samples)
  sample_id        text not null,
  sample_date      date not null,
  sample_seq       int  not null default 0,
  unique (sample_id, sample_date, sample_seq),

  -- context
  vintage_year     int,
  variety          text,
  appellation      text,
  sample_type      text default 'Berries',
  crush_date       date,
  days_post_crush  int,
  batch_id         text,
  notes            text,
  below_detection  boolean default false,
  created_at       timestamptz default now(),

  -- berry morphology
  berry_count                  int,
  berries_weight_g             numeric,
  extracted_juice_ml           numeric,
  extracted_juice_g            numeric,
  extracted_phenolics_ml       numeric,
  berry_fresh_weight_g         numeric,
  berry_anthocyanins_mg_100b   numeric,

  -- per-berry composition (mg/berry)
  berry_sugars_mg              numeric,
  berry_acids_mg               numeric,
  berry_water_mg               numeric,
  berry_skins_seeds_mg         numeric,

  -- per-berry composition (weight %)
  berry_sugars_pct             numeric,
  berry_acids_pct              numeric,
  berry_water_pct              numeric,
  berry_skins_seeds_pct        numeric,

  -- per-berry composition (grams)
  berry_sugars_g               numeric,
  berry_acids_g                numeric,
  berry_water_g                numeric,
  berry_skins_seeds_g          numeric,

  -- phenolics/color measured on the extracted juice (populated when present)
  ipt     numeric,
  tant    numeric,
  fant    numeric,
  bant    numeric,
  ptan    numeric,
  irps    numeric,
  l_star  numeric,
  a_star  numeric,
  b_star  numeric,
  color_i numeric,
  color_t numeric,
  brix    numeric,
  ph      numeric,
  ta      numeric
);

create index berry_samples_vintage_variety on berry_samples (vintage_year, variety);
create index berry_samples_appellation     on berry_samples (appellation);
```

**Rationale for specific choices:**

- Phenolic/color columns are included because berry rows in the reference file populate them (measurements on the extracted juice). Dropping them would lose real data.
- `sample_type` is a free column defaulting to `'Berries'` so future sub-types (`'Veraison Berries'`, `'Harvest Berries'`, …) require no migration.
- Movement columns (CSV cols 22–41), Cap Temperature, and Must Temperature are not captured. They are not meaningful for berry samples.

## 7. Classification rules

Single source of truth in `config.js`:

```js
CONFIG.sampleTypeRouting = {
  'Berries':       'berry_samples',
  'Must':          'wine_samples',
  'Young Wine':    'wine_samples',
  'Aging Wine':    'wine_samples',
  'Bottled Wine':  'wine_samples',
  'Control Wine':  'skip',
};
```

**Classification order per row:**

1. **Rejection gate (source-data problems).** If `!sample_id` → `rejected` with `motivo_rechazo = 'Sample Id faltante'`. These are bad rows the lab should fix.
2. **Exclusion gate (known policy).** If `CONFIG.isSampleExcluded(sample_id)`, or `_labTestRe` matches sample_id/sample_type, or `appellation === 'California'` → route to `excluded` with a category label (`hard_excluded` | `lab_test` | `california`). Never counted as rejected.
3. **Routing lookup.** `destination = CONFIG.sampleTypeRouting[(row['Sample Type'] || '').trim()]`
   - `'wine_samples'` → `shapeWineRow(row)` → `wineBatch`
   - `'berry_samples'` → `shapeBerryRow(row)` → `berryBatch`
   - `'skip'` → dropped, counted in `excluded.control_wine`
   - `undefined` → `rejected` with `motivo_rechazo = 'Sample Type no reconocido: <value>'`

**Excluded vs. rejected distinction:** excluded = intentional policy (the lab knows Control Wine and California don't belong); rejected = something wrong with the source file (missing sample_id, unrecognized type) that the lab should investigate.

**Bucket categories:**

| Bucket | Meaning | Preview display | CSV download |
|--------|---------|-----------------|--------------|
| `wineBatch` | routed to `wine_samples` | "N nuevas · M actualizadas" | no |
| `berryBatch` | routed to `berry_samples` | "N nuevas · M actualizadas" | no |
| `excluded` | known exclusion policy (control, lab, CA, hard-excluded) | "N omitidos por política" | no |
| `rejected` | unexpected in source (unknown type, no sample_id) | "N rechazados" | **yes — `rechazados.csv`** |

**Normalization** (`normalizeVariety`, `normalizeAppellation`, `vintage_year` prefix extraction, below-detection `<N` detection, above-detection `>N` detection) runs identically in both shapers. Unchanged from today.

**Adding a new sample_type** is a one-line change to `CONFIG.sampleTypeRouting`. No code changes in `upload.js`.

## 8. Preview card UX

All labels in Spanish. CSP-safe DOM rendering (no inline handlers, no innerHTML of user data). Mobile responsive per project convention.

**Structure:**

```
┌──────────────────────────────────────────────────────────────┐
│ 📄 <filename> · <N> filas analizadas                         │
├──────────────────────────────────────────────────────────────┤
│   Listo para insertar                                        │
│   🍷 Muestras de vino    <N>   (<new> nuevas · <upd> upd.)  │
│   🫐 Muestras de baya    <N>   (<new> nuevas · <upd> upd.)  │
│                                                              │
│   Omitidos por política                                      │
│   Control Wine             <N>                               │
│   Excluidos (lab/CA/reglas) <N>                              │
│                                                              │
│   ⚠ Rechazados (revisar)                                    │
│   Sample Type no reconocido  <N>     [ Descargar CSV ]      │
│   Sample Id faltante         <N>                             │
│                                                              │
│   [ Cancelar ]                    [ Confirmar e insertar ]  │
└──────────────────────────────────────────────────────────────┘
```

**Behavior:**

- **Preview state** lives on `UploadManager._pendingUpload = { file, wineBatch, berryBatch, excluded, rejected, counts }`. A new drop overwrites it.
- **Confirm button disabled** if `wineBatch.length + berryBatch.length === 0`. Cancel always enabled.
- **Rechazados CSV** generated client-side from `rejected[]`. Headers = original CSV headers + trailing `motivo_rechazo` column. Triggered by an object URL + `<a download>`, URL revoked after click.
- **Confirm** runs `upsertRows('wine_samples', wineBatch)` then `upsertRows('berry_samples', berryBatch)` sequentially. On full success, card is replaced with a Spanish summary; on partial success, card is replaced with a warning that names both outcomes.
- **Cancel** clears `_pendingUpload`, resets `_uploading = false`, returns status to idle. Nothing was written, nothing to undo.
- **After success**, `DataStore.cacheData()` is invalidated and `App.refreshAllViews()` runs, matching today's behavior.

**Explicitly not built:**

- Row-level preview table (3,528 rows is too many to scan; the aggregated counts + rechazados CSV is the right level).
- In-browser file editor (the lab fixes source files in their own tools).
- Undo/rollback (upserts are idempotent; re-uploading a corrected file fixes any mistake).

## 9. Testing

**Unit tests** (Vitest, under `tests/`):

1. `tests/upload-classifier.test.js`
   - Synthetic rows covering every known `Sample Type` land in the correct bucket.
   - Unknown `Sample Type` → `rejected` with reason.
   - Empty `sample_id` → `rejected` with `motivo_rechazo = 'Sample Id faltante'`.
   - `isSampleExcluded` / `_labTestRe` / `California` → `excluded` (not `rejected`).

2. `tests/upload-shapers.test.js`
   - `shapeWineRow` maps all wine columns; berry-specific keys are absent.
   - `shapeBerryRow` maps all 19 berry-specific columns and the phenolic/color columns when present; wine-only columns (`alcohol`, `va`, `malic_acid`, `rs`) are absent.
   - `<50`, `<10` → `null` + `below_detection = true` on both shapers.
   - `-`, `—`, `NA`, `N/A`, empty → `null`.

3. `tests/upload-fixture-result2.test.js`
   - Trimmed, anonymized slice of `result (2).csv` checked in as `tests/fixtures/winexray_mixed.csv`.
   - Full classify → shape pipeline run against it.
   - Bucket counts match hand-verified expected values.
   - No wine columns appear on berry rows and vice versa.

4. `tests/upload-preview.test.js`
   - `_pendingUpload` populated after parse, cleared on Cancel, cleared after successful Confirm.
   - Confirm disabled when both batches empty.
   - Rechazados CSV export produces valid CSV with original headers + `motivo_rechazo`.

5. `tests/api-upload.test.js`
   - `berry_samples` accepted with its column whitelist.
   - Unknown columns stripped.
   - Missing `sample_id` rejected with Spanish error.

**Manual verification checklist** before marking done:

- [ ] Drop `result (2).csv` on dev. Preview shows expected counts (≈2,171 wine / 920 berry / 280 Control / ~142 rejected). Rechazados CSV downloads and opens cleanly in Excel.
- [ ] Click Confirm. Summary appears. Supabase `berry_samples` has 920 new rows, `wine_samples` has 2,171 new/updated.
- [ ] Re-drop the same file. Preview shows "0 nuevas · N actualizadas" for both tables (upsert idempotency verified).
- [ ] Drop a `.xlsx` Recepción file. Old flow runs unchanged — no preview card, direct insert.
- [ ] Drop a deliberately broken CSV (no `Sample Id` column). Clean Spanish error, no writes.
- [ ] KPIs, charts, maps all render unchanged from wine side.
- [ ] Mobile: preview card usable at 375px, buttons tappable.
- [ ] `npm test` clean, `npm run build` clean.

## 10. Rollout

1. Apply `sql/migration_berry_samples.sql` to Supabase (table exists, empty).
2. Deploy `/api/upload` with `berry_samples` added to `ALLOWED_TABLES`. Old client still works — it never sends to the new table.
3. Deploy `js/upload.js`, `js/config.js`, `js/events.js`, CSS, and HTML container. Preview flow is live.
4. Lab drops one real file in production; operator verifies counts match expectations before the change is declared done.

## 11. Open questions (deferred, not blocking implementation)

- Historical backfill: do we move existing `Berries` rows out of `wine_samples` and into `berry_samples`? Recommended but not in this spec's scope.
- Berry analytics: what KPIs, charts, or map layers should surface berry data? A follow-up spec decides.
- Unified `.xlsx` preview: whether to bring the preview pattern to Recepción if consistency becomes a pain point.
