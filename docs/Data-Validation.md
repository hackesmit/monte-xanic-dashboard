# Data Validation and Ingestion Rules

## File Type Detection

| Extension | Detected As | Handler |
|-----------|-------------|---------|
| `.csv` | WineXRay export | `UploadManager.parseWineXRay()` |
| `.xlsx` | Recepcion de Tanque | `UploadManager.parseRecepcion()` |
| Other | Rejected | Error message shown |

## WineXRay CSV Normalization

### Below-Detection Values
Values matching `/^<\s*\d+(\.\d+)?$/` (e.g. `<50`, `<10`, `< 5.0`) are:
- Stored as `NULL` in the database
- `below_detection` flag set to `true` on the row
- Displayed with dagger mark in tables

### Null Handling
These string values are treated as NULL: `-`, `--`, `NA`, `N/A`, empty string.

### Excluded Samples (filtered on upload)

**Lab test patterns** (regex, case-insensitive):
`COLORPRO`, `CRUSH`, `WATER`, `BLUEBERRY`, `RASPBERRY`, `BLACKBERRY`

**Hardcoded exclusions:**
`24ROSEMX-5`, `24CABERNETMERLOT-1`, `25ROSEMX-1`

**Pattern exclusions:**
- Sample IDs containing `EXP`, `EXPERIMENT`, or `NORMAL`
- Appellation normalizing to `California`

### Variety Normalization
- `Petite Sirah` -> `Durif`
- Applied during upload via `CONFIG.normalizeVariety()`

### Appellation Normalization
Old formats are converted to ranch-first format:
- `VDG - Monte Xanic` -> `Monte Xanic (VDG)`
- Applied during upload via `CONFIG.normalizeAppellation()`

### Sample Sequence Assignment
When multiple rows share the same `(sample_id, sample_date)`:
- Each gets an incrementing `sample_seq` value (1, 2, 3...)
- This prevents the composite unique constraint from rejecting legitimate duplicate-day measurements

## Recepcion Excel Handling

### Sheet Detection
- Sheet names containing `preferm` (case-insensitive): parsed as prefermentativos
- Sheet names containing `recep` (case-insensitive): parsed as receptions

Both sheets are always processed when present.

### Lot Splitting
Each reception row may contain up to 4 lot columns (`_lot1` through `_lot4`). These are:
1. Extracted from the reception row
2. Stripped from the reception data before insertion
3. Inserted as separate rows in `reception_lots` with `lot_position` 1-4

### Vintage Extraction
`vintage_year` is extracted from `batch_code` prefix: `25SBVDG-1` -> 2025.

## Upsert (Duplicate Handling)

| Table | Conflict Columns | Behavior |
|-------|-----------------|----------|
| wine_samples | sample_id, sample_date, sample_seq | Merge on conflict |
| tank_receptions | report_code | Merge on conflict |
| prefermentativos | report_code, measurement_date | Merge on conflict |
| mediciones_tecnicas | medicion_code | Merge on conflict |
| reception_lots | (none) | Insert only |

"Merge on conflict" means existing rows are updated with new values. Supabase `Prefer: resolution=merge-duplicates` header.

## Server-Side Validation

Performed in `/api/upload.js`:
- Token verification (HMAC + expiry + blacklist)
- Role check: only `lab` and `admin` can upload
- Table name must be in server-side allowlist
- Row count must not exceed table-specific limit (500 for wine_samples, 200 for others)
- Conflict columns are defined server-side only (client input ignored)

## Recommended Future Improvements

- Add server-side row-level validation (type checking, range validation)
- Add checksum or hash verification for uploaded files
- Add upload audit log (who uploaded what, when)
- Validate that variety and appellation values match known lists server-side
- Add a preview/confirmation step before insertion for large batches
