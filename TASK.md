# Task — Wave 3 + Wave 4 Implementation

## Branch: `feature/wave3-wave4-fixes`

## Goal
Implement the remaining high-priority bug fixes and missing features from REVIEW.md Rounds 7–9. This branch covers **Wave 3** (weather improvements) and **Wave 4** (data integrity + quick fixes).

## Constraints
- Vanilla JS only — no npm packages, no frameworks, CDN libs only
- Spanish labels throughout
- Mobile responsive
- No breaking changes to existing Supabase schema (additive migration only)
- Must preserve existing chart/filter/upload behavior
- Do not touch Wave 5 items (security hardening, dead CSS) — separate branch

## Already Done on This Branch (uncommitted)
| Task | Files | Status |
|------|-------|--------|
| 4e — `.vercelignore` docs exclusion | `.vercelignore` | Done |
| 4f — Duplicate login listener fix | `js/auth.js`, `js/events.js` | Done |

## Remaining Work

### Wave 3 — Weather: GDD Chart + Location Filter (5 tasks)
| Task | REVIEW ID | Description |
|------|-----------|-------------|
| 3a | 16.5, 16.6 | Add valley selector UI + GDD chart canvas to `index.html` |
| 3b | 16.6 | Add `weatherLocation` to `Filters.state` + change handler |
| 3c | 16.5 | Create `createGDDChart()` — cumulative GDD line chart |
| 3d | 16.6 | Pass location param to all weather chart functions |
| 3e | 16.6 | Dynamic weather section header text |

### Wave 4 — Data Integrity + Quick Fixes (4 remaining tasks)
| Task | REVIEW ID | Description |
|------|-----------|-------------|
| 4a | 16.3 | `sample_seq` column — SQL migration + upload + chart offset |
| 4b | 16.4 | Cross-lot same-day jitter (±0.2 day hash offset) |
| 4c | 14.1 | Extraction table respects active filters |
| 4d | 17.1 | Add blacklist check to `api/config.js` |

## Files Likely Involved
| File | Wave 3 | Wave 4 |
|------|--------|--------|
| `index.html` | 3a | — |
| `js/filters.js` | 3b | — |
| `js/charts.js` | 3c, 3d | 4a, 4b |
| `js/app.js` | 3d, 3e | 4c |
| `js/weather.js` | 3c (read only) | — |
| `js/events.js` | 3a (bind selector) | — |
| `js/upload.js` | — | 4a |
| `api/upload.js` | — | 4a |
| `api/config.js` | — | 4d |
| `sql/migration_sample_seq.sql` | — | 4a (new) |

## Acceptance Criteria
1. Valley selector (VDG/VON/SV) in weather section — switching updates all weather charts + header text
2. GDD cumulative chart renders in vintage view with accumulation curve from Jul 1
3. Same-day duplicate uploads preserved (not overwritten) via `sample_seq`
4. Cross-lot overlapping points visually separated with deterministic jitter
5. Extraction table respects vintage/variety/origin filters
6. Revoked tokens rejected by `/api/config` (blacklist check)
7. All existing charts/filters/upload continue to work unchanged
8. Mobile responsive
