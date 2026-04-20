> **ARCHIVED — RESOLVED in Phase 8 (commits up to `3c2b8e8`).**
> This document described the pre–Phase-8 berry upload identity bug (non-deterministic
> `sample_seq`, weak `sample_id = '25'`, collapsed lots). The fix shipped as `js/identity.js`
> and `buildBerryIdentity()`; see Rounds 13–16 in `REVIEW.md` and the MT.1–MT.7 test suites
> in `tests/`. Preserved here for historical context only.
> **Do not treat the recommendations below as open action items.**

---

# Diagnosis: Berry Data Collapse on Server Upload

## Problem

When uploading WineXRay CSV files through the server (`/api/upload`), only **one data point per lot** survives in the database. Uploading the same file temporarily (client-side, in-memory) shows the full multi-date evolution as expected.

## Root Cause

**All Berry samples in the WineXRay CSV have `Sample Id = '25'` (just the vintage prefix, not a unique identifier).**

The server upserts on the unique constraint:

```
UNIQUE (sample_id, sample_date, sample_seq)
```

Since every berry row shares `sample_id = '25'`, rows with the same `sample_date` collapse during upsert — only one row per date survives (per `sample_seq` value). Different varieties, lots, and appellations measured on the same date overwrite each other.

### Evidence

```sql
-- All berry rows in the DB have sample_id = '25':
SELECT DISTINCT sample_id FROM wine_samples WHERE sample_type IN ('Berries', 'Berry');
-- Returns: '25'
```

### Why Temp Upload Works

The temporary (client-side) path parses the CSV into `DataStore.berryData` in memory and renders directly. No upsert occurs — every parsed row is kept. The lot identity comes from other columns (variety, appellation) during display, so the data appears correct.

### Why Server Upload Fails

The server path upserts via Supabase REST API with `on_conflict=sample_id,sample_date,sample_seq`. When 5 berry samples from different lots share `sample_id = '25'` and `sample_date = '2025-10-30'`, `sample_seq` assignment gives them values 1–5. On the first upload, all 5 insert correctly. On re-upload, they upsert correctly (same seq values).

**BUT** — if the CSV has different lots in different row orders between uploads, `sample_seq` assignment shifts and data from one lot overwrites data from another lot. And if only one berry per date existed in the original upload, all subsequent data for that date was lost.

### Additional Problem: `extractLotCode('25')` → `''`

`dataLoader.js:279-287` strips the `25` vintage prefix, leaving an empty string. Every berry sample gets `lotCode = ''`. Charts that group by lot show all berries as one "lot."

## Affected Components

| File | Issue |
|------|-------|
| WineXRay CSV | Berry `Sample Id` column contains only vintage prefix (`25`), not a unique lot code |
| `api/upload.js:6` | Upsert conflict on `(sample_id, sample_date, sample_seq)` — meaningless when `sample_id` is the same for all berries |
| `js/dataLoader.js:279` | `extractLotCode('25')` → `''` — all berries get empty lot code |
| `js/upload.js:97-103` | `sample_seq` assignment is fragile — row order changes shift seq values |

## Fix Options

### Option A: Composite `sample_id` (Recommended)

During CSV parsing in `parseWineXRay()`, construct a meaningful `sample_id` for berry rows:

```
sample_id = `${vintage}${varietyCode}${appellationCode}-B`
```

Example: `25CSVA-B` (2025, Cabernet Sauvignon, Valle de Guadalupe, Berry). This makes the unique constraint work correctly — each lot+date combination gets its own row.

**Pros:** No schema change. No migration. Fixes the upsert immediately.
**Cons:** Requires a one-time re-upload to populate correct `sample_id` values.

### Option B: Add `variety` + `appellation` to the unique constraint

Change the constraint to `UNIQUE (sample_id, sample_date, variety, appellation, sample_seq)`.

**Pros:** Works without changing CSV parsing.
**Cons:** Schema migration required. Wider constraint may cause other issues.

### Option C: Leave `sample_id` as-is, use `vessel_id` or `appellation` as disambiguator

If the CSV has a `Vessel Id` column for berry samples, use it to construct a unique `sample_id`.

**Pros:** Uses existing data.
**Cons:** Need to verify `Vessel Id` is populated for berry rows.

## Next Step

Inspect the actual WineXRay CSV to confirm what columns are available for berry rows. Run:

```sql
SELECT sample_id, vessel_id, variety, appellation, sample_date, sample_seq
FROM wine_samples
WHERE sample_type IN ('Berries', 'Berry')
ORDER BY sample_date, variety;
```

This shows whether `vessel_id`, `variety`, or `appellation` can disambiguate berry samples.
