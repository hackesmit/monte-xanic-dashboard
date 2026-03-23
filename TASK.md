# Task — Stability, Security & UX Fixes

## Goal
Implement the prioritized fixes from REVIEW.md (Workflow 2 findings) and the remaining items from Workflow 1 (TASK.md Tier A/B improvements). Fix security vulnerabilities first, then race conditions, then data integrity, then UX polish.

## Constraints
- All user-facing text must be in Spanish
- No npm packages or build tools — CDN only, Vanilla JS ES6
- Every change must be mobile responsive
- Preserve Chart.js 4.4.1 and SheetJS 0.18.5 compatibility
- Follow CLAUDE.md file responsibility rules strictly
- Do not introduce over-engineering — minimal targeted fixes only

## Files Likely Involved
| File | Changes |
|------|---------|
| `js/tables.js` | XSS fix (5.1), below_detection marker (A4) |
| `api/login.js` | Rate limit cleanup (A3), IP extraction fix (4.2) |
| `js/auth.js` | Role fallback to 'viewer' (4.3) |
| `js/app.js` | Refresh guard (2.1), observer disconnect on view switch (2.2), empty states (B1) |
| `js/charts.js` | Observer disconnect (2.2/2.4), canvas visibility check, try/catch (A2), cache cleanup (5.2), empty states (B1) |
| `js/weather.js` | Sync guard (2.3), API validation (6.1), negative rainfall (6.3) |
| `js/kpis.js` | pH filter consistency (5.4), empty states (B1) |
| `js/filters.js` | Stale lot validation (3.1), filter chips rebuild (3.2) |
| `js/upload.js` | Header validation error (1.1), vintage guard (1.2), staged changes to commit |
| `css/styles.css` | Loading spinner animation (B3), empty state styling |

## Files to Avoid
- `js/config.js` — no changes needed
- `js/dataLoader.js` — no changes needed (pagination, cache confirmed working)
- `js/maps.js` — Phase 5, not in scope
- `api/config.js` — no changes needed
- `api/verify.js` — no changes needed (token check confirmed correct)
- `index.html` — minimal changes only (empty state containers if needed)

## Acceptance Criteria
- [ ] No unescaped user data in HTML rendering
- [ ] Rate limit map has TTL cleanup and correct IP extraction
- [ ] Role defaults to 'viewer' on failure, not 'admin'
- [ ] refresh() cannot fire concurrently
- [ ] IntersectionObserver is disconnected and queue cleared on view switch
- [ ] Weather sync cannot run concurrently; only updates state after confirmed DB write
- [ ] below_detection rows show † marker in tables
- [ ] Empty filter results show Spanish "Sin datos" message
- [ ] All Chart.js constructors wrapped in try/catch
- [ ] API response validation in weather module
- [ ] Stale lot IDs auto-cleared or warned

---

## Workflow 3: Visualization Improvements

### Goal
Improve the analytical value of the dashboard's charts by replacing one weak visualization, adding two missing ones, and enhancing one existing chart type.

### V1 — Replace Doughnut with Horizontal Bar (Muestras por Origen)
**Priority:** High — lowest-utility chart on the dashboard
**Files:** `js/charts.js`, `index.html`

The "Muestras por Origen" doughnut chart (`chartOrigen`) is the weakest visualization:
- Doughnut/pie charts are poor for comparison — humans can't accurately compare angles or arc lengths
- With 10 origins, small slices become indistinguishable
- Visually inconsistent with the 4 origin bar charts directly below it

**Change:** Replace `createDoughnut()` call with a new `createOriginCountBar()` — a horizontal bar chart showing sample count per origin, sorted descending, using the same origin color scheme. Reuse the `createOriginBarChart()` pattern but with raw counts instead of averages.

**Keep:** Same canvas ID (`chartOrigen`), same card title and subtitle (update subtitle to "Número de muestras por viñedo"), same export button.

### V2 — Add Extraction % Chart
**Priority:** Medium — the most actionable extraction metric is hidden in tooltips
**Files:** `js/charts.js`, `index.html`

The current extraction view shows absolute tANT values (berry vs wine) as a grouped bar. The extraction percentage — the winemaker's real question ("how much did I extract?") — is only visible on tooltip hover.

**Change:** Add a second chart above or below the existing extraction bar:
- Horizontal bar: one bar per lot, showing extraction % (0–100%)
- Color-code bars by quality band: <30% use `var(--flag-error)`, 30–50% use `var(--gold)`, >50% use `var(--flag-success)` (or similar)
- Sorted descending by extraction %
- Tooltip shows: lot code, variety, origin, absolute berry tANT, absolute wine tANT, extraction %

**Add to `index.html`:** New `chart-card` in the extraction view with canvas `chartExtractionPct`, title "Tasa de Extracción (%)", subtitle "Porcentaje de antocianinas extraídas por lote".

**Implementation:** Reuse the `pairs` array already computed in `createExtractionChart()`. Extract it into a shared helper or compute once and pass to both chart functions.

### V3 — Add Wine View Chart (Fenólicos por Varietal)
**Priority:** Medium — Wine view is the only view with zero charts
**Files:** `js/charts.js`, `js/app.js`, `index.html`

The Wine view has KPIs and two tables but no visual analytics. Every other view has charts. This makes the Wine view feel incomplete and forces users to mentally parse table data to spot trends.

**Change:** Add a grouped horizontal bar chart showing average tANT, fANT, pTAN, and IPT by variety for wine reception data.
- Canvas ID: `chartWinePhenolics`
- One bar group per variety, 4 bars per group (tANT, fANT, pTAN, IPT)
- Colors: use distinct phenolic compound colors (e.g., tANT=#C4A060, fANT=#9B59B6, pTAN=#E07060, IPT=#60A8C0)
- Place between KPIs and the reception table
- Title: "Fenólicos por Varietal", subtitle: "Promedio de recepción por compuesto"

**In `app.js` refresh():** Add the chart render call in the `case 'wine':` block using the `filteredWine` data.

### V4 — Enhance Varietal Bars with Sample Count
**Priority:** Low — improves interpretability of existing charts
**Files:** `js/charts.js`

The "Brix por Varietal" and "tANT por Varietal" bar charts (`chartVarBrix`, `chartVarAnt`) show only averages. An average from n=3 Viognier samples and n=45 Cabernet Sauvignon samples look equally authoritative.

**Change:** In `createBarChart()`, append the sample count to each bar label: `"Cabernet Sauvignon (n=45)"`. Also include count in tooltip.

**Implementation:** After computing `byVar`, update labels:
```js
const labels = Object.keys(byVar).sort((a, b) => avg(byVar[b]) - avg(byVar[a]));
const displayLabels = labels.map(v => `${v} (n=${byVar[v].length})`);
```
Use `displayLabels` for chart labels but keep `labels` for color lookups.

### Files Involved
| File | Changes |
|------|---------|
| `js/charts.js` | V1: replace doughnut with bar; V2: new `createExtractionPctChart()`; V3: new `createWinePhenolicsChart()`; V4: add n= to bar labels |
| `index.html` | V2: new canvas `chartExtractionPct`; V3: new canvas `chartWinePhenolics` |
| `js/app.js` | V3: add chart render in wine case |

### Acceptance Criteria
- [ ] V1: Origin distribution shows as horizontal bar (not doughnut), sorted by count descending
- [ ] V2: Extraction view has a % bar chart color-coded by quality band
- [ ] V3: Wine view has at least one chart showing phenolics by variety
- [ ] V4: Varietal bar chart labels include sample count (n=)
- [ ] All new charts handle empty data with Spanish "Sin datos" message
- [ ] All new charts are mobile responsive (single-column on ≤768px)
- [ ] All new charts support PNG export
- [ ] All new charts respect dark/light theme via `_applyThemeToCharts()`

---

## Phase 7 (Deferred): Mediciones Técnicas con Evidencia Fotográfica

> **Status:** Architecture designed, NOT for current implementation.
> **Prerequisites:** All REVIEW.md findings resolved, Workflow 3 complete, Phases 5-6 stable.
> **Full architecture:** See sections 1-8 in conversation history (2026-03-23).
> **CLAUDE.md:** Schema reserved, file paths reserved, roadmap entry added.

### Summary
Digitize manual berry measurement records ("mediciones técnicas") with linked photographic evidence. ~110 mediciones, ~1,100 photos stored in Cloudflare R2. Measurement metadata in Supabase.

### Implementation Steps (when ready)
1. **7.1 — Infrastructure:** R2 bucket + CORS, env vars in Vercel
2. **7.2 — Database:** Create `mediciones_tecnicas` + `medicion_fotos` tables via `sql/migration_mediciones.sql`
3. **7.3 — API:** `api/photo-url.js` — presigned PUT URL generator (auth-gated, lab role)
4. **7.4 — Data layer:** `CONFIG.supabaseToMedicionJS` mapping, `DataStore.loadMediciones()`, `DataStore.getMedicionPhotos()`
5. **7.5 — Upload:** `js/mediciones.js` — measurement form + multi-photo upload (presigned URL → R2 PUT → metadata to Supabase)
6. **7.6 — UI:** `view-mediciones` panel — sortable table, expandable row detail with KPI strip, thumbnail grid, lightbox
7. **7.7 — Integration:** Wire up berry filter sidebar, add `case 'mediciones':` to `App.refresh()`
8. **7.8 — Security:** Update `vercel.json` CSP (add R2 domain to `img-src` + `connect-src`)
9. **7.9 — Mobile:** Thumbnail grid reflow, touch lightbox, camera roll upload

### What was done now (groundwork only)
- Reserved table names and schema in CLAUDE.md Database Schema section
- Reserved file paths in CLAUDE.md Project Structure (`js/mediciones.js`, `api/photo-url.js`, `sql/migration_mediciones.sql`)
- Added Phase 7 to CLAUDE.md Features Roadmap
- Documented R2 key structure: `{vintage_year}/{medicion_code}/{position}.jpg`
- Documented nav option: `<option value="mediciones">Mediciones</option>`, view ID: `view-mediciones`

### What was NOT done (deferred)
- No Supabase tables created
- No JS files created
- No R2 bucket provisioned
- No npm dependencies added
- No CSP headers modified
- No UI elements added to index.html
