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

## Prior Rounds (1–17)

Historical review rounds are preserved in git history. Key milestones:
- **Rounds 1–9:** Initial development, Waves 1–7 merged.
- **Round 10:** Weather charts, GDD, sample_seq, API refactor.
- **Rounds 11–12:** Lot-line plugin removal, doc cleanup.
- **Rounds 13–15:** Phase 8 — deterministic berry upload identity.
- **Round 16:** Phase 8 merged + `parseFloat` root cause fix.
- **Round 17:** Dead code cleanup, jsPDF CDN fix, scatter legend.
