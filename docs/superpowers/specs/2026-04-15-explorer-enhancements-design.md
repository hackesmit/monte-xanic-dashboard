# Explorer Enhancements — Design Spec

**Date:** 2026-04-15
**Phase:** 9 (Sub-project 1 of 2)
**Scope:** F1 (line connections), F2 (per-chart export), F3 (page export), F4 (chart resize + legend)

---

## Overview

Upgrade the Explorer page from a basic chart builder into a full-featured analysis tool with line overlays, export capabilities, chart resizing, visible legends, and dashboard-wide page export. All changes preserve the existing vanilla JS / CDN-only / Spanish-UI conventions.

---

## F1 — Explorer Line Connections

### Behavior

Each explorer scatter chart slot gets a per-slot "Conectar Lineas" toggle button in the slot header. When active:

- All datasets in that chart set `showLine: true` and `borderWidth: CONFIG.chartDefaults.borderWidth`
- Points within each group (variety, origin, or vintage) are connected by lines, sorted by X-axis value
- The button shows an active state (gold text/border, matching `.chart-toggle.active` style)

When inactive (default): `showLine: false`, `borderWidth: 0` — scatter-only.

Bar charts ignore this toggle (lines don't apply).

### Implementation

- **`explorer.js`**: Add `showLines` boolean per slot object (default `false`). New method `toggleLines(id)` flips the flag and calls `renderSlot(id)`.
- **`explorer.js` `_injectSlotDOM`**: Add button `<button class="chart-toggle explorer-line-toggle" data-slot-id="${id}">Conectar Lineas</button>` in the slot header, right side.
- **`explorer.js` `renderSlot`**: Pass `{ showLine: slot.showLines }` to `Charts.createExplorerChart()`.
- **`events.js`**: Delegate click on `.explorer-line-toggle` to `Explorer.toggleLines(id)`.
- **No changes to `charts.js`**: `createExplorerChart` already accepts `opts.showLine`.

---

## F2 — Per-Chart Export

### Behavior

Each explorer slot gets an export button (⤓) in the header. Clicking it opens the same PNG/PDF choice as other chart exports. The chart title is derived from axis labels: `"${yLabel} vs ${xLabel}"` for scatter/line, `"${yLabel} por ${groupLabel}"` for bar.

### Implementation

- **`explorer.js` `_injectSlotDOM`**: Add `<button class="chart-export-btn" data-chart-id="explorerChart_${id}" data-chart-title="${title}">&#x2913;</button>` in slot header.
- **`explorer.js` `renderSlot`**: Update the export button's `data-chart-title` attribute after computing axis labels.
- **`events.js`**: Export buttons inside `#explorer-charts` are already handled by the existing global delegation for `.chart-export-btn` (which calls `Charts.exportChart` / `Charts.exportChartPDF`). No new delegation needed — verify existing handler covers dynamically injected buttons.

---

## F3 — Page Export

### Behavior

Each dashboard view header gets an "Exportar Vista" button. Clicking it captures all visible charts on that page into:

- **PNG**: Vertical stack — each chart rendered full-width, stacked top to bottom, with branded header (title, date, watermark) at top. Single downloadable PNG.
- **Multi-page PDF**: Each chart on its own landscape page with branded header. Single downloadable PDF.

A dropdown or two-button menu offers the PNG vs PDF choice, consistent with existing single-chart export UX.

### Pages

| View | Container | Charts to Capture |
|------|-----------|-------------------|
| Bayas | `#view-berry` | All `.chart-card canvas` elements in berry section |
| Vino | `#view-wine` | All `.chart-card canvas` elements in wine section |
| Explorador | `#view-explorer` | All `canvas[id^="explorerChart_"]` elements |
| Meteorologia | `#view-weather` | All `.chart-card canvas` elements in weather section |
| Mapa | `#view-map` | SVG map + KPI cards (special handling — SVG to canvas conversion) |
| Mediciones | `#view-mediciones` | All `.chart-card canvas` elements in mediciones section |

### Implementation

- **`index.html`**: Add `<button class="page-export-btn" data-view="berry" title="Exportar vista completa">Exportar Vista &#x2913;</button>` to each view header div.
- **`charts.js`**: New method `exportPage(viewId, format)`:
  1. Query all visible `<canvas>` elements within `#view-${viewId}`
  2. For PNG: create a tall offscreen canvas, draw branded header, then each chart image stacked vertically with padding between them
  3. For PDF: create jsPDF document, add branded header page, then each chart on its own landscape page
  4. Download as `monte-xanic-${viewName}-${date}.png` or `.pdf`
- **`events.js`**: Delegate click on `.page-export-btn` → show format menu → call `Charts.exportPage()`.
- **Map special case**: `#view-map` contains an SVG, not a canvas. Use `XMLSerializer` + `Image` + `drawImage` to convert SVG to canvas before including in the page export. Note: SVG-to-canvas has cross-origin and rendering fidelity edge cases. If problematic, the map page export can initially export KPI cards only and add SVG conversion as a follow-up.

### Branded Styling

Matches existing single-chart export: dark background (`#1C1C1C`), gold title text (`#DDB96E`), gold separator line, "Monte Xanic — Vendimias" watermark at bottom. Date stamp included.

---

## F4 — Chart Resize + Legend

### Resize Toggle

Each explorer slot gets an expand/compact toggle button (⛶) in the header.

| Mode | Canvas Height | Behavior |
|------|--------------|----------|
| Compact (default) | 280px | Current layout, fits 2 charts on screen |
| Expanded | 500px | Full-width, pushes charts below it down |

When toggled:
- Button gets `.active` class (gold highlight)
- Slot container gets `.explorer-slot-expanded` class
- Chart.js instance resizes automatically (`responsive: true` + `maintainAspectRatio: false` already set)
- CSS transition for smooth height change

### Legend Bar

Each explorer chart displays a legend bar below the canvas, matching the berry page `#legend-bar` style.

**Structure:**
```html
<div class="explorer-legend" id="explorerLegend_${id}">
  <!-- Populated after chart render -->
</div>
```

**Content:** Color-coded dots + group labels for each dataset in the chart. Format:
```
● Cabernet Sauvignon  ● Syrah  ● Sauvignon Blanc
```

**Implementation:**
- **`explorer.js` `renderSlot`**: After chart creation, populate the legend div by reading the chart instance's datasets (label + borderColor).
- **`css/styles.css`**: Style `.explorer-legend` with flex-wrap, matching `#legend-bar` styling (dot size, font, spacing, background).
- Legend is clickable — clicking a group name toggles that dataset's visibility (standard Chart.js `getDatasetMeta().hidden` toggle), consistent with berry page legend behavior.

---

## Slot Header Layout

Complete right-side button order per explorer slot:

```
[Conectar Lineas] [⛶] [⤓] [×]
```

- **Conectar Lineas**: `.chart-toggle .explorer-line-toggle` — line connection toggle (F1)
- **⛶**: `.chart-toggle .explorer-expand-toggle` — expand/compact toggle (F4)
- **⤓**: `.chart-export-btn` — per-chart export (F2)
- **×**: `.explorer-remove-btn` — remove chart (existing)

On mobile (<=768px): buttons use icon-only mode (no "Conectar Lineas" text, just a line icon) to save space.

---

## Files Modified

| File | Changes |
|------|---------|
| `js/explorer.js` | Per-slot `showLines` and `expanded` state. `toggleLines(id)`, `toggleExpand(id)` methods. Updated `_injectSlotDOM` with new buttons + legend div. Updated `renderSlot` to populate legend and pass showLine opts. |
| `js/charts.js` | New `exportPage(viewId, format)` method for page-wide export. |
| `js/events.js` | Delegate clicks for `.explorer-line-toggle`, `.explorer-expand-toggle`, `.page-export-btn`, `.explorer-legend` items. |
| `index.html` | "Exportar Vista" button in each view header. |
| `css/styles.css` | `.explorer-slot-expanded`, `.explorer-legend`, `.page-export-btn`, mobile responsive rules. |

No new files. No changes to data layer, config, upload, or backend.

---

## Constraints

- No npm packages. CDN only (jsPDF already loaded).
- All UI labels in Spanish.
- Mobile responsive — buttons collapse to icons on small screens.
- Existing 72/72 tests must not break.
- File responsibility boundaries respected (no chart rendering in explorer.js, no data queries in charts.js).

---

## Out of Scope

- Lot-level groupBy in explorer (deferred)
- Data tables under charts (dropped — data available in dedicated table views)
- Satellite map (F7 — deferred to later stage)
- Weather enhancements (F5, F6 — separate sub-project spec)
