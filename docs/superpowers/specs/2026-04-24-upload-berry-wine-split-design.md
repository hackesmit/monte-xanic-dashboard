# Upload Redesign: Bulletproof Pipeline for All Monte Xanic Data Sources

**Status:** Design approved, awaiting user review before implementation plan
**Date:** 2026-04-24 (revised after scope expansion)
**Owner:** Planner (this doc) → Builder (implementation)
**Related:** `js/upload.js`, `api/upload.js`, `js/config.js`, `sql/`, `js/mediciones.js`

---

## 1. Problem

Three files are continuously uploaded to the dashboard. A fourth is a one-time historical import. The current upload system handles only two of them, has no preview or duplicate-safety, and is brittle to future formats.

**The three recurring formats:**

| File | Current handling | Issues |
|---|---|---|
| WineXRay CSV (`result (2).csv`-style) | Parsed; all rows dumped into `wine_samples` | Berry samples have entirely different measurements than wine samples but share a table; most berry-specific columns are dropped on the floor; ~140 rows per file have malformed `Sample Type` values (vessel codes) that get silently filtered; operator has no visibility into what was accepted vs. rejected |
| Recepción de Tanque XLSX (`Recepcion_de_Tanque_2025.xlsx`) | Parsed; writes to `tank_receptions`, `reception_lots`, `prefermentativos` | `reception_lots` upsert is broken (no conflict key; column whitelist requires `reception_id` but client sends `report_code`); re-uploading duplicates or fails; no preview |
| Pre-recepción XLSX (`prerecepcion_actualizado (1).xlsx`) | **Not handled at all.** Pre-recepción is a distinct dataset from `mediciones_tecnicas` (the two overlap in some fields but are not the same). `mediciones_tecnicas` is filled one row at a time via the form in `mediciones.js` and must stay unchanged. | The file contains ~215 ready-to-import rows with its own domain (lab chemistry, supplier, reception date, bunch weight, berry length, bin/truck temps, pasificadas count, full health grades). It needs its own table and its own downstream view. |

**The one-time historical file:** `MOSTOS PHENOLICS 24-25 (1).xlsx`. 15 sheets of 2024 data, mostly pivots and per-variety splits; the only data-bearing sheet (`PHENOLICS 2024`, ~800 rows) maps to a partial slice of `tank_receptions`.

**The operator's pain** is two failure modes on every recurring upload:

1. **Accidental duplicate upload.** Same file dropped twice.
2. **Incremental update upload.** A "small version" of the file with only the new rows since last time.

Today both cases either silently duplicate rows, fail with cryptic errors, or silently drop data. A bulletproof system has to make both cases safe and observable.

## 2. Goals

- One explicit upload button per recurring format; three buttons total, with unambiguous Spanish labels so the operator can always tell which dataset they are updating. The button *is* the format declaration — no content-sniffing detection logic to maintain.
- Each recurring format has its own destination table (or table set) so the corresponding dataset is findable and queryable as a distinct entity downstream.
- `mediciones_tecnicas` is not modified in any way. It stays owned by the form in `mediciones.js`. Pre-recepción data lives in its own table.
- Every upload goes through a shared preview → confirm → upsert pipeline. Nothing writes to the DB until the operator clicks Confirm.
- Every destination table has a composite conflict key; every insert is an `on_conflict=... do update`. Re-uploading the same file is an idempotent no-op-in-effect. Uploading an incremental file updates the existing rows and inserts the new ones.
- Preview shows per-destination-table counts with a "new vs. update" split, a count of rows excluded by policy, and a count of rows rejected for source-data problems with a downloadable `rechazados.csv`.
- Adding a fourth recurring format later is adding one parser module + one button. No changes to the preview, confirm, or upsert code.
- `MOSTOS PHENOLICS 24-25` is handled by a one-time Node script in `scripts/`, not in the UI. After it runs once in production it never runs again.
- All downstream views continue to work on wine and mediciones data unchanged.

## 3. Non-goals

- A single smart auto-detect dropzone. Explicit buttons are more bulletproof and chosen over auto-detection per design discussion.
- Handling MOSTOS as a recurring format or giving it a UI button. It's a one-off.
- Downstream analytics for berry data. `berry_samples` lands clean; KPIs, charts, maps, and `classification.js` remain wine-only. A follow-up spec covers what berry analytics belong where.
- Historical backfill of `Berries` rows already in `wine_samples`. A one-time migration script can follow if needed, but is not part of this change.
- Automatic salvage of malformed rows (e.g., vessel code in `Sample Type`). Such rows are rejected so the lab fixes the source file.
- A pluggable dynamic parser registry loaded at runtime. The registry is a static list in code; "pluggable" means adding a new format is a small localized code change, not a runtime discovery mechanism.

## 4. Architecture

Parsing is fully modularized. The upload controller knows nothing about any specific format.

### 4.1 File layout

```
js/
├── upload.js                    ← controller: preview state, confirm handler,
│                                  upsert orchestration, UI glue
│                                  (shrinks vs. today — parsing extracted)
└── upload/
    ├── index.js                 ← registry: { winexray, recepcion, prerecepcion }
    ├── winexray.js              ← CSV → { wine_samples, berry_samples }
    ├── recepcion.js             ← XLSX → { tank_receptions, reception_lots,
    │                                       prefermentativos }
    └── prerecepcion.js          ← XLSX → { pre_receptions }

scripts/
└── import-mostos-2024.js        ← one-time Node CLI, not deployed

sql/
├── migration_berry_samples.sql          ← new table
├── migration_pre_receptions.sql         ← new table (distinct from mediciones_tecnicas)
└── migration_reception_lots_upsert.sql  ← add report_code column + conflict key
```

### 4.2 Uniform parser interface

Every parser module in `js/upload/` exports an object with the same shape:

```js
export const <name>Parser = {
  id: 'winexray' | 'recepcion' | 'prerecepcion',
  label: 'WineXRay' | 'Recepción de Tanque' | 'Pre-recepción',
  acceptedExtensions: ['.csv'] | ['.xlsx', '.xls'],

  // Throws on unrecoverable parse errors (header missing, unreadable file, etc.)
  // with a Spanish message. Never writes to the DB.
  parse(file): Promise<{
    targets:  Array<{ table: string, rows: object[], conflictKey: string }>,
    excluded: { [reason: string]: number },
    rejected: Array<{ row: object, motivo_rechazo: string }>,
    meta:     { totalRows: number, filename: string }
  }>
};
```

`js/upload/index.js` is a static registry:

```js
export const PARSERS = {
  winexray:     winexrayParser,
  recepcion:    recepcionParser,
  prerecepcion: prerecepcionParser,
};
```

### 4.3 UI: three buttons

Inside the existing upload zone in `index.html`:

```
Sección: Cargar datos
┌────────────────────────────────────────────────────────────┐
│  [ 📄 Cargar WineXRay (.csv) ]                             │
│  [ 📄 Cargar Recepción de Tanque (.xlsx) ]                 │
│  [ 📄 Cargar Pre-recepción (.xlsx) ]                       │
│                                                            │
│  <preview card or status message renders here>             │
└────────────────────────────────────────────────────────────┘
```

Each button wires a hidden `<input type="file" accept="...">` keyed by parser id. Clicking the button opens the file picker; selecting a file triggers `UploadManager.startUpload(parserId, file)`.

**The button is the format declaration.** If the operator picks the wrong file for the wrong button, `parser.parse()` fails fast with a Spanish error ("Este archivo no parece ser un archivo WineXRay: falta la columna 'Sample Id'") and no preview is shown. There is no auto-fallback to another parser.

### 4.4 Shared pipeline in `upload.js`

```js
async startUpload(parserId, file) {
  if (this._uploading) return;  // single-flight guard
  if (!Auth.canUpload()) return;
  const parser = PARSERS[parserId];
  if (!parser) return;  // defensive; shouldn't happen
  if (file.size > MAX_SIZE) return error();

  this._uploading = true;
  this._setStatus('pending', `⏳ Leyendo ${file.name}…`);

  try {
    const result = await parser.parse(file);
    if (!result.targets.some(t => t.rows.length)) {
      return this._setStatus('error', 'El archivo no contiene filas válidas.');
    }
    for (const t of result.targets) {
      Identity.canonicalSeqAssign(t.rows);  // wine/berry only; no-op otherwise
      t.newCount = await this._countNew(t.table, t.rows, t.conflictKey);
      t.updateCount = t.rows.length - t.newCount;
    }
    this._pendingUpload = { parser, file, ...result };
    this._renderPreviewCard();
  } catch (err) {
    this._setStatus('error', err.message || 'Error al leer el archivo.');
  } finally {
    /* _uploading stays true until Confirm or Cancel */
  }
}

async confirmPendingUpload() {
  const { parser, targets, rejected } = this._pendingUpload;
  const results = [];
  for (const t of targets) {
    const r = await this.upsertRows(t.table, t.rows);
    results.push({ table: t.table, ...r });
    if (r.error) break;  // partial-tolerant: don't attempt later tables on failure
  }
  this._renderSummary(results, rejected);
  this._pendingUpload = null;
  this._uploading = false;
  DataStore.cacheData();
  App.refreshAllViews();
}

cancelPendingUpload() {
  this._pendingUpload = null;
  this._uploading = false;
  this._setStatus('idle', '');
}
```

The controller is fully parser-agnostic. A fourth parser is added by putting a module in `js/upload/`, registering it in `index.js`, and adding a button — zero changes to the pipeline.

### 4.5 File responsibilities

| File | Change |
|---|---|
| `js/upload.js` | Shrinks. Keeps controller logic, preview state, confirm/cancel handlers, `upsertRows`, `_detectDuplicates`. Parsing code removed. |
| `js/upload/*.js` | New subdirectory. One module per format + registry. |
| `js/config.js` | Adds `sampleTypeRouting` for WineXRay; adds column maps for pre-recepción; keeps existing `wxToSupabase`, `recepcionToSupabase`, `prefermentToSupabase`. |
| `js/events.js` | Three new button click handlers + preview card Confirm/Cancel handlers. |
| `api/upload.js` | Adds `berry_samples` and `pre_receptions` to whitelist; fixes `reception_lots` entry (new conflict key, accepts `report_code`). `mediciones_tecnicas` entry is not changed. |
| `sql/migration_berry_samples.sql` | New table. |
| `sql/migration_pre_receptions.sql` | New table (distinct from `mediciones_tecnicas`). |
| `sql/migration_reception_lots_upsert.sql` | Adds `report_code TEXT NOT NULL` to `reception_lots` + unique constraint `(report_code, lot_position)`; drops `reception_id` requirement (kept as nullable FK for historical compatibility) and backfills `report_code` from the FK. |
| `scripts/import-mostos-2024.js` | New Node CLI, not deployed. |
| `index.html` | Three buttons + one preview-card container. |
| `css/` | Styles for buttons and preview card. |

## 5. Data flow

One shared flow for all three parsers. Parser differences live in `parser.parse()` only.

```
User clicks "Cargar <format>"
         │  (file picker opens with accept=".<ext>")
         ▼
File selected
         │
         ▼
UploadManager.startUpload(parserId, file)
  – size ≤ 10 MB
  – client-side role check (lab/admin)
  – single-flight guard
         │
         ▼
parser.parse(file)
  → { targets, excluded, rejected, meta }
  – throws on unrecoverable parse errors (Spanish message)
  – validates file matches the declared format (fail fast if not)
         │
         ▼
Per target:
  Identity.canonicalSeqAssign(rows)  ← winexray only; others no-op
  _countNew(table, rows, conflictKey) → new vs update split
         │
         ▼
_pendingUpload stored in-memory, preview card rendered
NO DB WRITES YET
         │
    ┌────┴────┐
    │         │
[Cancelar] [Confirmar]
    │         │
    ▼         ▼
clear      upsertRows(target[0])   ← sequential
state      upsertRows(target[1])
           upsertRows(target[2])
           │
           ▼
Summary: per-table inserted count · rejected count · link to rechazados.csv
DataStore.cacheData() invalidated
App.refreshAllViews()
```

**Key properties:**

- Parse + preview is entirely client-side. No DB writes occur until Confirm.
- `_uploading` stays true from button click until Confirm/Cancel. A second button click is a no-op in that window.
- Duplicates are checked *before* preview so the card shows "N new · M update" per table.
- Errors at parse stage → Spanish error, no Confirm button, state reset on acknowledge.
- Errors during Confirm → remaining targets are skipped, summary names what succeeded and what didn't, no auto-retry, no rollback (previous successes are durable).
- After full success → `DataStore.cacheData()` + `App.refreshAllViews()` fire; unchanged from today.

## 6. Schema changes

Three migrations. Each is a single SQL file, idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / guarded constraint drops).

### 6.1 New `berry_samples` table

```sql
-- sql/migration_berry_samples.sql
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
  ON berry_samples (vintage_year, variety);
CREATE INDEX IF NOT EXISTS berry_samples_appellation
  ON berry_samples (appellation);
```

### 6.2 New `pre_receptions` table

Pre-recepción is its own dataset. It overlaps with `mediciones_tecnicas` on a few fields (variety, lot code, some berry-health counts) but captures additional upstream data (supplier, reception date, bin/truck temps, bunch weight, berry length, pasificadas counts, lab chemistry). `mediciones_tecnicas` is not touched — it stays owned by the form in `mediciones.js` with its existing schema.

```sql
-- sql/migration_pre_receptions.sql
CREATE TABLE IF NOT EXISTS public.pre_receptions (
  id                BIGSERIAL PRIMARY KEY,

  -- identity
  report_code       TEXT NOT NULL,            -- "No. Reporte" (e.g., MT-24-001)
  UNIQUE (report_code),

  -- context
  vintrace          TEXT,                     -- Vintrace reference / "PENDIENTE"
  reception_date    DATE,                     -- Fecha recepción de uva
  medicion_date     DATE,                     -- Fecha medición técnica
  vintage_year      INT,
  supplier          TEXT,                     -- Proveedor
  variety           TEXT,
  lot_code          TEXT,                     -- Lote de campo

  -- load characteristics
  total_bins        INT,                      -- Total bins/jabas
  bin_unit          TEXT,                     -- "bins" | "jabas"
  tons_received     NUMERIC,                  -- Toneladas totales
  bin_temp_c        NUMERIC,                  -- Temperatura bins/jabas
  truck_temp_c      NUMERIC,                  -- Temperatura camión

  -- morphology
  bunch_avg_weight_g    NUMERIC,              -- Peso promedio racimos (g)
  berry_length_avg_cm   NUMERIC,              -- Longitud promedio por baya (cm)
  berries_200_weight_g  NUMERIC,              -- Peso de 200 bayas (g)
  berry_avg_weight_g    NUMERIC,              -- Peso promedio por baya (g)

  -- health counts (berries in the inspected sample)
  health_madura         INT,
  health_inmadura       INT,
  health_sobremadura    INT,
  health_picadura       INT,
  health_enfermedad     INT,
  health_pasificada     INT,
  health_aceptable      INT,
  health_no_aceptable   INT,

  -- lab chemistry
  lab_date          DATE,                     -- Fecha análisis laboratorio
  brix              NUMERIC,
  ph                NUMERIC,
  at                NUMERIC,                  -- g/L
  ag                NUMERIC,                  -- g/L
  am                NUMERIC,                  -- g/L
  polifenoles       NUMERIC,                  -- mg/L
  catequinas        NUMERIC,                  -- mg/L
  antocianos        NUMERIC,                  -- mg/L

  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pre_receptions_vintage_variety
  ON pre_receptions (vintage_year, variety);
CREATE INDEX IF NOT EXISTS pre_receptions_reception_date
  ON pre_receptions (reception_date);
CREATE INDEX IF NOT EXISTS pre_receptions_supplier
  ON pre_receptions (supplier);
```

**Why a separate table, not an extension of `mediciones_tecnicas`:** the two are different datasets in the lab's taxonomy. `mediciones_tecnicas` are measurements made on the morning of grape arrival, entered manually via the form. Pre-recepción is a broader upstream record (supplier logistics, bin characteristics, full lab chemistry) maintained in a different workflow. Merging them would confuse ownership and make the form-vs-file distinction unclear. Separate tables let each dataset be queried, charted, and navigated as its own entity.

### 6.3 `reception_lots` upsert fix

The current situation: table has `UNIQUE (reception_id, lot_code)` but `api/upload.js` has `conflict: null`. The client pushes `{ report_code, lot_code, lot_position }`, the API whitelist requires `reception_id`, so the path never actually worked. Making it bulletproof means adding `report_code` to the table, making it the upsert key, and letting the API accept it.

```sql
-- sql/migration_reception_lots_upsert.sql
ALTER TABLE reception_lots
  ADD COLUMN IF NOT EXISTS report_code TEXT;

-- Backfill from FK for any existing rows
UPDATE reception_lots rl
  SET report_code = tr.report_code
  FROM tank_receptions tr
  WHERE rl.reception_id = tr.id
    AND rl.report_code IS NULL;

-- Going forward, report_code is required; reception_id becomes optional
ALTER TABLE reception_lots ALTER COLUMN report_code SET NOT NULL;
ALTER TABLE reception_lots ALTER COLUMN reception_id DROP NOT NULL;

-- Idempotency key for upserts
ALTER TABLE reception_lots
  DROP CONSTRAINT IF EXISTS reception_lots_reception_id_lot_code_key;

ALTER TABLE reception_lots
  ADD CONSTRAINT reception_lots_upsert_key
  UNIQUE (report_code, lot_position);
```

Client and API both move to `report_code` as the link; `reception_id` FK stays for historical rows and for joining via views, but is no longer required on insert.

## 7. Parsers

Each module is responsible for: opening the file, validating its shape, producing normalized row payloads, and categorizing rejections/exclusions. No module talks to Supabase or the UI.

### 7.1 `js/upload/winexray.js`

- Extension: `.csv` (also reads `.xlsx` if SheetJS handles it, but the button accepts `.csv` only).
- **Fail-fast validation:** if none of the known WineXRay headers (`Sample Id`, `Sample Type`, `Sample Date`) are present → throw `"Este archivo no parece ser un export de WineXRay: faltan columnas requeridas."`
- **Per-row classification (in order):**
  1. `!sample_id` → `rejected` with `motivo_rechazo = 'Sample Id faltante'`
  2. `CONFIG.isSampleExcluded(sample_id)` | `_labTestRe.test(sample_id)` | `_labTestRe.test(sample_type)` | `appellation === 'California'` → `excluded` with category label
  3. `CONFIG.sampleTypeRouting[sample_type]` lookup:
     - `'wine_samples'` → shape + push to wine target
     - `'berry_samples'` → shape + push to berry target
     - `'skip'` → counted in `excluded.control_wine`
     - `undefined` → `rejected` with `motivo_rechazo = 'Sample Type no reconocido: <value>'`

- **Routing whitelist** (single source of truth in `config.js`):

  ```js
  CONFIG.sampleTypeRouting = {
    'Berries':      'berry_samples',
    'Must':         'wine_samples',
    'Young Wine':   'wine_samples',
    'Aging Wine':   'wine_samples',
    'Bottled Wine': 'wine_samples',
    'Control Wine': 'skip',
  };
  ```

- Emits two targets:
  ```js
  { targets: [
      { table: 'wine_samples',  rows: [...], conflictKey: 'sample_id,sample_date,sample_seq' },
      { table: 'berry_samples', rows: [...], conflictKey: 'sample_id,sample_date,sample_seq' }
  ]}
  ```

### 7.2 `js/upload/recepcion.js`

- Extension: `.xlsx`, `.xls`.
- **Fail-fast validation:** both `Recepción` and `Prefermentativos` sheets must be present (case-insensitive substring match on sheet names, as today). Missing either → Spanish error identifying which is missing.
- Parsing logic is the current `parseRecepcion(wb)` lifted into the module verbatim, with two corrections:
  - Lot rows emit `{ report_code, lot_code, lot_position }` directly. `reception_id` is no longer sent by the client — after the migration in §6.3, `report_code` is the link column for `reception_lots`, and `reception_id` remains only as a nullable FK on historical rows.
  - Emits three targets with explicit `conflictKey`:
    ```js
    { targets: [
        { table: 'tank_receptions',  rows: [...], conflictKey: 'report_code' },
        { table: 'reception_lots',   rows: [...], conflictKey: 'report_code,lot_position' },
        { table: 'prefermentativos', rows: [...], conflictKey: 'report_code,measurement_date' }
    ]}
    ```
- **Target order:** `tank_receptions` first so the parent `report_code` exists before child rows reference it; then `reception_lots`; then `prefermentativos`. Controller runs them sequentially in array order.

### 7.3 `js/upload/prerecepcion.js` (new)

- Extension: `.xlsx`, `.xls`.
- **Fail-fast validation:** sheet named `Pre-recepción` (case-insensitive) must exist, containing a header row with at least `No. Reporte`, `Fecha medición técnica`, `Variedad`, `Lote de campo`. Header row is *not* row 0 in these files — it's typically row 2 (rows 0-1 are title + blank). Parser scans the first ~10 rows for a row with ≥5 non-null cells as the header.
- **Column mapping** (added to `config.js`):

  ```js
  CONFIG.preReceptionsToSupabase = {
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
  };
  ```

- The column `'Longitud promedio de 10 bayas (cm)'` is deliberately not mapped — the per-bayas average (`'Longitud promedio por baya (cm)'`) carries the same information and is what we keep.
- Header matching is whitespace-normalized (`.trim()`, collapse internal whitespace) since the source file has trailing spaces on some labels.
- **Per-row classification:**
  1. `!report_code` or `report_code === 'PENDIENTE'` → `rejected` with reason (`'Reporte faltante'` or `'Reporte pendiente'`).
  2. Otherwise normalize variety via `CONFIG.normalizeVariety`, extract `vintage_year` from `medicion_date || reception_date` (year part), push to target.
- **One target:**
  ```js
  { targets: [
      { table: 'pre_receptions', rows: [...], conflictKey: 'report_code' }
  ]}
  ```
- Re-uploading the file updates any existing `pre_receptions` row whose `report_code` matches, so incremental uploads and accidental duplicates are both safe.
- **`mediciones_tecnicas` is never touched by this parser.**

## 8. Preview card UX

Same card structure for all three formats. Labels and icons differ per parser, rendered from `parser.label` and a small icon map. All text Spanish. CSP-safe DOM (no inline handlers, no innerHTML of user data). Mobile responsive per project convention.

```
┌──────────────────────────────────────────────────────────────┐
│ 📄 <filename> · <N> filas analizadas · <parser.label>        │
├──────────────────────────────────────────────────────────────┤
│   Listo para insertar                                        │
│   <emoji> <table display name>  <N>   (<new> nuevas · <upd> upd.) │
│   …                                                          │
│                                                              │
│   Omitidos por política                                      │
│   <reason label>  <N>                                        │
│   …                                                          │
│                                                              │
│   ⚠ Rechazados (revisar)                                    │
│   <motivo>  <N>  [ Descargar CSV ]                          │
│   …                                                          │
│                                                              │
│   [ Cancelar ]                    [ Confirmar e insertar ]  │
└──────────────────────────────────────────────────────────────┘
```

**Display names per table:**

- `wine_samples` → "🍷 Muestras de vino"
- `berry_samples` → "🫐 Muestras de baya"
- `tank_receptions` → "🛢️ Recepciones de tanque"
- `reception_lots` → "📦 Lotes de recepción"
- `prefermentativos` → "🧪 Prefermentativos"
- `pre_receptions` → "📋 Pre-recepciones"

**Behavior unchanged from original design:**

- Confirm disabled if `sum(t.rows.length) === 0`.
- Rechazados CSV generated client-side from `rejected[]`, `a[download]` with object URL revoked after click.
- Confirm → sequential `upsertRows` per target, first-failure stops the chain, summary names outcome per target.
- Cancel → clear state, no writes, return to idle.
- Re-upload of an identical file produces a preview where every target shows "0 nuevas · N actualizadas" — the operator sees it *before* committing.

## 9. Classification and normalization rules

WineXRay is the only parser with non-trivial classification; the others are 1:1 column-to-column mappings with minimal filtering.

**WineXRay rules** — see §7.1.

**Recepción rules** (unchanged from today):
- Rows with no `report_code` → excluded (reason `missing_report_code`).
- Lot rows with empty `_lotN` value → not emitted.
- Prefermentativos rows with no data → excluded.

**Pre-recepción rules** (new):
- `report_code === 'PENDIENTE'` or `!report_code` → rejected. These are rows the lab hasn't finalized yet (the source file's `Vintrace` column often shows `PENDIENTE` instead of a real report code).
- All other rows → emitted to `pre_receptions`.
- `medicion_date` and `reception_date` may both be null for a pending row; they do not block classification once `report_code` is valid.

**Shared normalization** (applied by each parser as relevant, from existing helpers in `config.js`):
- `normalizeVariety()` — `Petite Sirah` → `Durif`, etc.
- `normalizeAppellation()` — old names → ranch-first format.
- `vintage_year` extraction — from `sample_id` prefix for WineXRay, from `medicion_date.getFullYear()` for pre-recepción, from `batch_code` prefix for Recepción.
- Below-detection `<N` → `null` + `below_detection = true` (WineXRay only).
- `-`, `—`, `NA`, `N/A`, empty → `null`.

## 10. Testing

**Unit tests** (Vitest, under `tests/`):

1. `tests/upload-winexray.test.js`
   - Every known `Sample Type` routes to correct target.
   - Unknown `Sample Type` → `rejected` with reason.
   - Empty `sample_id` → `rejected`.
   - `isSampleExcluded` / `_labTestRe` / `California` → `excluded` with category.
   - `<50` / `<10` → `null` + `below_detection = true` on both wine and berry shapers.
   - Fixture test: trimmed slice of `result (2).csv` in `tests/fixtures/winexray_mixed.csv`; asserts hand-verified counts.

2. `tests/upload-recepcion.test.js`
   - Fixture: trimmed `Recepcion_de_Tanque_2025.xlsx` slice.
   - `tank_receptions`, `reception_lots`, `prefermentativos` all emit expected counts.
   - Lot rows use `report_code`, not `reception_id`.
   - Missing one of the two sheets → parse throws with sheet-name-specific Spanish error.

3. `tests/upload-prerecepcion.test.js`
   - Fixture: trimmed `prerecepcion_actualizado (1).xlsx` slice.
   - Header row auto-detected when not at row 0.
   - `'PENDIENTE'` report_code → rejected.
   - Lab chemistry columns populated when present, `null` when absent.
   - All mapped columns appear on output rows (no silent drops).
   - Target table is `pre_receptions`. `mediciones_tecnicas` receives zero rows.

4. `tests/upload-controller.test.js`
   - `_pendingUpload` populated after parse; cleared on Cancel; cleared after successful Confirm.
   - Confirm disabled when every target has 0 rows.
   - Single-flight: second button click while `_uploading=true` is a no-op.
   - Rechazados CSV has original columns + `motivo_rechazo`.
   - Partial success (first target inserts, second fails): summary shows both outcomes; remaining targets not attempted.

5. `tests/api-upload.test.js`
   - `berry_samples` accepted with its column whitelist.
   - `pre_receptions` accepted with its column whitelist and `report_code` conflict key.
   - `reception_lots` accepts `report_code` + conflict key on `(report_code, lot_position)`.
   - `mediciones_tecnicas` whitelist is **unchanged** — existing form-driven writes must keep working exactly as before.
   - Unknown columns stripped.
   - Missing required fields rejected with Spanish error.

**Manual verification checklist** (all must pass before marking done):

- [ ] `npm test` clean, `npm run build` clean.
- [ ] Three buttons render in correct order on desktop and mobile; each opens the file picker with correct `accept` attribute.
- [ ] Drop `result (2).csv` on WineXRay button. Preview shows expected counts (~2,171 wine / 920 berry / 280 Control / ~142 rejected). Rechazados CSV downloads and opens cleanly in Excel.
- [ ] Confirm → `wine_samples` and `berry_samples` populated in Supabase; `DataStore.cacheData()` invalidates; KPIs/charts refresh.
- [ ] Re-drop same WineXRay file. Preview shows "0 nuevas · N actualizadas" for both tables; Confirm is a no-op in effect.
- [ ] Drop `Recepcion_de_Tanque_2025.xlsx` on Recepción button. Preview shows `tank_receptions` + `reception_lots` + `prefermentativos` counts.
- [ ] Re-drop same Recepción file. Preview shows all updates, zero new. **This is the key bulletproof test — the pre-existing lots bug must be fixed.**
- [ ] Drop `prerecepcion_actualizado (1).xlsx` on Pre-recepción button. Preview shows `pre_receptions` count, minus any `PENDIENTE` rows rejected.
- [ ] Confirm → `pre_receptions` rows inserted. `mediciones_tecnicas` row count is unchanged.
- [ ] Use the existing mediciones form to add a row. Row lands in `mediciones_tecnicas` with zero interference from this spec's changes.
- [ ] Re-drop same pre-recepción file. Preview shows all updates, zero new.
- [ ] Drop wrong file on wrong button (e.g., WineXRay CSV on Recepción button). Spanish error, no preview, no writes.
- [ ] Drop corrupted/unreadable file. Spanish error, no preview, no writes.
- [ ] Mobile 375px width: all three buttons tappable; preview card legible.

## 11. One-time MOSTOS import

Not in the UI. Handled by `scripts/import-mostos-2024.js` — a Node CLI run locally once against production.

**Contract:**

- Reads `Xanic info/MOSTOS PHENOLICS 24-25 (1).xlsx`, sheet `PHENOLICS 2024` only. All other sheets (BERRIES, pivots, per-variety) ignored with a logged note.
- Maps each row to `tank_receptions` with the available columns: `report_code` (derive from `TANQUE` + `FECHA` hash if no natural key — see below), `reception_date`, `batch_code` (from `LOTE`), `tank_id` (from `TANQUE`), `supplier`, `variety`, `polifenoles_wx` (from `PHENOLICS`), `antocianinas_wx` (from `ANTHOCYANINS`), `vintage_year = 2024`.
- **Open question** (resolve before running): the file has no `Reporte` column, so `report_code` must be synthesized. Proposed: `"MOSTOS-2024-" + rowIndex` or `"MOSTOS-" + tank_id + "-" + ISO(reception_date)`. The latter is safer for re-runs (idempotent); the former is simpler. Committing to the latter unless the user pushes back.
- Upserts via service key directly to Supabase (no `/api/upload` route, since this is a local dev tool).
- Logs per-row progress and a final summary to stdout.
- Exits non-zero on any error; safe to rerun (upserts are idempotent).

**Not run during `npm run build`** or CI. Lives in `scripts/` alongside any other dev utilities. Can be deleted after use or left as a record.

## 12. Rollout order

1. Apply `sql/migration_berry_samples.sql`. Table exists, empty.
2. Apply `sql/migration_pre_receptions.sql`. Table exists, empty.
3. Apply `sql/migration_reception_lots_upsert.sql`. Backfill runs; conflict key added.
4. Deploy `api/upload.js` with updated `ALLOWED_TABLES` (adds `berry_samples` and `pre_receptions`, fixes `reception_lots`). `mediciones_tecnicas` entry is unchanged. Old client still works — it just can't target the new tables yet.
5. Deploy `js/upload/` modules + controller rewrite + `index.html` buttons + CSS + `events.js` handlers. All three buttons go live simultaneously.
6. Lab drops one of each file type in production; operator verifies counts match expectations; re-drops same files to verify idempotency.
7. Run `node scripts/import-mostos-2024.js` locally against production once. Verify row counts in `tank_receptions`. Archive the script.

## 13. Open decisions

Resolve before implementation:

- **MOSTOS `report_code` synthesis** — currently proposing `"MOSTOS-" + tank_id + "-" + ISO(reception_date)`. Confirm or replace.
- **Whether to keep `reception_lots.reception_id` FK at all** after this change. Proposal: keep as nullable, stop populating it from new uploads, leave existing joined views alone.
- **Display order of the three buttons** — currently WineXRay, Recepción, Pre-recepción. If one is used more often, it could lead.

## 14. Downstream findability (follow-up scope)

Each recurring format now has its own clearly-named destination table:

- WineXRay → `wine_samples` + `berry_samples`
- Recepción → `tank_receptions` + `reception_lots` + `prefermentativos`
- Pre-recepción → `pre_receptions`
- Mediciones técnicas (form-only, unchanged) → `mediciones_tecnicas`

The user's concern is that each of these datasets should be **easily findable in the dashboard UI** — not just visible as a table in Supabase. This spec creates the tables and the upload paths but does **not** add navigation or views for `berry_samples` or `pre_receptions`. That work belongs to a follow-up spec ("Add navigation + views for berry samples and pre-recepción datasets") which will decide:

- Where each dataset appears in the nav (sidebar entry? top-level tab?).
- What charts / tables / KPIs make sense per dataset.
- Whether the existing Mediciones view needs an adjacent "Pre-recepción" view.
- Whether the WineXRay analytics should split wine and berry data into separate screens.

For this spec, the contract is: the data is there, the table names are self-explanatory, and a future spec can light up the UI without any further schema changes.
