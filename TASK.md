# Task — Current State

## Project Status: Phases 1–7 Complete

All planned work through Phase 7 is committed on `main`. Security hardening done. REVIEW.md Rounds 1–10 complete. **Waves 1–7 all implemented and merged.** Phase 7 (Mediciones Tecnicas) implemented 2026-04-08.

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

---

## All Items Resolved

### Round 10 — Resolved in Waves 6–7

#### Priority 1

| ID | Issue | File | Status |
|----|-------|------|--------|
| P1.1 | Harvest calendar ignores valley selector | `js/charts.js` | **Done** |
| P1.2 | `clearAll()` doesn't reset `weatherLocation` or valley UI | `js/filters.js` | **Done** |
| P1.3 | `logout.js` blacklists any token without HMAC verification | `api/logout.js` | **Done** |
| P1.4 | `RESUMEN_2026-04-06.txt` not in `.gitignore` | root | **Done** |

#### Priority 2

| ID | Issue | File | Status |
|----|-------|------|--------|
| P2.1 | Jitter logic duplicated in two chart locations | `js/charts.js` | **Done** |
| P2.2 | Rate limit runs before auth on `api/config.js` | `api/config.js` | **Done** |
| P2.3 | In-memory rate limiter never evicts below 500 buckets | `api/lib/rateLimit.js` | **Done** |
| P2.4 | Valley change handler re-renders even when sync finds nothing | `js/events.js` | **Done** |
| P2.5 | `valleyVintage` fallback uses weather vintage, not berry vintage | `js/app.js` | **Done** |
| P2.6 | `.vercelignore` missing `RESUMEN*.txt` pattern | `.vercelignore` | **Done** |

### Tests — Written & Passing (47/47)

| ID | Scope | Tests | Status |
|----|-------|-------|--------|
| MT.1 | `sample_seq` assignment in `upload.js` | 7 | **Pass** |
| MT.2 | Deterministic jitter function in `charts.js` | 8 | **Pass** (found jitter asymmetry bug) |
| MT.3 | `verifyToken()` shared module | 13 | **Pass** |
| MT.4 | `rateLimit()` | 9 | **Pass** |
| MT.5 | Valley selector flow | 10 | **Pass** |

Run: `npm test` or `node --test tests/*.test.mjs`

**Bug found & fixed by MT.2:** `_applyDaysJitter` jitter asymmetry (JS negative modulo) — fixed with `(((hash % 41) + 41) % 41 - 20) * 0.01`.

### Resolved in Waves 3–5 (2026-04-06)

| ID | Issue | Resolution |
|----|-------|------------|
| 16.5 | No GDD chart | Wave 3: cumulative GDD chart + multi-valley temp comparison |
| 16.6 | No weather location filter | Wave 3: valley selector (VDG/VON/SV) + dynamic header |
| 16.3 | Same-day measurements overwritten | Wave 4a: `sample_seq` column + SQL migration |
| 17.1 | Blacklist missing from `api/config.js` | Wave 4d: blacklist check added via shared `verifyToken` |
| 14.1 | Extraction table ignores filters | Wave 4c: uses `Filters.getFiltered()` + `getFilteredWine()` |
| 18.1 | Duplicate login form listener | Wave 4f: removed from `Events._bindAuth()`, `_formBound` guard |
| 14.3 | Token verification triplicated | Wave 5a: `api/lib/verifyToken.js` shared module |
| 14.8 | No rate limiting on upload/verify/logout/config | Wave 5c: `api/lib/rateLimit.js` on all endpoints |
| 14.9 | User-provided conflict column in upload API | Wave 5b: server-side `tableConfig.conflict` only |
| 14.5 | ~70 lines dead CSS | Wave 5d: removed `.brand-top/name/divider/sub`, `.extraction-grid/*` |
| 16.4 | Cross-lot same-day jitter | Wave 4b: deterministic hash offset ±0.2 day |
| 17.3 | Docs deploy to Vercel | Wave 4e: `.vercelignore` updated |

### Resolved in Waves 1–2 (prior PRs)

| ID | Issue | Resolution |
|----|-------|------------|
| 14.12 | CSP blocks inline handlers | Wave 1: 71 static + 11 dynamic handlers → events.js |
| 17.7 | api/upload.js SyntaxError | Removed duplicate `const supabaseUrl` |
| 16.1 | PDF/PNG export broken | Wave 1f: error toasts, jsPDF guard, Image onerror |
| 16.2 | Same-lot points not connected | Wave 2a: lot-line plugin + last-point fix |
| 16.7 | Legends invisible in exports | Wave 2b: native Chart.js legends |
| 16.8 | Varietal colors too similar | Wave 2c: 10 colors redistributed |
| 14.7 | Origin charts missing export buttons | Wave 2d: export buttons added |
| 15.1 | CSP connect-src blocks weather API | Wave 1d: archive-api.open-meteo.com added |

---

## Phase 7 — Mediciones Tecnicas ✅ (2026-04-08)

| Item | Description | Status |
|------|-------------|--------|
| SQL | `mediciones_tecnicas` table migration | Done (run in Supabase) |
| API | `mediciones_tecnicas` added to upload allowlist | Done |
| Data | `DataStore.medicionesData` + `_rowToMedicion` + `loadMediciones()` | Done |
| Form | Manual entry form (variety, origin, tonnage, berry, health sort) | Done |
| Table | Sortable table with health mini-bars | Done |
| KPIs | Count, total tons, avg weight, avg % madura | Done |
| Charts | Tonnage by variety, weight timeline, health distribution | Done |
| Routing | Nav tab, view panel, event bindings | Done |

**Scope:** Physical berry field measurements — tonnage received, berry size/weight, 200-berry health sort (madura, inmadura, sobremadura, picadura, enfermedad, quemadura). No photos (deferred).

**Prerequisite:** Run `sql/migration_mediciones.sql` in Supabase SQL editor.
