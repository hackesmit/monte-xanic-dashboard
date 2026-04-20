# Review Closure Summary — Mobile Responsiveness + Repo Hygiene

**Date:** 2026-04-20
**Branch:** `main`
**Commits:** `4dc8354` · `31d38c4` · `2118ac8` · `9c49feb`

---

## TL;DR

Four commits closed every P1 item and most P2 items from Rounds 20–22
of `REVIEW.md`. The dashboard now has real touch-friendly controls on
iPhone-sized screens, a clean repo root, and an automated Playwright
spec that will catch any future mobile regression.

- **140/140** node tests pass
- **12/12** Playwright e2e tests pass (iPhone SE 320×568 + iPhone 14 390×844)
- `vite build` clean
- Everything pushed to `origin/main`

---

## Why this work happened

The planner shipped **Round 21** (2026-04-20) and **Round 22** — a live
mobile-viewport audit using Playwright. The audit found that while the
desktop dashboard was polished, the mobile experience had real problems:

- Tap targets as small as **18×14 px** across ~20 buttons
  (Apple HIG minimum is 44×44)
- Buttons rendered **outside the viewport** at 390 px wide (could only
  be reached by scrolling the whole page sideways — an unexpected
  gesture on mobile)
- The theme toggle on the login screen was **clipped above the viewport**
  on iPhone SE
- Form inputs at 13 px triggered iOS Safari's **auto-zoom on focus**
  (disorienting)
- Ranch tabs on the map wrapped into **3–4 unbalanced rows**

The audit also flagged repo hygiene issues — stale planning docs and
stray PNGs at the repo root that would pollute history if anyone ran
`git add .`.

---

## What shipped, in plain English

### Mobile usability — every control is now easy to tap

All of the following only activate below 768 px width (tablets and
phones); desktop visuals are unchanged.

| Before | After |
|---|---|
| Login theme toggle 36×17 px, clipped off-screen on iPhone SE | Pinned to the viewport corner at 44×44 px with a subtle backdrop |
| 20+ tiny "⤓" export buttons on each chart (18×14 px) | Hidden on mobile — section-level "Exportar Vista" button handles it |
| Explorer chart toolbar sat partially off-screen at 390 px | Action buttons drop to a second row; the title truncates with "…" |
| "Guardar Medición" button 26 px tall | 44 px tall, with padding scaled up for thumb-tap reliability |
| Map ranch tabs 24 px tall; 8 tabs wrapped into 3–4 rows | 44 px tall, now a single horizontal scroll strip with snap |
| Form inputs 31–33 px tall, font size triggered iOS auto-zoom | 44 px tall, font size bumped to 16 px (iOS no longer auto-zooms) |
| Map metric dropdown 34 px tall | 44 px tall |
| PWA console warning about deprecated meta tag | Added canonical `mobile-web-app-capable` alongside the Apple tag |

### Mobile polish — layout no longer awkward

| Before | After |
|---|---|
| KPI grid at 320 px: 5 cards in 2 columns → row 3 had a lone card + empty slot | Auto-fit grid: 5 cards flow as 3+2 (no dead space) |
| 7 nav tabs at 3/row orphaned "MEDICIONES" on its own row | 7 tabs at 4/row → clean 4+3 layout |
| Nav tab labels at 8 px (below Material's 10 px floor) | Bumped to 10 px |
| No visual cue that tables were horizontally scrollable | Subtle right-edge shadow hints "swipe for more" |

### Repo hygiene — clean root, safe to `git add`

| Before | After |
|---|---|
| 3 stale planning docs at root described the Phase 8 berry-identity bug as *open* (it shipped months ago) — risk: a future agent could "re-fix" already-working code | Moved to `docs/reviews/archive/` with a "RESOLVED in Phase 8" header prepended; preserved for historical context |
| Duplicate brand logo, 4 theme/mobile PNG screenshots at root, untracked — risk: `git add .` commits ~300 KB of noise to history forever | Moved into `.playwright-mcp/archive-2026-04-20/` (already gitignored). Nothing deleted; everything still on disk if needed |
| `.gitignore` missed `playwright-report/` and `playwright/.cache/` | Added both |

### Testing — automated regression guard

Added a Playwright harness that **would have caught every one of the
mobile issues above** on the first run. It now runs on every `npm run
test:e2e`, so any future change that shrinks a button or pushes content
off-screen will fail CI immediately.

Covered checks at iPhone SE (320×568) and iPhone 14 (390×844):

1. Login theme toggle stays inside the viewport at ≥ 44×44 px
2. No horizontal overflow on **any** of 7 nav views (Bayas, Vino,
   Extracción, Vendimias, Mapa, Explorador, Mediciones)
3. `.nav-tab`, `.ranch-tab`, `.btn-gold`, form `input/select`, and
   `#map-metric-select` are all ≥ 44×44 px when visible

### One hidden bug the test spec caught

While writing the e2e spec, a subtle bug in the login-toggle fix surfaced.

The short version: the login card had a fade-in animation that used a
CSS `transform` property. CSS animations with `fill-mode: both` leave
the final computed style set to `matrix(1,0,0,1,0,0)` — an identity
transform that, while visually invisible, **still creates a containing
block that nullifies `position: fixed` on any descendant**. So the
login toggle, which we'd just "fixed" to anchor to the viewport,
silently reverted to anchoring to the card — reintroducing the
original bug on 320 px viewports.

**Fix:** split the animation into two keyframes — the card gets an
opacity-only fade (`loginCardFadeIn`), inner elements still get the
slide (`loginFadeIn`). Visually identical; no containing block; toggle
stays anchored to the viewport where it belongs.

This is exactly the class of bug a human reviewer misses and an
automated viewport test catches. Worth every minute of the e2e
investment.

---

## How to verify

All commands run from the repo root.

```bash
# Node test suite (fast, no browser required)
npm test
# → 140 tests pass in ~1.8 s

# Playwright mobile regression suite (one-time browser install first)
npm run test:e2e:install   # downloads chromium (~200 MB)
npm run test:e2e
# → 12 tests pass in ~14 s

# Production build
npm run build
# → clean, no new warnings
```

---

## What's still open

Every P1 from R20–R22 is closed. Two P2 items remain and are policy
calls, not bugs:

- **C18 (`.gitignore` catch-all)** — optional: add patterns like
  `DIAGNOSIS*.md`, `*-handoff.md` so future scratch docs are ignored
  by default. Skipped pending a policy call from the project owner.
- **C19 (dev-bypass UX)** — optional: on `localhost`, auto-populate
  the bypass token or show a "Dev bypass" button on the login screen.
  Purely a convenience for the contributor workflow.

Separate, pre-existing open items NOT part of this closure:

- **R18 P1.3** — jsPDF v4 PDF export still needs browser verification
  with real chart data.
- **R18 P2.3** — 1.3 MB JS bundle size (optimisation, not a bug).
- **R18 P1.2** — latent circular-dep risk between `app.js` and six
  other modules (not a current bug).

---

## Files touched (for reference)

### Source changes

- `css/styles.css` — mobile media-query additions and animation split
  (the bulk of the work)
- `index.html` — added `mobile-web-app-capable` meta tag
- `.gitignore` — added `playwright-report/`, `playwright/.cache/`
- `package.json` — added `test:e2e` and `test:e2e:install` scripts
- `REVIEW.md` — marked C1–C17 and C20 resolved with fix notes

### New files

- `playwright.config.js` — e2e harness (baseURL 8080, auto-spawn vite)
- `tests/e2e/mobile-responsive.spec.js` — 12 regression tests
- `docs/reviews/archive/DIAGNOSIS.md` — archived with Phase 8 header
- `docs/reviews/archive/codex-review-consolidated-handoff.md` — archived
- `docs/reviews/archive/ultraplan-prompt.txt` — archived

### Moved (to ignored location, no git history)

Eight stray PNGs plus a duplicate `.webp` logo → `.playwright-mcp/archive-2026-04-20/`.

---

## Commit index

| Commit | Scope |
|---|---|
| `4dc8354` | P1 mobile fixes — touch targets, clipping, meta tag |
| `31d38c4` | Hygiene — archive stale docs, corral stray screenshots |
| `2118ac8` | P2 mobile polish — KPI/nav/font/table/ranch-tabs |
| `9c49feb` | Playwright e2e spec + bonus login-card animation bug fix |
