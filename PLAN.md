# Plan — Phase 6: Polish

## Status: IN PROGRESS

---

## Implemented Items

| # | Task | Status | Files |
|---|------|--------|-------|
| 1 | Login screen UI polish | DONE | `css/styles.css`, `index.html` |
| 2 | Export charts as PDF | DONE | `js/charts.js`, `index.html`, `css/styles.css` |
| 3 | Mobile filter panel improvements | DONE | `js/app.js`, `index.html`, `css/styles.css` |
| 4 | Multi-vintage trend lines | DONE | `js/charts.js` |
| 5 | Per-origin chemistry comparison (radar) | DONE | `js/charts.js`, `index.html` |

### 1. Login Screen UI Polish
- Radial gold glow background for atmospheric depth
- Card: layered box-shadow, drop-shadow on logo, gradient gold divider
- Inputs: gold outer glow on focus
- Button: gold gradient background, hover glow
- Staggered fade-in entrance animation (card → logo → divider → tagline → fields → button → footer)
- All via CSS variables — light theme works automatically

### 2. PDF Export
- Added jsPDF 2.5.2 via CDN
- `exportChartPDF()`: landscape A4, dark background, branded title + gold separator + watermark
- Export buttons converted to dropdown menu (PNG / PDF) via `showExportMenu()`
- `.chart-export-menu` dropdown styled to match dashboard design
- All 19 export buttons updated from direct PNG to format menu

### 3. Mobile Filter Panel
- Bottom sheet: rounded top corners (14px border-radius), pull handle bar
- Sheet header with "Filtros" title and close button (×)
- Slide-down dismiss animation (`sheetSlideDown` keyframes)
- Close button: 32px circular, gold hover state
- Handle + header hidden on desktop via `@media (min-width: 769px)`

### 4. Multi-Vintage Trend Lines
- Vintage comparison charts now show ALL data (not just lots in 2+ vintages)
- Scatter points per vintage with automatic binned trend lines
- Trend lines: 5-day bins, dashed, only where bins have 2+ samples
- Legend filters out "tendencia" entries to keep it clean
- Works with any number of vintages

### 5. Per-Origin Chemistry Radar
- New `createOriginRadarChart()` — radar/spider chart
- 5 axes: Brix, pH, AT, tANT, Peso Baya
- Values normalized to 0-100 scale per metric
- One polygon per origin with origin colors + transparent fill
- Tooltip shows raw (non-normalized) values
- Placed in "Comparativo por Origen" section, lazy-rendered

---

## Remaining Phase 6 Items
- [ ] Harvest calendar with weather overlays

## Open Security Items (REVIEW.md)
| ID | Severity | Category |
|----|----------|----------|
| 4.1 | Critical | Security (client-only upload auth) |
| 4.4 | Medium | Security (ephemeral rate limit) |
| 4.5 | Medium | Security (no token revocation) |
