# Code Review — Monte Xanic Dashboard

> All findings from Rounds 1–17 have been resolved. Phase 8 merged to main. Phase 9 Stage 0 (Vite migration) in progress.
> See TASK.md for the complete resolution table.
> Read `CLAUDE.md` first for full project context.

---

## Round 18 — Branch `feat/vite-migration` — Vite Migration WIP (2026-04-16)

**Scope:** 1 commit (`75bfe7a`) on branch `feat/vite-migration`. 27 files changed, +1500 / −129 lines.
**Source changes:** 15 JS files (ES module conversion), `index.html` (CDN removal + single entry point), `vite.config.js` (new), `package.json` (npm deps + scripts + `"type": "module"`), `vercel.json` (buildCommand/outputDirectory/CSP), `public/manifest.json` (moved + icon paths), 2 PWA icons (new), 1 test file (MT.6 imports from source).
**Build:** `vite build` succeeds — 265 modules, 13 output files, exit 0 in 1.43s.
**Tests:** 72/72 passing (9 suites, 158ms). No regressions.
**Status:** Marked WIP — browser smoke test not yet performed.

---

### Priority 1 — Issues

**P1.1 — ~~Inline theme-restore script will be blocked by the tightened CSP~~ RESOLVED**
- **File:** `index.html:11`, `public/theme-init.js` (new)
- **Fix applied:** Option (b) — moved the inline IIFE to `public/theme-init.js`, referenced via `<script src="/theme-init.js"></script>` (non-module, blocking). Vite copies `public/` contents to `dist/` root, so it is served from `'self'`. No CSP changes needed.
- **Verified:** `vite build` succeeds, `dist/theme-init.js` exists, `dist/index.html` references it correctly. 72/72 tests pass.

**P1.2 — Circular dependency chain: app.js ↔ auth.js, filters.js, charts.js, tables.js, events.js, upload.js**
- **Files:** `js/app.js` imports `Auth`, `Filters`, `Charts`, `Tables`, `Events`, `Explorer`, `Mediciones`. Six of those modules import `App` back:
  - `auth.js:3` → `import { App } from './app.js'`
  - `filters.js:4` → `import { App } from './app.js'`
  - `charts.js:8` → `import { App } from './app.js'`
  - `tables.js:3` → `import { App } from './app.js'`
  - `events.js:3` → `import { App } from './app.js'`
  - `upload.js:8` → `import { App } from './app.js'`
- ES modules handle circular imports via live bindings — at module evaluation time, the `App` import in these files will be `undefined` (or an incomplete TDZ reference) until `app.js` finishes evaluating. This is safe **only if** none of these modules access `App` at the top level during module initialization. All current usages of `App` in these files are inside method bodies (called at event time, after all modules have loaded), so this should work.
- **However:** This is fragile. Any future code that accesses `App` at module scope (e.g., a default value, a top-level `App.someMethod()` call, or a computed property initializer) will silently get `undefined` and fail. The PLAN.md already flags this as a known risk.
- **Recommendation:** No immediate fix required, but this should be addressed in a follow-up by extracting shared state into a separate module (e.g., `state.js`) to break the cycle. Add a code comment in `app.js` warning about the circular deps.
- **Impact:** No current bug, but a latent maintenance hazard.

**P1.3 — jsPDF major version jump: 2.5.1 → 4.2.1 — untested in browser**
- **File:** `package.json:18` — `"jspdf": "^4.2.1"`
- The CDN previously served jsPDF 2.5.1. The npm package installs 4.2.1 — a **2 major versions** jump. Node.js API smoke test (`new jsPDF()`, `internal.pageSize.getWidth`) passes, but jsPDF v4's rendering engine, font handling, and `addImage()` behavior may differ from v2.
- The PDF export paths (`charts.js:1827`, `charts.js:2011`) use `addImage(dataURL, 'PNG', ...)`, `setFontSize`, `text()`, `addPage()`, and `internal.pageSize` — all standard API. API compatibility is likely fine, but visual output (fonts, spacing, image quality) could regress.
- **Impact:** Medium. PDF exports may render differently. Needs browser testing with actual chart data.

---

### Priority 2 — Improvements

**P2.1 — `_applyDaysJitter` exported unnecessarily**
- **File:** `js/charts.js:11` — `export function _applyDaysJitter(x, d)`
- This function is only used internally within `charts.js` (lines 179, 549). No other module imports it. The `export` keyword was added during the ES module conversion to match the pattern of exporting everything, but internal helpers prefixed with `_` should remain unexported.
- **Fix:** Remove `export` keyword → `function _applyDaysJitter(x, d)`.
- **Impact:** Cosmetic. Slightly pollutes the module's public API.

**P2.2 — `npm start` now runs `vite preview` instead of a static file server**
- **File:** `package.json:11` — `"start": "vite preview --port 8080"`
- The old `start` script ran `npx serve -l 8080 -s .` (static server). The new `start` runs `vite preview`, which serves the `dist/` build output. This is correct for local preview but changes the behavior: `npm start` now requires `npm run build` first. Previously it served the working directory directly.
- **Impact:** Low. CLAUDE.md says to use `npm run dev` for development, and `npm start` is now a proper preview command. But if any documentation or script depends on `npm start` serving source files directly, it will break.

**P2.3 — Build output warning: 1.3 MB chunk**
- **Build output:** `dist/assets/index-CRyFFn_e.js` is 1,305 KB (407 KB gzipped).
- Vite warns: "Some chunks are larger than 500 kB after minification." This single bundle contains all app code + Chart.js + jsPDF + Supabase + SheetJS.
- **Not a blocker** for migration (the CDN approach loaded similar total bytes). But code splitting with dynamic `import()` for jsPDF (only needed for export) and XLSX (only needed for upload) would significantly reduce initial load.
- **Recommendation:** Address post-migration as an optimization. Add a note to PLAN.md.

**P2.4 — MT.6 test no longer duplicates source — imports from `../js/identity.js` directly**
- **File:** `tests/mt6-canonical-seq.test.mjs:7` — `import { Identity } from '../js/identity.js'`
- This is a **positive change**. R15 noted that MT.6 duplicated `Identity` code inline (maintenance risk). The ES module conversion now allows direct import, eliminating the copy-paste sync burden.
- **Note:** This works because `package.json` has `"type": "module"` and `identity.js` exports properly. All good.

**P2.5 — Untracked files (6 items) — some should be gitignored**
- `.playwright-mcp/` — Ephemeral Playwright MCP artifacts (logs, screenshots, YAMLs). Carried from R12. Should be in `.gitignore`.
- `.superpowers/` — Brainstorm artifacts. Should be in `.gitignore`.
- `DIAGNOSIS.md` (90 lines) — Stale diagnostic notes from Phase 8, already fixed. Delete or gitignore.
- `codex-review-consolidated-handoff.md` (348 lines) — Contains security analysis of upload pipeline trust model, RLS concerns, rate-limiting weaknesses. **Do not commit** — attacker roadmap for a public repo. Gitignore or delete.
- `ultraplan-prompt.txt` (27 lines) — Agent prompt template, no runtime value.
- `Logotipo_corporativo_MX_amarillo-01 (1).png` — Duplicate-download filename in root. Carried since R11.
- **Action:** Add `.playwright-mcp/`, `.superpowers/`, `DIAGNOSIS.md`, `codex-review-consolidated-handoff.md`, `ultraplan-prompt.txt` to `.gitignore`. Move or delete the logo PNG.

**P2.6 — Manifest icon paths use absolute `/assets/` but icons live in `public/assets/`**
- **File:** `public/manifest.json:10-11`
- Icon paths are `"/assets/icon-192.png"` and `"/assets/icon-512.png"`. Vite copies `public/` contents to `dist/` root, so `dist/assets/icon-192.png` exists (verified). The leading `/` means they resolve correctly from the site root.
- **No issue** — verified icons exist in build output. Just noting for completeness.

---

### Missing Tests

- **No browser/E2E smoke test for Vite migration.** The PLAN.md explicitly calls this out as the remaining step. The dashboard was stuck on "Cargando datos" during a prior local test; root cause was a missing `import { CONFIG }` (fixed) but the fix hasn't been browser-verified. A Playwright test or manual check is needed.
- **No test for PDF export with jsPDF v4.** The 2-major-version jump should be validated by exporting an actual chart to PDF and verifying the output is non-empty and correctly sized.
- **No test for the inline theme script under CSP.** Would need a real browser with CSP enforcement to catch P1.1.

---

### Notes

- **Migration scope is correct.** 15 JS files converted, 4 CDN scripts replaced with npm packages, single `<script type="module">` entry point. No functional changes to business logic — the goal of "zero functional changes" is met (pending browser verification).
- **The `typeof WeatherStore !== 'undefined'` → `!WeatherStore` refactor is correct.** 8 occurrences in `charts.js` and 1 in `explorer.js` were updated. With ES module imports, `WeatherStore` is always defined (it's a live binding to the imported object), so `!WeatherStore` is equivalent and cleaner. The falsy check still guards against `null`/`undefined` if the module exports change.
- **Test improvement:** MT.6 now imports from source instead of duplicating code inline. This was a prior P2 finding (R15) resolved as a side effect of the ES module conversion.
- **CSP tightening is a good security improvement** — removing CDN script-src origins reduces the attack surface. Just needs the inline script hash (P1.1).
- **`window.supabase.createClient` → named import is clean.** `dataLoader.js:42` now uses the proper ES import path.
- **The `window.jspdf` availability checks were correctly removed** from `exportChartPDF` and `exportPagePDF` (`charts.js:1816-1819`, `charts.js:1997-2000`). With ES module imports, `jsPDF` is always available at module evaluation time — no need for runtime availability guards.
- **Package-lock diff is large (1,384 lines)** but expected for adding 4 new production deps + Vite. All dependencies resolve to expected versions.
- **Recommended next steps:** (1) Fix P1.1 (CSP + inline script), (2) browser smoke test, (3) push and verify Vercel preview deploy, (4) merge to main.

---

## Round 19 — Branch `feat/vite-migration` — 4 New Commits (2026-04-16)

**Scope:** 4 commits (`1810695`, `b7d6b48`, `68c9763`, `d9c7010`) on branch `feat/vite-migration`. 15 files changed, +637 / −771 lines (net reduction from REVIEW.md consolidation).
**Commits:**
1. `1810695` — feat: light theme default, dual logos, encoding normalization
2. `b7d6b48` — feat: weather time aggregation (F5) and selectable timeframes (F6)
3. `68c9763` — docs: update TASK.md, PLAN.md for Stage 2 (F5+F6) completion
4. `d9c7010` — fix: move inline theme script to external file for CSP compliance (P1.1)

**Build:** `vite build` succeeds — 265 modules, 14 output files, 1.36s.
**Tests:** 96/96 passing (13 suites, 890ms). 24 new tests in MT.8.
**Browser smoke test:** Dev server + production build both load with 0 JS errors. Theme toggle verified on login screen (light ↔ dark).

---

### Round 18 Items Resolved

| ID | Issue | Resolution |
|----|-------|------------|
| R18.P1.1 | Inline theme script blocked by CSP | **Fixed** (`d9c7010`) — moved to `public/theme-init.js`, served as `'self'` |

---

### Priority 1 — Issues

None. All R18 P1 items resolved or downgraded:
- **P1.1 (CSP inline script):** Fixed in `d9c7010`.
- **P1.2 (circular deps):** No current bug — remains a maintenance note. Browser testing confirms all modules load and resolve correctly.
- **P1.3 (jsPDF v4):** Cannot test PDF export without authenticated session + data. Remains an open verification item but is not blocking the migration.

---

### Priority 2 — Improvements

**P2.1 — `theme-init.js` has no trailing newline**
- **File:** `public/theme-init.js`
- Minor: file ends without a newline character. Some linters and POSIX tools expect a trailing newline.
- **Impact:** Cosmetic.

**P2.2 — `_syncInner` `dateRangeFn` API is inconsistent — some callers ignore the `year` parameter**
- **Files:** `js/events.js:111,128`
- `_syncInner` calls `rangeFn(year)` in a loop. Two callers pass lambdas that ignore `year`:
  - `() => WeatherStore.getDateRange(null, '30d')` — always returns 30-day window regardless of year
  - `() => range` — returns a fixed custom range
- This works because both callers also pass a single-element `[year]` array, so the loop runs exactly once. But the API contract is unclear — `rangeFn` looks like it should use `year`, yet these callers don't.
- **Impact:** Low. Functional, but confusing to a future maintainer. Consider documenting the two modes (per-vintage vs fixed-range).

**P2.3 — `normalizeAppellation` double-encoded UTF-8 fix is fragile**
- **File:** `js/config.js:113-120`
- The fix detects `\u00C3` (Ã) to identify double-encoded UTF-8, then replaces specific byte sequences (`Ã±` → `ñ`, `Ã©` → `é`, etc.). This handles the 6 most common Spanish diacritics.
- However, it's a byte-pair replacement — if `\u00C3` appears legitimately in text (unlikely in Spanish wine appellations but possible), it would be falsely matched. Also, any diacritics not in the list (e.g., `ü` as `Ã¼`) would not be fixed.
- **Impact:** Low. The current list covers all known cases in the dataset. A more robust approach would be to fix encoding at the database/API level.

**P2.4 — `_enrichData` now normalizes variety/appellation on wineRecepcion/winePreferment too**
- **File:** `js/dataLoader.js:509-517`
- Previous `_enrichData` only processed `berryData`. Now it also normalizes `wineRecepcion.variedad`/`.proveedor` and `winePreferment.variedad`/`.proveedor`. This is a scope expansion beyond the Vite migration.
- The normalization is correct and consistent with the berry data path. But it changes the data shape — if any downstream code compares raw DB strings to these normalized values, it could break.
- **Impact:** Low risk. The normalization functions are idempotent and additive. More of a scope note.

**P2.5 — Untracked files grew from 6 to 10 items**
- New since R18: `Logotipo_corporativo_MX_amarillo-01.webp`, `dark-mode.png`, `light-mode.png`, `light-trimmed.png`
- These appear to be design reference screenshots. None should be committed.
- **Action:** Add `*.png` root-level screenshots and `.webp` logo variants to `.gitignore`, or delete them.

**P2.6 — `_applyDaysJitter` still exported unnecessarily (carried from R18)**
- **File:** `js/charts.js:11`
- Not addressed in the 4 new commits. Minor cosmetic issue.

---

### Missing Tests

- **No test for encoding normalization** — The double-encoded UTF-8 fix in `config.js:113-120` and the `_enrichData` normalization of wineRecepcion/winePreferment have no test coverage. A test verifying `normalizeAppellation('Vi\uFFFDa')` → `'Viña'` and `normalizeAppellation('Ger\u00C3\u00B3nimo')` → `'Gerónimo'` would prevent regression.
- **PDF export with jsPDF v4** — still untested in browser (requires auth + data).
- **Weather UI interactions** — The aggregation/timeframe selectors are tested at the data layer (MT.8) but not at the UI event layer. Would need Playwright E2E tests with live data.

---

### Notes

- **P1.1 fix is clean and correct.** External `theme-init.js` in `public/` is the right approach — it's blocking (runs before paint), CSP-compliant (served from `'self'`), and Vite copies it to `dist/` root untouched. Default flipped to light (`t==='dark'?'dark':'light'`), matching `App.theme: 'light'` and `App.restoreTheme()`.
- **Light theme implementation is well done.** Dual logos (SVG for dark, WebP for light) toggled via CSS classes `.logo-dark`/`.logo-light` with `[data-theme="light"]` selector. Login screen gets its own theme toggle button. `_syncThemeIcons` now uses `querySelectorAll` to update both login and header toggle icons.
- **Weather aggregation (F5) is solid.** `WeatherStore.aggregate()` correctly averages temperatures, sums rainfall, and accumulates GDD contributions. The `_gddContribution` field in aggregated rows is used by `createGDDChart` to avoid re-computing GDD from averaged temps (which would be mathematically wrong). Good design.
- **Selectable timeframes (F6) are well-integrated.** New filter state (`weatherAggregation`, `weatherTimeframe`, `weatherCustomStart`, `weatherCustomEnd`), new HTML selectors in `index.html`, event handlers in `events.js`, and chart functions updated to accept the new parameters. `clearAll` correctly resets all new state.
- **MT.8 test suite is thorough.** 24 tests covering aggregation (day/week/month modes, null handling, correctness), date range helpers, ISO week calculation, and x-axis title generation. Tests import directly from `js/weather.js` — no code duplication.
- **Browser smoke test passed.** Both dev server and production build load with 0 JS errors. Theme toggle works on login screen. Light theme is the new default with correct logo switching.
- **96/96 tests pass.** No regressions in existing tests (MT.2–MT.7). 24 new tests in MT.8.

---

## Prior Rounds (1–18)

Historical review rounds are preserved in git history. Key milestones:
- **Rounds 1–9:** Initial development, Waves 1–7 merged.
- **Round 10:** Weather charts, GDD, sample_seq, API refactor.
- **Rounds 11–12:** Lot-line plugin removal, doc cleanup.
- **Rounds 13–15:** Phase 8 — deterministic berry upload identity.
- **Round 16:** Phase 8 merged + `parseFloat` root cause fix.
- **Round 17:** Dead code cleanup, jsPDF CDN fix, scatter legend.
- **Round 18:** Vite migration review — CSP inline script, circular deps, jsPDF v4 jump.

---

## Round 20 — Branch `main` — Untracked Artifacts Audit (2026-04-20)

**Scope:** No tracked modifications. `git diff` and `git diff --cached` both empty. `git status` reports the branch is even with `origin/main`. The review below covers **only untracked files** that could pollute the next commit or leak into history if `git add -A` or `git add .` is used.

**Untracked inventory:**
- `.playwright-mcp/` — 884 KB of agent-generated browser snapshots, console logs, and PNGs (e.g., `light-theme-login.png`, `vite-smoke-test.png`, `trimmed-logo-base64.txt`).
- `.superpowers/brainstorm/` — 12 KB agent scratch directory.
- `DIAGNOSIS.md` — 4.1 KB, pre-Phase-8 berry identity analysis.
- `codex-review-consolidated-handoff.md` — 14.5 KB, same vintage, same subject.
- `ultraplan-prompt.txt` — 1.6 KB, derived prompt from the handoff.
- `Logotipo_corporativo_MX_amarillo-01 (1).png` (64 KB) and `Logotipo_corporativo_MX_amarillo-01.webp` (30 KB) — brand assets at repo root.
- `dark-mode.png`, `light-mode.png`, `light-trimmed.png` — 70–73 KB each, theme screenshots from Round 18/19 work.

---

### Priority 1 — Issues

**P1.1 — Agent/test-artifact directories are not git-ignored**
- **Files:** `.gitignore` (lines 60–65) ignores `.claude/` and `test-results/` but **not** `.playwright-mcp/` or `.superpowers/`.
- **Risk:** A future `git add -A` / `git add .` would commit ~884 KB of transient Playwright snapshots, console logs, and base64 blobs to history. `trimmed-logo-base64.txt` alone is ~54 KB; committed once, it stays in pack history forever.
- **Recommendation:** Add two lines to `.gitignore` before the next commit:
  ```
  .playwright-mcp/
  .superpowers/
  ```
  Place them next to the existing `.claude/` and `test-results/` stanza so the pattern is obvious. This is a non-destructive, reversible change and does not touch any tracked content.

**P1.2 — Stale diagnosis documents contradict shipped code**
- **Files:** `DIAGNOSIS.md`, `codex-review-consolidated-handoff.md`, `ultraplan-prompt.txt`.
- All three describe the berry-identity bug (non-deterministic `sample_seq`, weak `sample_id = '25'`, collapsed lots) as a live problem and recommend creating `js/identity.js` and `buildBerryIdentity()`.
- **Current state:** `js/identity.js` exists on `main` (Phase 8, Rounds 13–16 in this file). The bug is already fixed. These untracked docs are historical context, not open issues.
- **Risk:** If a future agent treats them as authoritative, it may re-implement identity generation, duplicate logic, or "fix" code that is already correct. The `ultraplan-prompt.txt` explicitly instructs a follow-on agent to "Create shared normalization module (js/identity.js)" — which already exists.
- **Recommendation:** Either (a) delete them, (b) move under `docs/reviews/archive/` with a header stating "resolved in Phase 8 (commit 3c2b8e8 and prior)", or (c) add to `.gitignore`. Do not commit them as-is. The narrowest safe action is (b); (a) is fine if the analysis is duplicated in git log.

---

### Priority 2 — Improvements

**P2.1 — Brand assets and theme screenshots at repo root**
- **Files:** `Logotipo_corporativo_MX_amarillo-01 (1).png`, `Logotipo_corporativo_MX_amarillo-01.webp`, `dark-mode.png`, `light-mode.png`, `light-trimmed.png`.
- The two logo files are production brand assets (the `.webp` variant is referenced as the light-theme logo in the Round 19 notes). Shipping them from repo root is inconsistent with the rest of the project, which serves static assets from `public/` (per `index.html` and the `public/theme-init.js` pattern from P1.1 of Round 18).
- The `(1)` suffix on the PNG is the Windows "duplicate download" marker — suggests it was dragged in by hand and never normalized.
- The filename contains a space, which is fragile in shell contexts and for any future `<link>`/`<img>` reference unless URL-encoded.
- The three `*-mode.png` screenshots look like debugging artifacts from Round 18/19.
- **Recommendation:**
  - Move the active logo into `public/` under a space-free, suffix-free name (e.g., `public/logo-mx-amarillo.webp`) and reference from HTML/CSS.
  - Delete the `(1).png` duplicate and the three theme screenshots, or move them under a screenshots folder that is git-ignored.
  - Until disposition is decided, do **not** `git add .` — a targeted `git add <file>` per item is safer.

**P2.2 — `.gitignore` could pre-empt future noise**
- Currently there is no catch-all for ad-hoc top-level work-in-progress documents (the repo already excludes `RESUMEN*.txt`, `REPORTE_DASHBOARD.txt`, `PROJECT_SUMMARY.md`). Consider adding:
  ```
  DIAGNOSIS*.md
  *-handoff.md
  ultraplan-*.txt
  ```
  This is optional and should be a conscious policy call, not a silent add — flagging for the user to decide.

**P2.3 — Untracked assets are candidates for `git clean`, but only after disposition is confirmed**
- Do **not** run `git clean -fd` to remove these. Some (the logo) are likely intended to be tracked; some (the handoff docs) carry analysis the user may want to preserve outside the repo. Ask the user which to keep before any cleanup.

---

### Missing Tests

- **No code changed**, so no new tests are required by this review.
- The stale handoff docs (P1.2) list a "must-add" test plan for upload idempotency. Those regressions are presumably covered by the Phase 8 test suite (see Round 16). If the user wants to verify the docs are actually stale, grep `tests/` for re-upload / shuffle idempotency coverage before archiving the handoff.

---

### Notes

- **Tree is clean at the source level.** No source file has been modified. This review is entirely about preventing accidental commits of agent/test artifacts and about the stale-doc footgun — it is not a code review of a feature.
- **Safety posture.** All recommendations above are additive or localized (edit `.gitignore`, move a file). No recommendation involves `git reset`, `git clean -f`, force-push, or touching tracked content.
- **Before the next commit on this branch**, the user should:
  1. Decide which untracked files to keep as tracked (likely: the `.webp` logo, moved into `public/`).
  2. Decide which to delete (likely: `(1).png` duplicate, theme PNGs, handoff/diagnosis/prompt files if duplicated elsewhere).
  3. Update `.gitignore` for `.playwright-mcp/` and `.superpowers/` (P1.1) so they stay out of history permanently.
  4. Use explicit `git add <path>` — never `git add .` — until the above is resolved.
- **No risky scope expansion observed** (there is no diff to expand). No dependency churn, no config changes, no schema changes in this review cycle.
