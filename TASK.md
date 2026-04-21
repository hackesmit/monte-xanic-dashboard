# Task — Current State

> **Last synced:** 2026-04-20 — PLAN/REVIEW/TASK aligned with `main` through `146b50b`. Branch is 1 commit ahead of `origin/main` (push pending user approval).

## Phase 9: Explorer Enhancements, Weather Timeframes, Satellite Map & Analytics Foundations

### Goal

Evolve the dashboard from a reporting tool into an interactive analytics platform. Enhance the Explore page with export, tables, and line-connected graphs. Add time-aggregation controls to weather charts. Introduce a satellite-based vineyard map with quality overlays. Lay groundwork for future lot categorization and performance ranking.

### Constraints

- No npm packages or build tools. CDN only (Leaflet CDN for satellite map).
- All UI labels in Spanish.
- All units metric.
- Mobile responsive.
- Vanilla JS ES6 only. No frameworks.
- Maintain Chart.js 4.4.1 and SheetJS 0.18.5 compatibility.
- File responsibility boundaries (CLAUDE.md) must be respected.
- Existing 72/72 tests must not break.

### Features

| # | Feature | Scope | Status |
|---|---------|-------|--------|
| F0 | Vite migration | Replace CDN scripts with npm packages, ES modules, Vite dev/build | **Done** — merged to `main`, browser-verified, Rounds 18–19 closed |
| F0b | Mobile hardening | 44×44 touch targets, tap-target / overflow fixes, e2e regression spec | **Done** — 17 of 20 punch-list corrections closed (Rounds 20–24) |
| F1 | Explorer line connections | Per-slot "Conectar Lineas" toggle on scatter charts | **Done** (`5f933e2`) |
| F2 | Explorer per-chart export | PNG/PDF export button per explorer chart slot, with legend | **Done** (`7f500b9`) |
| F3 | Page-wide export | "Exportar Vista" on all dashboard views — PNG vertical stack / multi-page PDF with legend | **Done** (`d067072`, `f506fe9`) |
| F4 | Explorer chart resize + legend | Expand/compact toggle, clickable legend bar below each chart | **Done** (`2fdcf50`, `185d65e`) |
| F4b | Explorer lot picker | Searchable multi-select lot picker when groupBy = Lote | **Done** (`7b9213f`) |
| F5 | Weather time aggregation | Toggle day/week/month on weather charts | **Done** (`b7d6b48`) |
| F6 | Weather multiple timeframes | Selectable date ranges beyond fixed Jul–Oct | **Done** (`b7d6b48`) |
| F7 | Satellite vineyard map | Leaflet-based satellite view with quality heatmap overlay | **Future** — deferred |
| F8 | Weather forecast integration | Open-Meteo 7/16-day, on-demand dashed overlay on all 4 weather charts | **Done** (`4a6e80a`) |
| F9 | Lot quality classification (A+/A/B/C + percentile) | Berry+mediciones → rubric-based grade per lot, tonnage-weighted per section on the map | **Done** — branch `feat/quality-classification` |
| F10 | Lot performance percentile ranking | Rank lots vs historical same-lot data | **Partial** — percentile shipped with F9; historical-cohort toggle deferred |

### Files Likely Involved

| File | Features |
|------|----------|
| `package.json` | F0 |
| `vite.config.js` (new) | F0 |
| `vercel.json` | F0 |
| `index.html` | F0, F1–F6 |
| `js/*.js` (all 15 files) | F0 (ES module conversion) |
| `tests/*.test.mjs` | F0 (import from source) |
| `CLAUDE.md` | F0 |
| `js/explorer.js` | F1, F2, F3, F4 |
| `js/charts.js` | F1, F2, F3, F5 |
| `js/weather.js` | F5, F6, F8 |
| `js/maps.js` | F7 |
| `js/config.js` | F5, F6, F7, F9, F10 |
| `js/events.js` | F2, F3, F4, F5, F6, F7 |
| `js/tables.js` | F4 |
| `js/dataLoader.js` | F9, F10 |
| `index.html` | F1–F7 (HTML structure, CDN scripts) |
| `css/styles.css` | F1–F7 (styling) |

### What Shipped (Sub-project 1: Explorer Enhancements)

**F1 — Per-slot line toggle:**
- "Conectar Lineas" button per explorer chart slot
- Toggles `showLine` on datasets in-place (preserves hidden series state)
- Bar charts unaffected

**F2 — Per-chart export with legend:**
- ⤓ button on each explorer slot opens PNG/PDF menu
- Title derived from axis labels (e.g., "Brix vs Dias Post-Envero")
- Export includes chart image + color-coded legend below chart
- Export menu positioned correctly within explorer slots

**F3 — Page-wide export with legend:**
- "Exportar Vista" button on berry, wine, extraction, vintage, explorer, mediciones views
- PNG: vertical stack of all visible charts with branded header, legend per chart, watermark
- PDF: title page + one page per chart with preserved aspect ratio, legend, watermark
- Map view skipped (SVG-to-canvas deferred)

**F4 — Chart resize + legend:**
- ⛶ expand/compact toggle per slot (280px ↔ 500px) with CSS transition
- Clickable legend bar below each chart showing color-coded group names
- Click legend item to toggle dataset visibility (dimmed state)

**F4b — Searchable lot picker:**
- "Lote" added as groupBy option (berry: lotCode, wine: codigoBodega)
- Searchable multi-select picker: type to filter, checkboxes, "Todo"/"Limpiar" bulk actions
- Only selected lots render on chart, hash-based colors per lot

**Additional fixes shipped:**
- Localhost auth bypass when /api/verify unreachable (`d36b3b2`)
- Line toggle preserves hidden dataset state (`63b37b0`)

### What Shipped (Sub-project 3: Mobile Hardening — Rounds 20–24)

Commits: `cb76a24`, `4dc8354`, `31d38c4`, `2118ac8`, `9c49feb`. REVIEW.md Rounds 20–24 capture the audit trail.

**Repo hygiene (`cb76a24`, `31d38c4`):**
- `.gitignore`: `.playwright-mcp/`, `.superpowers/` added (C1)
- `DIAGNOSIS.md`, `codex-review-consolidated-handoff.md`, `ultraplan-prompt.txt` → `docs/reviews/archive/` with RESOLVED-in-Phase-8 headers (C2)
- Brand logo duplicates and theme/mobile screenshots moved into gitignored `.playwright-mcp/archive-2026-04-20/` (C8)
- `_applyDaysJitter` unexported; `public/theme-init.js` trailing newline; MT.9 encoding-normalization tests added (22 cases)

**Touch targets and overflow fixes at `@media (max-width: 768px)` (`4dc8354`, `2118ac8`):**
- `.login-theme-toggle` → 44×44 fixed, z-index above card (C3)
- Per-chart `.chart-export-btn` hidden on mobile; section-level "Exportar Vista" remains (C4)
- `.explorer-slot-header` flex-wraps; actions row drops to full width; `.explorer-summary` truncates with ellipsis (C5, C14)
- `.btn-gold` → min-height 44 px (C6)
- `.ranch-tab` → min-height 44 px (C7)
- `.kpi-row` → `repeat(auto-fit, minmax(100px, 1fr))`, no orphan cell (C9)
- `.nav-tab` → 25 % basis (4+3 layout), font-size 8 → 10 px (C10, C11)
- `mobile-web-app-capable` meta tag added alongside the deprecated Apple one (C12)
- `.table-scroll` right-edge inset shadow as horizontal-scroll affordance (C13)
- `.form-group` input/select → 44 px tall, font-size 16 px (prevents iOS Safari auto-zoom) (C15)
- `.ranch-tabs` → horizontal scroll strip with scroll-snap (C16)
- `#map-metric-select` → min-height 44 px (C17)

**Root-cause fix for C3's residual clipping (`9c49feb`):**
- `.login-card` ran `animation: loginFadeIn` whose `transform: translateY(...)` keyframe ended as `matrix(1,0,0,1,0,0)` — an identity transform that still establishes a containing block for fixed descendants, anchoring `.login-theme-toggle` to the card instead of the viewport
- Split the keyframe: `.login-card` now runs opacity-only `loginCardFadeIn`; inner elements still slide via `loginFadeIn`
- Verified at 320×568: toggle now at `{x:264, y:12, w:44, h:44}`, `fullyVisible: true`, card `transform: none`

**Regression suite (`9c49feb`):**
- `tests/e2e/mobile-responsive.spec.js` (Playwright) iterates iPhone SE 320×568 and iPhone 14 390×844
- Asserts: login toggle inside viewport + ≥ 44×44, no horizontal page overflow on any nav view, nav-tab/ranch-tab/form-input/btn-gold/map-metric-select ≥ 44 px
- Runs via `npm run test:e2e` (kept out of `npm test` so node-test stays browser-free at ~1.8 s)
- 12/12 passing locally

**Deferred by design:**
- C18 (catch-all gitignore for ad-hoc top-level docs) — redundant now that the archive exists
- C19 (`?dev=1` bypass UX) — e2e spec already seeds the bypass via `context.addInitScript`

**New observation from Round 23/24:** The `#weather-forecast-toggle` / `#weather-forecast-horizon` controls I flagged were actually F8 (weather forecast overlay) shipped in `4a6e80a` — the feature itself is done, MT.10 covers 22 test cases (parsing, eligibility, TTL cache, horizon coercion, multi-valley isolation). Only the mobile-width touch-target bump to 44 px remains; not covered by the e2e spec.

### What Shipped (Sub-project 2: Weather Enhancements)

**F5 — Weather time aggregation:**
- Día/Semana/Mes dropdown next to valley selector
- `WeatherStore.aggregate()` groups daily data: temps averaged, rainfall summed, GDD preserved
- All 4 weather charts support aggregation (temp, rain, GDD, valley comparison)
- Larger point radius for aggregated data (visual clarity)

**F6 — Weather selectable timeframes:**
- Temporada (Jul–Oct), Año Completo (Jan–Dec), Últimos 30 Días, Personalizado
- Custom date picker with inline `<input type="date">` inputs
- Dynamic sync fetches extended ranges from Open-Meteo when timeframe changes
- Section title updates to reflect active timeframe + valley
- GDD chart always uses season range (Jul–Oct) — domain-appropriate for viticulture
- 30d/custom modes show single "Reciente"/"Personalizado" dataset (no vintage overlay)

### What Shipped (Sub-project 4: Quality Classification & True Quality Map)

Branch: `feat/quality-classification` (pending merge). Spec in `docs/superpowers/specs/2026-04-21-quality-classification-design.md`; plan in `docs/superpowers/plans/2026-04-21-quality-classification.md`.

- `js/classification.js` (new) — pure scoring engine: rubric + valley resolution, threshold bucketing (`le-a-le-b` / `ge-a-ge-b` / `range`), weighted sum, madurez ±3 overlay, partial-data guard at ≥ 60 Imp, per-variety peso overrides, percentile within cohort (default `vintage-variety`), tonnage-weighted `aggregateSection`.
- `CONFIG.rubrics` (7 entries: PV-DUR-VON, CS-SY-MAL-MRS-TEM-VON, CS-SY-VDG, MER-CF-GRE-CALADOC-VON, GRE-CALADOC-VDG-VSV, SB-VDG-VON, CH-CB-SBGR-VDG-VON) plus `varietyRubricMap`, `valleyPatterns`, `sanitaryThresholds`, `madurezOverlay`, `gradeColors`.
- `DataStore.joinBerryWithMediciones()` — attaches `row.medicion = { health_*, tons_received, phenolic_maturity }` to each berry via `(lotCode, vintage)` lookup; translates camelCase `_rowToMedicion` fields into the snake_case contract the engine expects. Hooked into `_enrichData()` + `loadMediciones()`. Cache-path `app.js` now also fires `loadMediciones()`.
- `maps.js` — new `calidad` metric (default), discrete A+/A/B/C + Sin-clasificar coloring, SVG `<title>` per-lot tooltip, detail-panel grade row with percentile pill and expandable `<details>` breakdown, legend swap.
- `mediciones.js` + `index.html` — new `Madurez Fenólica (opcional)` select in the form and `Madurez` column in the table with short labels. `api/upload.js` whitelist + MT.7 test mirror updated.
- `sql/migration_phenolic_maturity.sql` — adds nullable `phenolic_maturity TEXT CHECK (…)` to `mediciones_tecnicas`. **Apply manually in Supabase SQL editor before the form is exercised in production.**
- MT.11 (41 cases) green. Total `npm test` 181/181; `npm run test:e2e` 12/12.

**Known limitation (follow-up):** The rubrics scored by the engine expect `polyphenols`, `anthocyanins`, `av`, and `ag` fields on each berry row. The current `supabaseToBerryJS` mapping doesn't expose them (`av`/`ag` live on `tank_receptions`; polyphenols is unmapped). On live data, lots fall below the 60-Imp threshold and render as gray "Sin clasificar" across every section. A follow-up should either (a) map `tANT → anthocyanins` + `ipt → polyphenols` in the berry pipeline, (b) join tank-reception chem back to berry rows, or (c) lower the partial-data threshold. The engine correctly handles partial data today; this is a data-wiring gap, not an engine bug.

---

## Project Status: Phases 1–8 Complete

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Deploy Online (Vercel) | Done |
| 2 | Database Migration (Supabase) | Done |
| 3 | Meteorology Integration | Done |
| 4 | Authentication (bcrypt + HMAC, 2h tokens) | Done |
| 4b | Data & Visualization Overhaul | Done |
| 4c | Stability, Security & Viz Improvements | Done |
| 5 | Vineyard Quality Map (SVG) | Done |
| 6 | Polish (login, PDF, mobile, trends, radar, harvest calendar) | Done |
| — | Security Hardening (server upload, rate limits, token blacklist) | Done |
| — | Review Rounds 1–10 (all findings triaged) | Done |
| — | Waves 1–7 (all review findings resolved) | Done |
| 7 | Mediciones Tecnicas (form, table, charts) | Done |
| — | Remove always-on lot-line plugin from scatter charts | Done |
| 8 | Deterministic Berry Identity & Pipeline Hardening | Done |
| **9** | **Explorer Enhancements, Weather Timeframes, Satellite Map** | **In Progress** |

---

## Tests — 140/140 node + 12/12 Playwright e2e Passing

| ID | Scope | Tests | Status |
|----|-------|-------|--------|
| MT.2 | Deterministic jitter function in `charts.js` | 8 | **Pass** |
| MT.3 | `verifyToken()` shared module | 13 | **Pass** |
| MT.4 | `rateLimit()` | 9 | **Pass** |
| MT.5 | Valley selector flow | 10 | **Pass** |
| MT.6 | Canonical seq + extractLotCode | 13 | **Pass** |
| MT.7 | Column whitelist + required fields | 19 | **Pass** |
| MT.8 | Weather aggregation, date ranges, ISO weeks | 24 | **Pass** |
| MT.9 | Encoding normalization (U+FFFD, double-encoded UTF-8 mojibake) | 22 | **Pass** |
| MT.10 | Weather forecast (Open-Meteo parsing, eligibility, TTL cache, horizon coercion) | 22 | **Pass** |
| E2E  | Mobile-responsive Playwright spec (320×568 + 390×844) | 12 | **Pass** |

Node suite: `npm test` (~1.8 s, browser-free).
E2E suite: `npm run test:e2e:install` (one-time), then `npm run test:e2e` (~15 s, needs chromium).

### Removed

| ID | Reason |
|----|--------|
| MT.1 | Superseded by MT.6 — tested old row-order seq algorithm |

---

## Open Items

### Round 16 Review

| ID | Issue | Status |
|----|-------|--------|
| R16.P1.1 | `lotCode = sampleId` breaks `CONFIG.berryToWine` mapping (extraction charts) | **Done** (`27b7f94`) |
| R16.P1.2 | `lotCode = sampleId` breaks vineyard map section resolution | **Done** (`27b7f94`) |
| R16.P2.2 | `Number()` vs `parseFloat` for comma-separated thousands — low risk | **Noted** |

### Rounds 18–19 Review (Vite migration)

| ID | Issue | Status |
|----|-------|--------|
| R18.P1.1 | Inline theme-restore script blocked by tightened CSP | **Done** (`d9c7010`) |
| R18.P1.2 | Circular deps `app.js ↔ {auth,filters,charts,tables,events,upload}.js` | **Noted** — safe today; future `state.js` refactor |
| R18.P1.3 | jsPDF 2.5.1 → 4.2.1 major jump — browser rendering untested | **Noted** — browser-verified light path; PDF-on-mobile Safari still open |
| R18.P2.1 | `_applyDaysJitter` unnecessarily exported | **Done** (`cb76a24`) |
| R18.P2.3 | 1.3 MB main bundle warning | **Noted** — code-split follow-up |
| R19.missing-tests | Encoding normalization untested | **Done** — MT.9, 22 tests (`cb76a24`) |

### Rounds 20–24 Review (Mobile hardening)

| ID | Issue | Status |
|----|-------|--------|
| C1  | `.gitignore` missing `.playwright-mcp/` + `.superpowers/` | **Done** (`cb76a24`) |
| C2  | Stale DIAGNOSIS / handoff / ultraplan docs at repo root | **Done** — archived (`31d38c4`) |
| C3  | Login theme toggle 36×17, clipped above viewport at 320 px | **Done** — fixed animation-transform root cause (`9c49feb`) |
| C4  | Chart export `⤓` buttons 18×14 px | **Done** — hidden on mobile (`4dc8354`) |
| C5 / C14 | Explorer slot actions render off-screen at 390 px | **Done** — flex-wrap + ellipsis (`4dc8354`) |
| C6  | `.btn-gold` "Guardar Medicion" 26 px tall | **Done** — min-height 44 (`4dc8354`) |
| C7  | `.ranch-tab` 24 px tall | **Done** — min-height 44 (`4dc8354`) |
| C8  | Brand logo duplicates + theme/mobile PNGs at repo root | **Done** — archived (`31d38c4`) |
| C9  | KPI grid orphan cell at 320 px | **Done** — auto-fit minmax (`2118ac8`) |
| C10 | 7 nav tabs orphan MEDICIONES on its own row | **Done** — 4+3 layout (`2118ac8`) |
| C11 | Nav tab font-size 8 px | **Done** — bumped to 10 px (`2118ac8`) |
| C12 | Deprecated `apple-mobile-web-app-capable` warning | **Done** — added `mobile-web-app-capable` (`4dc8354`) |
| C13 | Table horizontal scroll has no visual affordance | **Done** — inset shadow (`2118ac8`) |
| C15 | Mediciones inputs 31–33 px + 13 px font (iOS auto-zoom) | **Done** — 44 px + 16 px font (`4dc8354`) |
| C16 | Ranch tabs wrap into 3–4 rows at mobile | **Done** — horizontal scroll-snap strip (`2118ac8`) |
| C17 | `#map-metric-select` 34 px tall | **Done** — min-height 44 (`4dc8354`) |
| C20 | No automated mobile-viewport regression tests | **Done** — `tests/e2e/mobile-responsive.spec.js`, 12/12 (`9c49feb`) |
| C18 | Optional gitignore catch-all for ad-hoc root docs | **Deferred** — archive makes this redundant |
| C19 | Optional `?dev=1` bypass UX | **Deferred** — e2e spec already seeds via `addInitScript` |
| R24.weather | `#weather-forecast-toggle` inline `font-size:11px; padding:3px 10px` → 18–20 px on mobile | **Open** — F8 shipped (`4a6e80a`); mobile-touch-target bump to 44 px still pending |
