# Plan — Phase 8: Deterministic Berry Upload Identity & Pipeline Hardening

## Status: APPROVED — Ready for Builder

**Reference:** `codex-review-consolidated-handoff.md` (full Codex analysis)
**Objective:** `TASK.md` (acceptance criteria)

---

## Architecture

```
Current Flow (buggy):
  CSV/XLSX → parseWineXRay() → assign seq by ROW ORDER
                              → _detectDuplicates(2-col)
                              → POST /api/upload
                              → upsert on 3-col key  ← MISMATCH

New Flow (deterministic):
  CSV/XLSX → parseWineXRay()
               ├─ reject weak sample_ids (Identity.isWeakSampleId)
               ├─ normalize via Identity module
               ├─ sort within (id,date) groups by stable fields
               │   → assign deterministic seq (Identity.canonicalSeqAssign)
               ├─ _detectDuplicates(3-col, matches real key)
               └─ POST /api/upload
                    ├─ validate columns per table whitelist
                    ├─ reject rows missing required fields
                    └─ upsert on 3-col key  ← MATCHES
```

---

## Phase 1: Deterministic Identity (core fix)

### 1a. Deterministic `sample_seq` — `js/upload.js:97-103`

Replace row-order counter with content-based sort. Within each `(sample_id, sample_date)` group, sort rows by `(sample_type, vessel_id, brix, ph, ta)` before assigning seq.

```js
// Current (non-deterministic):
const seqCounters = {};
result.forEach(r => {
  const key = `${r.sample_id}|${r.sample_date || ''}`;
  seqCounters[key] = (seqCounters[key] || 0) + 1;
  r.sample_seq = seqCounters[key];
});

// New (deterministic):
const groups = {};
result.forEach(r => {
  const key = `${r.sample_id}|${r.sample_date || ''}`;
  (groups[key] = groups[key] || []).push(r);
});
for (const rows of Object.values(groups)) {
  rows.sort((a, b) => {
    return (a.sample_type || '').localeCompare(b.sample_type || '')
        || (a.vessel_id || '').localeCompare(b.vessel_id || '')
        || (a.brix ?? -Infinity) - (b.brix ?? -Infinity)
        || (a.ph ?? -Infinity) - (b.ph ?? -Infinity)
        || (a.ta ?? -Infinity) - (b.ta ?? -Infinity);
  });
  rows.forEach((r, i) => { r.sample_seq = i + 1; });
}
```

**No schema change** — same `(sample_id, sample_date, sample_seq)` constraint.

### 1b. Weak `sample_id` guard — `js/upload.js:~83`

After building `obj`, skip rows where `sample_id` is purely numeric or < 3 characters (e.g., `'25'`, `'1'`). These cannot produce meaningful lot codes.

```js
// After line 82: if (obj.sample_id) {
if (/^\d+$/.test(obj.sample_id) || obj.sample_id.length < 3) continue;
```

### 1c. Fix `_detectDuplicates` — `js/upload.js:193-212` + call site `~303`

Currently checks `(sample_id, sample_date)` — 2 columns. Real upsert conflict is 3 columns. Refactor to accept variable key columns and build composite match sets.

```js
// Call site change:
const dupInfo = await this._detectDuplicates(
  'wine_samples', samples, ['sample_id', 'sample_date', 'sample_seq']
);
```

---

## Phase 2: Shared Identity Module

### 2a. Create `js/identity.js` (NEW file)

Global `Identity` object (matching project convention — no ES modules on client side).

**Exports:**
- `Identity.canonicalSeqAssign(rows)` — deterministic sort + assign from Phase 1a
- `Identity.extractLotCode(sampleId)` — moved from `DataStore` (`js/dataLoader.js:279-286`)
- `Identity.isWeakSampleId(id)` — the guard from Phase 1b
- `Identity.stableRowKey(row)` — returns `sample_id|sample_date|sample_seq` for dedup

### 2b. Wire into `js/upload.js`

Replace inline seq assignment with `Identity.canonicalSeqAssign(result)`.
Replace inline weak-ID check with `Identity.isWeakSampleId(obj.sample_id)`.

### 2c. Wire into `js/dataLoader.js`

Replace `DataStore.extractLotCode` implementation with delegation to `Identity.extractLotCode`. Keep `DataStore.extractLotCode` as thin wrapper (other files call it).

### 2d. Add `<script>` tag — `index.html`

Insert `<script src="js/identity.js"></script>` before `dataLoader.js` (line 919), since both `dataLoader.js` and `upload.js` depend on it.

---

## Phase 3: Harden Backend

### 3a. Per-table column whitelist — `api/upload.js`

Add `columns` (Set) to each entry in `ALLOWED_TABLES`. Before upsert, strip any field not in the whitelist from each row.

```js
const ALLOWED_TABLES = {
  wine_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    maxRows: 500,
    required: ['sample_id'],
    columns: new Set([
      'sample_id','vessel_id','sample_type','sample_date',
      'crush_date','days_post_crush','vintage_year','variety','appellation',
      'tant','fant','bant','ptan','irps','ipt','ph','ta','brix',
      'l_star','a_star','b_star','color_i','color_t','berry_weight',
      'berry_anthocyanins','berry_sugars_mg','alcohol','va','malic_acid',
      'rs','below_detection','notes','sample_seq'
    ])
  },
  // same pattern for mediciones_tecnicas and reception_lots
};
```

### 3b. Required-field rejection — `api/upload.js`

After stripping unknown columns, reject any row missing its table's `required` fields with a 400 error and Spanish message.

---

## Phase 4: Tests

### 4a. `tests/mt6-canonical-seq.test.mjs` (NEW)

- Same rows in different orders → identical `sample_seq` assignments
- Weak `sample_id` values are filtered out
- Groups with different `(sample_id, sample_date)` get independent counters
- Tiebreaking by `brix/ph/ta` works correctly
- `Identity.extractLotCode` returns expected lot codes
- `Identity.isWeakSampleId` detects weak IDs

### 4b. `tests/mt7-column-whitelist.test.mjs` (NEW)

- Unknown columns are stripped
- Required columns trigger rejection when missing
- Valid rows pass through unchanged

---

## Files Modified

| File | Change Type | Phase |
|------|-------------|-------|
| `js/identity.js` | **NEW** — shared identity module | 2a |
| `js/upload.js` | Deterministic seq, weak ID guard, fixed dedup, use Identity | 1a, 1b, 1c, 2b |
| `js/dataLoader.js` | Delegate `extractLotCode` to Identity | 2c |
| `api/upload.js` | Column whitelist, required-field validation | 3a, 3b |
| `index.html` | Add `<script src="js/identity.js">` | 2d |
| `tests/mt6-canonical-seq.test.mjs` | **NEW** — deterministic seq + weak ID tests | 4a |
| `tests/mt7-column-whitelist.test.mjs` | **NEW** — server validation tests | 4b |

---

## No Schema Migration Needed

The `(sample_id, sample_date, sample_seq)` constraint stays unchanged. We make `sample_seq` deterministic within the existing schema.

## Historical Data Note

Existing rows have `sample_seq` from old row-order logic. On next re-upload of the same WineXRay files, the deterministic sort may produce different seq values than stored. Since upsert key includes `sample_seq`, this creates new rows instead of updating.

**Remediation:** After deploying code changes, do a one-time re-upload of canonical WineXRay source files. Then clean up orphaned rows:

```sql
-- After re-upload, remove orphaned rows from old non-deterministic seq
-- Exact query to be verified against actual data before running
DELETE FROM wine_samples ws
WHERE EXISTS (
  SELECT 1 FROM wine_samples ws2
  WHERE ws2.sample_id = ws.sample_id
    AND ws2.sample_date = ws.sample_date
    AND ws2.uploaded_at > ws.uploaded_at
);
```

This is a **manual post-deploy step**, not automated.

---

## Verification Checklist

1. `node --test tests/mt6-*.test.mjs tests/mt7-*.test.mjs` — all pass
2. `npm test` — all 47 existing tests still pass (49+ total)
3. Manual: upload WineXRay CSV, shuffle rows, re-upload → preview shows "0 new / N updated"
4. Manual: upload file with `sample_id = '25'` → row skipped, count reflects reduction
5. Manual: POST to `/api/upload` with extra field `{evil_col: 'x'}` → field stripped silently
6. `npm start` → dashboard loads, charts render, upload works end-to-end

---

## Prior Completed Work

<details>
<summary>Phases 1–7 and Waves 1–7 (all complete)</summary>

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Deploy Online (Vercel) | Done |
| 2 | Database Migration (Supabase) | Done |
| 3 | Meteorology Integration | Done |
| 4 | Authentication (bcrypt + HMAC, 2h tokens) | Done |
| 4b | Data & Visualization Overhaul | Done |
| 4c | Stability, Security & Viz Improvements | Done |
| 5 | Vineyard Quality Map (SVG) | Done |
| 6 | Polish (login, PDF, mobile, trends, radar, harvest calendar) | Done |
| — | Security Hardening (server upload, rate limits, token blacklist) | Done |
| — | Review Rounds 1–10 (all findings triaged) | Done |
| — | Waves 1–7 (all review findings resolved) | Done |
| 7 | Mediciones Tecnicas (form, table, charts) | Done |
| — | Remove always-on lot-line plugin from scatter charts | Done |

</details>
