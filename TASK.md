# Task — Current Objective

## Phase 8: Deterministic Berry Upload Identity & Pipeline Hardening

### Goal

Make berry upload identity deterministic and idempotent. Harden the upload pipeline against weak IDs, schema drift, and unvalidated payloads.

### Problem Statement

Berry upload identity is **non-deterministic**: `sample_seq` (part of the upsert conflict key `(sample_id, sample_date, sample_seq)`) is assigned by CSV row order. Re-uploading the same file with rows reordered produces different `sample_seq` values, causing data duplication or silent value swaps.

Secondary issues:
- Weak `sample_id` values (e.g., bare `'25'`) collapse lot derivation (empty `lotCode`)
- `_detectDuplicates()` checks only 2 columns but real conflict key is 3 columns — preview counts lie
- Server accepts any fields the client sends with no column validation
- Normalization logic duplicated between `upload.js` and `dataLoader.js`

### Constraints

- Vanilla JS only, no npm packages (CDN only)
- All UI labels in Spanish
- Don't break existing 47 passing tests
- No schema migration — same `(sample_id, sample_date, sample_seq)` constraint
- `sample_seq` becomes deterministic metadata, not positional identity
- Respect existing file responsibilities (see CLAUDE.md)

### Files Involved

| File | Role | Change Type |
|------|------|-------------|
| `js/identity.js` | Shared identity module | **NEW** |
| `js/upload.js` | Deterministic seq, weak ID guard, fixed dedup | Modify |
| `js/dataLoader.js` | Delegate `extractLotCode` to Identity | Modify |
| `api/upload.js` | Column whitelist, required-field validation | Modify |
| `index.html` | Add `<script>` for identity.js | Modify |
| `tests/mt6-canonical-seq.test.mjs` | Deterministic seq + weak ID tests | **NEW** |
| `tests/mt7-column-whitelist.test.mjs` | Server validation tests | **NEW** |

### Acceptance Criteria

1. Same rows in any order → identical `sample_seq` values (deterministic)
2. Re-upload of shuffled CSV shows "0 new / N updated" not "N new / 0 updated"
3. Rows with weak `sample_id` (numeric-only, < 3 chars) are skipped
4. `_detectDuplicates` matches real 3-column conflict key
5. `Identity.extractLotCode` used by both upload and dataLoader
6. Server strips unknown columns before upsert
7. Server rejects rows missing required fields (Spanish error messages)
8. All new tests pass (`mt6`, `mt7`)
9. All 47 existing tests still pass
10. Dashboard loads, charts render, upload flow works end-to-end

### Reference

- Full analysis: `codex-review-consolidated-handoff.md`
- Approved plan: `PLAN.md`

---

## Project Status: Phases 1–7 Complete

All planned work through Phase 7 is committed on `main`. Security hardening done. REVIEW.md Rounds 1–10 complete. **Waves 1–7 all implemented and merged.** Phase 7 (Mediciones Tecnicas) implemented 2026-04-08. Lot-line plugin removed 2026-04-13.

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
| **8** | **Deterministic Berry Identity & Pipeline Hardening** | **In Progress** |

---

## Tests — Written & Passing (47/47 + 2 new pending)

| ID | Scope | Tests | Status |
|----|-------|-------|--------|
| MT.1 | `sample_seq` assignment in `upload.js` | 7 | **Pass** |
| MT.2 | Deterministic jitter function in `charts.js` | 8 | **Pass** |
| MT.3 | `verifyToken()` shared module | 13 | **Pass** |
| MT.4 | `rateLimit()` | 9 | **Pass** |
| MT.5 | Valley selector flow | 10 | **Pass** |
| MT.6 | Canonical seq + weak ID guard | TBD | **Pending** |
| MT.7 | Column whitelist + required fields | TBD | **Pending** |

Run: `npm test` or `node --test tests/*.test.mjs`
