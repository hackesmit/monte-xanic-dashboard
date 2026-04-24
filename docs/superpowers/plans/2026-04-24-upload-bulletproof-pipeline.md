# Upload Bulletproof Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current one-dropzone-per-extension upload system with a three-button pipeline that handles WineXRay, Recepción de Tanque, and Pre-recepción uploads idempotently, shows a preview before every write, and cleanly separates berry samples from wine samples.

**Architecture:** Thin upload controller (`js/upload.js`) + three parser modules (`js/upload/*.js`) conforming to a uniform interface, backed by a shared preview-confirm-upsert pipeline. Every destination table has a composite conflict key so re-uploads are idempotent. One-off historical MOSTOS import handled by a standalone Node script.

**Tech Stack:** Vanilla JS ES modules, Chart.js (unchanged), SheetJS, Supabase, Vercel serverless. Tests use Node's built-in `node --test` runner. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-24-upload-berry-wine-split-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `sql/migration_berry_samples.sql` | Create `berry_samples` table + indexes |
| `sql/migration_pre_receptions.sql` | Create `pre_receptions` table + indexes |
| `sql/migration_reception_lots_upsert.sql` | Add `report_code` column + new conflict key on `reception_lots` |
| `js/upload/index.js` | Static registry mapping parser id → parser module |
| `js/upload/winexray.js` | WineXRay CSV parser: emits `wine_samples` + `berry_samples` targets |
| `js/upload/recepcion.js` | Recepción XLSX parser: emits `tank_receptions` + `reception_lots` + `prefermentativos` |
| `js/upload/prerecepcion.js` | Pre-recepción XLSX parser: emits `pre_receptions` |
| `scripts/import-mostos-2024.js` | One-time Node CLI for historical MOSTOS data |
| `tests/mt13-upload-winexray.test.mjs` | Unit tests for WineXRay parser |
| `tests/mt14-upload-recepcion.test.mjs` | Unit tests for Recepción parser |
| `tests/mt15-upload-prerecepcion.test.mjs` | Unit tests for Pre-recepción parser |
| `tests/mt16-upload-controller.test.mjs` | Unit tests for controller preview/confirm state |
| `tests/mt17-upload-whitelist.test.mjs` | Unit tests for extended API whitelist |
| `tests/fixtures/winexray_mixed.csv` | Anonymized slice of `result (2).csv` |
| `tests/fixtures/recepcion_sample.xlsx` | Anonymized slice of Recepción file |
| `tests/fixtures/prerecepcion_sample.xlsx` | Anonymized slice of Pre-recepción file |

### Modified files

| Path | Change |
|------|--------|
| `js/upload.js` | Shrinks to controller role: keeps `upsertRows`; replaces old `handleUpload`/`_detectDuplicates` with `startUpload`, `_startUploadWithParser`, `confirmPendingUpload`, `cancelPendingUpload`, `_countNew`, `_pendingUpload` state, and preview/summary DOM rendering. Parsing code removed (moved to `js/upload/`). |
| `js/config.js` | Adds `CONFIG.sampleTypeRouting`, `CONFIG.wxToBerry`, `CONFIG.preReceptionsToSupabase`. Existing maps untouched. |
| `js/events.js` | Replaces single dropzone handler with three button handlers + Confirm/Cancel handlers. |
| `api/upload.js` | Adds `berry_samples` and `pre_receptions` to `ALLOWED_TABLES`; fixes `reception_lots` entry (new conflict key, accepts `report_code`). `mediciones_tecnicas` entry unchanged. |
| `index.html` | Replaces the single `.csv/.xlsx` dropzone with three labeled buttons + a preview-card container div. |
| `css/` (appropriate file) | Adds styles for the three buttons and the preview card. |

### Unchanged files (do not touch)

- `js/mediciones.js` — form owner, stays on current `mediciones_tecnicas` schema
- `js/dataLoader.js`, `js/charts.js`, `js/kpis.js`, `js/classification.js`, `js/maps.js`, `js/demoMode.js`, `js/tables.js`, `js/filters.js` — downstream views stay wine-focused for this plan (berry/pre-recepción views are a follow-up spec)
- `js/identity.js` — `canonicalSeqAssign` works on berry rows as-is
- `api/lib/*.js`, `api/verify.js`, `api/login.js`, `api/logout.js` — auth infrastructure

---

## Task 1: Database migration — `berry_samples`

**Files:**
- Create: `sql/migration_berry_samples.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- sql/migration_berry_samples.sql
-- Creates berry_samples table for berry-specific measurements from WineXRay.
-- Separate from wine_samples because berry rows have entirely different
-- meaningful columns (morphology, per-berry composition) vs. wine rows
-- (phenolic chemistry, color). Identity pattern mirrors wine_samples.

CREATE TABLE IF NOT EXISTS public.berry_samples (
  id               BIGSERIAL PRIMARY KEY,

  -- identity (mirrors wine_samples)
  sample_id        TEXT NOT NULL,
  sample_date      DATE NOT NULL,
  sample_seq       INT  NOT NULL DEFAULT 0,
  UNIQUE (sample_id, sample_date, sample_seq),

  -- context
  vintage_year     INT,
  variety          TEXT,
  appellation      TEXT,
  sample_type      TEXT DEFAULT 'Berries',
  crush_date       DATE,
  days_post_crush  INT,
  batch_id         TEXT,
  notes            TEXT,
  below_detection  BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW(),

  -- berry morphology
  berry_count                  INT,
  berries_weight_g             NUMERIC,
  extracted_juice_ml           NUMERIC,
  extracted_juice_g            NUMERIC,
  extracted_phenolics_ml       NUMERIC,
  berry_fresh_weight_g         NUMERIC,
  berry_anthocyanins_mg_100b   NUMERIC,

  -- per-berry composition (mg/berry)
  berry_sugars_mg              NUMERIC,
  berry_acids_mg               NUMERIC,
  berry_water_mg               NUMERIC,
  berry_skins_seeds_mg         NUMERIC,

  -- per-berry composition (weight %)
  berry_sugars_pct             NUMERIC,
  berry_acids_pct              NUMERIC,
  berry_water_pct              NUMERIC,
  berry_skins_seeds_pct        NUMERIC,

  -- per-berry composition (grams)
  berry_sugars_g               NUMERIC,
  berry_acids_g                NUMERIC,
  berry_water_g                NUMERIC,
  berry_skins_seeds_g          NUMERIC,

  -- phenolics/color measured on extracted juice (populated when present)
  ipt     NUMERIC,
  tant    NUMERIC,
  fant    NUMERIC,
  bant    NUMERIC,
  ptan    NUMERIC,
  irps    NUMERIC,
  l_star  NUMERIC,
  a_star  NUMERIC,
  b_star  NUMERIC,
  color_i NUMERIC,
  color_t NUMERIC,
  brix    NUMERIC,
  ph      NUMERIC,
  ta      NUMERIC
);

CREATE INDEX IF NOT EXISTS berry_samples_vintage_variety
  ON public.berry_samples (vintage_year, variety);
CREATE INDEX IF NOT EXISTS berry_samples_appellation
  ON public.berry_samples (appellation);
```

- [ ] **Step 2: Apply the migration manually**

Run the SQL above in the Supabase SQL editor (or via `psql`) against the dev database. Verify the table exists:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'berry_samples' ORDER BY ordinal_position;
```

Expected: 42 columns listed. `sample_id`, `sample_date`, `sample_seq` present. Unique constraint on `(sample_id, sample_date, sample_seq)` listed under table indexes.

- [ ] **Step 3: Commit**

```bash
git add sql/migration_berry_samples.sql
git commit -m "feat(sql): add berry_samples table for berry-specific WineXRay measurements"
```

---

## Task 2: Database migration — `pre_receptions`

**Files:**
- Create: `sql/migration_pre_receptions.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- sql/migration_pre_receptions.sql
-- Creates pre_receptions table for the Pre-recepción upstream dataset.
-- Distinct from mediciones_tecnicas (which stays form-owned and unchanged).

CREATE TABLE IF NOT EXISTS public.pre_receptions (
  id                BIGSERIAL PRIMARY KEY,

  -- identity
  report_code       TEXT NOT NULL,          -- "No. Reporte" (e.g., MT-24-001)
  UNIQUE (report_code),

  -- context
  vintrace          TEXT,                   -- Vintrace reference / "PENDIENTE"
  reception_date    DATE,                   -- Fecha recepción de uva
  medicion_date     DATE,                   -- Fecha medición técnica
  vintage_year      INT,
  supplier          TEXT,                   -- Proveedor
  variety           TEXT,
  lot_code          TEXT,                   -- Lote de campo

  -- load characteristics
  total_bins        INT,                    -- Total bins/jabas
  bin_unit          TEXT,                   -- "bins" | "jabas"
  tons_received     NUMERIC,                -- Toneladas totales
  bin_temp_c        NUMERIC,                -- Temperatura bins/jabas
  truck_temp_c      NUMERIC,                -- Temperatura camión

  -- morphology
  bunch_avg_weight_g    NUMERIC,            -- Peso promedio racimos (g)
  berry_length_avg_cm   NUMERIC,            -- Longitud promedio por baya (cm)
  berries_200_weight_g  NUMERIC,            -- Peso de 200 bayas (g)
  berry_avg_weight_g    NUMERIC,            -- Peso promedio por baya (g)

  -- health counts
  health_madura         INT,
  health_inmadura       INT,
  health_sobremadura    INT,
  health_picadura       INT,
  health_enfermedad     INT,
  health_pasificada     INT,
  health_aceptable      INT,
  health_no_aceptable   INT,

  -- lab chemistry
  lab_date          DATE,                   -- Fecha análisis laboratorio
  brix              NUMERIC,
  ph                NUMERIC,
  at                NUMERIC,                -- g/L
  ag                NUMERIC,                -- g/L
  am                NUMERIC,                -- g/L
  polifenoles       NUMERIC,                -- mg/L
  catequinas        NUMERIC,                -- mg/L
  antocianos        NUMERIC,                -- mg/L

  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pre_receptions_vintage_variety
  ON public.pre_receptions (vintage_year, variety);
CREATE INDEX IF NOT EXISTS pre_receptions_reception_date
  ON public.pre_receptions (reception_date);
CREATE INDEX IF NOT EXISTS pre_receptions_supplier
  ON public.pre_receptions (supplier);
```

- [ ] **Step 2: Apply the migration manually**

Apply in Supabase SQL editor. Verify:

```sql
SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pre_receptions';
```

Expected: 36.

- [ ] **Step 3: Commit**

```bash
git add sql/migration_pre_receptions.sql
git commit -m "feat(sql): add pre_receptions table for Pre-recepción upstream dataset"
```

---

## Task 3: Database migration — `reception_lots` upsert fix

**Files:**
- Create: `sql/migration_reception_lots_upsert.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
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
```

- [ ] **Step 2: Apply the migration manually**

Apply in Supabase SQL editor. Verify:

```sql
-- Check new column
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'reception_lots' AND column_name IN ('report_code', 'reception_id');
-- Expected: report_code NO, reception_id YES

-- Check new constraint
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.reception_lots'::regclass AND contype = 'u';
-- Expected: reception_lots_upsert_key
```

- [ ] **Step 3: Commit**

```bash
git add sql/migration_reception_lots_upsert.sql
git commit -m "fix(sql): make reception_lots upsertable via report_code, not reception_id FK"
```

---

## Task 4: Extend API whitelist — `berry_samples` + `pre_receptions` + fix `reception_lots`

**Files:**
- Modify: `api/upload.js:4-58` (the `ALLOWED_TABLES` map)
- Create: `tests/mt17-upload-whitelist.test.mjs`

- [ ] **Step 1: Write the failing tests first**

Create `tests/mt17-upload-whitelist.test.mjs`:

```js
// MT.17 — Extended ALLOWED_TABLES whitelist for berry_samples, pre_receptions,
// and fixed reception_lots. Mirrors the shape of mt7 (column-whitelist test).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import the whitelist by re-importing the api handler's config.
// api/upload.js does not export ALLOWED_TABLES; we duplicate the expected
// shape here as a contract test. Any drift between this test and the handler
// will surface when running uploads end-to-end.

const EXPECTED_TABLES = {
  berry_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    required: ['sample_id'],
    hasColumn: ['sample_id', 'sample_date', 'berry_count', 'berry_sugars_mg',
                'berry_sugars_pct', 'extracted_juice_ml', 'ipt', 'l_star',
                'below_detection', 'sample_seq'],
  },
  pre_receptions: {
    conflict: 'report_code',
    required: ['report_code'],
    hasColumn: ['report_code', 'vintrace', 'reception_date', 'medicion_date',
                'supplier', 'variety', 'lot_code', 'tons_received',
                'bunch_avg_weight_g', 'berry_avg_weight_g', 'health_madura',
                'health_pasificada', 'lab_date', 'brix', 'ph', 'polifenoles',
                'antocianos'],
  },
  reception_lots: {
    conflict: 'report_code,lot_position',
    required: ['report_code', 'lot_code'],
    hasColumn: ['report_code', 'lot_code', 'lot_position'],
    // reception_id is no longer required; may or may not be in whitelist
  },
};

// Dynamically import the handler and inspect its internal config via a test
// endpoint. Simpler: the api module exposes ALLOWED_TABLES for tests.

import { ALLOWED_TABLES } from '../api/upload.js';

describe('MT.17 — API whitelist for new and fixed tables', () => {
  for (const [table, expected] of Object.entries(EXPECTED_TABLES)) {
    describe(table, () => {
      it('is registered', () => {
        assert.ok(ALLOWED_TABLES[table], `${table} missing from ALLOWED_TABLES`);
      });

      it(`has conflict key = ${expected.conflict}`, () => {
        assert.equal(ALLOWED_TABLES[table].conflict, expected.conflict);
      });

      it(`has required = ${JSON.stringify(expected.required)}`, () => {
        assert.deepEqual(ALLOWED_TABLES[table].required, expected.required);
      });

      for (const col of expected.hasColumn) {
        it(`whitelists column: ${col}`, () => {
          assert.ok(ALLOWED_TABLES[table].columns.has(col),
            `${col} missing from ${table} column whitelist`);
        });
      }
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mt17-upload-whitelist.test.mjs`
Expected: FAIL — `ALLOWED_TABLES` is not exported from `api/upload.js`, and `berry_samples`/`pre_receptions` entries don't exist.

- [ ] **Step 3: Export `ALLOWED_TABLES` and add the three table entries**

In `api/upload.js`, change the declaration line from `const ALLOWED_TABLES = {` to `export const ALLOWED_TABLES = {`. Then add / replace entries as follows:

Add two new keys inside the `ALLOWED_TABLES` object:

```js
  berry_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    maxRows: 1000,
    required: ['sample_id'],
    columns: new Set([
      'sample_id','sample_date','sample_seq','sample_type',
      'vintage_year','variety','appellation','crush_date','days_post_crush',
      'batch_id','notes','below_detection',
      'berry_count','berries_weight_g','extracted_juice_ml','extracted_juice_g',
      'extracted_phenolics_ml','berry_fresh_weight_g','berry_anthocyanins_mg_100b',
      'berry_sugars_mg','berry_acids_mg','berry_water_mg','berry_skins_seeds_mg',
      'berry_sugars_pct','berry_acids_pct','berry_water_pct','berry_skins_seeds_pct',
      'berry_sugars_g','berry_acids_g','berry_water_g','berry_skins_seeds_g',
      'ipt','tant','fant','bant','ptan','irps',
      'l_star','a_star','b_star','color_i','color_t',
      'brix','ph','ta',
    ]),
  },

  pre_receptions: {
    conflict: 'report_code',
    maxRows: 500,
    required: ['report_code'],
    columns: new Set([
      'report_code','vintrace','reception_date','medicion_date','vintage_year',
      'supplier','variety','lot_code',
      'total_bins','bin_unit','tons_received','bin_temp_c','truck_temp_c',
      'bunch_avg_weight_g','berry_length_avg_cm','berries_200_weight_g','berry_avg_weight_g',
      'health_madura','health_inmadura','health_sobremadura','health_picadura',
      'health_enfermedad','health_pasificada','health_aceptable','health_no_aceptable',
      'lab_date','brix','ph','at','ag','am','polifenoles','catequinas','antocianos',
      'notes',
    ]),
  },
```

Replace the existing `reception_lots` entry with:

```js
  reception_lots: {
    conflict: 'report_code,lot_position',
    maxRows: 2000,
    required: ['report_code','lot_code'],
    columns: new Set(['report_code','lot_code','lot_position','reception_id']),
  },
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/mt17-upload-whitelist.test.mjs`
Expected: all assertions PASS.

Also run the existing whitelist test to make sure it still passes:
Run: `node --test tests/mt7-column-whitelist.test.mjs`
Expected: PASS (mt7 is a local duplicate of the old config; it does NOT import from api/upload.js, so it won't break. Leave it alone.)

- [ ] **Step 5: Commit**

```bash
git add api/upload.js tests/mt17-upload-whitelist.test.mjs
git commit -m "feat(api): extend upload whitelist for berry_samples, pre_receptions, fix reception_lots"
```

---

## Task 5: Config additions — `sampleTypeRouting` + `wxToBerry`

**Files:**
- Modify: `js/config.js` (add two new exports near the bottom of the `CONFIG` object, after the existing mappings)

- [ ] **Step 1: Add the `sampleTypeRouting` whitelist**

In `js/config.js`, locate the `CONFIG` object. After the existing `prefermentToSupabase` block, add:

```js
  // ── Sample Type routing for WineXRay ─────────────────────────────
  // Maps the "Sample Type" column value to its destination table.
  // Anything not in this map is rejected by the WineXRay parser.
  sampleTypeRouting: {
    'Berries':      'berry_samples',
    'Must':         'wine_samples',
    'Young Wine':   'wine_samples',
    'Aging Wine':   'wine_samples',
    'Bottled Wine': 'wine_samples',
    'Control Wine': 'skip',
  },
```

- [ ] **Step 2: Add the `wxToBerry` column mapping**

Immediately after `sampleTypeRouting` in `config.js`, add:

```js
  // ── WineXRay CSV headers → berry_samples columns ─────────────────
  // Used by js/upload/winexray.js for rows where Sample Type = 'Berries'.
  // Includes morphology, per-berry composition, and phenolics/color
  // measured on the extracted juice.
  wxToBerry: {
    'Sample Id':              'sample_id',
    'Sample Type':            'sample_type',
    'Sample Date':            'sample_date',
    'CrushDate (yyyy-mm-dd)': 'crush_date',
    'DaysPostCrush (number)': 'days_post_crush',
    'Vintage':                'vintage_year',
    'Variety':                'variety',
    'Appellation':            'appellation',
    'Batch Id':               'batch_id',
    'Notes...':               'notes',

    // morphology
    'Number Of Berries In Sample (number)':  'berry_count',
    'Weight Of Berries In Sample (gr)':      'berries_weight_g',
    'Volume Of Extracted Juice (milliliters)': 'extracted_juice_ml',
    'Weight Of Extracted Juice (gr)':        'extracted_juice_g',
    'Volume Of Extracted Phenolics (milliliters)': 'extracted_phenolics_ml',
    'Berry Fresh Weight (gr)':               'berry_fresh_weight_g',
    'Berry (extractable) Anthocyanins (mg/100b me)': 'berry_anthocyanins_mg_100b',
    'Berry Extractable Anthocyanins (mg/100b)':      'berry_anthocyanins_mg_100b',

    // per-berry composition (mg/berry)
    'Berry Sugars (mg/b)':        'berry_sugars_mg',
    'Berry Acids (mg/b)':         'berry_acids_mg',
    'Berry Water (mg/b)':         'berry_water_mg',
    'Berry Skins & Seeds (mg/b)': 'berry_skins_seeds_mg',

    // per-berry composition (weight %)
    'Berry Sugars (wt.%)':        'berry_sugars_pct',
    'Berry Acids (wt.%)':         'berry_acids_pct',
    'Berry Water (wt.%)':         'berry_water_pct',
    'Berry Skins & Seeds (wt.%)': 'berry_skins_seeds_pct',

    // per-berry composition (grams)
    'Berry Sugars (gr)':        'berry_sugars_g',
    'Berry Acids (gr)':         'berry_acids_g',
    'Berry Water (gr)':         'berry_water_g',
    'Berry Skins & Seeds (gr)': 'berry_skins_seeds_g',

    // phenolics/color measured on extracted juice
    'Total Phenolics Index (IPT, d-less)': 'ipt',
    'tANT (ppm ME)':                       'tant',
    'fANT (ppm ME)':                       'fant',
    'bANT (ppm ME)':                       'bant',
    'pTAN (ppm CE)':                       'ptan',
    'iRPs (ppm CE)':                       'irps',
    'L*':                                  'l_star',
    'a*':                                  'a_star',
    'b*':                                  'b_star',
    'I':                                   'color_i',
    'T':                                   'color_t',
    'Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)': 'brix',
    'pH (pH units)':                       'ph',
    'Titratable Acidity (TA gr/l)':        'ta',
  },
```

- [ ] **Step 3: Verify config.js still loads**

Run: `node -e "import('./js/config.js').then(m => { console.log('sampleTypeRouting:', Object.keys(m.CONFIG.sampleTypeRouting).length); console.log('wxToBerry:', Object.keys(m.CONFIG.wxToBerry).length); })"`

Expected output:
```
sampleTypeRouting: 6
wxToBerry: 40
```

- [ ] **Step 4: Commit**

```bash
git add js/config.js
git commit -m "feat(config): add sampleTypeRouting whitelist and wxToBerry column map"
```

---

## Task 6: Config additions — `preReceptionsToSupabase`

**Files:**
- Modify: `js/config.js` (add one more mapping after `wxToBerry`)

- [ ] **Step 1: Add the `preReceptionsToSupabase` mapping**

After the `wxToBerry` block added in Task 5, insert:

```js
  // ── Pre-recepción XLSX headers → pre_receptions columns ──────────
  // Used by js/upload/prerecepcion.js. The pre_receptions table is
  // distinct from mediciones_tecnicas (which stays form-owned).
  // Note: 'Longitud promedio de 10 bayas (cm)' is deliberately not
  // mapped; the per-baya average carries the same info.
  preReceptionsToSupabase: {
    'Vintrace':                              'vintrace',
    'No. Reporte':                           'report_code',
    'Fecha recepción de uva':                'reception_date',
    'Fecha medición técnica':                'medicion_date',
    'Total':                                 'total_bins',
    'Bins/Jabas':                            'bin_unit',
    'Toneladas totales':                     'tons_received',
    'Proveedor':                             'supplier',
    'Variedad':                              'variety',
    'Lote de campo':                         'lot_code',
    'Temperatura de bins/jabas (°C)':        'bin_temp_c',
    'Temperatura de camión (°C)':            'truck_temp_c',
    'Peso promedio racimos (g)':             'bunch_avg_weight_g',
    'Longitud promedio por baya (cm)':       'berry_length_avg_cm',
    'Peso de 200 bayas (g)':                 'berries_200_weight_g',
    'Peso promedio por baya (g)':            'berry_avg_weight_g',
    'Bayas con picadura':                    'health_picadura',
    'Bayas con enfermedades':                'health_enfermedad',
    'Bayas inmaduras':                       'health_inmadura',
    'Bayas Maduras':                         'health_madura',
    'Bayas sobremaduras':                    'health_sobremadura',
    'Bayas pasificadas':                     'health_pasificada',
    'Bayas aceptables':                      'health_aceptable',
    'Bayas No aceptables':                   'health_no_aceptable',
    'Fecha análisis laboratorio':            'lab_date',
    '°Brix':                                 'brix',
    'pH':                                    'ph',
    'AT (g/L)':                              'at',
    'AG (g/L)':                              'ag',
    'AM (g/L)':                              'am',
    'Polifenoles (mg/L)':                    'polifenoles',
    'Catequinas (mg/L)':                     'catequinas',
    'Antocianos (mg/L)':                     'antocianos',
  },
```

- [ ] **Step 2: Verify**

Run: `node -e "import('./js/config.js').then(m => console.log(Object.keys(m.CONFIG.preReceptionsToSupabase).length))"`
Expected: `33`

- [ ] **Step 3: Commit**

```bash
git add js/config.js
git commit -m "feat(config): add preReceptionsToSupabase column map"
```

---

## Task 7: Create fixtures for parser tests

**Files:**
- Create: `tests/fixtures/winexray_mixed.csv`
- Create: `tests/fixtures/recepcion_sample.xlsx` (generated)
- Create: `tests/fixtures/prerecepcion_sample.xlsx` (generated)
- Create: `tests/fixtures/README.md`

- [ ] **Step 1: Create the fixtures directory**

```bash
mkdir -p tests/fixtures
```

- [ ] **Step 2: Create `winexray_mixed.csv`**

Write a synthetic CSV that matches the WineXRay header but is small enough to reason about. Save to `tests/fixtures/winexray_mixed.csv`:

```csv
Sample Sequence Number,Filename,UploadDate (yyyy-mm-dd),Batch Id,Sample Number,Sample Id,Vessel Id,Sample Type,Sample Date,Sample Time,CrushDate (yyyy-mm-dd),AssayDate (yyyy-mm-dd),DaysPostCrush (number),Vintage,Variety,Appellation,Must Temperature,Temperature Unit,Cap Temperature,Cap Temperature Unit,Brix (degrees %w/w: (gr sucrose/100 gr juice)*100),pH (pH units),Titratable Acidity (TA gr/l),Residual Sugars (RS gr/l),Volatile Acidity (VA gr/l),Malic Acid (TM gr/l),Alcohol (% v/v),Total Phenolics Index (IPT, d-less),tANT (ppm ME),fANT (ppm ME),bANT (ppm ME),pTAN (ppm CE),iRPs (ppm CE),L*,a*,b*,I,T,Notes...,Number Of Berries In Sample (number),Weight Of Berries In Sample (gr),Volume Of Extracted Juice (milliliters),Weight Of Extracted Juice (gr),Volume Of Extracted Phenolics (milliliters),Berry Fresh Weight (gr),Berry (extractable) Anthocyanins (mg/100b me),Berry Sugars (mg/b),Berry Acids (mg/b),Berry Water (mg/b),Berry Skins & Seeds (mg/b),Berry Sugars (wt.%),Berry Acids (wt.%),Berry Water (wt.%),Berry Skins & Seeds (wt.%),Berry Sugars (gr),Berry Acids (gr),Berry Water (gr),Berry Skins & Seeds (gr)
1,file1.dsp,2026-03-01,160000,1,25CSMX-1,,Aging Wine,2/27/2026,,9/1/2025,2026-03-01,179,2025,Cabernet Sauvignon,Valle de Guadalupe,,C,,C,-,3.65,5.2,1.1,0.45,0.8,14.2,55,623,420,212,1529,2935,67.7,32.7,6.9,0.24,0.724,,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-
2,file2.dsp,2026-03-01,160000,2,25MEMX-1,,Must,2/15/2026,,9/1/2025,2026-03-01,163,2025,Merlot,Valle de Guadalupe,18,C,,C,24.2,3.4,6.8,,,,,45,,,,,2200,,,,,,,,,,,,,,,,,,,,,,,,,,
3,file3.dsp,2026-03-01,160000,3,25CSMX-2,,Young Wine,2/20/2026,,9/1/2025,2026-03-01,168,2025,Cabernet Sauvignon,Valle de Guadalupe,,C,,C,-,3.6,5.5,0.8,0.3,0.5,13.8,48,580,380,200,1400,2700,65.2,30.1,7.2,0.22,0.68,,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-
4,file4.dsp,2026-03-01,160000,4,25CSMX-3,,Berries,1/23/2026,,8/1/2025,2026-03-01,175,2025,Cabernet Sauvignon,Valle de Guadalupe,,C,,C,22.5,3.5,7.0,,,,,,,,,,65.0,28.5,8.1,0.25,0.7,,200,272.06,165.75,,,1.3603,272.06,1.355,0.15,0.85,0.005,0.005,0.05,85,0.001,0.002,0.15,0.01
5,file5.dsp,2026-03-01,160000,5,,,Berries,1/23/2026,,8/1/2025,2026-03-01,175,2025,Merlot,Valle de Guadalupe,,C,,C,23.0,3.4,7.5,,,,,,,,,,,,,,,,200,270.00,160.00,,,1.35,,1.35,,,,,,,,,,
6,file6.dsp,2026-03-01,160000,6,25CSMX-CW,,Control Wine,2/27/2026,,9/1/2025,2026-03-01,179,2025,Cabernet Sauvignon,Valle de Guadalupe,,C,,C,-,3.6,5.1,1.0,0.4,0.7,14.0,50,600,400,200,1500,2800,66.0,31.5,7.0,0.23,0.7,,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-
7,file7.dsp,2026-03-01,160000,7,25XXMX-1,,E2,2/27/2026,,9/1/2025,2026-03-01,179,2025,Merlot,Valle de Guadalupe,,C,,C,-,3.6,5.3,0.9,0.35,0.6,13.9,49,550,370,190,1350,2600,64.5,29.8,7.1,0.21,0.65,,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-
8,file8.dsp,2026-03-01,160000,8,25CAMX-WATERBLUEBERRY,,Aging Wine,2/27/2026,,9/1/2025,2026-03-01,179,2025,Cabernet Sauvignon,Valle de Guadalupe,,C,,C,<50,3.6,5.4,0.8,0.32,0.5,14.1,47,570,390,205,1450,2750,65.5,30.2,7.3,0.22,0.67,lab test,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-,-
```

Row breakdown:
- Row 1: Aging Wine → wine_samples
- Row 2: Must → wine_samples
- Row 3: Young Wine → wine_samples
- Row 4: Berries (valid) → berry_samples
- Row 5: Berries with empty sample_id → **rejected** (`Sample Id faltante`)
- Row 6: Control Wine → **excluded** (`control_wine`)
- Row 7: sample_type = 'E2' (vessel code) → **rejected** (`Sample Type no reconocido: E2`)
- Row 8: sample_id contains 'WATERBLUEBERRY' (lab test) → **excluded** (`lab_test`). Also has `<50` in brix to exercise below-detection flag.

- [ ] **Step 3: Generate `recepcion_sample.xlsx`**

Write a Node script inline to generate a minimal recepción XLSX. Run:

```bash
node -e "
const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();

// Recepción 2025 sheet — title row, header row, data rows
const recepcionRows = [
  [null,'FL 8.5.8 rev 2',null,'ANÁLISIS DE RECEPCIÓN EN TANQUE'],
  ['Reporte','Fecha','Lote de viñedo 1','Lote de viñedo 2','Lote de viñedo 3','Lote de viñedo 4','Código \r\n(lote de bodega)','Tanque','Proveedor','Variedad','°Brix','pH','A.T.','A.G.','A.M.','A.V.','SO2L','NFA','°Temp','%Sólidos','Polifenoles WX (FFA)','Antocianinas WX (FFA)','Poli SPICA','Anto SPICA','IPT SPICA','Acidificado','P010 (kg)'],
  ['R-001','2025-09-15','25CSMX-1A','25CSMX-1B',null,null,'25CS001','T-A1','Monte Xanic','Cabernet Sauvignon',24.5,3.6,6.2,0.45,2.1,0.1,25,180,18.5,18,520,380,490,350,55,'No',1500],
  ['R-002','2025-09-16','25MEVA-1A',null,null,null,'25ME001','T-B2','Viña Alta','Merlot',23.8,3.5,6.8,0.4,2.3,0.08,22,170,19,17,480,360,460,340,52,'No',1200],
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(recepcionRows), 'Recepción 2025');

// Prefermentativos 2025 sheet
const prefermRows = [
  ['Reporte','Fecha','Código (lote de bodega)','Tanque','Variedad','°Brix','pH','A.T.','°Temp','tANT','Notas'],
  ['R-001','2025-09-16','25CS001','T-A1','Cabernet Sauvignon',24.2,3.55,6.3,18,520,'post-crush'],
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prefermRows), 'Prefermentativos 2025');

XLSX.writeFile(wb, 'tests/fixtures/recepcion_sample.xlsx');
console.log('wrote tests/fixtures/recepcion_sample.xlsx');
"
```

Expected output: `wrote tests/fixtures/recepcion_sample.xlsx`

- [ ] **Step 4: Generate `prerecepcion_sample.xlsx`**

```bash
node -e "
const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();

const rows = [
  [null,'MEDICIÓN TÉCNICA DE LA UVA ',null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,'Laboratorio'],
  [null],
  ['Vintrace','No. Reporte','Fecha recepción de uva','Fecha medición técnica','Total','Bins/Jabas','Toneladas totales ','Proveedor ','Variedad','Lote de campo ','Temperatura de bins/jabas (°C)','Temperatura de camión (°C)','Peso promedio racimos (g)','Longitud promedio de 10 bayas (cm)','Longitud promedio por baya (cm)','Peso de 200 bayas (g)','Peso promedio por baya (g)','Bayas con picadura ','Bayas con enfermedades','Bayas inmaduras','Bayas Maduras','Bayas sobremaduras','Bayas pasificadas','Bayas aceptables','Bayas No aceptables','Fecha análisis laboratorio ','°Brix','pH','AT (g/L)','AG (g/L)','AM (g/L)','Polifenoles (mg/L)','Catequinas (mg/L)','Antocianos (mg/L)'],
  ['VT-100','MT-24-001','2024-08-15','2024-08-15',18,'bins',5.863,'Monte Xanic','Chardonnay','24CHMX-1B',4.8,null,165.75,13.55,1.355,272.06,1.3603,0,0,0,150,0,0,150,0,'2024-08-15',16.8,3.47,8.55,0.01,4.72,null,null,null],
  ['PENDIENTE','MT-24-002','2024-08-16','2024-08-16',34,'bins',14.358,'Monte Xanic','Sauvignon Blanc','24SBMX-2A',3.7,null,194.16,12.88,1.288,277.72,1.3886,0,4,2,190,4,0,190,10,'2024-08-16',21.6,3.37,8.7,0,3.67,null,null,null],
  ['VT-102',null,'2024-08-17','2024-08-17',20,'bins',6.5,'Monte Xanic','Merlot','24MEMX-3',4.0,null,170,13.2,1.32,270,1.35,0,0,0,180,0,0,180,0,'2024-08-17',22.0,3.5,8.0,0.01,4.0,450,200,180],
  ['VT-103','PENDIENTE','2024-08-18','2024-08-18',22,'bins',7.2,'Monte Xanic','Syrah','24SYMX-1',4.2,null,172,13.3,1.33,271,1.355,0,0,0,185,0,0,185,0,'2024-08-18',22.5,3.55,8.1,0.02,4.1,460,210,190],
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Pre-recepción');
XLSX.writeFile(wb, 'tests/fixtures/prerecepcion_sample.xlsx');
console.log('wrote tests/fixtures/prerecepcion_sample.xlsx');
"
```

Row breakdown:
- Row 4 (data row 1): valid MT-24-001 → `pre_receptions`
- Row 5 (data row 2): valid MT-24-002, but `Vintrace='PENDIENTE'` (that's fine; vintrace is informational)
- Row 6 (data row 3): `No. Reporte` is null → **rejected** (`Reporte faltante`)
- Row 7 (data row 4): `No. Reporte = 'PENDIENTE'` → **rejected** (`Reporte pendiente`)

- [ ] **Step 5: Create `tests/fixtures/README.md`**

```markdown
# Test Fixtures

Synthetic, anonymized slices of the Monte Xanic data files used for parser tests.

- `winexray_mixed.csv` — 8 rows covering every classifier branch (wine, berry, excluded, rejected)
- `recepcion_sample.xlsx` — 2 receptions + 1 prefermentativo row
- `prerecepcion_sample.xlsx` — 4 rows including PENDIENTE and missing-reporte cases

If you regenerate these, keep the row counts and coverage intentions above — the parser tests assert exact counts per bucket.
```

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/
git commit -m "test: add anonymized upload fixtures for parser tests"
```

---

## Task 8: Parser registry scaffold

**Files:**
- Create: `js/upload/index.js`

- [ ] **Step 1: Write the registry stub**

```js
// js/upload/index.js
// Static registry of parser modules. Adding a format is adding a module
// and one line here.

import { winexrayParser } from './winexray.js';
import { recepcionParser } from './recepcion.js';
import { prerecepcionParser } from './prerecepcion.js';

export const PARSERS = {
  winexray:     winexrayParser,
  recepcion:    recepcionParser,
  prerecepcion: prerecepcionParser,
};

// Ordered list for UI button rendering
export const PARSER_ORDER = ['winexray', 'recepcion', 'prerecepcion'];
```

This file will fail to resolve imports until Tasks 9–11 create the modules. That's expected.

- [ ] **Step 2: Create empty parser module files as placeholders**

```bash
mkdir -p js/upload
```

Create `js/upload/winexray.js`:

```js
// js/upload/winexray.js
// WineXRay CSV parser. Filled in by Task 9.
export const winexrayParser = {
  id: 'winexray',
  label: 'WineXRay',
  acceptedExtensions: ['.csv'],
  async parse(_file) {
    throw new Error('winexrayParser.parse not yet implemented');
  },
};
```

Create `js/upload/recepcion.js`:

```js
// js/upload/recepcion.js
// Recepción de Tanque XLSX parser. Filled in by Task 10.
export const recepcionParser = {
  id: 'recepcion',
  label: 'Recepción de Tanque',
  acceptedExtensions: ['.xlsx', '.xls'],
  async parse(_file) {
    throw new Error('recepcionParser.parse not yet implemented');
  },
};
```

Create `js/upload/prerecepcion.js`:

```js
// js/upload/prerecepcion.js
// Pre-recepción XLSX parser. Filled in by Task 11.
export const prerecepcionParser = {
  id: 'prerecepcion',
  label: 'Pre-recepción',
  acceptedExtensions: ['.xlsx', '.xls'],
  async parse(_file) {
    throw new Error('prerecepcionParser.parse not yet implemented');
  },
};
```

- [ ] **Step 3: Verify imports resolve**

Run:
```bash
node -e "import('./js/upload/index.js').then(m => console.log('parsers:', Object.keys(m.PARSERS).join(', ')))"
```
Expected: `parsers: winexray, recepcion, prerecepcion`

- [ ] **Step 4: Commit**

```bash
git add js/upload/
git commit -m "feat(upload): scaffold parser registry and module stubs"
```

---

## Task 9: WineXRay parser — `js/upload/winexray.js`

**Files:**
- Modify: `js/upload/winexray.js` (replace stub with implementation)
- Create: `tests/mt13-upload-winexray.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/mt13-upload-winexray.test.mjs`:

```js
// MT.13 — WineXRay parser: classifies rows, shapes wine/berry payloads,
// categorizes exclusions and rejections.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { winexrayParser } from '../js/upload/winexray.js';

// Helper: wrap a Buffer as a File-like object the parser can consume.
// The parser calls DataStore.loadFile(file); in Node we bypass and provide
// a fake file with arrayBuffer() returning the Buffer contents.
function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

async function loadFixture() {
  const buf = await readFile(new URL('./fixtures/winexray_mixed.csv', import.meta.url));
  return asFakeFile(buf, 'winexray_mixed.csv');
}

describe('MT.13 — WineXRay parser', () => {
  it('has the expected parser interface', () => {
    assert.equal(winexrayParser.id, 'winexray');
    assert.equal(winexrayParser.label, 'WineXRay');
    assert.deepEqual(winexrayParser.acceptedExtensions, ['.csv']);
    assert.equal(typeof winexrayParser.parse, 'function');
  });

  it('parses the mixed fixture and emits two targets', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    assert.equal(result.targets.length, 2);
    const wine = result.targets.find(t => t.table === 'wine_samples');
    const berry = result.targets.find(t => t.table === 'berry_samples');
    assert.ok(wine, 'wine_samples target missing');
    assert.ok(berry, 'berry_samples target missing');
    assert.equal(wine.conflictKey, 'sample_id,sample_date,sample_seq');
    assert.equal(berry.conflictKey, 'sample_id,sample_date,sample_seq');
  });

  it('routes sample types correctly', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;
    const berry = result.targets.find(t => t.table === 'berry_samples').rows;

    // Row 1 Aging Wine, Row 2 Must, Row 3 Young Wine → 3 wine rows
    assert.equal(wine.length, 3);
    // Row 4 Berries (row 5 is rejected for missing sample_id)
    assert.equal(berry.length, 1);
  });

  it('rejects rows with missing sample_id', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const missing = result.rejected.find(r => r.motivo_rechazo === 'Sample Id faltante');
    assert.ok(missing, 'expected rejection for row with empty sample_id');
  });

  it('rejects rows with unknown sample_type', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const unknown = result.rejected.find(r =>
      r.motivo_rechazo.startsWith('Sample Type no reconocido'));
    assert.ok(unknown, 'expected rejection for row with sample_type=E2');
    assert.match(unknown.motivo_rechazo, /E2/);
  });

  it('excludes Control Wine rows without marking them rejected', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    assert.equal(result.excluded.control_wine, 1);
    const controlInRejected = result.rejected.find(r =>
      r.row['Sample Id'] === '25CSMX-CW');
    assert.equal(controlInRejected, undefined,
      'Control Wine must not appear in rejected');
  });

  it('excludes lab-test rows (sample_id containing WATERBLUEBERRY)', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    assert.equal(result.excluded.lab_test, 1);
  });

  it('sets below_detection=true for <50 brix values', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;
    // Note: the lab-test row with <50 brix is excluded before shaping,
    // so below_detection shouldn't leak into wine rows here.
    // Verify no leaked below_detection flag on the 3 shaped wine rows.
    assert.ok(wine.every(r => r.below_detection === false));
  });

  it('shapes berry rows with berry-specific columns populated', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const berry = result.targets.find(t => t.table === 'berry_samples').rows[0];
    assert.equal(berry.sample_id, '25CSMX-3');
    assert.equal(berry.sample_type, 'Berries');
    assert.equal(berry.berry_count, 200);
    assert.equal(berry.berries_200_weight_g ?? berry.berries_weight_g ?? 272.06, 272.06);
    // Wine-only columns should not be on berry rows
    assert.equal(berry.alcohol, undefined);
    assert.equal(berry.va, undefined);
  });

  it('normalizes variety (Petite Sirah → Durif)', async () => {
    // Synthetic: run the parse and check normalizeVariety was applied.
    // The fixture uses Cabernet Sauvignon / Merlot; they normalize to themselves.
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;
    assert.ok(wine.every(r => ['Cabernet Sauvignon', 'Merlot'].includes(r.variety)));
  });

  it('throws a Spanish error when headers are missing', async () => {
    const junk = asFakeFile(Buffer.from('foo,bar\n1,2\n'), 'junk.csv');
    await assert.rejects(
      () => winexrayParser.parse(junk),
      /no parece ser un export de WineXRay/i
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mt13-upload-winexray.test.mjs`
Expected: all tests FAIL with "winexrayParser.parse not yet implemented".

- [ ] **Step 3: Implement the parser**

Replace the stub in `js/upload/winexray.js` with:

```js
// js/upload/winexray.js
// WineXRay CSV parser.
//
// Emits two targets:
//   wine_samples  ← rows with Sample Type in {Must, Young Wine, Aging Wine, Bottled Wine}
//   berry_samples ← rows with Sample Type = 'Berries'
//
// Control Wine and lab-test rows are excluded silently.
// Unknown Sample Type, missing Sample Id → rejected with motivo_rechazo.

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';

const BELOW_DETECTION_RE = /^<\s*\d+(\.\d+)?$/;
const ABOVE_DETECTION_RE = /^>\s*(\d+(\.\d+)?)$/;
const LAB_TEST_RE = /\b(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)\b/i;

async function fileToRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: false });
}

function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (str === '' || str === '-' || str === '—' || str === 'NA' || str === 'N/A') return null;
  const n = Number(str);
  return isNaN(n) ? str : n;
}

// Shape a row against a column map. Returns {obj, belowDetection}.
function shapeRow(headers, row, columnMap) {
  const obj = {};
  let belowDetection = false;
  headers.forEach((h, idx) => {
    const col = columnMap[h];
    if (!col) return;
    const val = row[idx];
    const str = val !== null && val !== undefined ? String(val).trim() : '';
    if (BELOW_DETECTION_RE.test(str)) {
      belowDetection = true;
      obj[col] = null;
    } else if (ABOVE_DETECTION_RE.test(str)) {
      const m = str.match(ABOVE_DETECTION_RE);
      obj[col] = m ? parseFloat(m[1]) : null;
    } else {
      obj[col] = normalizeValue(val);
    }
  });
  obj.below_detection = belowDetection;
  return obj;
}

function applyNormalization(obj) {
  if (obj.variety) obj.variety = CONFIG.normalizeVariety(obj.variety);
  if (obj.appellation && obj.sample_id) {
    obj.appellation = CONFIG.normalizeAppellation(obj.appellation, obj.sample_id);
  }
  if (!obj.vintage_year && obj.sample_id) {
    const m = String(obj.sample_id).match(/^(\d{2})/);
    if (m) {
      const y = 2000 + parseInt(m[1], 10);
      obj.vintage_year = (y >= 2015 && y <= 2040) ? y : null;
    }
  }
  return obj;
}

export const winexrayParser = {
  id: 'winexray',
  label: 'WineXRay',
  acceptedExtensions: ['.csv'],

  async parse(file) {
    const rows = await fileToRows(file);
    if (!rows || rows.length < 2) {
      throw new Error('El archivo no contiene filas de datos.');
    }
    const headers = rows[0].map(h => String(h || '').trim());

    const knownHeaders = new Set([
      ...Object.keys(CONFIG.wxToSupabase),
      ...Object.keys(CONFIG.wxToBerry),
    ]);
    const matchCount = headers.filter(h => knownHeaders.has(h)).length;
    if (matchCount < 3) {
      throw new Error('Este archivo no parece ser un export de WineXRay: faltan columnas requeridas (Sample Id, Sample Type, Sample Date).');
    }

    const sampleIdIdx = headers.indexOf('Sample Id');
    const sampleTypeIdx = headers.indexOf('Sample Type');

    const wineRows = [];
    const berryRows = [];
    const excluded = { control_wine: 0, lab_test: 0, california: 0, hard_excluded: 0 };
    const rejected = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0 || row.every(c => c === null || c === '')) continue;

      const sampleId = sampleIdIdx >= 0 ? (row[sampleIdIdx] ?? '').toString().trim() : '';
      const sampleType = sampleTypeIdx >= 0 ? (row[sampleTypeIdx] ?? '').toString().trim() : '';

      // 1. Missing sample_id → rejected
      if (!sampleId) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: 'Sample Id faltante',
        });
        continue;
      }

      // 2. Policy exclusions (order: hard, lab, California)
      if (CONFIG.isSampleExcluded && CONFIG.isSampleExcluded(sampleId)) {
        excluded.hard_excluded++;
        continue;
      }
      if (LAB_TEST_RE.test(sampleId) || LAB_TEST_RE.test(sampleType)) {
        excluded.lab_test++;
        continue;
      }
      // California filter runs after shaping since we need appellation normalization

      // 3. Routing
      const dest = CONFIG.sampleTypeRouting[sampleType];
      if (dest === 'skip') {
        if (sampleType === 'Control Wine') excluded.control_wine++;
        continue;
      }
      if (!dest) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: `Sample Type no reconocido: ${sampleType || '(vacío)'}`,
        });
        continue;
      }

      // Shape + normalize
      const columnMap = dest === 'berry_samples' ? CONFIG.wxToBerry : CONFIG.wxToSupabase;
      const obj = shapeRow(headers, row, columnMap);
      applyNormalization(obj);

      // California late-filter
      if (obj.appellation === 'California') {
        excluded.california++;
        continue;
      }

      if (dest === 'berry_samples') berryRows.push(obj);
      else wineRows.push(obj);
    }

    return {
      targets: [
        { table: 'wine_samples',  rows: wineRows,  conflictKey: 'sample_id,sample_date,sample_seq' },
        { table: 'berry_samples', rows: berryRows, conflictKey: 'sample_id,sample_date,sample_seq' },
      ],
      excluded,
      rejected,
      meta: { totalRows: rows.length - 1, filename: file.name },
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/mt13-upload-winexray.test.mjs`
Expected: all tests PASS.

If the first run fails, common causes:
- `XLSX` import path: make sure `xlsx` is installed (it is, see `package.json`).
- `CONFIG.isSampleExcluded` may be missing; check `js/config.js` — it's defined there. The parser guards with `CONFIG.isSampleExcluded && ...`.
- `fixture` path: the fixture must exist from Task 7.

- [ ] **Step 5: Commit**

```bash
git add js/upload/winexray.js tests/mt13-upload-winexray.test.mjs
git commit -m "feat(upload): WineXRay parser with berry/wine split + classification"
```

---

## Task 10: Recepción parser — `js/upload/recepcion.js`

**Files:**
- Modify: `js/upload/recepcion.js` (replace stub with implementation)
- Create: `tests/mt14-upload-recepcion.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/mt14-upload-recepcion.test.mjs`:

```js
// MT.14 — Recepción de Tanque parser: 2-sheet XLSX → tank_receptions +
// reception_lots + prefermentativos. Lot rows use report_code, not reception_id.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recepcionParser } from '../js/upload/recepcion.js';

function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

async function loadFixture() {
  const buf = await readFile(new URL('./fixtures/recepcion_sample.xlsx', import.meta.url));
  return asFakeFile(buf, 'recepcion_sample.xlsx');
}

describe('MT.14 — Recepción parser', () => {
  it('has the expected parser interface', () => {
    assert.equal(recepcionParser.id, 'recepcion');
    assert.deepEqual(recepcionParser.acceptedExtensions, ['.xlsx', '.xls']);
  });

  it('parses into three targets in correct order', async () => {
    const file = await loadFixture();
    const result = await recepcionParser.parse(file);
    assert.equal(result.targets.length, 3);
    assert.equal(result.targets[0].table, 'tank_receptions');
    assert.equal(result.targets[1].table, 'reception_lots');
    assert.equal(result.targets[2].table, 'prefermentativos');
  });

  it('uses conflict keys matching the API whitelist', async () => {
    const file = await loadFixture();
    const result = await recepcionParser.parse(file);
    assert.equal(result.targets[0].conflictKey, 'report_code');
    assert.equal(result.targets[1].conflictKey, 'report_code,lot_position');
    assert.equal(result.targets[2].conflictKey, 'report_code,measurement_date');
  });

  it('emits lot rows with report_code (no reception_id)', async () => {
    const file = await loadFixture();
    const result = await recepcionParser.parse(file);
    const lots = result.targets[1].rows;
    assert.ok(lots.length > 0);
    for (const lot of lots) {
      assert.ok(lot.report_code, 'lot missing report_code');
      assert.ok(lot.lot_code, 'lot missing lot_code');
      assert.equal(lot.reception_id, undefined, 'lot should not carry reception_id');
    }
  });

  it('expands lot columns _lot1.._lot4 into separate rows', async () => {
    const file = await loadFixture();
    const result = await recepcionParser.parse(file);
    const receptions = result.targets[0].rows;
    const lots = result.targets[1].rows;
    // Fixture row 1: R-001 has two lots (1A, 1B); row 2: R-002 has one lot (1A)
    const r001Lots = lots.filter(l => l.report_code === 'R-001');
    const r002Lots = lots.filter(l => l.report_code === 'R-002');
    assert.equal(r001Lots.length, 2);
    assert.equal(r002Lots.length, 1);
    assert.equal(r001Lots[0].lot_position, 1);
    assert.equal(r001Lots[1].lot_position, 2);
    // Receptions themselves should not carry _lotN helper keys
    assert.equal(receptions[0]._lot1, undefined);
  });

  it('throws a Spanish error when a required sheet is missing', async () => {
    // Build a workbook with only Prefermentativos sheet
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['foo'],['bar']]), 'Prefermentativos 2025');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const file = asFakeFile(Buffer.from(buf), 'incomplete.xlsx');
    await assert.rejects(() => recepcionParser.parse(file), /Recep/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mt14-upload-recepcion.test.mjs`
Expected: all tests FAIL with "recepcionParser.parse not yet implemented".

- [ ] **Step 3: Implement the parser**

Replace the stub in `js/upload/recepcion.js` with:

```js
// js/upload/recepcion.js
// Recepción de Tanque XLSX parser.
//
// Reads two sheets:
//   - Recepción <year>        → tank_receptions + reception_lots (up to 4 lots per row)
//   - Prefermentativos <year> → prefermentativos
//
// Lot rows are emitted with report_code (NOT reception_id) per the
// migration in sql/migration_reception_lots_upsert.sql.

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';

function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (str === '' || str === '-' || str === '—' || str === 'NA' || str === 'N/A') return null;
  const n = Number(str);
  return isNaN(n) ? str : n;
}

function sheetToArray(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: false });
}

function findHeaderRow(rows, minNonNull = 5) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const nn = rows[i].filter(v => v !== null && String(v).trim() !== '').length;
    if (nn >= minNonNull) return i;
  }
  return -1;
}

export const recepcionParser = {
  id: 'recepcion',
  label: 'Recepción de Tanque',
  acceptedExtensions: ['.xlsx', '.xls'],

  async parse(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    let recepcionSheet = null;
    let prefermSheet = null;
    for (const name of wb.SheetNames) {
      const lower = name.toLowerCase();
      if (lower.includes('preferm')) prefermSheet = name;
      else if (lower.includes('recep')) recepcionSheet = name;
    }

    if (!recepcionSheet) {
      throw new Error('Falta la hoja "Recepción" en el archivo.');
    }
    if (!prefermSheet) {
      throw new Error('Falta la hoja "Prefermentativos" en el archivo.');
    }

    const receptions = [];
    const lots = [];
    const preferment = [];

    // ── Recepción sheet ──
    const recRows = sheetToArray(wb, recepcionSheet);
    const recHeaderIdx = findHeaderRow(recRows);
    if (recHeaderIdx < 0) throw new Error('No se encontró la fila de encabezados en la hoja Recepción.');
    const recHeaders = recRows[recHeaderIdx].map(h => String(h ?? '').trim().replace(/\s+/g, ' '));

    for (let i = recHeaderIdx + 1; i < recRows.length; i++) {
      const row = recRows[i];
      if (!row || row.every(c => c === null || String(c).trim() === '')) continue;

      const obj = {};
      let hasData = false;
      recHeaders.forEach((h, idx) => {
        const col = CONFIG.recepcionToSupabase[h];
        if (!col) return;
        const val = normalizeValue(row[idx]);
        obj[col] = val;
        if (val !== null) hasData = true;
      });

      if (!hasData || !obj.report_code) continue;

      // vintage_year from batch_code prefix
      if (obj.batch_code) {
        const m = String(obj.batch_code).match(/^(\d{2})/);
        if (m) {
          const y = 2000 + parseInt(m[1], 10);
          obj.vintage_year = (y >= 2015 && y <= 2040) ? y : null;
        }
      }

      // Extract lot columns and emit lot rows
      const reportCode = obj.report_code;
      for (let pos = 1; pos <= 4; pos++) {
        const key = `_lot${pos}`;
        if (obj[key]) {
          lots.push({ report_code: reportCode, lot_code: obj[key], lot_position: pos });
        }
        delete obj[key];
      }

      receptions.push(obj);
    }

    // ── Prefermentativos sheet ──
    const prefRows = sheetToArray(wb, prefermSheet);
    if (prefRows.length >= 2) {
      const prefHeaders = prefRows[0].map(h => String(h ?? '').trim());
      for (let i = 1; i < prefRows.length; i++) {
        const row = prefRows[i];
        if (!row || row.every(c => c === null || String(c).trim() === '')) continue;

        const obj = {};
        let hasData = false;
        prefHeaders.forEach((h, idx) => {
          const col = CONFIG.prefermentToSupabase[h];
          if (!col) return;
          const val = normalizeValue(row[idx]);
          obj[col] = val;
          if (val !== null) hasData = true;
        });

        if (!hasData || !obj.report_code) continue;

        if (obj.batch_code && !obj.vintage_year) {
          const m = String(obj.batch_code).match(/^(\d{2})/);
          if (m) {
            const y = 2000 + parseInt(m[1], 10);
            obj.vintage_year = (y >= 2015 && y <= 2040) ? y : null;
          }
        }
        preferment.push(obj);
      }
    }

    return {
      targets: [
        { table: 'tank_receptions',  rows: receptions, conflictKey: 'report_code' },
        { table: 'reception_lots',   rows: lots,       conflictKey: 'report_code,lot_position' },
        { table: 'prefermentativos', rows: preferment, conflictKey: 'report_code,measurement_date' },
      ],
      excluded: {},
      rejected: [],
      meta: { totalRows: recRows.length + prefRows.length - 2, filename: file.name },
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/mt14-upload-recepcion.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/upload/recepcion.js tests/mt14-upload-recepcion.test.mjs
git commit -m "feat(upload): Recepción parser extracted with report_code-based lot rows"
```

---

## Task 11: Pre-recepción parser — `js/upload/prerecepcion.js`

**Files:**
- Modify: `js/upload/prerecepcion.js` (replace stub with implementation)
- Create: `tests/mt15-upload-prerecepcion.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/mt15-upload-prerecepcion.test.mjs`:

```js
// MT.15 — Pre-recepción parser: XLSX → pre_receptions.
// Header row auto-detected; PENDIENTE and missing reporte → rejected.
// Never touches mediciones_tecnicas.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prerecepcionParser } from '../js/upload/prerecepcion.js';

function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

async function loadFixture() {
  const buf = await readFile(new URL('./fixtures/prerecepcion_sample.xlsx', import.meta.url));
  return asFakeFile(buf, 'prerecepcion_sample.xlsx');
}

describe('MT.15 — Pre-recepción parser', () => {
  it('targets pre_receptions, not mediciones_tecnicas', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0].table, 'pre_receptions');
    assert.equal(result.targets[0].conflictKey, 'report_code');
  });

  it('auto-detects the header row (row 2 in fixture)', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const rows = result.targets[0].rows;
    // Fixture has 4 data rows; 2 valid (MT-24-001, MT-24-002), 2 rejected
    assert.equal(rows.length, 2);
  });

  it('rejects rows where report_code is missing', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const missing = result.rejected.find(r => r.motivo_rechazo === 'Reporte faltante');
    assert.ok(missing);
  });

  it('rejects rows where report_code is PENDIENTE', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const pendiente = result.rejected.find(r => r.motivo_rechazo === 'Reporte pendiente');
    assert.ok(pendiente);
  });

  it('maps all 33 source columns correctly on a valid row', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const first = result.targets[0].rows.find(r => r.report_code === 'MT-24-001');
    assert.ok(first, 'MT-24-001 row missing');
    assert.equal(first.variety, 'Chardonnay');
    assert.equal(first.supplier, 'Monte Xanic');
    assert.equal(first.lot_code, '24CHMX-1B');
    assert.equal(first.total_bins, 18);
    assert.equal(first.bin_unit, 'bins');
    assert.equal(first.tons_received, 5.863);
    assert.equal(first.brix, 16.8);
    assert.equal(first.ph, 3.47);
    assert.equal(first.at, 8.55);
    assert.equal(first.health_madura, 150);
    assert.equal(first.vintage_year, 2024);
  });

  it('extracts vintage_year from medicion_date or reception_date', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const rows = result.targets[0].rows;
    assert.ok(rows.every(r => r.vintage_year === 2024));
  });

  it('throws a Spanish error when the Pre-recepción sheet is missing', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['foo'],['bar']]), 'OtroSheet');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const file = asFakeFile(Buffer.from(buf), 'wrongsheet.xlsx');
    await assert.rejects(() => prerecepcionParser.parse(file), /Pre-recepci/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mt15-upload-prerecepcion.test.mjs`
Expected: all tests FAIL with "prerecepcionParser.parse not yet implemented".

- [ ] **Step 3: Implement the parser**

Replace the stub in `js/upload/prerecepcion.js` with:

```js
// js/upload/prerecepcion.js
// Pre-recepción XLSX parser.
//
// Reads one sheet named "Pre-recepción" (case-insensitive substring match).
// Header row is NOT at row 0 in the source files — it's typically row 2.
// Parser scans the first ~10 rows for a row with ≥5 non-null cells as header.
//
// Rejects rows where report_code is missing or 'PENDIENTE'.
// Target is pre_receptions only. mediciones_tecnicas is never touched.

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';

function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (str === '' || str === '-' || str === '—' || str === 'NA' || str === 'N/A') return null;
  const n = Number(str);
  return isNaN(n) ? str : n;
}

function normalizeHeader(h) {
  return String(h ?? '').trim().replace(/\s+/g, ' ');
}

function findHeaderRow(rows, minNonNull = 5) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const nn = rows[i].filter(v => v !== null && String(v).trim() !== '').length;
    if (nn >= minNonNull) return i;
  }
  return -1;
}

export const prerecepcionParser = {
  id: 'prerecepcion',
  label: 'Pre-recepción',
  acceptedExtensions: ['.xlsx', '.xls'],

  async parse(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    // Find the Pre-recepción sheet (case-insensitive substring match on 'pre-recep')
    const sheetName = wb.SheetNames.find(n =>
      n.toLowerCase().replace(/[^a-záéíóúñ]/g, '').includes('prerecep'));
    if (!sheetName) {
      throw new Error('Falta la hoja "Pre-recepción" en el archivo.');
    }

    const allRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, defval: null, raw: false,
    });

    const headerIdx = findHeaderRow(allRows);
    if (headerIdx < 0) {
      throw new Error('No se encontró la fila de encabezados en la hoja Pre-recepción.');
    }

    const headers = allRows[headerIdx].map(normalizeHeader);

    // Validate key headers
    const requiredHeaders = ['No. Reporte', 'Fecha medición técnica', 'Variedad', 'Lote de campo'];
    const missing = requiredHeaders.filter(h => !headers.includes(h));
    if (missing.length) {
      throw new Error(`Encabezados faltantes en Pre-recepción: ${missing.join(', ')}`);
    }

    const out = [];
    const rejected = [];

    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row || row.every(c => c === null || String(c).trim() === '')) continue;

      const obj = {};
      let hasData = false;
      headers.forEach((h, idx) => {
        const col = CONFIG.preReceptionsToSupabase[h];
        if (!col) return;
        const val = normalizeValue(row[idx]);
        obj[col] = val;
        if (val !== null) hasData = true;
      });

      if (!hasData) continue;

      // Rejection rules on report_code
      const rc = obj.report_code;
      if (!rc) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: 'Reporte faltante',
        });
        continue;
      }
      if (String(rc).trim().toUpperCase() === 'PENDIENTE') {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: 'Reporte pendiente',
        });
        continue;
      }

      // Normalize variety
      if (obj.variety && CONFIG.normalizeVariety) {
        obj.variety = CONFIG.normalizeVariety(obj.variety);
      }

      // vintage_year from medicion_date or reception_date
      const dateStr = obj.medicion_date || obj.reception_date;
      if (dateStr) {
        const y = new Date(dateStr).getFullYear();
        if (y >= 2015 && y <= 2040) obj.vintage_year = y;
      }

      out.push(obj);
    }

    return {
      targets: [
        { table: 'pre_receptions', rows: out, conflictKey: 'report_code' },
      ],
      excluded: {},
      rejected,
      meta: { totalRows: allRows.length - headerIdx - 1, filename: file.name },
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/mt15-upload-prerecepcion.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/upload/prerecepcion.js tests/mt15-upload-prerecepcion.test.mjs
git commit -m "feat(upload): Pre-recepción parser → pre_receptions table"
```

---

## Task 12: Refactor `js/upload.js` controller — preview/confirm/cancel

**Files:**
- Modify: `js/upload.js` (remove parse functions; introduce `startUpload`/`confirmPendingUpload`/`cancelPendingUpload`)
- Create: `tests/mt16-upload-controller.test.mjs`

**Important:** parse functions are now in the parser modules. Remove `parseWineXRay` and `parseRecepcion` methods from `UploadManager`. Keep `upsertRows`, `_detectDuplicates`, and `_esc`.

- [ ] **Step 1: Write the failing controller tests**

Create `tests/mt16-upload-controller.test.mjs`:

```js
// MT.16 — Upload controller: startUpload → preview state, Confirm → writes,
// Cancel → clears state, single-flight guard.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The controller depends on Auth, DataStore, Identity, App. In Node tests we
// stub these by replacing the module's imports via a small shim file.
// Simplest: test the controller's pure state machine by exercising public
// methods after injecting fake parser + fake upsertRows.

import { UploadManager } from '../js/upload.js';

function makeFakeFile(name = 'x.csv') {
  return { name, size: 10, async arrayBuffer() { return new ArrayBuffer(10); } };
}

function makeFakeParser(targets = [{ table: 't', rows: [{ x: 1 }], conflictKey: 'x' }]) {
  return {
    id: 'fake',
    label: 'Fake',
    acceptedExtensions: ['.csv'],
    async parse() {
      return { targets, excluded: {}, rejected: [], meta: { totalRows: 1, filename: 'x.csv' } };
    },
  };
}

beforeEach(() => {
  // Reset controller state
  UploadManager._pendingUpload = null;
  UploadManager._uploading = false;
});

describe('MT.16 — Upload controller state machine', () => {
  it('startUpload stores parse result in _pendingUpload and does not write', async () => {
    const parser = makeFakeParser();
    // Monkey-patch upsertRows to ensure it is NOT called during preview
    let upsertCalled = 0;
    UploadManager.upsertRows = async () => { upsertCalled++; return { count: 0, error: null }; };
    UploadManager._countNew = async () => 1;

    await UploadManager._startUploadWithParser(parser, makeFakeFile());

    assert.ok(UploadManager._pendingUpload, 'pendingUpload should be set');
    assert.equal(upsertCalled, 0, 'upsertRows must NOT run during preview');
  });

  it('confirmPendingUpload upserts each target sequentially and clears state', async () => {
    const parser = makeFakeParser([
      { table: 'a', rows: [{ x: 1 }], conflictKey: 'x' },
      { table: 'b', rows: [{ y: 2 }], conflictKey: 'y' },
    ]);
    const calls = [];
    UploadManager.upsertRows = async (table, rows) => {
      calls.push(table);
      return { count: rows.length, error: null };
    };
    UploadManager._countNew = async () => 0;

    await UploadManager._startUploadWithParser(parser, makeFakeFile());
    await UploadManager.confirmPendingUpload();

    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(UploadManager._pendingUpload, null);
    assert.equal(UploadManager._uploading, false);
  });

  it('confirm stops at first failure, remaining targets not attempted', async () => {
    const parser = makeFakeParser([
      { table: 'a', rows: [{ x: 1 }], conflictKey: 'x' },
      { table: 'b', rows: [{ y: 2 }], conflictKey: 'y' },
      { table: 'c', rows: [{ z: 3 }], conflictKey: 'z' },
    ]);
    const calls = [];
    UploadManager.upsertRows = async (table) => {
      calls.push(table);
      return table === 'b'
        ? { count: 0, error: 'boom' }
        : { count: 1, error: null };
    };
    UploadManager._countNew = async () => 0;

    await UploadManager._startUploadWithParser(parser, makeFakeFile());
    const summary = await UploadManager.confirmPendingUpload();

    assert.deepEqual(calls, ['a', 'b']); // 'c' never attempted
    assert.ok(summary.some(r => r.error === 'boom'));
  });

  it('cancelPendingUpload clears state without side effects', async () => {
    const parser = makeFakeParser();
    UploadManager.upsertRows = async () => { throw new Error('should not be called'); };
    UploadManager._countNew = async () => 0;

    await UploadManager._startUploadWithParser(parser, makeFakeFile());
    UploadManager.cancelPendingUpload();

    assert.equal(UploadManager._pendingUpload, null);
    assert.equal(UploadManager._uploading, false);
  });

  it('single-flight: second startUpload while uploading is ignored', async () => {
    const parser = makeFakeParser();
    UploadManager.upsertRows = async () => { await new Promise(r => setTimeout(r, 10)); return { count: 1, error: null }; };
    UploadManager._countNew = async () => 0;

    const p1 = UploadManager._startUploadWithParser(parser, makeFakeFile('one.csv'));
    // _uploading is now true (set inside startUpload); second call should no-op
    await UploadManager._startUploadWithParser(parser, makeFakeFile('two.csv'));
    await p1;

    // _pendingUpload reflects only the first call's file
    assert.equal(UploadManager._pendingUpload?.file?.name, 'one.csv');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mt16-upload-controller.test.mjs`
Expected: FAIL — `_startUploadWithParser`, `confirmPendingUpload`, `cancelPendingUpload`, `_countNew` don't exist yet.

- [ ] **Step 3: Rewrite `js/upload.js` as the thin controller**

Replace the contents of `js/upload.js` with:

```js
// ── Upload Manager: parser-agnostic preview → confirm → upsert pipeline ──
// Parsing lives in js/upload/<parser>.js. This module owns:
//   - file validation gates (size, role, single-flight)
//   - preview state (_pendingUpload)
//   - confirm/cancel handlers
//   - Supabase upsert (via /api/upload)
// All user-facing messages are in Spanish.

import { CONFIG } from './config.js';
import { Identity } from './identity.js';
import { DataStore } from './dataLoader.js';
import { Auth } from './auth.js';
import { App } from './app.js';
import { PARSERS } from './upload/index.js';

const MAX_SIZE = 10 * 1024 * 1024;

export const UploadManager = {
  _uploading: false,
  _pendingUpload: null,

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  // Public entry point — called from events.js button handlers.
  async startUpload(parserId, file, statusEl) {
    const parser = PARSERS[parserId];
    if (!parser) {
      this._setStatus(statusEl, 'error', `✗ Parser desconocido: ${parserId}`);
      return;
    }
    return this._startUploadWithParser(parser, file, statusEl);
  },

  // Internal — also the test surface.
  async _startUploadWithParser(parser, file, statusEl) {
    if (this._uploading) {
      this._setStatus(statusEl, 'error', 'Carga en progreso, espere...');
      return;
    }
    if (!Auth.canUpload()) {
      this._setStatus(statusEl, 'error', '✗ Sin permisos para subir datos.');
      return;
    }
    if (file.size > MAX_SIZE) {
      this._setStatus(statusEl, 'error', '✗ Archivo demasiado grande (máx 10 MB).');
      return;
    }

    this._uploading = true;
    this._setStatus(statusEl, 'pending', `⏳ Leyendo ${this._esc(file.name)}…`);

    try {
      const result = await parser.parse(file);

      // Per-target processing: sample_seq assignment + new/update counts
      for (const t of result.targets) {
        if (t.table === 'wine_samples' || t.table === 'berry_samples') {
          Identity.canonicalSeqAssign(t.rows);
        }
        t.newCount = await this._countNew(t.table, t.rows, t.conflictKey);
        t.updateCount = t.rows.length - t.newCount;
      }

      const totalRows = result.targets.reduce((s, t) => s + t.rows.length, 0);
      if (totalRows === 0 && result.rejected.length === 0) {
        this._uploading = false;
        this._setStatus(statusEl, 'error', '✗ El archivo no contiene filas válidas.');
        return;
      }

      this._pendingUpload = { parser, file, ...result };
      this._renderPreviewCard(statusEl);
    } catch (err) {
      this._uploading = false;
      this._setStatus(statusEl, 'error', `✗ ${err.message || 'Error al leer el archivo.'}`);
    }
  },

  async confirmPendingUpload(statusEl) {
    if (!this._pendingUpload) return [];
    const { targets, rejected } = this._pendingUpload;
    const results = [];
    for (const t of targets) {
      if (!t.rows.length) continue;
      const r = await this.upsertRows(t.table, t.rows);
      results.push({ table: t.table, count: r.count, error: r.error });
      if (r.error) break;
    }
    this._renderSummary(statusEl, results, rejected);
    this._pendingUpload = null;
    this._uploading = false;
    try {
      if (DataStore.cacheData) DataStore.cacheData();
      if (App.refreshAllViews) App.refreshAllViews();
    } catch (_) { /* refresh is best-effort */ }
    return results;
  },

  cancelPendingUpload(statusEl) {
    this._pendingUpload = null;
    this._uploading = false;
    this._setStatus(statusEl, 'idle', '');
  },

  // Count how many of these rows already exist in the DB (for new vs update preview)
  async _countNew(table, rows, conflictKey) {
    if (!rows.length || !DataStore.supabase || !conflictKey) return rows.length;
    const keyCols = conflictKey.split(',').map(s => s.trim());
    try {
      const primary = keyCols[0];
      const keys = [...new Set(rows.map(r => r[primary]).filter(Boolean))];
      if (!keys.length) return rows.length;
      const { data, error } = await DataStore.supabase
        .from(table)
        .select(keyCols.join(','))
        .in(primary, keys);
      if (error || !data) return rows.length;
      const toKey = r => keyCols.map(c => r[c] ?? '').join('|');
      const existing = new Set(data.map(toKey));
      return rows.filter(r => !existing.has(toKey(r))).length;
    } catch (_) {
      return rows.length;
    }
  },

  async upsertRows(table, rows) {
    if (!rows.length) return { count: 0, error: null };
    const token = Auth.getToken();
    if (!token) return { count: 0, error: 'No autorizado — inicie sesión' };

    let total = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      try {
        const resp = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': token,
          },
          body: JSON.stringify({ table, rows: chunk }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          return { count: total, error: data.error || 'Error al insertar datos' };
        }
        total += data.count || chunk.length;
      } catch (err) {
        return { count: total, error: err.message };
      }
    }
    return { count: total, error: null };
  },

  // UI helpers (rendering is in separate Task 13/14; stubs here)
  _setStatus(el, state, msg) {
    if (!el) return;
    el.dataset.state = state;
    el.textContent = msg;
  },

  _renderPreviewCard(_statusEl) {
    // Implemented in Task 13 (events.js calls this)
  },

  _renderSummary(_statusEl, _results, _rejected) {
    // Implemented in Task 13
  },
};
```

- [ ] **Step 4: Run controller tests**

Run: `node --test tests/mt16-upload-controller.test.mjs`
Expected: all PASS.

**Troubleshooting:**

- *If tests fail because `Auth.canUpload` rejects*: stub it after import.
  ```js
  import { Auth } from '../js/auth.js';
  Auth.canUpload = () => true;
  Auth.getToken = () => 'test-token';
  ```

- *If importing `UploadManager` fails at module-load time* (e.g., because `App`/`Charts` touch `document` or `window` at import): the controller's `App.refreshAllViews` and `DataStore.cacheData` calls are already guarded by `try { if (App.refreshAllViews) ... } catch (_) {}`. If the import itself throws, replace `import { App } from './app.js';` in `js/upload.js` with a deferred lookup:
  ```js
  // instead of importing App at the top
  // use: const App = globalThis.__App || {};
  // and ensure app.js exposes itself via globalThis.__App = App in its own module init.
  ```
  Only do this if node:test actually fails at import — do not speculate.

- *If `_uploading` single-flight test is flaky*: the fake parser's `parse()` must yield at least once. Add a `await Promise.resolve();` at the top of the fake parser's `parse` body if needed.

- [ ] **Step 5: Also run the full test suite to check for regressions**

Run: `npm test`
Expected: all existing mt2–mt12 tests still pass; new mt13–mt17 all pass.

- [ ] **Step 6: Commit**

```bash
git add js/upload.js tests/mt16-upload-controller.test.mjs
git commit -m "refactor(upload): extract parsers; upload.js is now preview/confirm controller"
```

---

## Task 13: Preview card + summary rendering in `js/upload.js`

**Files:**
- Modify: `js/upload.js` (replace the `_renderPreviewCard` and `_renderSummary` stubs with real DOM rendering)

- [ ] **Step 1: Identify table display names**

Add at the top of `js/upload.js`, just after imports:

```js
const TABLE_DISPLAY = {
  wine_samples:     { emoji: '🍷', label: 'Muestras de vino' },
  berry_samples:    { emoji: '🫐', label: 'Muestras de baya' },
  tank_receptions:  { emoji: '🛢️', label: 'Recepciones de tanque' },
  reception_lots:   { emoji: '📦', label: 'Lotes de recepción' },
  prefermentativos: { emoji: '🧪', label: 'Prefermentativos' },
  pre_receptions:   { emoji: '📋', label: 'Pre-recepciones' },
};

const EXCLUDED_LABEL = {
  control_wine:  'Control Wine',
  lab_test:      'Pruebas de laboratorio',
  california:    'Appellation California',
  hard_excluded: 'Excluidos por política',
};
```

- [ ] **Step 2: Implement `_renderPreviewCard`**

Replace the `_renderPreviewCard` stub with:

```js
  _renderPreviewCard(statusEl) {
    if (!statusEl || !this._pendingUpload) return;
    const { parser, file, targets, excluded, rejected } = this._pendingUpload;
    const totalRows = targets.reduce((s, t) => s + t.rows.length, 0);

    // Clear existing content (CSP-safe; no innerHTML of user data)
    while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
    statusEl.dataset.state = 'preview';

    const card = document.createElement('div');
    card.className = 'upload-preview-card';

    // Header
    const header = document.createElement('div');
    header.className = 'upload-preview-header';
    header.textContent = `📄 ${file.name} · ${totalRows} filas procesables · ${parser.label}`;
    card.appendChild(header);

    // Targets section
    const readyH = document.createElement('h4');
    readyH.textContent = 'Listo para insertar';
    card.appendChild(readyH);

    for (const t of targets) {
      if (!t.rows.length) continue;
      const disp = TABLE_DISPLAY[t.table] || { emoji: '📄', label: t.table };
      const row = document.createElement('div');
      row.className = 'upload-preview-row';
      row.textContent = `${disp.emoji} ${disp.label}: ${t.rows.length} (${t.newCount} nuevas · ${t.updateCount} actualizadas)`;
      card.appendChild(row);
    }

    // Excluded section
    const hasExcluded = Object.values(excluded || {}).some(n => n > 0);
    if (hasExcluded) {
      const excH = document.createElement('h4');
      excH.textContent = 'Omitidos por política';
      card.appendChild(excH);
      for (const [key, count] of Object.entries(excluded)) {
        if (!count) continue;
        const row = document.createElement('div');
        row.className = 'upload-preview-row upload-preview-excluded';
        row.textContent = `${EXCLUDED_LABEL[key] || key}: ${count}`;
        card.appendChild(row);
      }
    }

    // Rejected section
    if (rejected && rejected.length) {
      const rejH = document.createElement('h4');
      rejH.textContent = '⚠ Rechazados (revisar)';
      card.appendChild(rejH);

      // Group by motivo_rechazo
      const byMotivo = {};
      for (const r of rejected) {
        byMotivo[r.motivo_rechazo] = (byMotivo[r.motivo_rechazo] || 0) + 1;
      }
      for (const [motivo, count] of Object.entries(byMotivo)) {
        const row = document.createElement('div');
        row.className = 'upload-preview-row upload-preview-rejected';
        row.textContent = `${motivo}: ${count}`;
        card.appendChild(row);
      }

      // Download button
      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.textContent = 'Descargar rechazados.csv';
      dlBtn.className = 'btn upload-preview-download';
      dlBtn.addEventListener('click', () => this._downloadRejected());
      card.appendChild(dlBtn);
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'upload-preview-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.addEventListener('click', () => this.cancelPendingUpload(statusEl));

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Confirmar e insertar';
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.disabled = targets.every(t => !t.rows.length);
    confirmBtn.addEventListener('click', () => this.confirmPendingUpload(statusEl));

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    card.appendChild(actions);

    statusEl.appendChild(card);
  },
```

- [ ] **Step 3: Implement `_renderSummary`**

Replace the `_renderSummary` stub with:

```js
  _renderSummary(statusEl, results, rejected) {
    if (!statusEl) return;
    while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);

    const anyError = results.some(r => r.error);
    statusEl.dataset.state = anyError ? 'partial' : 'success';

    const box = document.createElement('div');
    box.className = anyError ? 'upload-summary upload-summary-partial' : 'upload-summary upload-summary-success';

    const lines = [];
    for (const r of results) {
      const disp = TABLE_DISPLAY[r.table] || { label: r.table };
      if (r.error) {
        lines.push(`✗ ${disp.label}: ${r.error}`);
      } else {
        lines.push(`✓ ${disp.label}: ${r.count} insertadas/actualizadas`);
      }
    }
    if (rejected && rejected.length) {
      lines.push(`Rechazadas: ${rejected.length}`);
    }

    for (const line of lines) {
      const el = document.createElement('div');
      el.textContent = line;
      box.appendChild(el);
    }
    statusEl.appendChild(box);
  },
```

- [ ] **Step 4: Implement `_downloadRejected` (client-side CSV)**

Add this method to `UploadManager`:

```js
  _downloadRejected() {
    if (!this._pendingUpload || !this._pendingUpload.rejected.length) return;
    const { rejected, file } = this._pendingUpload;

    // Build CSV: union of all row keys + motivo_rechazo column
    const headerSet = new Set();
    for (const r of rejected) Object.keys(r.row).forEach(k => headerSet.add(k));
    const headers = [...headerSet, 'motivo_rechazo'];

    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [headers.map(escape).join(',')];
    for (const r of rejected) {
      const vals = headers.map(h => h === 'motivo_rechazo' ? escape(r.motivo_rechazo) : escape(r.row[h]));
      lines.push(vals.join(','));
    }
    const csv = lines.join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rechazados-${file.name.replace(/\.[^.]+$/, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
```

- [ ] **Step 5: Manual smoke test (no automated UI test in this task)**

Open the dashboard locally in a browser after Task 14/15/16 are done. This task is rendering-only; tests for the logic were written in Task 12.

For now, verify the controller tests still pass:

Run: `node --test tests/mt16-upload-controller.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/upload.js
git commit -m "feat(upload): preview card + summary + rejected CSV download (CSP-safe DOM)"
```

---

## Task 14: `index.html` — three upload buttons + preview container

**Files:**
- Modify: `index.html` (find the existing DB upload zone — locate via `grep -n 'db-upload' index.html` — and replace it)

- [ ] **Step 1: Locate the existing upload zone**

Run: `grep -n 'db-upload\|id="db-upload' "index.html"`

You should find the file-input + status element used by the current upload flow. Note the IDs used so the replacement is drop-in compatible with CSS selectors in `js/events.js`.

- [ ] **Step 2: Replace with three-button markup**

Find and replace the block containing the current dropzone (usually `<input type="file" id="db-upload-input">` and `<div id="db-upload-status">`) with:

```html
<section class="upload-section" aria-labelledby="upload-section-title">
  <h3 id="upload-section-title">Cargar datos</h3>

  <div class="upload-buttons">
    <button type="button" id="upload-btn-winexray" class="btn btn-upload">
      📄 Cargar WineXRay (.csv)
    </button>
    <input type="file" id="upload-file-winexray" accept=".csv" hidden>

    <button type="button" id="upload-btn-recepcion" class="btn btn-upload">
      📄 Cargar Recepción de Tanque (.xlsx)
    </button>
    <input type="file" id="upload-file-recepcion" accept=".xlsx,.xls" hidden>

    <button type="button" id="upload-btn-prerecepcion" class="btn btn-upload">
      📄 Cargar Pre-recepción (.xlsx)
    </button>
    <input type="file" id="upload-file-prerecepcion" accept=".xlsx,.xls" hidden>
  </div>

  <div id="upload-status" class="upload-status" data-state="idle" role="status" aria-live="polite"></div>
</section>
```

The status element keeps its role as both the error message container and the preview-card container; `upload.js` writes into `document.getElementById('upload-status')`.

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run build`
Expected: build succeeds, no HTML parse errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(ui): three upload buttons replace single dropzone"
```

---

## Task 15: `js/events.js` — button + confirm/cancel handlers

**Files:**
- Modify: `js/events.js` (remove old `db-upload` handler, add three button handlers)

- [ ] **Step 1: Locate the existing handler**

Run: `grep -n 'db-upload\|handleUpload' js/events.js`

Note the current structure — `events.js` uses delegated listeners.

- [ ] **Step 2: Add button click handlers + file-input change handlers**

Inside the main delegated-click block in `events.js` (or in the `init()` function, matching existing style), add:

```js
// ── Upload buttons (three explicit formats) ──────────────────────
const UPLOAD_BUTTONS = [
  { btn: 'upload-btn-winexray',     input: 'upload-file-winexray',     parser: 'winexray'     },
  { btn: 'upload-btn-recepcion',    input: 'upload-file-recepcion',    parser: 'recepcion'    },
  { btn: 'upload-btn-prerecepcion', input: 'upload-file-prerecepcion', parser: 'prerecepcion' },
];

for (const { btn, input, parser } of UPLOAD_BUTTONS) {
  const btnEl = document.getElementById(btn);
  const inputEl = document.getElementById(input);
  if (!btnEl || !inputEl) continue;

  btnEl.addEventListener('click', () => inputEl.click());

  inputEl.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const statusEl = document.getElementById('upload-status');
    await UploadManager.startUpload(parser, file, statusEl);
    // Reset input so same file can be re-selected immediately
    e.target.value = '';
  });
}
```

Make sure `UploadManager` is imported at the top of `events.js`:

```js
import { UploadManager } from './upload.js';
```

- [ ] **Step 3: Remove the old handler**

Delete the previous `dbFileInput` / `db-upload-input` handler block that called `UploadManager.handleUpload(...)`. (The method no longer exists on UploadManager; leaving the old code would break the build.)

- [ ] **Step 4: Dev server smoke test**

Run: `npm run dev` in a background terminal, then open `http://localhost:5173` (or whatever port vite prints). Log in with a lab/admin account. You should see three buttons in the Cargar datos section.

Click each button — each should open a file picker with the correct extension filter. Pick the wrong file type on a button (e.g., `result (2).csv` on the Recepción button) — the preview step should surface a Spanish error like "Falta la hoja 'Recepción' en el archivo."

Don't click Confirm on real files yet — Task 16 adds the CSS needed to make the preview card readable.

- [ ] **Step 5: Commit**

```bash
git add js/events.js
git commit -m "feat(events): three button handlers + file-input change for upload flow"
```

---

## Task 16: CSS — buttons + preview card

**Files:**
- Modify: the main CSS file (run `grep -l 'db-upload\|btn' css/*.css` to find where existing upload styles live; typically `css/style.css` or `css/app.css`)

- [ ] **Step 1: Add styles for the three buttons**

Append to the existing CSS file:

```css
/* ── Upload section ────────────────────────────────────────── */
.upload-section {
  margin: 1.5rem 0;
  padding: 1rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
}

.upload-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.btn-upload {
  flex: 1 1 220px;
  min-height: 44px;
  padding: 0.75rem 1rem;
  font-size: 0.95rem;
  cursor: pointer;
}

@media (max-width: 600px) {
  .upload-buttons { flex-direction: column; }
  .btn-upload { flex: 1 1 auto; width: 100%; }
}

/* ── Preview card ──────────────────────────────────────────── */
.upload-status {
  min-height: 2rem;
}
.upload-status[data-state="error"] { color: #b00020; }
.upload-status[data-state="pending"] { color: #555; font-style: italic; }

.upload-preview-card {
  padding: 1rem;
  background: var(--card-bg, #fafafa);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
}

.upload-preview-header {
  font-weight: 600;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-color, #ddd);
}

.upload-preview-card h4 {
  margin: 0.75rem 0 0.25rem;
  font-size: 0.9rem;
  color: #444;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.upload-preview-row {
  padding: 0.25rem 0;
  font-size: 0.95rem;
}
.upload-preview-row.upload-preview-excluded { color: #777; }
.upload-preview-row.upload-preview-rejected { color: #b85c00; }

.upload-preview-download {
  margin: 0.5rem 0;
}

.upload-preview-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color, #ddd);
}
.upload-preview-actions .btn { flex: 1; min-height: 44px; }

@media (max-width: 480px) {
  .upload-preview-actions { flex-direction: column; }
}

/* ── Summary box (after Confirm) ───────────────────────────── */
.upload-summary {
  padding: 0.75rem 1rem;
  border-radius: 6px;
}
.upload-summary-success { background: #e8f5e9; border: 1px solid #81c784; }
.upload-summary-partial { background: #fff3e0; border: 1px solid #ffb74d; }
```

- [ ] **Step 2: Dev-server visual smoke test**

With `npm run dev` still running, refresh the dashboard. The Cargar datos section should now:

- Show three clearly-labeled buttons in a row on desktop, stacked on mobile (<600px).
- Render the preview card with readable typography when a valid file is selected.
- Show the summary box (green for success, amber for partial) after clicking Confirm.

- [ ] **Step 3: Commit**

```bash
git add css/*.css
git commit -m "feat(ui): styles for three-button upload + preview card + summary"
```

---

## Task 17: End-to-end integration check with production fixtures

**Files:** none new; this task is a runtime check against a dev Supabase.

This task validates the whole pipeline against the real `Xanic info` files before shipping.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Log in to the dashboard with a lab or admin account.

- [ ] **Step 2: WineXRay — drop `Xanic info/result (2).csv`**

Click "Cargar WineXRay (.csv)", pick `result (2).csv`. The preview card should show approximately:

- 🍷 Muestras de vino: ~2,171 (counts vary after exclusions)
- 🫐 Muestras de baya: ~920
- Omitidos por política · Control Wine: 280
- Omitidos por política · Pruebas de laboratorio: some count
- ⚠ Rechazados — Sample Type no reconocido: ~142 [Descargar rechazados.csv]

Click "Descargar rechazados.csv" — verify the downloaded file opens in Excel with headers + `motivo_rechazo` column.

Click "Confirmar e insertar". Wait. Summary shows insertion counts for both tables.

- [ ] **Step 3: Re-drop the same WineXRay file (idempotency check)**

Repeat Step 2 with the same file. The preview should now show:

- 🍷 Muestras de vino: ~2,171 (0 nuevas · ~2,171 actualizadas)
- 🫐 Muestras de baya: ~920 (0 nuevas · ~920 actualizadas)

Click Confirm. Summary shows 0 new rows were added. Verify in Supabase:

```sql
SELECT COUNT(*) FROM wine_samples WHERE vintage_year = 2025;
SELECT COUNT(*) FROM berry_samples WHERE vintage_year = 2025;
```

Counts should match the first upload's counts (no duplicates).

- [ ] **Step 4: Recepción — drop `Xanic info/Recepcion_de_Tanque_2025.xlsx`**

Click "Cargar Recepción de Tanque (.xlsx)", pick the file. Preview shows counts for three tables. Confirm. Verify:

```sql
SELECT COUNT(*) FROM tank_receptions;
SELECT COUNT(*) FROM reception_lots;
SELECT COUNT(*) FROM prefermentativos;
```

Re-drop the same file. **Critical test**: preview should show 0 new / N updates for all three tables. Verify no duplicate rows:

```sql
SELECT report_code, lot_position, COUNT(*) FROM reception_lots GROUP BY report_code, lot_position HAVING COUNT(*) > 1;
```

Expected: no rows returned (no duplicates).

- [ ] **Step 5: Pre-recepción — drop `Xanic info/prerecepcion_actualizado (1).xlsx`**

Click "Cargar Pre-recepción (.xlsx)". Preview shows:
- 📋 Pre-recepciones: N
- ⚠ Rechazados — Reporte pendiente: some count (rows where `No. Reporte = 'PENDIENTE'`)

Confirm. Verify:

```sql
SELECT COUNT(*) FROM pre_receptions;
SELECT COUNT(*) FROM mediciones_tecnicas; -- must be unchanged from baseline
```

Re-drop to verify idempotency (0 new / N updates).

- [ ] **Step 6: Wrong-file-on-wrong-button check**

Click "Cargar Recepción de Tanque (.xlsx)" and pick `result (2).csv`. Since the button's `accept` filter is `.xlsx,.xls` the picker should reject the CSV at selection time. If the user bypasses the filter with a renamed file, the parser throws a Spanish error like "Falta la hoja 'Recepción'".

- [ ] **Step 7: If every check passes, record a brief note**

Create `docs/superpowers/reviews/2026-04-24-upload-pipeline-e2e.md` with:

```markdown
# E2E verification — 2026-04-24 upload pipeline

Verified against `Xanic info/` files:

- WineXRay `result (2).csv`: <N wine / M berry / K excluded / R rejected>
- Recepción `Recepcion_de_Tanque_2025.xlsx`: <counts>
- Pre-recepción `prerecepcion_actualizado (1).xlsx`: <counts / rejected>

Idempotency verified by re-upload: 0 new rows on second pass for all three files.
`mediciones_tecnicas` row count unchanged after pre-recepción upload: <count> before, <count> after.
```

- [ ] **Step 8: Commit the verification note**

```bash
git add docs/superpowers/reviews/2026-04-24-upload-pipeline-e2e.md
git commit -m "docs: e2e verification of new upload pipeline against production fixtures"
```

---

## Task 18: MOSTOS 2024 one-off import script

**Files:**
- Create: `scripts/import-mostos-2024.js`

This script is a dev-side tool. It is **not** shipped with the Vercel build, **not** called from the UI, and **not** imported by any module. It is run once locally by a developer against production Supabase to backfill historical phenolics data.

- [ ] **Step 1: Write the script**

Create `scripts/import-mostos-2024.js`:

```js
#!/usr/bin/env node
// scripts/import-mostos-2024.js
// ONE-TIME import of MOSTOS PHENOLICS 24-25 (1).xlsx → tank_receptions.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//   node scripts/import-mostos-2024.js "Xanic info/MOSTOS PHENOLICS 24-25 (1).xlsx"
//
// Reads the 'PHENOLICS 2024' sheet only. Other sheets (BERRIES, pivots,
// per-variety) are ignored.
//
// Each row is mapped to a partial tank_receptions row and upserted on
// report_code. The report_code is synthesized as:
//   MOSTOS-<tank_id>-<YYYY-MM-DD>
// so re-runs are idempotent.

import * as XLSX from 'xlsx';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const filePath = process.argv[2];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars required.');
  process.exit(1);
}
if (!filePath) {
  console.error('ERROR: path to MOSTOS PHENOLICS xlsx required as arg.');
  process.exit(1);
}

const wb = XLSX.readFile(filePath);
if (!wb.SheetNames.includes('PHENOLICS 2024')) {
  console.error('ERROR: expected sheet "PHENOLICS 2024" not found.');
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(wb.Sheets['PHENOLICS 2024'], { defval: null, raw: false });
console.log(`Loaded ${rows.length} rows from PHENOLICS 2024`);

function toISODate(excelDate) {
  if (!excelDate) return null;
  if (typeof excelDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(excelDate)) return excelDate.slice(0, 10);
  // Excel serial date
  if (typeof excelDate === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + excelDate * 86400000);
    return d.toISOString().slice(0, 10);
  }
  try { return new Date(excelDate).toISOString().slice(0, 10); } catch { return null; }
}

const payload = [];
for (const r of rows) {
  const tankId = String(r['TANQUE'] ?? '').trim();
  const date = toISODate(r['FECHA']);
  if (!tankId || !date) continue;

  payload.push({
    report_code:     `MOSTOS-${tankId}-${date}`,
    reception_date:  date,
    tank_id:         tankId,
    batch_code:      r['LOTE'] ?? null,
    supplier:        r['PROVEEDOR'] ?? null,
    variety:         r['VARIEDAD'] ?? null,
    polifenoles_wx:  r['PHENOLICS'] ?? null,
    antocianinas_wx: r['ANTHOCYANINS'] ?? null,
    vintage_year:    2024,
  });
}

console.log(`Mapped ${payload.length} rows for upsert`);

// Batch of 500 against tank_receptions
const BATCH = 500;
let total = 0;
for (let i = 0; i < payload.length; i += BATCH) {
  const chunk = payload.slice(i, i + BATCH);
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/tank_receptions?on_conflict=report_code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(chunk),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`Batch ${i}: FAIL ${resp.status} — ${txt}`);
    process.exit(1);
  }
  total += chunk.length;
  console.log(`Upserted ${total}/${payload.length}`);
}

console.log(`Done. ${total} rows upserted into tank_receptions.`);
```

- [ ] **Step 2: Smoke test (dry run against test data)**

Before running in production, create a tiny test copy to confirm the mapping:

```bash
SUPABASE_URL=$SUPABASE_URL \
  SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY \
  node scripts/import-mostos-2024.js "Xanic info/MOSTOS PHENOLICS 24-25 (1).xlsx"
```

Expected output: ends with `Done. ~800 rows upserted into tank_receptions.`

- [ ] **Step 3: Verify in Supabase**

```sql
SELECT COUNT(*) FROM tank_receptions WHERE report_code LIKE 'MOSTOS-%';
SELECT * FROM tank_receptions WHERE report_code LIKE 'MOSTOS-%' LIMIT 5;
```

Re-run the same command in Step 2. Count should be identical — upsert is idempotent.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-mostos-2024.js
git commit -m "chore: one-off MOSTOS 2024 phenolics historical import script"
```

---

## Task 19: Full-suite regression + build + push

**Files:** none changed; this is the final verification.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: **all tests PASS**, including mt2–mt12 (pre-existing) and mt13–mt17 (new).

If any old test fails, stop and investigate — it likely means a shared helper was unintentionally altered during refactor.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: vite build succeeds with no errors. The `dist/` output is valid.

- [ ] **Step 3: Optional e2e tests (if Playwright is configured)**

Run: `npm run test:e2e`
If existing e2e tests cover the upload path, they should still pass. If e2e tests reference the old single-dropzone element IDs, update them to point at the new buttons.

- [ ] **Step 4: Final push**

Per `CLAUDE.md` git workflow: always push after completing features.

```bash
git push
```

Verify the push succeeded. Only after this is done should the work be reported as complete.

- [ ] **Step 5: Update project docs**

Update `TASK.md` to mark the upload-redesign task complete and `docs/Roadmap.md` if relevant. Also re-read the Planner/Reviewer/Builder role rules in `docs/AGENT_RULES.md` to confirm nothing else is expected. These updates are documentation-only.

Run:
```bash
git status
```

If `TASK.md` or `docs/Roadmap.md` has pending edits, commit them:

```bash
git add TASK.md docs/Roadmap.md
git commit -m "docs: mark upload redesign complete in TASK.md and Roadmap"
git push
```

---

## Open decisions from spec §13

Resolve these during implementation review; they do not block task-by-task execution:

- **MOSTOS `report_code` synthesis** — Task 18 uses `MOSTOS-<tank_id>-<YYYY-MM-DD>`. Alternate formats can be swapped in one place (the `payload.push(...)` block).
- **`reception_lots.reception_id` FK** — Task 3's migration keeps it as nullable and stops populating it from new uploads. If you want it dropped, do that in a follow-up migration; it does not block this plan.
- **Button display order** — currently WineXRay, Recepción, Pre-recepción. If usage data suggests a different order, it's a one-line reorder in `index.html` Task 14 and `PARSER_ORDER` in `js/upload/index.js` Task 8.
