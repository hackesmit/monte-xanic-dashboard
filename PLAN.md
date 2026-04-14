# Plan — Phase 8: Deterministic Berry Upload Identity & Pipeline Hardening

## Status: COMPLETE (2026-04-13)

**Reference:** `codex-review-consolidated-handoff.md` (original Codex analysis)

---

## Root Cause Discovery

The original diagnosis assumed berry `sample_id = '25'` was a data-quality issue. The actual root cause was `parseFloat` in `_normalizeValue()`:

```js
// Bug: parseFloat('25TEON-5') → 25 (parses leading digits, discards rest)
const n = parseFloat(str);
// Fix: Number('25TEON-5') → NaN → falls back to string
const n = Number(str);
```

This single-line fix (`d8d1486`) resolved the "one lot" bug. The composite ID approach from earlier iterations was treating a symptom.

---

## What Was Implemented

### Deterministic `sample_seq` (Phase 1)

`Identity.canonicalSeqAssign` sorts rows within each `(sample_id, sample_date)` group by `(sample_type, vessel_id, brix, ph, ta, berry_weight, tant, JSON tiebreaker)` before assigning seq. Re-uploading shuffled rows produces identical seq values.

### Shared Identity Module (Phase 2)

`js/identity.js` — global `Identity` object with:
- `canonicalSeqAssign(rows)` — deterministic seq assignment
- `extractLotCode(sampleId)` — vintage prefix + suffix stripping

### Backend Hardening (Phase 3)

`api/upload.js` — per-table column whitelists and required-field validation for all 5 tables (`wine_samples`, `tank_receptions`, `reception_lots`, `prefermentativos`, `mediciones_tecnicas`).

### `_detectDuplicates` Fix (Phase 1c)

Refactored from 2 positional params to array-based `keyCols`. Wine samples now use 3-column key `['sample_id', 'sample_date', 'sample_seq']` matching the real upsert conflict key.

### Tests (Phase 4)

- `tests/mt6-canonical-seq.test.mjs` — 13 tests (deterministic seq + extractLotCode)
- `tests/mt7-column-whitelist.test.mjs` — 19 tests (column stripping, required validation, config integrity)

---

## Post-Phase 8 Fixes

| Commit | Fix |
|--------|-----|
| `d8d1486` | `parseFloat` → `Number` — the actual root cause |
| `adcb89e` | Dead code removal (buildCompositeSampleId, isWeakSampleId, stableRowKey, MT.1) |
| `8db2d18` | jsPDF CDN 404 — version 2.5.2 → 2.5.1 |
| `62d8010` | Scatter chart legend shows lot codes when lots selected |

---

## Files Modified

| File | Change |
|------|--------|
| `js/identity.js` | **NEW** — shared identity module (2 methods) |
| `js/upload.js` | Deterministic seq, `Number()` fix, removed dead `conflictCol` param |
| `js/dataLoader.js` | `lotCode = sampleId` (raw IDs), removed dead `extractLotCode` wrapper |
| `api/upload.js` | Column whitelists + required-field validation for all 5 tables |
| `index.html` | `<script src="js/identity.js">`, jsPDF CDN version fix |
| `js/charts.js` | Scatter legend shows lot codes when lots are filtered |
| `tests/mt6-canonical-seq.test.mjs` | **NEW** — 13 tests |
| `tests/mt7-column-whitelist.test.mjs` | **NEW** — 19 tests |

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
