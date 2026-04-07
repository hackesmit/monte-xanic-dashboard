# Task — Current State

## Project Status: Phases 1–6 Complete — All Waves Merged

All planned work through Phase 6 is committed on `main`. Security hardening done. REVIEW.md Rounds 1–9 complete. **Waves 1–5 all implemented and merged.**

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
| — | Wave 1 — CSP Migration | Done |
| — | Wave 2 — Lot Lines + Legends + Colors | Done |
| — | Wave 3 — Weather GDD + Valley Filter | Done |
| — | Wave 4 — Data Integrity + Quick Fixes | Done |
| — | Wave 5 — Security Hardening + Cleanup | Done |

---

## All Items Resolved

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

## Next Major Feature: Phase 7 — Mediciones Técnicas

> **Status:** Architecture designed, NOT yet implemented.
> **Full schema:** Reserved in CLAUDE.md Database Schema section.
> **Scope:** ~110 mediciones, ~1,100 photos in Cloudflare R2, metadata in Supabase.
