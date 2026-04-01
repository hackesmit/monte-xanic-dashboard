# Task — Current State

## Project Status: Phases 1–6 Complete, Round 7 User-Testing Bugs Active

All planned work through Phase 6 is committed on `main`. Security hardening done. REVIEW.md Rounds 1–4 resolved (PRs #1–#6). Round 5–6 identified remaining issues. **Round 7: first real user testing uncovered 9 bugs/gaps.**

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
| — | Review Rounds 1–4 (all findings resolved) | Done |
| — | **Round 7: User Testing Bug Fixes** | **ACTIVE** |

---

## Immediate: Round 7 User-Testing Fixes

> **Source:** First production data update by winery staff (2026-03-31)
> **Full diagnostics:** REVIEW.md Section 16
> **Plan:** PLAN.md
> **Branch:** `feature/csp-inline-handler-migration`

### High Priority — Blocks daily use

| # | ID | Issue | Files | Status |
|---|-----|-------|-------|--------|
| 1 | 14.12 | CSP blocks inline handlers on Vercel — static HTML | `vercel.json`, `js/events.js`, `index.html`, `js/app.js` | **DONE** (commits 31a7062, 2287b96) |
| 1b | 14.12+ | CSP blocks 11 dynamic inline handlers in JS files | `js/maps.js`, `js/explorer.js`, `js/charts.js` | **NOT STARTED** |
| 2 | 16.1 | PDF/PNG export broken (CSP + jsPDF race + silent failures) | `js/charts.js`, `index.html` | Not started |
| 3 | 16.2 | Same-lot points not connected, golden border on every point | `js/charts.js` | Not started |
| 4 | 16.5 | No GDD chart (calculation exists, no visualization) | `js/weather.js`, `js/charts.js`, `index.html` | Not started |
| 5 | 16.6 | No weather location filter (API ready, no UI selector) | `js/charts.js`, `js/filters.js`, `index.html` | Not started |
| 6 | 16.7 | Legends invisible in PNG/PDF exports | `js/charts.js` | Not started |

### Medium Priority — Data integrity & visual polish

| # | ID | Issue | Files | Status |
|---|-----|-------|-------|--------|
| 7 | 16.3 | Same-day different-hour measurements overwritten on upload | `js/upload.js`, `api/upload.js` | Not started |
| 8 | 16.8 | Varietal colors too similar (reds overlap, whites indistinguishable) | `js/config.js` | Not started |
| 9 | 14.1 | Extraction table ignores filters | `js/app.js` | Not started |
| 10 | 14.2 | Blacklist check missing from `api/config.js` | `api/config.js` | Not started |

### Low Priority — Cleanup & hardening

| # | ID | Issue | Files | Status |
|---|-----|-------|-------|--------|
| 11 | 14.3 | Token verification triplicated (3 copies) | `api/*.js` | Not started |
| 12 | 14.8 | No rate limiting on upload/verify/logout/config | `api/*.js` | Not started |
| 13 | 14.9 | User-provided conflict column in upload API | `api/upload.js` | Not started |
| 14 | 15.2 | Docs deploy to Vercel (missing .vercelignore entries) | `.vercelignore` | Not started |
| 15 | 16.4 | Overlapping points need jitter | `js/charts.js` | Not started |
| 16 | 14.5 | ~70 lines dead CSS | `css/styles.css` | Not started |
| 17 | 14.7 | 4 origin charts missing export buttons | `index.html` | Not started |

---

## User Decisions Needed

1. **16.3 — Duplicate dates:** Should we preserve time (DB migration to timestamp) or add a within-day sequence counter? Option B (sequence) is lower risk.
2. **16.9 — Data labels in exports:** User wants to explore showing data values at each point in exports. Future feature, not blocking.

---

## Next Major Feature: Phase 7 — Mediciones Tecnicas

> **Status:** Architecture designed, NOT yet implemented. Blocked by Round 7 fixes.
> **Full schema:** Reserved in CLAUDE.md Database Schema section.
> **Scope:** ~110 mediciones, ~1,100 photos in Cloudflare R2, metadata in Supabase.

---

## Comprehensive Feature Report
See `REPORTE_DASHBOARD.txt` for a full Spanish-language report of all 27 charts, KPIs, tables, filters, upload pipeline, weather, map, auth, and export features.
