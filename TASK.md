# Task — Current State

## Phase 8: Deterministic Berry Upload Identity & Pipeline Hardening — COMPLETE

### Root Cause

The original "one lot" bug was caused by `parseFloat` in `_normalizeValue()` — `parseFloat('25TEON-5')` returned `25`, silently destroying all sample IDs starting with digits. Fixed by changing to `Number()` which preserves non-numeric strings.

### What Shipped

1. **Deterministic `sample_seq`** — `Identity.canonicalSeqAssign` sorts by stable fields within each `(sample_id, sample_date)` group before assigning seq. Re-uploading shuffled rows produces identical seq values.
2. **`_detectDuplicates` 3-column key** — Preview now matches real upsert conflict key `(sample_id, sample_date, sample_seq)`.
3. **Server column whitelists** — Per-table `columns` Set in `ALLOWED_TABLES`. Unknown fields stripped before upsert.
4. **Server required-field validation** — Rows missing required fields rejected with Spanish error messages.
5. **`parseFloat` → `Number` fix** — The actual root cause. All 92 unique sample IDs now persist correctly.
6. **`lotCode = sampleId`** — Raw IDs from CSV persist to dashboard. No prefix stripping.
7. **Dead code removed** — `buildCompositeSampleId`, `isWeakSampleId`, `stableRowKey`, `DataStore.extractLotCode`, MT.1 test.
8. **jsPDF CDN fix** — Version 2.5.2 → 2.5.1 (2.5.2 returned 404).
9. **Scatter chart legend** — Shows lot codes when lots are selected, varietals otherwise.

### Post-deploy

- Database truncated and re-uploaded with clean data (done 2026-04-13).

---

## Project Status: Phases 1–8 Complete

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
| 8 | Deterministic Berry Identity & Pipeline Hardening | Done |

---

## Tests — 72/72 Passing (6 suites)

| ID | Scope | Tests | Status |
|----|-------|-------|--------|
| MT.2 | Deterministic jitter function in `charts.js` | 8 | **Pass** |
| MT.3 | `verifyToken()` shared module | 13 | **Pass** |
| MT.4 | `rateLimit()` | 9 | **Pass** |
| MT.5 | Valley selector flow | 10 | **Pass** |
| MT.6 | Canonical seq + extractLotCode | 13 | **Pass** |
| MT.7 | Column whitelist + required fields | 19 | **Pass** |

Run: `npm test` or `node --test tests/*.test.mjs`

### Removed

| ID | Reason |
|----|--------|
| MT.1 | Superseded by MT.6 — tested old row-order seq algorithm |

---

## Open Items (from Round 16 Review)

| ID | Issue | Status |
|----|-------|--------|
| R16.P1.1 | `lotCode = sampleId` breaks `CONFIG.berryToWine` mapping (extraction charts) | **Open** |
| R16.P1.2 | `lotCode = sampleId` breaks vineyard map section resolution | **Open** |
| R16.P2.2 | `Number()` vs `parseFloat` for comma-separated thousands — low risk | **Noted** |
