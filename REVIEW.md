# Code Review — Monte Xanic Dashboard

> All findings from Rounds 1–10 have been resolved. Waves 1–7 merged to main. Phase 7 implemented 2026-04-08.
> See TASK.md for the complete resolution table.
> Read `CLAUDE.md` first for full project context.

---

## Phase 9 Stage 1 — Explorer Enhancements Shipped (2026-04-15)

**Scope:** 14 commits on `main` (`5f933e2`..`f506fe9`). 5 source files + 1 HTML + 1 CSS modified.

### Features Delivered

| Feature | Description |
|---------|-------------|
| F1 | Per-slot "Conectar Lineas" toggle — updates chart in-place preserving hidden series |
| F2 | Per-chart ⤓ export with PNG/PDF menu + legend |
| F3 | "Exportar Vista" on 6 dashboard views — PNG vertical stack / multi-page PDF, legend per chart, aspect-ratio preserved |
| F4 | Expand/compact toggle (280px ↔ 500px), clickable legend bar below each chart |
| F4b | Searchable lot picker (type-to-filter, checkboxes, Todo/Limpiar) |

### Bug Fixes During Implementation

| Commit | Fix |
|--------|-----|
| `d36b3b2` | Localhost auth bypass when `/api/verify` unreachable (hostname check) |
| `63b37b0` | Line toggle preserves hidden dataset state (in-place update vs re-render) |
| `3c91e89` | Legend export: use `background-color` + PDF aspect ratio preservation |
| `77faed6` | Read legend from Chart.js instance instead of fragile DOM scraping |
| `f506fe9` | Add legend + aspect ratio to page export paths (`exportPage`/`exportPagePDF`) |

### Tests

72/72 passing throughout. No regressions. No new test files (UI-only changes).

---

## Round 13 — Design Spec Review: Explorer Enhancements (2026-04-15)

**Document:** `docs/superpowers/specs/2026-04-15-explorer-enhancements-design.md`
**Scope:** F1 (line connections), F2 (per-chart export), F3 (page export), F4 (chart resize + legend)
**Review type:** Pre-implementation design review — verified all assumptions against current codebase.

---

### Priority 1 — Issues (must fix before building)

**P1.1 — F2: Export menu positioning will break in explorer slots**
`Charts.showExportMenu()` (`charts.js:1647`) positions the dropdown via `btn.closest('.chart-card')`. Explorer slots use `.explorer-slot`, not `.chart-card`. The fallback branch (`charts.js:1654`) does `btn.appendChild(menu)`, which appends the popup *inside the button element* — broken layout.
**Fix:** Either (a) update `showExportMenu` to also check `.closest('.explorer-slot')`, or (b) add `position: relative` to `.explorer-slot` and adjust the selector. This must be addressed in the design before implementation.

**P1.2 — F3: `#view-weather` does not exist**
The design's page export table (line 71) lists `Meteorologia | #view-weather`. This container ID does not exist in `index.html`. Weather charts (lines 600–650) live *inside* `#view-berry`, not in a separate view panel. The nav tabs do not include a standalone weather view.
**Fix:** Either (a) remove "Meteorologia" from the page export table and include weather charts in the berry page export, or (b) note that weather charts should be captured as part of the `#view-berry` export. The design's 6-view table needs to become 5 views, with berry export covering weather charts too.

**P1.3 — F1: Line toggle conflicts with existing `chartType === 'line'` path**
`explorer.js:102` currently passes `{ showLine: slot.chartType === 'line' }`. The design says to pass `{ showLine: slot.showLines }` from the new toggle. But what happens when `chartType` is `'line'`? The existing line chart type should *always* show lines regardless of the toggle. The design doesn't address this interaction.
**Fix:** The opts should be `{ showLine: slot.showLines || slot.chartType === 'line' }`. The toggle button should be hidden or disabled when `chartType === 'line'` (already showing lines) or `chartType === 'bar'` (lines don't apply). The design says bar charts ignore the toggle but doesn't mention the line chart type case.

**P1.4 — F4: Explorer legend clicks cannot use `Charts.toggleSeries()`**
The design says legend items toggle dataset visibility "consistent with berry page legend behavior." But `Charts.toggleSeries()` (`charts.js:933`) is global — it adds to `Charts.hiddenSeries` and calls `App.refresh()`, which rebuilds *all* charts. In the explorer context, toggling "Cabernet Sauvignon" in slot 1 would also hide it in slot 2, the berry charts, and everywhere else. Explorer legends need per-chart toggling using `chart.getDatasetMeta(index).hidden` directly.
**Fix:** Specify that explorer legend clicks use `Chart.js`'s native per-instance `getDatasetMeta(idx).hidden = !hidden` + `chart.update()`, NOT `Charts.toggleSeries()`. The event delegation in `events.js` needs to route `.explorer-legend .legend-item` clicks to a new per-chart toggle path, not the global one.

---

### Priority 2 — Improvements (non-blocking, address during implementation)

**P2.1 — F3: View header structure is inconsistent across views**
The design says "each dashboard view header gets an Exportar Vista button" but doesn't specify where in each view's DOM structure to place it. Current headers vary:
- Berry/Wine: `mobile-filter-summary` + `section-label`
- Explorer: `section-label` only
- Map: `map-header` (flex row with tabs + select)
- Mediciones: `section-label` only
**Suggestion:** Define a consistent anchor point. Recommend appending the button to the first `.section-label` or creating a uniform `.view-header` wrapper if one doesn't exist.

**P2.2 — F1: Mobile icon for "Conectar Lineas" unspecified**
The design says buttons "use icon-only mode" on mobile <=768px with "just a line icon" but doesn't specify which character or SVG. Needs a concrete icon choice (e.g., `⟋` U+27CB, or a simple SVG path).
**Suggestion:** Use `〰` (U+3030 wavy dash) or a small inline SVG line icon. Specify in the design to avoid guesswork during implementation.

**P2.3 — F3: Map SVG export needs more specificity**
The design correctly identifies SVG-to-canvas conversion as risky and proposes KPI-only fallback. But it doesn't specify: (a) which SVG element to serialize (`#map-svg-container` contains the SVG), (b) how to handle the color scale legend (`#map-color-scale`), (c) whether the section detail panel (`#section-detail-panel`) is included.
**Suggestion:** Clarify the exact elements to capture for map export, and whether the fallback (KPI-only) should be the initial implementation with SVG as a follow-up.

**P2.4 — F4: Expanded height may need to be configurable per chart type**
Design specifies 500px for expanded mode. Bar charts with many groups may need more height, while scatter plots with few points may not benefit. Consider making this a CSS variable or slot-specific.
**Suggestion:** Use a CSS custom property (`--explorer-expanded-h: 500px`) so it's easy to tune later.

---

### Missing Tests

The design's constraints section correctly states "existing 72/72 tests must not break." Additionally:

- **F1 (line toggle):** No unit tests needed — purely visual toggle of a Chart.js rendering option.
- **F2 (per-chart export):** Export functions already exist untested. Adding test for `showExportMenu` positioning logic would be valuable but may require DOM mocking.
- **F3 (page export):** `exportPage` is a new method in `charts.js`. Consider testing the canvas-collection logic (querying correct selectors per view) even if actual image generation can't be tested in Node.
- **F4 (legend population):** The legend HTML generation from chart datasets could be unit-tested. Consider a test that verifies legend items match dataset labels/colors.

---

### Notes

- **Design quality is high overall.** File boundaries are respected, implementation paths are specific, and the "no new files" constraint is correct.
- **`createExplorerChart` API is already compatible** with F1 — confirmed `opts.showLine` is accepted and wired through at `charts.js:1812,1827-1828`.
- **`responsive: true` + `maintainAspectRatio: false`** confirmed set on explorer charts (`charts.js:1838-1839`), validating F4's resize approach.
- **Chart export delegation** at `events.js:155-166` uses `document.addEventListener('click')` so it *will* capture dynamically injected `.chart-export-btn` buttons — the design's assumption on F2 event delegation is correct.
- **The brainstorm artifact** at `.superpowers/brainstorm/28701-1776274359/content/explorer-slot-layout.html` suggests an earlier layout exploration was done. Good process.
- **Recommended build order:** F1 (simplest, self-contained) → F4 resize (CSS only) → F4 legend → F2 (depends on export menu fix) → F3 (most complex, depends on F2 patterns).

---

## Round 12 — 2 unpushed commits + workspace hygiene (2026-04-15)

**Scope:** 2 unpushed commits on `main` (`e4da5c1`, `27b7f94`) — 2 files changed, +22/−3 lines. Plus 5 untracked items in working tree.
**Commits reviewed:**
1. `e4da5c1` — `ci: add GitHub Actions workflow to run tests on PRs` (+19 lines, new `.github/workflows/ci.yml`)
2. `27b7f94` — `fix: restore lotCode vintage-prefix stripping — extraction charts and map broken` (+3/−3 in `js/dataLoader.js`)

---

### Priority 1 — Issues

**P1.1 — CI workflow missing `npm ci` step (`.github/workflows/ci.yml`)**
The workflow runs `npm test` but never installs dependencies. The project declares `bcryptjs` and `@playwright/test` in `package.json`. On a fresh GitHub Actions runner, `node_modules/` won't exist. Currently the 72 tests use only Node built-in `node:test` and `node:assert`, so this works *by accident*. The moment any test imports a real dependency (e.g., `bcryptjs` for auth tests), CI will break silently.
**Action:** Add `- run: npm ci` before `- run: npm test` in `ci.yml`.

**P1.2 — `codex-review-consolidated-handoff.md` contains security-sensitive analysis (carried from R11)**
348-line file documents the upload endpoint's trust model, service-key behavior, RLS concerns, rate-limiting weaknesses, and token revocation gaps. If committed to a public repo, this is an attacker roadmap. Not in `.gitignore`.
**Action:** Delete or add to `.gitignore`. Do not commit.

**P1.3 — `.playwright-mcp/` directory should be gitignored (carried from R11)**
Contains ephemeral Playwright MCP artifacts: `.log`, `.yml`, and a 107 KB `.png` screenshot. Risk of accidental commit via `git add -A`.
**Action:** Add `.playwright-mcp/` to `.gitignore`.

---

### Priority 2 — Improvements

**P2.1 — CI workflow has no dependency caching**
`ci.yml` uses `actions/setup-node@v4` but does not set `cache: 'npm'`. Once `npm ci` is added (per P1.1), every run will do a full install. Adding `cache: 'npm'` is a one-line fix that speeds up CI.
**Action:** Add `cache: 'npm'` to the `setup-node` step.

**P2.2 — `dataLoader.js` lotCode fix is correct but regression-prone**
Commit `27b7f94` correctly restores `Identity.extractLotCode(obj.sampleId)` at three call sites (`dataLoader.js:63`, `:238`, `:504`), fixing the regression where raw `sampleId` (with vintage prefix) broke downstream chart/map grouping. The change is minimal and correct. However, this is the second time this regression has occurred — a brief inline comment explaining *why* `lotCode` must differ from `sampleId` would prevent repeat.
**Action:** Optional — add a one-line comment at `dataLoader.js:63`.

**P2.3 — Stale workspace files (carried from R11)**
- `DIAGNOSIS.md` (90 lines) — describes the berry `sample_id = '25'` collapse, already fixed in Phase 8. Stale.
- `ultraplan-prompt.txt` (27 lines) — agent prompt template, no runtime value.
- `Logotipo_corporativo_MX_amarillo-01 (1).png` (64 KB) — duplicate-download filename in project root.
**Action:** Delete stale files or add to `.gitignore`. Move logo to `assets/` if used, else delete.

**P2.4 — Branch is ahead of `origin/main` by 2 commits**
Per CLAUDE.md: "Always push changes to remote after fixing bugs or completing features." Both commits appear ready.
**Action:** Run `git push`.

---

### Missing Tests

- **CI workflow not locally testable.** No way to validate `ci.yml` locally — inherent to GitHub Actions. Consider a dry-run push to a feature branch to verify the workflow triggers and passes.
- **No new test gaps from `27b7f94`.** `Identity.extractLotCode` already has 7 test cases in `tests/mt6-canonical-seq.test.mjs:159-178` covering prefix stripping, suffix stripping, null/empty, and edge cases. The `dataLoader.js` change re-wires call sites to use the tested function — no new logic introduced.

---

### Notes

- **All 72 tests pass** (verified `npm test` during this review).
- Round 11 review (prior agent session) covered workspace hygiene only. This Round 12 supersedes it by also covering the 2 unpushed code commits.
- The `Identity.extractLotCode` regex (`/^\d{2}/`) strips exactly 2 leading digits. Correct for current vintage codes (24, 25) but would break on 3-digit or 1-digit prefixes. Acceptable for now — awareness item.
- `ci.yml` does not include `workflow_dispatch` — no manual trigger available. Consider adding if ad-hoc CI runs are needed.

---

## Round 10 — Branch `feature/wave3-wave4-fixes` (2026-04-07)

**Scope:** 4 commits (04cb435..54b63fc) — 20 files changed, +498 / −538 lines.
**Areas:** API refactor (shared verifyToken/rateLimit), weather multi-valley charts, GDD chart, sample_seq duplicate handling, extraction filter fix, login double-submit fix, radar chart removal, CSS cleanup.

---

### Priority 1 — Issues

**P1.1 — Harvest calendar weather overlay ignores valley selector**
`js/charts.js:1409` — `createHarvestCalendar` calls `WeatherStore.getRange()` without passing a `location` parameter, so it always uses `'VDG'` regardless of the valley selector (`Filters.state.weatherLocation`). Unlike the other weather charts which were updated to accept a `location` parameter, this one was missed.

**P1.2 — `clearAll()` does not reset `weatherLocation` or valley selector UI**
`js/filters.js:205-221` — `clearAll()` resets vintages, varieties, origins, lots, grapeType, and colorBy but never resets `state.weatherLocation` back to `'VDG'`. Nor does it reset the `#weather-valley-select` dropdown or the `#weather-section-title` text. After "Limpiar Todo", the valley selector shows VON/SV while state may drift from the displayed default.

**P1.3 — `logout.js` accepts any token for blacklisting without verifying identity**
`api/logout.js:14-16` — The endpoint accepts any arbitrary string in `req.body.token`, hashes it, and writes it to `token_blacklist`. An attacker could spray forged token hashes into the blacklist table. The rate limiter (60/15min) reduces but doesn't eliminate this. Consider verifying the token's HMAC signature before blacklisting.

**P1.4 — Untracked files should not be committed**
`RESUMEN_2026-04-06.txt` and `PROJECT_SUMMARY.md` are untracked and not in `.gitignore`. The RESUMEN file contains internal task details and planned next steps. `PROJECT_SUMMARY.md` (576 lines) is a full architecture overview including auth flow, API endpoints, and table schemas. If accidentally committed, both would be publicly accessible. Add `RESUMEN*.txt` and `PROJECT_SUMMARY.md` to `.gitignore` and `.vercelignore`.

---

### Priority 2 — Improvements

**P2.1 — Jitter logic duplicated in two places**
`js/charts.js:198-208` (scatter chart) and `js/charts.js:567-577` (vintage comparison) contain identical jitter code (sampleSeq offset + hash-based lot jitter). Extract to a shared helper like `_applyDaysJitter(x, d)` to avoid divergence.

**P2.2 — Rate limit applied before auth on all authenticated endpoints**
`api/config.js:12`, `api/upload.js:20`, `api/verify.js:12`, `api/logout.js:12` — All four endpoints run `rateLimit(req, res)` before `verifyToken()`. Unauthenticated garbage requests consume the IP's rate-limit bucket, potentially locking out legitimate users sharing the same IP (corporate NAT). Consider swapping the order: verify auth first, then rate-limit authenticated users. `api/config.js` is the most impactful since it's called on every page load.

**P2.3 — In-memory rate limiter never evicts unless bucket count exceeds 500**
`api/lib/rateLimit.js:19` — Stale entries are only swept when `buckets.size > 500`. Under normal traffic patterns this threshold is never reached. Since Vercel serverless functions have short lifetimes this is low-risk, but a periodic sweep (e.g., every 100 inserts) or a TTL-based Map would be cleaner.

**P2.4 — Weather sync re-renders charts even when no new data fetched**
`js/events.js:46-49` — When the selected valley has no cached data, `WeatherStore.sync(vintages).then(renderWeather)` fires. The sync guard (`_isSyncing`) prevents double-fetch, but `.then(renderWeather)` re-renders a second time even if sync found no new rows. Only triggers when switching to an un-cached valley, not on every dropdown change. Consider re-rendering only if sync actually fetched new rows (e.g., return a `changed` boolean from sync).

**P2.5 — `valleyVintage` fallback picks last known weather vintage, not last berry vintage**
`js/app.js:335` — When no vintage filters are active, `valleyVintage` falls back to `WeatherStore.getVintagesFromData().slice(-1)[0]`. This may differ from the berry data's latest vintage. Using `DataStore.berryData` to derive the latest vintage would be more intuitive.

**P2.6 — `.vercelignore` missing `RESUMEN*.txt` and `PROJECT_SUMMARY.md` patterns**
`.vercelignore:6` — Has `REPORTE_DASHBOARD.txt` but neither `RESUMEN*.txt` nor `PROJECT_SUMMARY.md`. Both would slip through to production if committed.

---

### Missing Tests

- **MT.1** — No test for `sample_seq` assignment in `upload.js`. Verify that multiple rows with the same `(sample_id, sample_date)` get incrementing `sample_seq` values (1, 2, 3...).
- **MT.2** — No test for the jitter function in `charts.js`. The hash-based jitter should be deterministic (same lot always produces same offset).
- **MT.3** — No test for `verifyToken()` shared module. Critical auth code — unit tests should cover: valid token, expired token, invalid signature, missing token, blacklisted token, fetch failure (fail-open behavior).
- **MT.4** — No test for `rateLimit()`. Should verify that requests within the window pass, and requests exceeding `maxRequests` get 429.
- **MT.5** — No test for the valley selector flow. Switching valleys should update `Filters.state.weatherLocation`, re-render charts, and sync if needed.

---

### Notes

- **Radar chart removal** (`charts.js`, `index.html`) — cleanly done, no orphaned references remain. CSS classes `brand-top`, `brand-name`, `brand-divider`, `brand-sub`, `extraction-grid`, `extraction-card`, `ext-bar*` were all unused in HTML/JS. Clean removal.
- **Token verification refactor** (`api/lib/verifyToken.js`, `api/lib/rateLimit.js`) — good DRY improvement. Three endpoints now share the same code path. The fail-open behavior on blacklist check failure is an intentional availability choice, documented in the code.
- **Migration script** (`sql/migration_sample_seq.sql`) — correct: adds column with default, drops old constraint, creates new composite unique. Note: the `DROP CONSTRAINT IF EXISTS` uses a guessed constraint name (`wine_samples_sample_id_sample_date_key`) — verify the actual constraint name in Supabase before running.
- **Login double-submit fix** (`js/auth.js`) — `_formBound` guard prevents duplicate event listeners. The `click` listener on `#login-btn` was redundant with the `submit` listener on `#login-form`, so removing it is correct.
- **Extraction table filter fix** (`js/app.js:582-593`) — now uses `Filters.getFiltered()` / `Filters.getFilteredWine()` instead of unfiltered `DataStore` arrays. Correct behavioral fix.
- **GDD chart** (`js/charts.js:1255-1351`) — correctly uses base-10 C, accumulates from Jul 1, caps at today for current year. No off-by-one issues.
- **Diff size** is reasonable (498+ / 538-) for the scope of changes. No unrelated file edits detected.

---

### Review of Uncommitted Documentation Changes (Round 10.1)

**Scope:** 3 modified files (PLAN.md, REVIEW.md, TASK.md), 2 untracked files (PROJECT_SUMMARY.md, RESUMEN_2026-04-06.txt). Documentation only — no source code changes.

**PLAN.md** — Rewritten from "all complete" status to a staged plan with Wave 6 (P1 fixes) and Wave 7 (P2 improvements), plus Stage 2 for Phase 7. Historical completed work collapsed into `<details>`. Structure is sound and tasks map correctly to REVIEW.md findings. Line references are accurate.

**REVIEW.md** — Replaced ~930 lines of historical rounds (1–18) with a compact 73-line Round 10 summary. All P1 and P2 findings verified against source code:
- P1.1: Confirmed — `charts.js:1409` has no location param.
- P1.2: Confirmed — `filters.js:205-221` never resets `weatherLocation`.
- P1.3: Confirmed — `logout.js:14-16` does no HMAC verification before blacklisting.
- P1.4: Confirmed — `RESUMEN_2026-04-06.txt` not in `.gitignore`. However, `PROJECT_SUMMARY.md` (also untracked, 576 lines, contains architecture details) was not mentioned — added as finding.
- P2.1: Confirmed — identical jitter code at lines 198-208 and 567-577.
- P2.2: Confirmed — `config.js:12` runs rateLimit before verifyToken on line 15. However, the same pattern exists in ALL four authenticated endpoints, not just `config.js` — expanded finding.
- P2.3: Confirmed — `rateLimit.js:19` checks `buckets.size > 500`.
- P2.4: Partially correct — the original wording "may fire on every dropdown toggle" is misleading. The sync+re-render only fires when `!hasData` for the selected valley (line 46-48), not on every toggle. Corrected wording.
- P2.5: Confirmed — `app.js:335` uses `WeatherStore.getVintagesFromData()`.
- P2.6: Confirmed — `.vercelignore` has no RESUMEN pattern.

**TASK.md** — Updated to "Round 10 Fixes Pending" with open items table matching REVIEW.md. Historical items collapsed into `<details>`. Cross-references are consistent.

**Untracked files:**
- `PROJECT_SUMMARY.md` (576 lines) — full architecture overview with auth flow, API endpoints, rate limit thresholds, table schemas. No credentials. Low risk but should be in `.gitignore` + `.vercelignore`.
- `RESUMEN_2026-04-06.txt` (26 lines) — Spanish work summary. No credentials. Already flagged in P1.4.

**No issues found in the documentation changes themselves.** The consolidation from ~930 lines to ~73 lines is clean — no information loss for actionable items. All historical context is preserved in git history (prior commits).

---

## Round 11 — Branch `main` (2026-04-13)

**Scope:** Commit `94234b5` — 1 file changed (`js/charts.js`), +1 / −40 lines.
**Change:** Intentional removal of `_lotLinePlugin` per user request. Plugin drew always-on thin lines connecting same-lot points, duplicating the existing button-toggled `showLine` feature.

---

### Priority 1 — Issues

None. The plugin removal was user-requested and committed with a clear message. Orphaned comment also cleaned up.

---

### Priority 2 — Improvements

**P2.1 — Untracked logo file with copy-number suffix in project root**
- **File:** `Logotipo_corporativo_MX_amarillo-01 (1).png`
- Filename contains a copy-number suffix `(1)`, sits in project root instead of `assets/`. Should be renamed and moved, or deleted.

---

### Missing Tests

N/A — removed code, no new behavior to test. Existing 47/47 tests unaffected.

---

### Notes

- The `_lotLinePlugin` was added in Wave 2 (`a6d7ba8`) but became redundant with the button-toggled `showLine` on datasets. Removal is clean — no orphaned references remain.
- Prior Round 10 findings (P1.1–P1.4, P2.1–P2.6, MT.1–MT.5) all resolved. Status tracked in TASK.md.

---

## Round 12 — Uncommitted Doc Changes on `main` (2026-04-13)

**Scope:** 3 modified files (PLAN.md, REVIEW.md, TASK.md), 0 source code changes. +25 / −23 lines.
**Purpose:** Update tracking docs to reflect the committed lot-line plugin removal (`94234b5`).

---

### Priority 1 — Issues

None.

---

### Priority 2 — Improvements

**P2.1 — PLAN.md Wave 2 summary still references "Lot-line plugin" as a delivered feature**
- **File:** `PLAN.md:19`
- Wave 2 bullet reads "Lot-line plugin connecting same-lot points". Since the plugin was subsequently removed in "Post-Phase 7 — Scatter Chart Cleanup", the Wave 2 entry is historically accurate but could confuse a reader who doesn't scroll to the bottom. Consider appending "(later removed — see Post-Phase 7)" to the bullet for clarity.

**P2.2 — Untracked logo file still present in project root**
- **File:** `Logotipo_corporativo_MX_amarillo-01 (1).png`
- Carried forward from Round 11. Copy-number suffix `(1)` and placement in root (not `assets/`). Not in `.gitignore`. Should be moved, renamed, added to `.gitignore`, or deleted.

**P2.3 — TASK.md Round 10 resolution claims should be spot-checked periodically**
- **File:** `TASK.md:40-54`
- All 10 items (P1.1–P1.4, P2.1–P2.6) are marked **Done**. Spot-check verified:
  - P1.2 (`clearAll` resets `weatherLocation`): confirmed at `filters.js:217`.
  - P1.4 (`RESUMEN*.txt` in `.gitignore`): confirmed at `.gitignore:53`.
  - Tests: 47/47 passing. No regressions.
- No discrepancies found. Claims are accurate.

---

### Missing Tests

N/A — documentation-only changes.

---

### Notes

- **Diff is clean and minimal.** All three files update only tracking metadata — no source code, no config, no schema changes.
- **No risky patterns detected.** No dependency changes, no env/secret edits, no CI/CD modifications, no destructive commands.
- **Cross-file consistency verified:**
  - PLAN.md, TASK.md, and REVIEW.md all reference the same commit (`94234b5`) and date (2026-04-13) for the lot-line removal.
  - TASK.md phase table row ("Remove always-on lot-line plugin") matches the PLAN.md "Post-Phase 7" section.
  - REVIEW.md Round 11 scope statement matches the actual commit diff.
- **Test suite:** 47/47 passing (5 suites, 109ms). No failures, no skips.

---

## Round 13 — Branch `feature/phase8-deterministic-identity` Phase 1 (2026-04-13)

**Scope:** 4 files changed (+380 / −190 lines). 1 source file (`js/upload.js`, +50 / −16 net), 3 documentation files (PLAN.md, TASK.md, REVIEW.md).
**Branch:** `feature/phase8-deterministic-identity` (no commits yet — all changes are uncommitted).
**Plan phases covered:** Phase 1 only (1a: deterministic seq, 1b: weak ID guard, 1c: fix `_detectDuplicates`). Phases 2–4 not started.

---

### Priority 1 — Issues

**P1.1 — Weak ID guard silently drops ALL berry data instead of fixing identity**
- **File:** `js/upload.js:83-84`
- The guard `if (/^\d+$/.test(obj.sample_id) || obj.sample_id.length < 3) continue;` skips rows where `sample_id` is purely numeric or under 3 characters. As confirmed in our diagnosis, ALL berry samples from WineXRay have `sample_id = '25'` — this means **100% of berry data will be silently discarded on upload**.
- The original problem was "one point per lot." This fix changes it to "zero points per lot." The user still can't upload berry data.
- **Root cause not addressed:** The real issue is that berry rows need a composite `sample_id` constructed from available fields (variety, appellation, vintage) to create meaningful identity. DIAGNOSIS.md Option A described this approach, but the builder chose to skip/filter instead of fix.
- **Impact:** Critical. Berry upload is now completely broken — worse than before.

**P1.2 — MT.1 test suite tests the OLD `sample_seq` algorithm, not the new one**
- **File:** `tests/mt1-sample-seq.test.mjs:13-21`
- MT.1 still uses the old `seqCounters` row-order logic (line 13-21), not the new deterministic sort logic from `js/upload.js:100-117`. The test passes because it tests a copy of the OLD code, not the actual implementation.
- The test provides zero coverage of the new deterministic seq behavior. If the sort comparator has a bug, MT.1 won't catch it.
- **Impact:** False confidence. Tests say "47/47 pass" but the core change is untested.

**P1.3 — Deterministic sort tiebreaker is insufficient — rows with identical `(sample_type, vessel_id, brix, ph, ta)` get arbitrary order**
- **File:** `js/upload.js:109-114`
- If two rows within the same `(sample_id, sample_date)` group have identical values across all 5 sort fields, their relative order is undefined (JS `Array.sort` is not guaranteed stable across all engines). This means `sample_seq` assignment is still non-deterministic for these rows.
- In practice, this can happen when the same sample is measured twice with the same instrument yielding identical `brix`, `ph`, `ta` readings. The sort needs a final tiebreaker — e.g., `berry_weight`, `tant`, or a string hash of all row values.
- **Impact:** Medium. The common case (different measurements) is handled, but identical-value edge cases remain non-deterministic.

---

### Priority 2 — Improvements

**P2.1 — `_detectDuplicates` now includes `sample_seq` in the key, creating a query explosion risk**
- **File:** `js/upload.js:208-226`, call site `js/upload.js:318`
- The refactored `_detectDuplicates` queries Supabase with `.in(primaryCol, keys)` then builds a composite key set locally. For `wine_samples`, `primaryCol` is `sample_id`. This fetches ALL rows matching any `sample_id` in the upload batch — potentially thousands of rows for a large re-upload.
- The old 2-column approach had the same query pattern but matched fewer rows. Adding `sample_seq` to the local key is correct, but the `.select(keyCols.join(','))` should be verified to not break Supabase's column selection syntax (it expects comma-separated column names, which it is — this is fine).
- **Low risk** but worth noting for large datasets.

**P2.2 — `upsertRows` still accepts a `conflictCol` parameter that is never used**
- **File:** `js/upload.js:232`
- `async upsertRows(table, rows, conflictCol)` still has the `conflictCol` parameter, but the function body never references it — the server determines the conflict columns from `ALLOWED_TABLES`. The parameter is dead code.
- Call sites still pass it: `js/upload.js:308` passes `'sample_id,sample_date'`, `js/upload.js:339` passes `'report_code'`, etc.
- **Impact:** Cosmetic / dead code. Not a bug, but misleading.

**P2.3 — PLAN.md is now 240 lines and mixes approved plan with historical record**
- **File:** `PLAN.md`
- The plan grew from 91 to 240 lines. It includes full code snippets (Phase 1a shows before/after), SQL remediation queries, and a collapsed history section. The code snippets duplicate what's already in the diff.
- Consider keeping PLAN.md focused on the plan (what/why/order) and leaving code in the source files.

**P2.4 — TASK.md deleted all historical resolution details**
- **File:** `TASK.md`
- Rounds 1–10 resolution tables (Waves 1–7 details, Phase 7 items, bug fix details) were all removed. While this information exists in git history, losing it from TASK.md makes it harder to trace why decisions were made.
- The Phase 7 section (SQL, API, Data, Form, Table, KPIs, Charts, Routing) was entirely removed.

**P2.5 — Four untracked files in project root**
- `DIAGNOSIS.md` — diagnostic notes from this session, useful context but should be in `docs/` or `.gitignore`
- `codex-review-consolidated-handoff.md` (14KB) — Codex analysis referenced by PLAN.md
- `ultraplan-prompt.txt` (1.6KB) — prompt template
- `Logotipo_corporativo_MX_amarillo-01 (1).png` — carried forward from prior rounds
- None should be committed to the repo root. Add to `.gitignore` or move to `docs/`.

---

### Missing Tests

- **MT.6 (planned, not written)** — TASK.md lists "Canonical seq + weak ID guard" tests as pending. These are critical because P1.2 shows the existing MT.1 doesn't test the new code. This is the highest-priority gap.
- **MT.7 (planned, not written)** — Column whitelist tests for Phase 3. Phase 3 code hasn't been written yet, so this is expected.
- **No test for the weak-ID filter** — There is no test that verifies `sample_id = '25'` is correctly handled (whether by filtering, transforming, or constructing a composite ID). Given P1.1, a test would have caught that berry data is being dropped entirely.

---

### Notes

- **Only Phase 1 of 4 was attempted.** PLAN.md defines Phases 1–4 (identity module, backend hardening, tests). Only Phase 1 changes appear in the source diff. Phases 2 (identity.js), 3 (api/upload.js whitelist), and 4 (new test files) are not started.
- **Branch has no commits.** All work is uncommitted. This is fine for a review checkpoint but means nothing is saved to git yet.
- **The deterministic seq approach (Phase 1a) is sound in principle.** Sorting by stable fields before assigning seq is the right idea. The implementation needs the tiebreaker fix (P1.3) and the weak-ID guard needs to be replaced with composite ID construction (P1.1).
- **Test suite:** 47/47 existing tests pass. No regressions in existing behavior. But the new code is untested (P1.2).
- **The `_detectDuplicates` refactor (Phase 1c) is correct.** Moving from 2-column to 3-column composite matching aligns the preview with the actual upsert key. The API is cleaner (array of key columns instead of positional args).
- **Documentation changes are substantial but premature.** PLAN.md and TASK.md were rewritten for the full Phase 8 scope, but only Phase 1 code exists. The docs describe work that hasn't happened yet as if it's the current state.

---

## Round 14 — Branch `feature/phase8-deterministic-identity` Phases 1–3 (2026-04-13)

**Scope:** 7 modified files + 1 new file (`js/identity.js`). +528 / −207 lines total.
**Source changes:** `js/identity.js` (new, 51 lines), `js/upload.js` (+40/−16), `js/dataLoader.js` (+1/−7), `api/upload.js` (+83/−6), `index.html` (+1).
**Plan phases covered:** Phase 1 (deterministic seq, weak ID guard, dedup fix), Phase 2 (Identity module, wiring), Phase 3 (backend column whitelist + required-field validation). Phase 4 (tests) not started.

---

### Priority 1 — Issues

**P1.1 — CARRIED FROM R13: Weak ID guard still drops ALL berry data**
- **File:** `js/upload.js:83-84`, `js/identity.js:41-44`
- The logic was refactored into `Identity.isWeakSampleId()` but the behavior is identical: `sample_id = '25'` is purely numeric and < 3 chars → `true` → `continue` → row skipped.
- **All berry samples are still silently discarded on upload.** The original bug was "one point per lot"; this changes it to "zero points." The root cause (berries need a composite `sample_id` built from variety + appellation + vintage) remains unaddressed.
- **This is the #1 blocking issue.** No other work matters if berry upload is broken.

**P1.2 — CARRIED FROM R13: MT.1 tests the OLD `sample_seq` algorithm**
- **File:** `tests/mt1-sample-seq.test.mjs:13-21`
- Still contains the old `seqCounters` row-order logic. The new deterministic sort in `Identity.canonicalSeqAssign` has zero test coverage. "47/47 pass" provides false confidence.

**P1.3 — CARRIED FROM R13: Sort tiebreaker insufficient for identical rows**
- **File:** `js/identity.js:16-22`
- No additional tiebreaker fields added since Round 13. Rows with identical `(sample_type, vessel_id, brix, ph, ta)` still get non-deterministic ordering. Need a final tiebreaker (e.g., `berry_weight`, `tant`, or serialized hash of all values).

---

### Priority 2 — Improvements

**P2.1 — Backend required-field check rejects entire batch on first bad row**
- **File:** `api/upload.js:107-114`
- The loop checks all rows sequentially and returns 400 on the first row missing a required field. A single malformed row in a 200-row batch means zero rows are inserted.
- This is arguably correct (atomic validation), but the error message only reports which row failed — the user has no way to know if other rows are also bad without fixing and re-uploading repeatedly.
- **Low priority** — consider collecting all errors and returning them at once, or at minimum reporting the count of bad rows.

**P2.2 — `reception_lots` required fields may block legitimate inserts**
- **File:** `api/upload.js:39` — `required: ['reception_id','lot_code']`
- At `js/upload.js:176`, lot rows are initially built with `report_code` (not `reception_id`). The `reception_id` is mapped later at line 366 after fetching IDs. If the mapping fails for any row (e.g., `codeToId[l.report_code]` is undefined), the `.filter(l => codeToId[l.report_code])` at line 365 drops it before sending to the server. So the required-field check won't trigger on this path.
- However, if someone sends a direct POST to `/api/upload` with `reception_lots` rows missing `reception_id`, the validation correctly rejects. This is fine — the validation is defensive.

**P2.3 — `upsertRows` dead `conflictCol` parameter (carried from R13)**
- **File:** `js/upload.js:232`
- Still accepts `conflictCol` that is never used. Call sites still pass stale values. Dead code.

**P2.4 — Column whitelist accuracy verified — all 5 tables match**
- Cross-checked every `ALLOWED_TABLES[table].columns` set against `CONFIG.wxToSupabase`, `CONFIG.recepcionToSupabase`, `CONFIG.prefermentToSupabase`, and `_rowToMedicion` field mappings. All columns in the client-side mappings are present in the server whitelist, plus parser-added fields (`below_detection`, `sample_seq`, `vintage_year`). No column will be silently stripped during normal uploads. ✅

**P2.5 — Untracked files now 5 (was 4)**
- Added: `js/identity.js` (new source file — this SHOULD be tracked)
- Remaining untracked: `DIAGNOSIS.md`, `codex-review-consolidated-handoff.md`, `ultraplan-prompt.txt`, `Logotipo_corporativo_MX_amarillo-01 (1).png`
- `js/identity.js` must be committed. The others should go in `.gitignore` or be cleaned up.

---

### Missing Tests

- **MT.6 (planned, not written)** — Canonical seq + weak ID tests. This is critical — the core Phase 1 logic (`Identity.canonicalSeqAssign`, `Identity.isWeakSampleId`, `Identity.extractLotCode`) has zero test coverage.
- **MT.7 (planned, not written)** — Column whitelist + required-field validation tests. Phase 3 code is implemented but untested.
- **MT.1 needs rewrite** — Must test `Identity.canonicalSeqAssign` instead of the deleted `seqCounters` logic.

---

### Notes

- **Phase 2 (Identity module) is well-structured.** `js/identity.js` is clean, follows project convention (global object, no ES modules), and correctly centralizes logic. The `DataStore.extractLotCode` → `Identity.extractLotCode` delegation preserves backward compatibility.
- **Phase 3 (backend hardening) is solid.** Column whitelists are accurate across all 5 tables. Required-field validation uses Spanish error messages. Unknown columns are stripped silently (correct — don't leak schema info). The validation runs after auth + rate limit (correct order).
- **Script tag ordering is correct.** `identity.js` is placed after `config.js` and before `dataLoader.js` in `index.html`, satisfying both dependency chains (`dataLoader.js` calls `Identity.extractLotCode`, `upload.js` calls `Identity.canonicalSeqAssign`).
- **No regressions.** 47/47 existing tests pass. No changes to charts, filters, events, or other modules.
- **3 of 3 Round 13 P1 issues are unresolved.** The builder implemented Phases 2–3 (new work) but did not address the P1 feedback from Round 13. P1.1 (berry data dropped) is the critical blocker.
- **Still no commits on this branch.** All work remains uncommitted.

---

## Round 15 — Branch `feature/phase8-deterministic-identity` All Phases (2026-04-13)

**Scope:** 7 modified files + 3 new files (`js/identity.js`, `tests/mt6-canonical-seq.test.mjs`, `tests/mt7-column-whitelist.test.mjs`). +607 / −212 lines total.
**Source changes:** `js/identity.js` (new, 66 lines), `js/upload.js` (+52/−16), `js/dataLoader.js` (+1/−7), `api/upload.js` (+83/−6), `index.html` (+1).
**Test changes:** `tests/mt6-canonical-seq.test.mjs` (new, 279 lines, 22 tests), `tests/mt7-column-whitelist.test.mjs` (new, 238 lines, 19 tests).
**All 4 plan phases implemented.** Tests: **92/92 pass** (47 existing + 45 new).

---

### Priority 1 — Issues

None. **All 3 P1 issues from Rounds 13–14 are resolved:**

- **P1.1 (berry data dropped) → FIXED.** `js/upload.js:93-97` now calls `Identity.buildCompositeSampleId(obj)` for weak IDs before skipping. Berry row with `sample_id='25'`, `variety='Cabernet Sauvignon'`, `appellation='VDG-Rancho1'` → composite `'25-CabernetSauvignon-VDG-Rancho1'`. Only rows that remain weak after construction (no variety or appellation available) are skipped. Normalization runs before composite construction (lines 83-84), ensuring deterministic IDs.
- **P1.2 (MT.1 tests old algorithm) → RESOLVED.** New MT.6 test suite (22 tests) covers `Identity.canonicalSeqAssign` with determinism, tiebreaking, null handling, and group independence. MT.1 is now legacy (tests the old row-order approach) but doesn't test wrong behavior — just superseded.
- **P1.3 (sort tiebreaker insufficient) → FIXED.** `identity.js:22-24` adds `berry_weight`, `tant`, and `JSON.stringify(a).localeCompare(JSON.stringify(b))` as final tiebreaker. The JSON serialization ensures even fully-identical-measurement rows get deterministic ordering.

---

### Priority 2 — Improvements

**P2.1 — `extractLotCode` on composite IDs produces leading-dash lot codes**
- **File:** `js/identity.js:32-39`, confirmed by test at `mt6:236-237`
- `Identity.extractLotCode('25-CabernetSauvignon-VDG')` → `'-CabernetSauvignon-VDG'` (leading dash).
- The `^\d{2}` regex strips `'25'`, leaving `'-CabernetSauvignon-VDG'`. This is functionally unique and won't cause bugs, but charts labeling lots will display lot codes starting with `-`.
- Consider adjusting `extractLotCode` to also strip a leading dash/hyphen after vintage prefix removal: `code = code.replace(/^\d{2}-?/, '')`.

**P2.2 — `JSON.stringify` tiebreaker depends on property insertion order**
- **File:** `js/identity.js:24`
- In V8 (Node.js, Chrome), string-keyed properties serialize in insertion order. Since all rows from the same CSV are constructed via the same `headers.forEach` loop, property order is consistent. However, if rows were ever constructed differently (e.g., manual form entry vs CSV), the JSON tiebreaker could produce different orderings.
- **Very low risk** for current usage. If this becomes a concern, a sorted-keys serializer would make it fully deterministic.

**P2.3 — MT.1 is now redundant with MT.6**
- **File:** `tests/mt1-sample-seq.test.mjs`
- MT.1 tests the old `seqCounters` row-order algorithm that no longer exists in source code. MT.6 fully covers the replacement logic. MT.1 could be removed or updated to import from `Identity.canonicalSeqAssign` instead.
- **No urgency** — it doesn't test wrong behavior, just dead code.

**P2.4 — Tests duplicate source code inline (established pattern, but maintenance risk)**
- **Files:** `tests/mt6-canonical-seq.test.mjs:11-60`, `tests/mt7-column-whitelist.test.mjs:9-87`
- Both test files copy the implementation code inline. If `identity.js` or `api/upload.js` changes, tests must be manually synced. This is the same pattern used by MT.1–MT.5 (browser globals can't be imported in Node), so it's consistent with project conventions. Just noting the maintenance trade-off.

**P2.5 — Backend required-field validation (carried from R14) — batch rejection on first bad row**
- **File:** `api/upload.js:107-114`
- Still rejects entire batch on first bad row. Low priority, documented in R14.

**P2.6 — `upsertRows` dead parameter fixed** ✅
- **File:** `js/upload.js:220`
- Changed from `async upsertRows(table, rows, conflictCol)` to `async upsertRows(table, rows)`. All 5 call sites updated. R13/R14 P2.3 resolved.

**P2.7 — Untracked files: 7 total**
- **Must track:** `js/identity.js`, `tests/mt6-canonical-seq.test.mjs`, `tests/mt7-column-whitelist.test.mjs`
- **Should gitignore or delete:** `DIAGNOSIS.md`, `codex-review-consolidated-handoff.md`, `ultraplan-prompt.txt`, `Logotipo_corporativo_MX_amarillo-01 (1).png`

---

### Missing Tests

No critical gaps remain. Minor notes:

- MT.6 doesn't test the full `parseWineXRay` flow end-to-end (normalization → weak ID check → composite construction → seq assignment). A single integration-style test that feeds a raw row array through the complete pipeline would catch ordering bugs between normalization and composite ID construction.
- No test verifies that `buildCompositeSampleId` output is stable across `normalizeVariety`/`normalizeAppellation` variations (e.g., `'Petite Sirah'` → `'Durif'` normalization happens before composite construction, so the ID uses `'Durif'` not `'PetiteSirah'`).

---

### Notes

- **All 4 plan phases are implemented.** Phase 1 (deterministic seq + weak ID + dedup fix), Phase 2 (Identity module + wiring), Phase 3 (backend column whitelist + required-field validation), Phase 4 (MT.6 + MT.7 tests). The implementation matches the plan in PLAN.md.
- **92/92 tests pass.** 47 existing (0 failures, 0 regressions) + 45 new (22 in MT.6, 19 in MT.7, 4 table config integrity checks). All pass in under 153ms.
- **MT.7 includes table configuration integrity tests** that verify required fields are in the whitelist and conflict columns are in the whitelist. This catches future schema drift automatically — well done.
- **No commits yet on this branch.** All work remains uncommitted. Ready for commit + PR once P2 items are triaged.
- **Column whitelists verified correct** across all 5 tables (cross-checked in R14, still valid).
- **The composite ID approach resolves the original bug.** Berry rows with `sample_id='25'` + variety + appellation → meaningful composite IDs → correct upsert identity → multiple data points per lot preserved across uploads.
- **Branch is clean.** No changes to charts, filters, events, weather, mediciones, auth, or any module outside the upload pipeline.

---

## Round 16 — Branch `main` — Phase 8 Merged + 4 Follow-Up Fixes (2026-04-13)

**Scope:** 5 commits merged to `main` (`7cfaed0..d8d1486`). 10 files changed, +1265 / −217 lines total.
**Commits:**
1. `7cfaed0` — feat: Phase 8 — deterministic berry upload identity & pipeline hardening
2. `8073a97` — fix: derive composite lot codes for weak sample_ids at data load time
3. `021d195` — fix: stop modifying sample_id in DB — derive lot codes at display time only
4. `51c1589` — fix: use raw sample_id as lot code — no transformation
5. `d8d1486` — fix: parseFloat destroying sample IDs — '25TEON-5' became 25

**Key discovery in commit 5:** The *actual* root cause of the "all berries have sample_id = 25" bug was `parseFloat` in `_normalizeValue()`. `parseFloat('25TEON-5')` → `25` (parses leading digits, discards the rest). This destroyed all sample IDs starting with digits. The fix: `parseFloat` → `Number`, which returns `NaN` for non-numeric strings and falls back to the original string.

---

### Priority 1 — Issues

**P1.1 — `lotCode = sampleId` breaks `CONFIG.berryToWine` mapping — extraction charts silently lose wine data**
- **Files:** `js/dataLoader.js:63,238,508`, `js/charts.js:633,1984,1998`, `js/explorer.js:151`, `js/app.js:592`
- With the old code, `lotCode = extractLotCode('25CALMX-1E')` → `'CALMX-1E'` (vintage prefix stripped). `CONFIG.berryToWine` maps these stripped codes to wine lots:
  ```js
  berryToWine: { 'CALMX-1E': ['25CAVDG-1'], 'KCA-S3B': ['25CAKMP-1','25CAKMP-2'], ... }
  ```
- Now, `lotCode = sampleId = '25CALMX-1E'` (vintage prefix included). `CONFIG.berryToWine['25CALMX-1E']` → `undefined`.
- **Impact:** Extraction comparison charts (`_buildExtractionPairs`), the extraction table in `app.js`, and the ANT extractability calculation in `explorer.js` all silently return empty results. No error is thrown — the data just doesn't appear.

**P1.2 — `lotCode = sampleId` breaks vineyard map section resolution — map parcels have no data**
- **Files:** `js/maps.js:57-58,15-30`, `js/app.js:354-355`
- `MapStore.resolveSection('25CALMX-1E')` fails all 3 resolution strategies:
  1. Direct lookup: `CONFIG.fieldLotToSection['25CALMX-1E']` → `undefined` (keys are `'CALMX-1E'`)
  2. Suffix strip: no match after stripping
  3. Pattern regex: all patterns anchor on `^[A-Z]` (e.g., `/^[A-Z]{2,4}MX-(.+)$/i`). `'25CALMX-1E'` starts with digits → no match.
- **Impact:** Vineyard quality map shows no colored parcels and no lot data in tooltips.

**P1.3 — `Identity.buildCompositeSampleId`, `Identity.isWeakSampleId`, `Identity.stableRowKey` are now dead code**
- **File:** `js/identity.js:45-65`
- After the 4 follow-up commits, no source file calls these 3 functions. Only `Identity.canonicalSeqAssign` (from `upload.js`) and `Identity.extractLotCode` (from `dataLoader.js`) are used.
- `buildCompositeSampleId` was the R15 fix for weak IDs, but the R15 approach (composite ID construction) was replaced by the `parseFloat` → `Number` fix. The functions remain in source and are tested by MT.6, but they're dead code.
- **Impact:** Medium. Not a bug, but 20 lines of dead code and ~15 tests covering unused functions. Creates false impression that these functions are load-bearing.

---

### Priority 2 — Improvements

**P2.1 — `DataStore.extractLotCode` is dead code**
- **File:** `js/dataLoader.js:278-280`
- The method delegates to `Identity.extractLotCode(sampleId)`, but no code calls `DataStore.extractLotCode` anymore. All 3 former call sites were changed to `obj.sampleId || ''`.
- **Impact:** Dead code. Can be removed.

**P2.2 — `parseFloat` → `Number` changes behavior for comma-separated thousands**
- **File:** `js/upload.js:32`
- `parseFloat('1,200')` → `1` (silently truncates at comma). `Number('1,200')` → `NaN` → falls back to string `'1,200'`.
- For WineXRay CSVs (US-format, period decimals), this is correct behavior — `Number` is more strict. But if any CSV uses comma-separated thousands (e.g., `'1,200'` meaning twelve hundred), the value will be stored as a string instead of a number.
- **Low risk** — WineXRay uses standard numeric formats.

**P2.3 — 4 rapid-fire fix commits suggest incomplete testing before merge**
- Commits `8073a97`, `021d195`, `51c1589`, `d8d1486` were all quick follow-up fixes. The trail suggests the Phase 8 commit (`7cfaed0`) was merged before the `parseFloat` root cause was found. Each fix discovered a new issue in the previous fix.
- The final state is correct, but the commit history is messy. Consider squashing for cleanliness if this matters to the team.

**P2.4 — Untracked files (5 items)**
- `.playwright-mcp/` — new directory, likely from Playwright MCP setup. Should be in `.gitignore`.
- `DIAGNOSIS.md` — diagnostic notes from this session.
- `codex-review-consolidated-handoff.md` — Codex analysis.
- `ultraplan-prompt.txt` — prompt template.
- `Logotipo_corporativo_MX_amarillo-01 (1).png` — carried forward since Round 11.

---

### Missing Tests

- **No test for the `parseFloat` → `Number` fix.** The critical fix in `d8d1486` — the actual root cause — has no dedicated test. A test like "normalizeValue preserves string sample IDs starting with digits" (`_normalizeValue('25TEON-5')` should return `'25TEON-5'`, not `25`) would prevent regression.
- **MT.6 tests dead code.** `buildCompositeSampleId`, `isWeakSampleId`, and `stableRowKey` tests are testing functions no longer called from any source file. Consider removing these tests or the dead functions.
- **No test for berryToWine or fieldLotToSection lookup compatibility.** A test that verifies lotCode format matches the key format in `CONFIG.berryToWine` and `CONFIG.fieldLotToSection` would have caught P1.1/P1.2.

---

### Notes

- **The `parseFloat` → `Number` fix (`d8d1486`) was the real root cause.** `parseFloat('25TEON-5')` → `25` silently destroyed all sample IDs starting with digits. This single line change fixes the original "one point per lot" bug. The entire composite ID approach from R13-R15 was treating a symptom.
- **92/92 tests pass.** No regressions. But the test suite doesn't cover the lotCode format change or the `_normalizeValue` fix.
- **The Phase 8 feature work is sound.** Deterministic seq, backend column whitelists, required-field validation, and the `_detectDuplicates` 3-column fix are all correct and well-tested.
- **P1.1 and P1.2 are the blocking issues.** The fix is straightforward: `lotCode` should use `Identity.extractLotCode(sampleId)` (or equivalent vintage-prefix stripping) instead of raw `sampleId`. This is how it worked before Phase 8, and the downstream mappings (`berryToWine`, `fieldLotToSection`, `fieldLotRanchPatterns`) all expect stripped codes.
- **Recommended fix:** In `_rowToBerry`, `parseWineSheet`, and `_enrichData`, change `lotCode = obj.sampleId || ''` back to `lotCode = Identity.extractLotCode(obj.sampleId)`. This restores the vintage-stripped lot codes that all downstream code expects, while keeping the `sampleId` field (used for DB identity) unchanged.

---

## Round 17 — Branch `main` — Dead Code Cleanup + Fixes (2026-04-13)

**Scope:** 3 commits (`adcb89e`, `8db2d18`, `62d8010`). 4 files changed, 1 file deleted.
**Commits:**
1. `adcb89e` — chore: remove dead code (buildCompositeSampleId, isWeakSampleId, stableRowKey, DataStore.extractLotCode, MT.1)
2. `8db2d18` — fix: jsPDF CDN 404 — version 2.5.2 → 2.5.1
3. `62d8010` — fix: scatter chart legend shows lot codes when lots selected

---

### Round 16 Items Resolved

| ID | Issue | Resolution |
|----|-------|------------|
| R16.P1.3 | Dead code: `buildCompositeSampleId`, `isWeakSampleId`, `stableRowKey` | **Removed** (`adcb89e`) — functions + 13 dead tests deleted from identity.js and MT.6 |
| R16.P2.1 | Dead code: `DataStore.extractLotCode` wrapper | **Removed** (`adcb89e`) |
| R16.P2.4 | Untracked `.playwright-mcp/` directory | Should be in `.gitignore` — **still open** |

### Round 16 Items Resolved (Post-Round 17)

| ID | Issue | Status |
|----|-------|--------|
| R16.P1.1 | `lotCode = sampleId` breaks `CONFIG.berryToWine` mapping | **Fixed** (`27b7f94`) — restored `Identity.extractLotCode()` for lotCode derivation |
| R16.P1.2 | `lotCode = sampleId` breaks vineyard map section resolution | **Fixed** (`27b7f94`) — same commit, stripped codes now match `fieldLotToSection` keys |

---

### New Fixes

**jsPDF CDN 404** — `index.html` referenced `jspdf/2.5.2` which does not exist on cdnjs. Changed to `2.5.1`. PDF export now works.

**Scatter chart legend** — When specific lots are selected via filter chips, scatter chart datasets now group by `sampleId` instead of variety/origin. Legend labels show lot codes (e.g., `25CSMX-1`) so exported charts identify exactly which grapes are referenced. When no lots are selected, default variety/origin grouping is used.

---

### Tests

72/72 passing (6 suites). Down from 92 after removing 7 MT.1 tests and 13 dead-code MT.6 tests.
