# Motion Layer + Modal Polish — Design

**Date:** 2026-05-14
**Branch:** `feat/motion-tokens-and-modal-fixes`
**Status:** Audit approved; implementation in progress through Step 2. Step 3 awaits user review.

## Goal

Add a subtle, considered motion layer to the dashboard ("the interface feels considered", not "things slide around") and fix the most visible coherence bug en route (edit modals open at top-left instead of centered).

## Constraints (binding)

- Vanilla JS ES modules only. No frameworks.
- No new animation engines (GSAP, Framer Motion, anime.js, etc).
- CSS transitions/animations and the Web Animations API only.
- One soft exception: the dotlottie web component, used as a *player* for a specific JSON format (not as an animation runtime).
- Strict CSP: no inline styles, no inline handlers. All event wiring routes through `js/events.js` delegation.
- No Supabase/auth or Chart.js data config changes. Work happens in `css/styles.css` and JS that toggles classes.
- All UI labels in Spanish. Metric units. Mobile responsive.
- Respect `prefers-reduced-motion`.

## Audit findings (Step 1)

### Motion inventory
- 41 CSS transitions, with 10 distinct durations in use (100–800ms) and mixed easings — drift to be consolidated.
- 6 keyframe blocks: `spin`, `sheetSlideUp`, `sheetSlideDown`, `loginCardFadeIn`, `loginFadeIn`, `loginGlow`.
- 0 WAAPI calls.
- 19 Chart.js instances, all `animation: { duration: 300 }`; legend toggle uses 400ms.
- `prefers-reduced-motion` already implemented globally at `styles.css:1987`.
- No conflicts; no auto-loops; class-toggle-driven throughout.

### Visual diagnostic
- **Modal top-left bug, root cause:** global `* { margin: 0 }` reset at `styles.css:86` defeats UA stylesheet's `margin: auto` centering on native `<dialog>` elements. All four edit modals (`.row-edit-modal`) are affected: berry, wine, preferment, mediciones.
- Modal hygiene gaps: no body scroll lock, no focus trap, no autofocus on first field, no click-outside-backdrop close.
- Cosmetic bug: `font-family: 'Jost'` declared twice (`styles.css:1654`, `:2251`) but `@font-face` for Jost is never defined — silent fallback to `sans-serif`.

## Implementation order

### Commit 1 — Modal centering fix
Add to `css/styles.css`:
```css
dialog[open] { inset: 0; margin: auto; }
```
Fixes all four edit modals. One line, no JS change.

### Commit 2 — Modal hygiene
- New shared module `js/modalHygiene.js` exporting `lockBodyScroll`, `unlockBodyScroll`, `trapFocus`, `autofocusFirstField`, `attachModalHygiene`. Used by both `rowEditor.js` and `mediciones.js` so behaviour is identical across all five edit modals.
- CSS: `body.modal-open` toggles iOS-safe scroll lock (`position: fixed` + restored `scrollY` via `--modal-scroll-y` custom property).
- `js/rowEditor.js`: calls `attachModalHygiene(modal, { firstFieldId, onDismiss })` on open. Helper attaches Tab focus-trap, ESC + backdrop dismiss (routed to `RowEditor.close()` so dirty-state confirm fires), and auto-detaches on the dialog's native `close` event.
- `js/mediciones.js`: calls `attachModalHygiene(modal, { firstFieldId: 'med-edit-date' })` — ESC + backdrop are already routed through `closeEditModal()` in `js/events.js:462-471`, so only scroll lock + focus management are added.
- Replace dead `font-family: 'Jost'` declarations at `styles.css:1656` and `:2253` with `sans-serif` (Jost has no `@font-face` so the browser was already silently falling back to `sans-serif`).

### Commit 3 — Lottie integration
- Move `WIne Grapes.json` → `assets/animations/wine-grapes-loader.json` (also delete the duplicate `.lottie` binary or keep the JSON as canonical).
- `npm install @lottiefiles/dotlottie-wc`.
- Import the web component in `js/app.js`.
- Replace `.spinner-ring` markup on login screen with `<dotlottie-wc src="..." autoplay loop>`.
- Keep `.spinner-ring` styles in place as a fallback should the Lottie fail to load.

### Commit 4 — Motion tokens (Step 2)
Add to `:root` in `css/styles.css`:
```css
:root {
  --motion-fast:   120ms;   /* micro-interactions (hover, focus, chip toggles) */
  --motion-base:   200ms;   /* default for state transitions */
  --motion-slow:   320ms;   /* view transitions, sheet open/close */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);   /* default — flat, fast settle */
  --ease-entrance: cubic-bezier(0.16, 1, 0.3, 1); /* decel for entrances */
}
```
**Define only. Do NOT migrate the 41 existing transitions yet.** Migration happens in Step 3.

## What is NOT in this branch

- Step 3a (view transitions between dashboard panels) — pending Step 2 review
- Step 3b (Chart.js animation polish) — pending Step 2 review
- Step 3c (micro-interactions) — pending Step 2 review
- Step 3d (loading-state polish beyond Lottie integration) — pending Step 2 review
- Any redesign work outside the motion layer

## Verification

- `npm test` passes
- `npm run build` passes
- Manual smoke: load login, see Lottie loader; log in; open berry-table row → modal centered, body scroll locked, first field focused, click outside closes, Tab cycles within modal
- DevTools: simulate `prefers-reduced-motion: reduce` and confirm motion disables

## Rollback

Each commit is independently revertable. Modal fixes are CSS+small JS additions, easily backed out. Lottie integration touches `package.json`; revert reverts the dependency. Token additions are purely additive (`:root` properties).
