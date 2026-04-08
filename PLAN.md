# Plan — Stabilization Complete

## Status: ALL WAVES MERGED (1–7) — Phase 7 Next

**Waves 1–7** fully implemented and merged to `main`. Round 10 review findings (P1 + P2) resolved in Waves 6–7.

---

## Completed Work

### Wave 1 — CSP Fix + Export Repair ✅
- `js/events.js` — 237 lines, all event delegation
- 71 static + 11 dynamic inline handlers migrated
- Nav dropdown → tap-friendly button tabs
- CSP `connect-src` updated for `archive-api.open-meteo.com`
- Export fix: jsPDF guard, Image onerror, error toasts

### Wave 2 — Lot Connection + Legends + Colors ✅
- Lot-line plugin connecting same-lot points
- Last-point identification (golden border)
- Native Chart.js legends (visible in exports)
- 10 varietal colors redistributed
- 4 origin chart export buttons

### Wave 3 — Weather: GDD Chart + Location Filter ✅
- Valley selector (VDG / VON / SV) in weather section
- `Filters.state.weatherLocation` with change handler
- GDD cumulative chart (base 10°C, Jul 1 start)
- Multi-valley temperature comparison chart (VDG vs VON vs SV)
- Location param passed to all weather charts
- Dynamic section header text

### Wave 4 — Data Integrity + Quick Fixes ✅
- `sample_seq` column for same-day duplicate handling (SQL migration + upload + chart offset)
- Cross-lot same-day jitter (±0.2 day deterministic hash)
- Extraction table respects active filters
- Blacklist check on `/api/config`
- `.vercelignore` docs exclusion
- Duplicate login listener fix

### Wave 5 — Security Hardening + Cleanup ✅
- `api/lib/verifyToken.js` — shared HMAC + expiry + blacklist verification
- `api/lib/rateLimit.js` — in-memory rate limiting on all authenticated endpoints
- Server-side conflict column (client-provided value ignored)
- ~72 lines dead CSS removed (`.brand-top/name/divider/sub`, `.extraction-grid/*`)
- Perfil Químico por Origen radar chart removed

### Wave 6 — Round 10 P1 Fixes ✅
- Harvest calendar weather overlay respects valley selector
- `clearAll()` resets `weatherLocation` + valley selector UI to VDG
- `logout.js` verifies HMAC signature before blacklisting tokens
- `RESUMEN*.txt` + `PROJECT_SUMMARY.md` added to `.gitignore` + `.vercelignore`

### Wave 7 — Round 10 P2 Improvements ✅
- Shared `_applyDaysJitter()` helper (replaced 2 duplicated jitter blocks)
- Auth-before-rate-limit order on `api/config.js`
- Periodic rate-limit eviction (every 100 inserts instead of 500+ buckets)
- Valley change handler skips re-render when sync finds no new data
- `valleyVintage` fallback uses berry vintage instead of weather vintage

---

## New Files Created

| File | Purpose |
|------|---------|
| `api/lib/verifyToken.js` | Shared token verification (HMAC + expiry + blacklist) |
| `api/lib/rateLimit.js` | In-memory rate limiter for authenticated endpoints |
| `sql/migration_sample_seq.sql` | Adds `sample_seq` column + composite unique constraint |

---

## Next: Phase 7 — Mediciones Técnicas con Evidencia Fotográfica

Architecture designed in CLAUDE.md (reserved schema for `mediciones_tecnicas` + `medicion_fotos`).
- Cloudflare R2 for photos, Supabase for metadata
- Scope: ~110 mediciones, ~1,100 photos (~2-3GB in R2)
