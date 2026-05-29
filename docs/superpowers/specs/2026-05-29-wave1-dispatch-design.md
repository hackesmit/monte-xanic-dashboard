# Wave 1 dispatch — 4 PRs across 2 waves, subagent-driven

**Status:** Approved 2026-05-29.
**Companion spec (content):** `docs/superpowers/specs/2026-05-21-wave1-audits-calidad-design.md`
**Companion plans (per-PR, written next):** `docs/superpowers/plans/2026-05-29-wave1-issue-{2,1,5,3}.md`

This doc captures the **dispatch shape** — how Wave 1 ships, who edits what, and the review checklist between merges. The *content* of each change is owned by the 2026-05-21 spec; this doc points to it rather than restating it.

## Why a separate dispatch doc

The Wave 1 audit spec from 2026-05-21 was written as a single deliverable. We're splitting it into 4 PRs for blast-radius isolation and parallel subagent execution. The spec describes *what changes*; this doc describes *how the work gets done*. Keeping the two concerns separate means the spec stays canonical for the technical decisions while this doc can evolve independently if dispatch shape changes (e.g., if a subagent finishes faster than expected and we collapse Wave B).

## Pre-dispatch field prep (done 2026-05-29)

- `git checkout -- PLAN.md TASK.md` — dropped the stale Phase 10 planning diff (Phase 10 had already shipped).
- Corrected `DemoMode.isEnabled` → `DemoMode.isActive` in the Wave 1 spec (line 98).
- Refreshed `~/.claude/projects/.../memory/project_current_state.md` to reflect Phase 10 done + predictor done + Wave 1 in progress.
- Added a feedback memory `feedback_planning_doc_drift.md` so the next session doesn't fall into the same "design what's already shipped" trap.

## Sequencing

Two waves; one PR per issue.

```
Wave A (solo, blocking)        Wave B (parallel, after Wave A merges)
─────────────────────          ───────────────────────────────────────
#2 calidad map snake/camel  →  #1 weighted means     ┐
                               #5 extraction peak ANT │  3 PRs in flight
                               #3 calidad in mediciones ┘  at the same time
```

**Why this shape:** #2 is a strict prerequisite for #3 (without it, `scoreLot()` returns null on every row, so the badge column in #3 would all-dash and the integration test couldn't be written). #1 and #5 are independent of everything. So Wave A holds the dependency chain; Wave B is a true fan-out.

## Per-subagent contracts

Each subagent runs in an isolated git worktree (`superpowers:using-git-worktrees`), uses TDD (`superpowers:test-driven-development`), and gates completion behind `superpowers:verification-before-completion`. Prompts will name those skills explicitly.

### Subagent A — Issue #2 (Wave A, solo)

- **Branch:** `fix/calidad-camelcase`
- **PR title:** `fix(calidad): scoring reads camelCase medicion fields`
- **Allowed files:**
  - `js/classification.js` — 8 field reads renamed (L68–74, L84, L138 per Wave 1 spec §"#2 Calidad map fix")
  - `js/maps.js` L110 — `tons_received` → `tons`
  - `tests/mt31-map-calidad.test.mjs` (new) — 4 cases from Wave 1 spec §Tests
- **Forbidden:** Anything else, including `js/mediciones.js` (that's #3's territory).
- **Exit criteria:**
  - `npm test` → 397 + 4 green
  - `npm run build` succeeds
  - Browser smoke at `/?demo=1`: map view shows non-grey lots in Monte Xanic — subagent documents observed vs expected in the PR body
  - Branch pushed; PR opened via `gh pr create` per CLAUDE.md "always push after fixing bugs"

### Subagent B — Issue #1 (Wave B, parallel)

- **Branch:** `feat/weighted-means`
- **PR title:** `feat(aggregations): tonnage-weighted means via mediciones.tons_received`
- **Allowed files:**
  - `js/aggregations.js` (new) — exports `weightedMean(rows, valueKey, weightKey='_weight', { fallbackWeight=1 }={})` and `peakBy(rows, key)` per spec
  - `js/dataLoader.js` — `_weight` enrichment after mediciones load (skip when `DemoMode.isActive()`); update internal mean at L643–653
  - `js/kpis.js` — L4–7 (berry) and L42–45 (wine) → `weightedMean`
  - `js/charts.js` — L386–399, L457–469, L903–924, L1497–1515, L2278–2290
  - `js/maps.js` L79 — `const w = 1` → `const w = (lot._weight && lot._weight > 0) ? lot._weight : 1`
  - `tests/mt29-aggregations.test.mjs` (new) — 8 cases from spec
- **Forbidden:** `js/classification.js`, `js/mediciones.js`, `api/*`.
- **Exit criteria:**
  - `npm test` → green; if existing tests snapshot KPI numbers that now shift, update them deliberately and enumerate the shifts in the PR description
  - `npm run build` succeeds
  - Browser smoke: a KPI card on a real-data view shows a number that differs from before in a plausible direction (no negative or wildly out-of-range values)
  - Branch pushed; PR opened via `gh pr create`

### Subagent C — Issue #5 (Wave B, parallel)

- **Branch:** `fix/extraction-peak-ant`
- **PR title:** `fix(extraction): numerator picks peak antoWX per codigoBodega`
- **Allowed files:**
  - `js/app.js` L656 — replace overwrite with peak-keeping conditional
  - `js/charts.js` L699 — same pattern
  - `tests/mt30-extraction.test.mjs` (new) — 4 cases from spec
- **Forbidden:** Anything else. In particular, do *not* refactor into `peakBy` even though Subagent B is creating that helper — the PRs must stay independent.
- **Exit criteria:**
  - `npm test` → green
  - `npm run build` succeeds
  - Browser smoke: a lot with multiple wine samples shows extraction % calculated from peak (subagent verifies via console)
  - Branch pushed; PR opened via `gh pr create`

### Subagent D — Issue #3 (Wave B, parallel, rebased on Wave A)

- **Branch:** `feat/calidad-in-mediciones`
- **PR title:** `feat(mediciones): calidad badge in table + live score in edit modal`
- **Allowed files:**
  - `js/mediciones.js` — in `refresh()`, precompute `d._score = scoreLot(d)`; add `score36` to sortable keys; render badge in `renderTable()`; in edit modal, add a `<div class="detail-grade">` that re-runs `scoreLot()` on form input
  - `index.html` — one new `<th>` in mediciones table header; one `<div>` in mediciones edit modal
  - `css/styles.css` — add `.pred-badge-a-plus` / `.pred-badge-a` / `.pred-badge-b` / `.pred-badge-c` if not already present
  - `tests/mt31-map-calidad.test.mjs` — extend with integration case #4 from spec
- **Forbidden:** `js/classification.js` (owned by #2), `js/maps.js`, `js/kpis.js`, `js/charts.js`.
- **Exit criteria:**
  - `npm test` → green
  - `npm run build` succeeds
  - Browser smoke at `/?demo=1`: Mediciones Técnicas view shows A+/A/B/C badges per row; clicking a row → modal shows live grade that updates as the user edits phenolicMaturity / brix / etc. — subagent documents observed vs expected in the PR body
  - Branch pushed; PR opened via `gh pr create`

## Review checklist (main agent runs between merges)

1. **Diff stays inside the allowlist.** `git diff main --stat` — every modified file must be in the subagent's allowed list. Out-of-scope edits → reject, ask subagent to revert.
2. **Tests are real, not tautological.** Skim the new MT.X test file for assertions that actually exercise the change. MT.31 case #3 (the "snake_case shape returns null" regression pin) must be present.
3. **No drive-by refactors.** If the subagent reformatted other code or "improved" adjacent things, ask them to revert.
4. **CLAUDE.md file boundaries respected.** No new chart logic in `dataLoader.js`, no data queries in `charts.js`, no scoring logic in `maps.js`, etc.
5. **CSP-safe.** No new inline `onclick="..."` handlers, no inline `<script>` blocks. Event bindings go through `js/events.js`.
6. **`npm test` green + `npm run build` succeeds.** Run both myself before merging; don't trust the subagent's report.
7. **Browser smoke** for #2 (map colors) and #3 (mediciones badges). Drive Playwright myself in `?demo=1` mode.

## Wave A → Wave B transition

After #2 merges to `main`:
- Re-pull `main` locally
- Re-confirm `npm test` green
- Dispatch B, C, D in **one message** (single round-trip, three parallel agents) so they truly run concurrently rather than serializing

## Wave B merge order

First-finished-first-merged, except: if both #1 and #5 finish before #3, merge them first. #3 was rebased on #2 so its only likely conflict is internal.

## Risk hot spots

- **#1's numeric drift.** Existing tests in MT.5/MT.8/MT.11 may snapshot specific KPI numbers. If they break, the subagent must update them deliberately and the PR description must enumerate which baseline numbers shifted. Blanket `.toFixed()` tweaks without explanation will be rejected.
- **#1's demo-mode bypass.** `dataLoader.js` enrichment must early-return when `DemoMode.isActive()`. Otherwise demo data gets `_weight=1` everywhere — functionally a no-op, but the spec mandates the explicit skip for clarity.
- **#3's classification.js dependency.** If Subagent D starts before #2 merges, `scoreLot()` returns null and the badge column shows all dashes. Dispatch order prevents this; re-confirm `git log main` shows #2's commit before launching D.
- **#5's `wineByCodigo` shadowing.** Both `app.js:656` and `charts.js:699` build their own local `wineByCodigo` map. Subagent must fix both — not assume one is shared.

## Out of this dispatch

- **#7 (pronóstico no-refresh)** — deferred from Wave 1 per the 2026-05-21 spec; Playwright cannot reproduce, needs user-side repro before revisiting.
- **R5 (UI signal for lots missing `tons_received`)** — non-goal per the 2026-05-21 spec, called out again here for clarity.
- **Phase 10 anything** — already shipped on `main`.
- **Refreshing `PLAN.md` / `TASK.md` content** — discarded the stale Phase 10 draft; not rewriting the files in this session (memory captures current state instead).
- **Playwright e2e suite** — Wave 1 is unit-test driven (MT.29/30/31). If a subagent's change warrants an e2e regression, they add it and run it.

## Deliverables

- 4 merged PRs on `main`, each with its own MT.X test coverage where applicable.
- This dispatch spec committed.
- Per-PR implementation plans under `docs/superpowers/plans/2026-05-29-wave1-issue-{2,1,5,3}.md` (written by `superpowers:writing-plans` after this spec is approved).
- Auto-memory already refreshed (done in field prep).

## Rough time budget

- Dispatch spec + plan writing: ~10–15 min (me)
- Wave A subagent: ~10–15 min
- Wave A review/merge: ~5 min (me)
- Wave B (3 parallel subagents): ~15–25 min wall-clock
- Wave B review/merge: ~15 min (me, three PRs)
- **Total:** ~60–80 min with two natural break points (after field prep, after Wave A merge).
