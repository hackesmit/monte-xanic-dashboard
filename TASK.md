# Task — Current State & Next Steps

## Completed Work

### Workflow 2 — Stability, Security & UX Fixes ✅ DONE
All REVIEW.md findings implemented: XSS fix, rate limit cleanup, role fallback, refresh guard, observer disconnect, weather sync guard, below_detection markers, empty states, try/catch wrappers, API validation, stale lot clearing.

### Workflow 3 — Visualization Improvements ✅ DONE
All 4 items implemented + 2 bug fixes (duplicate nav option, unreachable switch case):
- V1: Origin doughnut → horizontal bar (`createOriginCountBar`)
- V2: Extraction % chart with quality bands (`createExtractionPctChart`)
- V3: Wine phenolics grouped bar (`createWinePhenolicsChart`)
- V4: Sample count (n=) in varietal bar labels

### Phase 5 — Vineyard Quality Map ✅ DONE
SVG polygon map with section detail, metric selector, ranch tabs, KPIs.

---

## Immediate Actions (Builder)

### 1. Commit Workflow 3 changes
Uncommitted files: `index.html`, `js/app.js`, `js/charts.js`
Staged (unrelated): `package.json` (Playwright devDep), `.claude/settings.local.json`

### 2. Cleanup diagnostic artifacts
Delete before committing:
- `test-diag.js` — one-off diagnostic script
- `test-results/` — Playwright screenshot artifacts

### 3. Address REVIEW.md Round 2 findings
Priority 1 (bugs in current uncommitted code):

| ID | Issue | Action |
|----|-------|--------|
| 1a | Duplicated extraction pair-building logic | Extract `_buildExtractionPairs(berryData, wineData)` shared helper; also fixes latent `berry.tANT === 0` → `Infinity%` bug in original `createExtractionChart` |
| 1b | Extraction % values can exceed 100% (clipped by `max: 100`) | Remove `max: 100` from x-axis to let Chart.js auto-scale, OR clamp with `Math.min(pct, 100)` and mark overflow |

Priority 2 (improvements):

| ID | Issue | Action |
|----|-------|--------|
| 2c | Wine phenolics chart: sparse compound data lacks n= context | Add `n=` to tooltip for each compound |
| 2d | Test artifacts not gitignored | Add `test-diag.js` and `test-results/` to `.gitignore` |
| 2e | `stepSize: 1` on origin chart x-axis | Remove — let Chart.js auto-scale for large counts |

---

## Open Security Items (from REVIEW.md — requires architecture decisions)

| ID | Severity | Issue | Blocker |
|----|----------|-------|---------|
| 4.1 | Critical | Upload auth is client-only (anon key) | Needs server-side upload endpoint |
| 4.4 | Medium | Rate limit is ephemeral (in-memory) | Needs Supabase/KV persistent store |
| 4.5 | Medium | No token revocation mechanism | Needs token blacklist or short-lived tokens |

These require design decisions before implementation — not simple code fixes.

---

## Future Phases (not yet started)

### Phase 6 — Polish *(Priority: MEDIUM)*
- [ ] Export charts as PDF
- [ ] Login screen UI polish
- [ ] Mobile filter panel improvements
- [ ] Multi-vintage trend lines (3+ years)
- [ ] Per-origin chemistry comparison
- [ ] Harvest calendar with weather overlays

### Phase 7 — Mediciones Técnicas *(Priority: LOW — deferred)*
- **Prerequisites:** Phase 6 stable, security items resolved
- **Scope:** Cloudflare R2 photo storage, measurement entry form, gallery UI
- **Architecture:** Designed in TASK.md (prior version) + CLAUDE.md schema reserved
- **Scale:** ~110 mediciones, ~1,100 photos (~2-3 GB in R2)

---

## Constraints (apply to all work)
- All user-facing text in Spanish
- No npm packages or build tools — CDN only, Vanilla JS ES6
- Every change must be mobile responsive
- Preserve Chart.js 4.4.1 and SheetJS 0.18.5 compatibility
- Follow CLAUDE.md file responsibility rules strictly
