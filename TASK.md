# Task — Current State

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
| F0 | Vite migration | Replace CDN scripts with npm packages, ES modules, Vite dev/build | **In Progress** — branch `feat/vite-migration`, needs browser smoke test |
| F1 | Explorer line connections | Per-slot "Conectar Lineas" toggle on scatter charts | **Done** (`5f933e2`) |
| F2 | Explorer per-chart export | PNG/PDF export button per explorer chart slot, with legend | **Done** (`7f500b9`) |
| F3 | Page-wide export | "Exportar Vista" on all dashboard views — PNG vertical stack / multi-page PDF with legend | **Done** (`d067072`, `f506fe9`) |
| F4 | Explorer chart resize + legend | Expand/compact toggle, clickable legend bar below each chart | **Done** (`2fdcf50`, `185d65e`) |
| F4b | Explorer lot picker | Searchable multi-select lot picker when groupBy = Lote | **Done** (`7b9213f`) |
| F5 | Weather time aggregation | Toggle day/week/month on weather charts | **Pending** |
| F6 | Weather multiple timeframes | Selectable date ranges beyond fixed Jul–Oct | **Pending** |
| F7 | Satellite vineyard map | Leaflet-based satellite view with quality heatmap overlay | **Future** — deferred |
| F8 | Weather forecast integration | Show future weather predictions | **Future** |
| F9 | Lot categorization (monovarietal vs mix) | Chemical-value-based lot classification | **Bookmarked** |
| F10 | Lot performance percentile ranking | Rank lots vs historical same-lot data | **Future** |

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

### Pending (Sub-project 2: Weather Enhancements)

**F5 — Weather time aggregation:** Day/week/month toggle on weather charts
**F6 — Weather timeframes:** Selectable date ranges beyond fixed Jul–Oct

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

## Tests — 72/72 Passing (6 suites)

| ID | Scope | Tests | Status |
|----|-------|-------|--------|
| MT.2 | Deterministic jitter function in `charts.js` | 8 | **Pass** |
| MT.3 | `verifyToken()` shared module | 13 | **Pass** |
| MT.4 | `rateLimit()` | 9 | **Pass** |
| MT.5 | Valley selector flow | 10 | **Pass** |
| MT.6 | Canonical seq + extractLotCode | 13 | **Pass** |
| MT.7 | Column whitelist + required fields | 19 | **Pass** |

Run: `npm test` or `node --test tests/*.test.mjs`

### Removed

| ID | Reason |
|----|--------|
| MT.1 | Superseded by MT.6 — tested old row-order seq algorithm |

---

## Open Items (from Round 16 Review)

| ID | Issue | Status |
|----|-------|--------|
| R16.P1.1 | `lotCode = sampleId` breaks `CONFIG.berryToWine` mapping (extraction charts) | **Done** (`27b7f94`) |
| R16.P1.2 | `lotCode = sampleId` breaks vineyard map section resolution | **Done** (`27b7f94`) |
| R16.P2.2 | `Number()` vs `parseFloat` for comma-separated thousands — low risk | **Noted** |
