# Explorer Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add line connections, chart resize, legends, per-chart export, and page-wide export to the Explorer and all dashboard views.

**Architecture:** Per-slot state flags (`showLines`, `expanded`) in Explorer, new DOM buttons/legend in `_injectSlotDOM`, new `Charts.exportPage()` for multi-chart export. All event delegation through `events.js`. CSS additions for expanded state and explorer legend.

**Tech Stack:** Vanilla JS ES6, Chart.js 4.4.1, jsPDF 2.5.1 (CDN), CSS custom properties.

**Build order:** F1 (lines) → F4-resize → F4-legend → F2 (per-chart export) → F3 (page export)

---

## File Structure

| File | Responsibility | Changes |
|------|---------------|---------|
| `js/explorer.js` | Slot state, DOM injection, toggle methods | Add `showLines`/`expanded` per slot, `toggleLines()`, `toggleExpand()`, `_renderSlotLegend()`, update `_injectSlotDOM`, update `renderSlot` |
| `js/charts.js` | Chart rendering, export | Add `exportPage(viewId, format)` method |
| `js/events.js` | Event delegation | Add delegation for new explorer buttons + page export buttons |
| `index.html` | HTML structure | Add "Exportar Vista" button to each view panel header |
| `css/styles.css` | Styling | Add `.explorer-slot-expanded`, `.explorer-legend`, `.explorer-line-toggle`, `.explorer-expand-toggle`, `.page-export-btn` |

---

### Task 1: F1 — Explorer Line Toggle (per-slot)

**Files:**
- Modify: `js/explorer.js:19` (slot defaults), `js/explorer.js:74-108` (renderSlot), `js/explorer.js:194-247` (_injectSlotDOM)
- Modify: `js/events.js:218-227` (_bindExplorerDelegation click handler)
- Modify: `css/styles.css:1564` (after explorer-slot-header)

- [ ] **Step 1: Add `showLines` to slot default state**

In `js/explorer.js:19`, add `showLines: false` to the slot object:

```js
const slot = { id, source: 'berry', xField: 'daysPostCrush', yField: 'brix', chartType: 'scatter', groupBy: 'variety', showLines: false, expanded: false };
```

- [ ] **Step 2: Add `toggleLines` method**

In `js/explorer.js`, after `toggleConfig` (after line 41), add:

```js
  toggleLines(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    slot.showLines = !slot.showLines;
    const btn = document.querySelector(`#explorer-slot-${id} .explorer-line-toggle`);
    if (btn) btn.classList.toggle('active', slot.showLines);
    this.renderSlot(id);
  },
```

- [ ] **Step 3: Update renderSlot to use per-slot showLines**

In `js/explorer.js:102`, change the opts line from:

```js
      const opts = { showLine: slot.chartType === 'line' };
```

to:

```js
      const opts = { showLine: slot.chartType === 'line' || slot.showLines };
```

- [ ] **Step 4: Add line toggle button to slot DOM**

In `js/explorer.js` `_injectSlotDOM`, replace the `explorer-remove-btn` line (line 209):

```js
        <button class="explorer-remove-btn" data-slot="${sid}" title="Eliminar">\u00D7</button>
```

with:

```js
        <div class="explorer-slot-actions">
          <button class="chart-toggle explorer-line-toggle" data-slot="${sid}" title="Conectar puntos con lineas">Conectar Lineas</button>
          <button class="explorer-remove-btn" data-slot="${sid}" title="Eliminar">\u00D7</button>
        </div>
```

- [ ] **Step 5: Add event delegation for line toggle**

In `js/events.js:224-226`, inside the `_bindExplorerDelegation` click handler, add a new branch before the `explorer-render-btn` check:

```js
      if (e.target.closest('.explorer-line-toggle')) Explorer.toggleLines(sid);
      else if (e.target.closest('.explorer-toggle-btn')) Explorer.toggleConfig(sid);
      else if (e.target.closest('.explorer-remove-btn')) Explorer.removeChart(sid);
      else if (e.target.closest('.explorer-render-btn')) Explorer.renderSlot(sid);
```

- [ ] **Step 6: Add CSS for explorer-slot-actions**

In `css/styles.css`, after `.explorer-remove-btn:hover` (after line 1611), add:

```css
.explorer-slot-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.explorer-line-toggle {
  white-space: nowrap;
}
```

- [ ] **Step 7: Test manually**

Open http://localhost:8080, navigate to Explorador. Add a scatter chart. Click "Conectar Lineas" — lines should appear connecting points within each group. Click again — lines disappear. Button should highlight gold when active. Verify bar charts ignore the toggle (lines don't render on bars).

- [ ] **Step 8: Run test suite**

Run: `npm test`
Expected: 72/72 pass, no regressions.

- [ ] **Step 9: Commit**

```bash
git add js/explorer.js js/events.js css/styles.css
git commit -m "feat: add per-slot line toggle to explorer charts (F1)"
```

---

### Task 2: F4-Resize — Explorer Expand/Compact Toggle

**Files:**
- Modify: `js/explorer.js` (toggleExpand method, _injectSlotDOM)
- Modify: `js/events.js:218-227` (_bindExplorerDelegation)
- Modify: `css/styles.css` (expanded state)

- [ ] **Step 1: Add `toggleExpand` method**

In `js/explorer.js`, after the `toggleLines` method, add:

```js
  toggleExpand(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    slot.expanded = !slot.expanded;
    const el = document.getElementById('explorer-slot-' + id);
    if (el) el.classList.toggle('explorer-slot-expanded', slot.expanded);
    const btn = el && el.querySelector('.explorer-expand-toggle');
    if (btn) btn.classList.toggle('active', slot.expanded);
    // Trigger Chart.js resize after CSS transition
    const canvasId = 'explorerChart_' + id;
    const chart = Charts.instances[canvasId];
    if (chart) setTimeout(() => chart.resize(), 320);
  },
```

- [ ] **Step 2: Add expand button to slot DOM**

In `js/explorer.js` `_injectSlotDOM`, in the `explorer-slot-actions` div (added in Task 1), insert the expand button between the line toggle and the remove button:

```js
          <button class="chart-toggle explorer-line-toggle" data-slot="${sid}" title="Conectar puntos con lineas">Conectar Lineas</button>
          <button class="chart-toggle explorer-expand-toggle" data-slot="${sid}" title="Expandir grafico">\u26F6</button>
          <button class="explorer-remove-btn" data-slot="${sid}" title="Eliminar">\u00D7</button>
```

- [ ] **Step 3: Add event delegation for expand toggle**

In `js/events.js`, in `_bindExplorerDelegation` click handler, add after the line toggle branch:

```js
      if (e.target.closest('.explorer-line-toggle')) Explorer.toggleLines(sid);
      else if (e.target.closest('.explorer-expand-toggle')) Explorer.toggleExpand(sid);
      else if (e.target.closest('.explorer-toggle-btn')) Explorer.toggleConfig(sid);
      else if (e.target.closest('.explorer-remove-btn')) Explorer.removeChart(sid);
      else if (e.target.closest('.explorer-render-btn')) Explorer.renderSlot(sid);
```

- [ ] **Step 4: Add CSS for expanded state**

In `css/styles.css`, after `.explorer-slot` (after line 1562), add:

```css
.explorer-slot-expanded .explorer-canvas-wrap {
  height: 500px;
  transition: height 0.3s ease;
}
.explorer-canvas-wrap {
  transition: height 0.3s ease;
}
```

- [ ] **Step 5: Test manually**

Open http://localhost:8080 → Explorador. Click ⛶ on a chart — it should expand to ~500px height, pushing charts below down. Chart.js should resize to fill the new space. Click again — compact to 280px. Button gold when active.

- [ ] **Step 6: Run test suite**

Run: `npm test`
Expected: 72/72 pass.

- [ ] **Step 7: Commit**

```bash
git add js/explorer.js js/events.js css/styles.css
git commit -m "feat: add expand/compact toggle to explorer charts (F4-resize)"
```

---

### Task 3: F4-Legend — Explorer Legend Bar

**Files:**
- Modify: `js/explorer.js` (_injectSlotDOM, renderSlot, new _renderSlotLegend)
- Modify: `css/styles.css` (explorer legend styles)

- [ ] **Step 1: Add legend container to slot DOM**

In `js/explorer.js` `_injectSlotDOM`, after the `explorer-canvas-wrap` div (the line with `</div>` closing the canvas wrap), add the legend div:

```js
      <div class="explorer-canvas-wrap" style="height:280px">
        <canvas id="explorerChart_${sid}"></canvas>
      </div>
      <div class="explorer-legend" id="explorerLegend_${sid}"></div>
```

- [ ] **Step 2: Add `_renderSlotLegend` method**

In `js/explorer.js`, in the private section (after `_updateSummary`), add:

```js
  _renderSlotLegend(slot, canvasId) {
    const el = document.getElementById('explorerLegend_' + slot.id);
    if (!el) return;
    const chart = Charts.instances[canvasId];
    if (!chart || !chart.data || !chart.data.datasets) { el.innerHTML = ''; return; }
    el.innerHTML = chart.data.datasets.map((ds, i) => {
      const color = ds.borderColor || ds.backgroundColor || '#888';
      const dimmed = chart.getDatasetMeta(i).hidden ? ' dimmed' : '';
      return `<span class="legend-item${dimmed}" data-slot="${slot.id}" data-ds-index="${i}" role="button" tabindex="0">` +
             `<span class="legend-dot" style="background:${color}"></span>${ds.label || ''}</span>`;
    }).join('');
  },
```

- [ ] **Step 3: Call `_renderSlotLegend` from renderSlot**

In `js/explorer.js` `renderSlot`, after the `_updateSummary` call (line 107), add:

```js
    this._renderSlotLegend(slot, canvasId);
```

- [ ] **Step 4: Add legend click handler for dataset toggling**

In `js/events.js` `_bindExplorerDelegation`, add a new click handler for legend items inside the existing container listener:

```js
      // Legend item toggle
      const legendItem = e.target.closest('.explorer-legend .legend-item');
      if (legendItem) {
        const slotId = parseInt(legendItem.dataset.slot);
        const dsIdx = parseInt(legendItem.dataset.dsIndex);
        const cId = 'explorerChart_' + slotId;
        const chart = Charts.instances[cId];
        if (chart && !isNaN(dsIdx)) {
          const meta = chart.getDatasetMeta(dsIdx);
          meta.hidden = !meta.hidden;
          chart.update();
          legendItem.classList.toggle('dimmed', meta.hidden);
        }
        return;
      }
```

Place this at the top of the click handler, before the `const slot = e.target.closest('[data-slot]')` line.

- [ ] **Step 5: Add CSS for explorer legend**

In `css/styles.css`, after the `.explorer-slot-actions` rule (added in Task 1), add:

```css
.explorer-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 16px;
  background: var(--near-black);
  border-top: 1px solid var(--border);
  min-height: 20px;
}
.explorer-legend .legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s;
}
.explorer-legend .legend-item:hover { color: var(--text); }
.explorer-legend .legend-item.dimmed { opacity: 0.3; }
```

- [ ] **Step 6: Test manually**

Open http://localhost:8080 → Explorador. Create scatter chart grouped by variety. Legend bar should appear below the chart with color dots + variety names. Click a legend item — that dataset should hide/dim. Click again — restore. Test with bar chart — legend shows group names. Test with all 3 chart types.

- [ ] **Step 7: Run test suite**

Run: `npm test`
Expected: 72/72 pass.

- [ ] **Step 8: Commit**

```bash
git add js/explorer.js js/events.js css/styles.css
git commit -m "feat: add legend bar to explorer charts (F4-legend)"
```

---

### Task 4: F2 — Per-Chart Export Button

**Files:**
- Modify: `js/explorer.js` (_injectSlotDOM, renderSlot)
- Modify: `js/charts.js:1646-1655` (showExportMenu card fallback)

- [ ] **Step 1: Add export button to slot DOM**

In `js/explorer.js` `_injectSlotDOM`, in the `explorer-slot-actions` div, insert the export button between the expand toggle and remove button:

```js
          <button class="chart-toggle explorer-line-toggle" data-slot="${sid}" title="Conectar puntos con lineas">Conectar Lineas</button>
          <button class="chart-toggle explorer-expand-toggle" data-slot="${sid}" title="Expandir grafico">\u26F6</button>
          <button class="chart-export-btn" data-slot="${sid}" data-chart-id="explorerChart_${sid}" data-chart-title="" title="Exportar grafico">&#x2913;</button>
          <button class="explorer-remove-btn" data-slot="${sid}" title="Eliminar">\u00D7</button>
```

- [ ] **Step 2: Update chart title on export button after render**

In `js/explorer.js` `renderSlot`, after the `_updateSummary` call, add:

```js
    // Update export button title
    const exportBtn = document.querySelector(`#explorer-slot-${id} .chart-export-btn`);
    if (exportBtn) {
      const title = slot.chartType === 'bar'
        ? `${yMeta.label} por ${(CONFIG.explorerGroupBy[slot.source] || []).find(g => g.value === slot.groupBy)?.label || slot.groupBy}`
        : `${yMeta.label} vs ${xMeta.label}`;
      exportBtn.dataset.chartTitle = title;
    }
```

- [ ] **Step 3: Fix export menu positioning for explorer slots**

In `js/charts.js` `showExportMenu` (line 1646-1655), the menu positions relative to `.chart-card`. Explorer slots use `.explorer-slot` instead. Update the positioning fallback:

```js
    // Position relative to chart-card or explorer-slot (which already has position: relative)
    const card = btn.closest('.chart-card') || btn.closest('.explorer-slot');
    if (card) {
      menu.style.top = (btn.offsetTop + btn.offsetHeight + 4) + 'px';
      menu.style.right = '12px';
      menu.style.position = 'absolute';
      card.appendChild(menu);
    } else {
      btn.appendChild(menu);
    }
```

- [ ] **Step 4: Ensure explorer-slot has position:relative for menu positioning**

In `css/styles.css`, update `.explorer-slot` (line 1558):

```css
.explorer-slot {
  border: 1px solid var(--border-gold);
  background: var(--card);
  margin-bottom: 12px;
  transition: background 0.3s;
  position: relative;
}
```

- [ ] **Step 5: Test manually**

Open http://localhost:8080 → Explorador. Click ⤓ on a chart — PNG/PDF dropdown should appear positioned near the button. Click PNG — downloads a branded PNG with correct title (e.g., "Brix vs Dias Post-Envero"). Click PDF — downloads branded PDF. Test export on both compact and expanded charts. Verify title updates when changing axes.

- [ ] **Step 6: Run test suite**

Run: `npm test`
Expected: 72/72 pass.

- [ ] **Step 7: Commit**

```bash
git add js/explorer.js js/charts.js css/styles.css
git commit -m "feat: add per-chart export to explorer slots (F2)"
```

---

### Task 5: F3 — Page Export (All Views)

**Files:**
- Modify: `js/charts.js` (new `exportPage` and `exportPagePDF` methods)
- Modify: `js/events.js` (new delegation for `.page-export-btn`)
- Modify: `index.html` (add "Exportar Vista" button to each view)
- Modify: `css/styles.css` (page export button styling)

- [ ] **Step 1: Add "Exportar Vista" buttons to each view in index.html**

In `index.html`, add a button after each view's first `section-label`. For berry view (after line 220):

```html
    <div id="view-berry" class="view-panel active">
      <div class="mobile-filter-summary" id="filter-summary-berry">
        <span class="summary-text" id="summary-text-berry"></span>
        <button class="summary-clear" data-clear="all">Limpiar</button>
      </div>
      <div class="view-export-row">
        <div class="section-label">Indicadores Clave</div>
        <button class="page-export-btn" data-view="berry" data-view-title="Bayas" title="Exportar vista completa">Exportar Vista &#x2913;</button>
      </div>
```

For wine view (line 421), similarly wrap the first section-label:

```html
      <div class="view-export-row">
        <div class="section-label">Indicadores Clave — Recepcion</div>
        <button class="page-export-btn" data-view="wine" data-view-title="Vino" title="Exportar vista completa">Exportar Vista &#x2913;</button>
      </div>
```

For extraction view (after `id="view-extraction"`):

```html
      <div class="view-export-row">
        <div class="section-label">Extraccion Fenolica</div>
        <button class="page-export-btn" data-view="extraction" data-view-title="Extraccion" title="Exportar vista completa">Exportar Vista &#x2913;</button>
      </div>
```

For vintage view (after `id="view-vintage"`):

```html
      <div class="view-export-row">
        <div class="section-label">Comparacion Vendimias</div>
        <button class="page-export-btn" data-view="vintage" data-view-title="Vendimias" title="Exportar vista completa">Exportar Vista &#x2913;</button>
      </div>
```

For explorer view (line 654):

```html
    <div id="view-explorer" class="view-panel">
      <div class="view-export-row">
        <div class="section-label">Explorador de Graficas</div>
        <button class="page-export-btn" data-view="explorer" data-view-title="Explorador" title="Exportar vista completa">Exportar Vista &#x2913;</button>
      </div>
```

For weather section — find the weather section-label and wrap it similarly with `data-view="weather"` and `data-view-title="Meteorologia"`.

For mediciones view:

```html
      <div class="view-export-row">
        <div class="section-label">Mediciones Tecnicas</div>
        <button class="page-export-btn" data-view="mediciones" data-view-title="Mediciones" title="Exportar vista completa">Exportar Vista &#x2913;</button>
      </div>
```

Skip the map view for now (SVG-to-canvas conversion is complex — add as follow-up).

- [ ] **Step 2: Add CSS for view-export-row and page-export-btn**

In `css/styles.css`, after the `.chart-controls` rule (line 564):

```css
.view-export-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0;
}
.view-export-row .section-label {
  margin-bottom: 0;
}
.page-export-btn {
  padding: 4px 14px;
  font-size: 9px;
  font-family: 'Sackers Gothic Medium';
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.page-export-btn:hover {
  border-color: var(--gold-dim);
  color: var(--text);
}
```

- [ ] **Step 3: Add `exportPage` method to charts.js**

In `js/charts.js`, after `exportChartPDF` (after line 1801), add:

```js
  exportPage(viewId, viewTitle) {
    // Collect all visible chart canvases in this view
    const container = document.getElementById('view-' + viewId);
    if (!container) { this._showExportToast('Vista no encontrada'); return; }

    const canvases = Array.from(container.querySelectorAll('canvas')).filter(c => {
      const chart = this.instances[c.id];
      return chart && c.offsetParent !== null; // visible and has chart instance
    });

    if (!canvases.length) { this._showExportToast('No hay graficos visibles para exportar'); return; }

    const pad = 40;
    const titleH = 50;
    const chartGap = 30;
    const watermarkH = 30;

    // Calculate total height
    const chartHeights = canvases.map(c => c.height);
    const maxW = Math.max(...canvases.map(c => c.width));
    const totalW = maxW + pad * 2;
    const totalH = titleH + chartHeights.reduce((sum, h) => sum + h + chartGap, 0) + watermarkH + pad;

    const tmp = document.createElement('canvas');
    tmp.width = totalW;
    tmp.height = totalH;
    const ctx = tmp.getContext('2d');

    // Dark background
    ctx.fillStyle = '#161616';
    ctx.fillRect(0, 0, totalW, totalH);

    // Title
    const date = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '18px "Sackers Gothic Medium", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${viewTitle} — Monte Xanic`, pad, pad + 6);
    ctx.fillStyle = '#888';
    ctx.font = '11px "Sackers Gothic Medium", sans-serif';
    ctx.fillText(date, pad, pad + 22);

    // Gold separator
    ctx.strokeStyle = 'rgba(196,160,96,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, titleH);
    ctx.lineTo(totalW - pad, titleH);
    ctx.stroke();

    // Draw charts sequentially (each chart.toBase64Image loads async via Image)
    let yOffset = titleH + 10;
    let loaded = 0;

    canvases.forEach((c, i) => {
      const chart = this.instances[c.id];
      if (!chart) return;
      try {
        const imgSrc = chart.toBase64Image('image/png', 1);
        const img = new Image();
        const myY = yOffset;
        yOffset += chartHeights[i] + chartGap;

        img.onload = () => {
          ctx.drawImage(img, pad, myY, c.width, c.height);
          loaded++;
          if (loaded === canvases.length) {
            // Watermark
            ctx.fillStyle = 'rgba(196,160,96,0.4)';
            ctx.font = '10px "Sackers Gothic Medium", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Monte Xanic \u2014 Vendimia', totalW - pad, totalH - 12);

            // Download
            const safeName = viewTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
            const link = document.createElement('a');
            link.download = `monte-xanic-${safeName}-${new Date().toISOString().slice(0,10)}.png`;
            link.href = tmp.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
        };
        img.onerror = () => { loaded++; };
        img.src = imgSrc;
      } catch (err) {
        loaded++;
        console.error('[Charts] Error exporting chart', c.id, err);
      }
    });
  },

  exportPagePDF(viewId, viewTitle) {
    if (typeof window.jspdf === 'undefined') {
      this._showExportToast('PDF no disponible — la libreria jsPDF aun no se ha cargado.');
      return;
    }
    const container = document.getElementById('view-' + viewId);
    if (!container) { this._showExportToast('Vista no encontrada'); return; }

    const canvases = Array.from(container.querySelectorAll('canvas')).filter(c => {
      const chart = this.instances[c.id];
      return chart && c.offsetParent !== null;
    });

    if (!canvases.length) { this._showExportToast('No hay graficos visibles para exportar'); return; }

    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();

      // Title page
      pdf.setFillColor(22, 22, 22);
      pdf.rect(0, 0, pw, ph, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.text(`${viewTitle} — Monte Xanic`, pw / 2, ph / 2 - 10, { align: 'center' });
      const date = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
      pdf.setFontSize(12);
      pdf.setTextColor(136, 136, 136);
      pdf.text(date, pw / 2, ph / 2 + 5, { align: 'center' });
      pdf.setTextColor(196, 160, 96);
      pdf.setFontSize(8);
      pdf.text('Monte Xanic \u2014 Vendimia', pw - 15, ph - 6, { align: 'right' });

      // One page per chart
      canvases.forEach(c => {
        const chart = this.instances[c.id];
        if (!chart) return;
        pdf.addPage();
        pdf.setFillColor(22, 22, 22);
        pdf.rect(0, 0, pw, ph, 'F');

        // Chart title from the closest .chart-title or explorer summary
        const card = c.closest('.chart-card') || c.closest('.explorer-slot');
        const titleEl = card && (card.querySelector('.chart-title') || card.querySelector('.explorer-summary'));
        const chartTitle = titleEl ? titleEl.textContent : c.id;

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(14);
        pdf.text(chartTitle, 15, 18);

        pdf.setDrawColor(196, 160, 96);
        pdf.setLineWidth(0.3);
        pdf.line(15, 22, pw - 15, 22);

        const imgData = chart.toBase64Image('image/png', 1);
        pdf.addImage(imgData, 'PNG', 15, 26, pw - 30, ph - 50);

        pdf.setTextColor(196, 160, 96);
        pdf.setFontSize(8);
        pdf.text('Monte Xanic \u2014 Vendimia', pw - 15, ph - 6, { align: 'right' });
      });

      const safeName = viewTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      pdf.save(`monte-xanic-${safeName}-${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) {
      console.error('[Charts] Error generando PDF de vista:', err);
      this._showExportToast('Error al generar el PDF de la vista');
    }
  },
```

- [ ] **Step 4: Add page export event delegation**

In `js/events.js`, add a new method `_bindPageExport` and call it from `init()`:

```js
  _bindPageExport() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.page-export-btn');
      if (!btn) return;
      const viewId = btn.dataset.view;
      const viewTitle = btn.dataset.viewTitle || viewId;

      // Show format menu using same pattern as chart export
      document.querySelectorAll('.chart-export-menu').forEach(m => m.remove());
      const menu = document.createElement('div');
      menu.className = 'chart-export-menu';
      menu.innerHTML =
        '<button data-fmt="png">PNG</button>' +
        '<button data-fmt="pdf">PDF</button>';
      menu.addEventListener('click', (ev) => {
        const fmt = ev.target.getAttribute('data-fmt');
        if (fmt === 'png') Charts.exportPage(viewId, viewTitle);
        if (fmt === 'pdf') Charts.exportPagePDF(viewId, viewTitle);
        menu.remove();
      });
      menu.style.position = 'absolute';
      menu.style.top = (btn.offsetHeight + 4) + 'px';
      menu.style.right = '0';
      btn.style.position = 'relative';
      btn.appendChild(menu);

      setTimeout(() => {
        const handler = (ev) => {
          if (!menu.contains(ev.target) && ev.target !== btn) {
            menu.remove();
            document.removeEventListener('click', handler);
          }
        };
        document.addEventListener('click', handler);
      }, 0);
    });
  },
```

In `js/events.js` `init()`, add `this._bindPageExport();` after the existing bind calls.

- [ ] **Step 5: Test manually — PNG export**

Open http://localhost:8080 → Bayas view. Click "Exportar Vista" → PNG. A PNG should download containing all visible berry charts stacked vertically with branded header and watermark. Verify date stamp is correct. Repeat for Explorer view with 2+ charts.

- [ ] **Step 6: Test manually — PDF export**

Click "Exportar Vista" → PDF on Bayas view. Multi-page PDF should download: title page + one page per chart. Verify chart titles appear correctly on each page. Test on Explorer view.

- [ ] **Step 7: Run test suite**

Run: `npm test`
Expected: 72/72 pass.

- [ ] **Step 8: Commit**

```bash
git add js/charts.js js/events.js index.html css/styles.css
git commit -m "feat: add page-wide export to all dashboard views (F3)"
```

- [ ] **Step 9: Push to remote**

```bash
git push
```

---

## Post-Implementation

After all 5 tasks are complete:

1. Verify all features work together: explorer with lines + expanded + legend + export + page export
2. Test on mobile (responsive layout, button sizing)
3. Run full test suite: `npm test` — expect 72/72 pass
4. Manual QA on each dashboard view's "Exportar Vista" button
