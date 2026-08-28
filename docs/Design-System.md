# Design System

The dashboard's visual language, expressed as CSS custom properties in
`css/styles.css`. Enforced by `tests/design-system.test.mjs` (MT.50), which runs
as part of `npm test`.

**The rule: never write a literal where a token exists.** Every inconsistency
found in the August 2026 audit was introduced by a feature built after the
original dashboard, and none of it was caught, because nothing checked. The
guard test is what makes this document real rather than aspirational.

## Identity

Sharp, editorial, engraved. The reference is a wine label, not a chat app.
Uppercase letterspaced Sackers Gothic on near-black, with a single gold accent
carrying every interactive state. When a new component could go either way,
choose the sharper, quieter option.

## Color

41 semantic tokens, defined for dark in `:root` and redefined for light under
`[data-theme="light"]`. Names describe role, not appearance, which is why
theming works at all.

| Token | Role |
|---|---|
| `--black` / `--white` | **Inverting pair.** `--black` is `#000` in dark and `#FFF` in light. Use for text that must contrast with a fill in both themes. |
| `--near-black`, `--surface`, `--card`, `--card2` | Ground layers, back to front |
| `--border`, `--border-gold` | Hairlines |
| `--gold`, `--gold-lt`, `--gold-dim` | Accent and its states |
| `--text`, `--muted`, `--cream` | Type |
| `--flag-error/warning/alert/info` | Semantic status |
| `--success-color`, `--error-color`, `--diff-positive`, `--diff-negative` | Data deltas |

### Deliberately exempt: fixed data palettes

These encode identity, not theme, and must **not** follow the light/dark
switch. A Cabernet is the same colour on both grounds.

- Varietal colours (`CONFIG.varietyColors`) and origin colours
  (`CONFIG.originColors`) in `js/config.js`
- Quality grade chips (`.grade-chip.grade-*`)
- Harvest block categories (`.hb-*`)
- Predictor confidence badges (`.pred-badge-*`)

These carry an explicit text colour so they read on any ground.

### The failure mode to avoid

A component written light-only, with hardcoded hex or
`var(--token, #fallback)` naming a token that does not exist. CSS does not
warn: the fallback wins forever, and the component sits as a white island in
dark mode, usually with themed text on top of it, which is unreadable rather
than merely ugly. This shipped four separate times before the audit caught it.

`tests/e2e/theme.spec.js` guards the views that were affected; MT.50 fails on
any `var()` naming an undefined token.

## Shape

Four steps. The scale tops out at 8px on purpose.

| Token | Value | Use |
|---|---|---|
| `--radius-sharp` | 2px | Chips, inputs, tags, small controls |
| `--radius-base` | 4px | Cards, buttons, panels |
| `--radius-panel` | 8px | Modals, sheets, floating surfaces |
| `--radius-round` | 50% | Avatars, FAB |

Previously 12 ungoverned values from 2px to 16px. The split was chronological:
the core dashboard was sharp, everything added later was rounded, and the Mona
tab read as a different product. Mona now uses the same scale.

## Type

Nine steps, replacing 19 ad hoc pixel values.

| Token | Value | Use |
|---|---|---|
| `--text-2xs` | 8px | Micro labels |
| `--text-xs` | 9px | Dense uppercase labels |
| `--text-sm` | 11px | Default label. The most common size. |
| `--text-md` | 13px | Body copy, table cells |
| `--text-lg` | 16px | Sub-headings, form inputs |
| `--text-xl` | 20px | Card headings |
| `--text-2xl` | 24px | View headings |
| `--text-3xl` | 30px | Display |
| `--text-4xl` | 48px | Hero numerals |

**16px is a floor for anything focusable on mobile.** iOS Safari zooms the
viewport when a focused text control computes below 16px and never zooms back
out. See the mobile block at the end of `css/styles.css`.

### Font stacks

| Token | Value |
|---|---|
| `--font-display` | `'Sackers Gothic Medium', sans-serif` |
| `--font-body` | `sans-serif` |
| `--font-mono` | `ui-monospace, Menlo, Consolas, monospace` |

22 rules previously named the family with no fallback, so a failed font load
would have dropped them to the browser serif while the other 32 stayed sans.

> **`@font-face` is the one exception.** Its `font-family` descriptor is the
> face's *registration name*, not a lookup. A `var()` there is invalid and
> silently prevents the font from loading at all, dropping the entire app to
> the fallback sans while every other test still passes. MT.50 guards this
> specifically.

## Motion

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 120ms | Hover, focus, chip toggles |
| `--motion-base` | 200ms | Default state transitions |
| `--motion-slow` | 320ms | View transitions, sheet open/close |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default |
| `--ease-entrance` | `cubic-bezier(0.16, 1, 0.3, 1)` | Things appearing |

A `prefers-reduced-motion` block collapses all durations to `0.01ms`, so
anything using these tokens respects the user's setting for free.

Named keyframe choreography (`loginFadeIn`, `sheetSlideUp`, `spin`, `mona-in`)
is exempt and may keep literal durations: it is a sequence, not interaction
feedback.

## Scoping

**Scope view-specific CSS to a container selector.** The predictor view defined
a bare `.chip` rule. Because it sat later in the file than the themed filter
chips, it overrode them globally, and the sidebar's Varietal and Origen chips
rendered as white pills in both themes. It is now `.chip-bar .chip`.

Anything owned by one view gets a container prefix, or a name that cannot
collide.

## Mobile

Touch rules live in the "Mobile touch pass" block at the end of
`css/styles.css` and a matching block in `css/mona.css`, guarded by
`tests/e2e/mobile-responsive.spec.js`:

- 44px minimum for anything tappable (Apple HIG; Material asks 48dp)
- 16px minimum font on focusable text controls (iOS zoom)
- `@media (hover: none)` for anything revealed on `:hover`, which a touch
  device can never satisfy
- `env(safe-area-inset-*)` with `viewport-fit=cover`, since the app declares
  itself home-screen capable with a translucent status bar
- `100dvh`, not `100vh`, for full-height surfaces

## Adding to the system

Extending a scale is a decision worth making deliberately. Add the token to
`:root`, add its value to the corresponding `SCALE` set in
`tests/design-system.test.mjs`, and note why here. Adding a value *without*
updating the test is what the test exists to prevent.
