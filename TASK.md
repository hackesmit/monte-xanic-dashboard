# Task — Current State

## Project Status: Phases 1–6 Complete — Round 7+ Stabilization Active

All planned work through Phase 6 is committed on `main`. Security hardening done. REVIEW.md Rounds 1–9 complete. **Waves 1–2 implemented (Wave 2 uncommitted). 11 open items remain across Waves 3–5.**

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
| — | Review Rounds 1–9 (all findings triaged) | Done |
| — | **Wave 1 — CSP Migration** | **Done (committed)** |
| — | **Wave 2 — Lot Lines + Legends + Colors** | **Done (uncommitted)** |
| — | **Waves 3–5 — Weather, Data, Security** | **Not started** |

---

## Immediate Next Action

**Commit + push Wave 2 changes**, then proceed to Wave 3.

Uncommitted files:
- `index.html` — 4 origin export buttons added
- `js/charts.js` — lot-line plugin, last-point fix, native legends, export error toasts
- `js/config.js` — 10 varietal colors redistributed
- `PLAN.md`, `REVIEW.md`, `TASK.md` — doc updates

---

## Open Items — 11 Remaining

### High Priority (blocks production usability)

| # | ID | Issue | Wave | Status |
|---|-----|-------|------|--------|
| 1 | 16.5 | No GDD chart (calculation exists, no visualization) | 3 | Not started |
| 2 | 16.6 | No weather location filter (API ready, no UI selector) | 3 | Not started |
| 3 | 16.3 | Same-day measurements overwritten — `sample_seq` fix | 4 | Not started |
| 4 | 17.1 | Blacklist missing from `api/config.js` (security gap) | 4 | Not started |
| 5 | 14.1 | Extraction table ignores filters | 4 | Not started |

### Medium Priority (functional correctness + security)

| # | ID | Issue | Wave | Status |
|---|-----|-------|------|--------|
| 6 | 18.1 | Duplicate login form listener — 2x `/api/login` requests | 4 | Not started |
| 7 | 14.3 | Token verification triplicated across 3 API files | 5 | Not started |
| 8 | 14.8 | No rate limiting on upload/verify/logout/config | 5 | Not started |
| 9 | 14.9 | User-provided conflict column in upload API | 5 | Not started |

### Low Priority (polish + cleanup)

| # | ID | Issue | Wave | Status |
|---|-----|-------|------|--------|
| 10 | 16.4 | Cross-lot same-day jitter (overlapping points) | 4 | Not started |
| 11 | 14.5 | ~70 lines dead CSS (.brand-*, .extraction-grid) | 5 | Not started |

### Resolved This Branch (8 items)

| ID | Issue | Resolution |
|----|-------|------------|
| 14.12 | CSP blocks inline handlers on Vercel | Wave 1: 71 static + 11 dynamic handlers → events.js |
| 17.7 | api/upload.js SyntaxError | Removed duplicate `const supabaseUrl` |
| 16.1 | PDF/PNG export broken | Wave 1f: error toasts, jsPDF guard, Image onerror |
| 16.2 | Same-lot points not connected | Wave 2a: lot-line plugin + last-point fix |
| 16.7 | Legends invisible in exports | Wave 2b: native Chart.js legends |
| 16.8 | Varietal colors too similar | Wave 2c: 10 colors redistributed |
| 14.7 | 4 origin charts missing export buttons | Wave 2d: export buttons added |
| 15.1 | CSP connect-src blocks weather API | Wave 1d: archive-api.open-meteo.com added |

### Also Resolved in Prior PRs

| ID | Issue | Resolution |
|----|-------|------------|
| 17.3 | Docs deploy to Vercel (.vercelignore) | Queued in Wave 4e |

---

## User Decisions

| Decision | Status |
|----------|--------|
| 16.3 — Same-day duplicates: `sample_seq` column | ✅ Confirmed |
| 16.9 — Data labels in exports | Future feature, not blocking |

---

## Next Major Feature: Phase 7 — Mediciones Técnicas

> **Status:** Architecture designed, NOT yet implemented.
> **Blocked by:** All Waves 3–5 complete + PR merged to main.
> **Full schema:** Reserved in CLAUDE.md Database Schema section.
> **Scope:** ~110 mediciones, ~1,100 photos in Cloudflare R2, metadata in Supabase.

---

## Comprehensive Feature Report
See `REPORTE_DASHBOARD.txt` for a full Spanish-language report of all 27 charts, KPIs, tables, filters, upload pipeline, weather, map, auth, and export features.
