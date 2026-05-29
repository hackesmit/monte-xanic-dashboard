# Wave 1 dispatch — 4 PRs across 2 waves, subagent-driven

**Status:** Approved 2026-05-29; **amended 2026-05-29** after verification revealed the 2026-05-21 audit spec misdiagnosed #2 and #3 (see "Spec corrections" below).
**Companion spec (content, partially superseded):** `docs/superpowers/specs/2026-05-21-wave1-audits-calidad-design.md`
**Companion plans (per-PR, written next):** `docs/superpowers/plans/2026-05-29-wave1-issue-{2,1,5,3}.md`

This doc captures the **dispatch shape** — how Wave 1 ships, who edits what, and the review checklist between merges. The *content* of each change is owned by the 2026-05-21 spec **except** for #2 and #3, which this doc overrides per the corrections section below.

## Why a separate dispatch doc

The Wave 1 audit spec from 2026-05-21 was written as a single deliverable. We're splitting it into 4 PRs for blast-radius isolation and parallel subagent execution. The spec describes *what changes*; this doc describes *how the work gets done*. Keeping the two concerns separate means the spec stays canonical for the technical decisions while this doc can evolve independently if dispatch shape changes (e.g., if a subagent finishes faster than expected and we collapse Wave B).

## Spec corrections (2026-05-29 verification pass)

Before writing the per-PR plans, I ran a Node script that imports `DataStore`, `DemoMode`, and `scoreAll` directly and walked the demo data through the full join pipeline. Two of the 2026-05-21 spec's claims didn't survive.

### Correction 1 — #2 misdiagnosed

The 2026-05-21 spec attributes "calidad map all-grey" to a snake_case/camelCase mismatch in `js/classification.js` (lines 68–74, 84, 138) reading snake_case from a medicion object that's actually camelCase, plus `maps.js:110` reading `tons_received` instead of `tons`.

**That's wrong.** `js/dataLoader.js:585-606` (`joinBerryWithMediciones`, shipped `2e55d18` on 2026-04-21) explicitly translates camelCase → snake_case before attaching `b.medicion`, and writes `tons_received: m.tons`. So:

- `classification.js`'s snake_case reads → correct
- `maps.js:110`'s `s.medicion?.tons_received` → correct
- **Applying the renames the 2026-05-21 spec proposed would BREAK the live code.**

**Real root cause** (verified by Node script): `js/demoMode.js generateDemoData()` (line 252) intentionally merges current-season berry data (`vintage = currentYear`, today 2026) with historical mediciones / receptions / wine (`vintage = 2025`). The split is required by the predictor's V=0 historical-slope-prior strategy. Side effect: `joinBerryWithMediciones` (keyed on `(lotCode, vintage)`) gets 0 matches, every berry's `medicion` resolves to null, sanitary/visual scoring returns null, `impSum < 60`, every lot returns `{ grade: null, reason: 'Datos insuficientes' }`.

Concrete evidence from the verification script:

```
berry rows: 135  med: 64
berry sample: lotCode=SYDA-G, vintage=2026
med sample:   lotCode=SBMX-1A, vintage=2025
unique berry (lotCode,vintage): 27  unique med: 64  intersection: 0
```

In production, real Supabase berry and medicion rows come from the same upload pipeline and presumably share vintage — so the calidad map may work on real data and only break in demo mode. Either way, the audit symptom is real, but the fix is in `demoMode.js`, not `classification.js`.

### Correction 2 — #3 won't work as written

The 2026-05-21 spec says (§"Calidad in Mediciones"):

```js
data.forEach(d => { d._score = scoreLot(d); });  // data = mediciones rows
```

`scoreLot()` (`classification.js:90`) expects berry chemistry (`brix`, `pH`, `tANT`, `berryFW`, ...) on the top-level `lot` object plus a nested `lot.medicion` with snake_case health fields. Mediciones rows have neither — they have weight/diameter/tons + flat camelCase health fields. So `scoreLot(medicionRow)` always returns `{ grade: null, reason: 'Datos insuficientes' }`.

**Corrected approach:** add a `scoreFromMedicion(medicionRow, berryByLot)` wrapper that finds the matching berry row by `(lotCode, vintage)`, attaches the medicion's snake-cased fields, and delegates to `scoreLot()`. Mediciones rows whose berry can't be located in `berryByLot` return `{ grade: null, reason: 'Sin berry' }`.

### Pre-dispatch field prep (done 2026-05-29)

- `git checkout -- PLAN.md TASK.md` — dropped the stale Phase 10 planning diff (Phase 10 had already shipped).
- Corrected `DemoMode.isEnabled` → `DemoMode.isActive` in the 2026-05-21 spec (line 98).
- Refreshed `~/.claude/projects/.../memory/project_current_state.md` to reflect Phase 10 done + predictor done + Wave 1 in progress.
- Added a feedback memory `feedback_planning_doc_drift.md` so the next session doesn't fall into the same "design what's already shipped" trap.
- Verified the 2026-05-21 spec's #2 and #3 claims by running the actual data path through Node (see "Spec corrections" above).

## Sequencing

Two waves; one PR per issue.

```
Wave A (solo, blocking)        Wave B (parallel, after Wave A merges)
─────────────────────          ───────────────────────────────────────
#2 calidad map snake/camel  →  #1 weighted means     ┐
                               #5 extraction peak ANT │  3 PRs in flight
                               #3 calidad in mediciones ┘  at the same time
```

**Why this shape:** #2 is a soft prerequisite for #3's user-facing smoke test (without it, demo-mode mediciones have no matching berries, so #3's badge column would all-dash in `/?demo=1`). #3's code path itself is independent — it could ship first — but verifying it visually requires #2's demo fix. #1 and #5 are independent of everything. So Wave A holds the dependency chain; Wave B is a true fan-out.

## Per-subagent contracts

Each subagent runs in an isolated git worktree (`superpowers:using-git-worktrees`), uses TDD (`superpowers:test-driven-development`), and gates completion behind `superpowers:verification-before-completion`. Prompts will name those skills explicitly.

### Subagent A — Issue #2 (Wave A, solo) — *corrected scope*

- **Branch:** `fix/demo-calidad-data`
- **PR title:** `fix(demo): emit current-vintage mediciones + receptions for calidad map`
- **Allowed files:**
  - `js/demoMode.js` — `generateCurrentSeason()` returns `{ berry, mediciones, receptions, receptionLots, wine }` instead of `{ berry }`. For every current-season group, emit one medicion row (`vintage = currentYear`, `lotCode = g.lotCode`, full health fields targeting an A or A+ grade so the demo looks good), one tank-reception row (with `av`, `ag`, `polifenoles_wx`, `vintage_year = currentYear`), one reception_lots link, and one wine row. `generateDemoData()` concatenates current arrays with historical arrays so both vintages remain visible (historical 2025 stays for the predictor's slope prior).
  - `tests/mt32-demo-calidad.test.mjs` (new) — pure integration test: import DataStore + DemoMode + scoreAll, call `DemoMode.enable()`, assert (a) `≥ 80%` of berry rows have a non-null `b.medicion`, (b) `scoreAll(berry, { cohort: 'vintage-variety' })` returns at least 50 lots with a non-null `grade`, (c) the grade distribution covers at least 2 of A+/A/B/C.
  - `tests/mt27-demo-predictor.test.mjs` — update only if the new current-vintage rows break existing assertions (predictor tests must still pass).
- **Forbidden:** `js/classification.js`, `js/maps.js`, `js/mediciones.js`, anything outside `js/demoMode.js` + the two test files.
- **Exit criteria:**
  - `npm test` → all green (MT.27 + MT.32 both pass)
  - `npm run build` succeeds
  - Verification: re-run the Node script in "Spec corrections" — `graded > 0`, grade distribution non-empty
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

### Subagent D — Issue #3 (Wave B, parallel, rebased on Wave A) — *corrected scope*

- **Branch:** `feat/calidad-in-mediciones`
- **PR title:** `feat(mediciones): calidad badge in table + live score in edit modal`
- **Allowed files:**
  - `js/classification.js` — *add only* a new exported function `scoreFromMedicion(medicionRow, berryByLot)`. Looks up `berryByLot.get(\`${m.lotCode}||${m.vintage}\`)`; returns `{ grade: null, reason: 'Sin berry' }` if not found. Otherwise builds a synthetic lot from the berry (variety, appellation, chemistry) with a snake-cased medicion attached (`health_grade`, `health_madura`, ..., `phenolic_maturity`, `tons_received`) and calls `scoreLot()`. Do **not** modify any existing function in this file — the renames the 2026-05-21 spec proposed are a no-op against the live code.
  - `js/mediciones.js` — in `refresh()`, build `berryByLot` from `DataStore.berryData`; for each medicion `d`, set `d._score = scoreFromMedicion(d, berryByLot)`; add `score36` to sortable keys; render the grade badge in `renderTable()`; in the edit modal, add a `<div class="detail-grade">` that re-runs `scoreFromMedicion()` on form input.
  - `index.html` — one new `<th>` in the mediciones table header; one `<div>` in the mediciones edit modal.
  - `css/styles.css` — add `.pred-badge-a-plus` / `.pred-badge-a` / `.pred-badge-b` / `.pred-badge-c` if not already present (check the predictor's badge palette first; reuse if available).
  - `tests/mt31-score-from-medicion.test.mjs` (new) — pure tests for the wrapper: (a) returns null grade with `reason: 'Sin berry'` when berry index miss, (b) returns same grade as `scoreLot(berry)` when a matching berry exists, (c) handles missing variety / appellation gracefully.
- **Forbidden:** `js/maps.js`, `js/kpis.js`, `js/charts.js`, `js/dataLoader.js`, `js/demoMode.js`, `api/*`. Touching `js/classification.js` is limited to **adding** `scoreFromMedicion`; do not rename or modify any existing reads.
- **Exit criteria:**
  - `npm test` → green
  - `npm run build` succeeds
  - Browser smoke at `/?demo=1` (after Wave A has merged so the join works): Mediciones Técnicas view shows A+/A/B/C badges per row; clicking a row → modal shows live grade that updates as the user edits phenolicMaturity / brix / etc. — subagent documents observed vs expected in the PR body
  - Branch pushed; PR opened via `gh pr create`

## Review checklist (main agent runs between merges)

1. **Diff stays inside the allowlist.** `git diff main --stat` — every modified file must be in the subagent's allowed list. Out-of-scope edits → reject, ask subagent to revert.
2. **Tests are real, not tautological.** Skim the new MT.X test file for assertions that actually exercise the change. For #2 (MT.32), the integration test must call `DemoMode.enable()` and assert against the actual scoreAll output — not just check that `mediciones.length > 0`. For #3 (MT.31), the "Sin berry" regression case must be present.
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
- **#2 must not break the predictor.** `mt27-demo-predictor.test.mjs` validates predictor behavior under demo data. Subagent A's added current-vintage rows must coexist with the existing historical (2025) rows that the predictor relies on for its V=0 slope-prior strategy. If MT.27 turns red, the fix is to keep the historical arrays intact and *add* the current-vintage rows alongside — not replace.
- **#3's demo-mode smoke depends on Wave A.** If Subagent D opens its smoke browser before #2 merges, the badges show all dashes in demo mode (no berry↔medicion match → `reason: 'Sin berry'`). Production data isn't affected. Dispatch order prevents this; re-confirm `git log main` shows #2's commit before launching D.
- **#3's classification.js touch.** Subagent D may add `scoreFromMedicion` to `classification.js` but must not modify any existing reads. The 2026-05-21 spec's renames are a no-op against live code (see "Spec corrections") and would regress the map view.
- **#5's `wineByCodigo` shadowing.** Both `app.js:656` and `charts.js:699` build their own local `wineByCodigo` map. Subagent must fix both — not assume one is shared.

## Out of this dispatch

- **#7 (pronóstico no-refresh)** — deferred from Wave 1 per the 2026-05-21 spec; Playwright cannot reproduce, needs user-side repro before revisiting.
- **R5 (UI signal for lots missing `tons_received`)** — non-goal per the 2026-05-21 spec, called out again here for clarity.
- **Phase 10 anything** — already shipped on `main`.
- **Refreshing `PLAN.md` / `TASK.md` content** — discarded the stale Phase 10 draft; not rewriting the files in this session (memory captures current state instead).
- **Playwright e2e suite** — Wave 1 is unit-test driven (MT.29 aggregations / MT.30 extraction / MT.31 scoreFromMedicion / MT.32 demo-calidad). If a subagent's change warrants an e2e regression, they add it and run it.

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
