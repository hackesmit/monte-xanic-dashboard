// ── Chart Explorer Module ──
// Allows users to create up to 4 custom charts with configurable axes, chart type, and grouping.
import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { Filters } from './filters.js';
import { Charts } from './charts.js';
import { WeatherStore } from './weather.js';

export const Explorer = {
  slots: [],
  maxSlots: 4,
  _nextId: 0,

  // ── Helpers ────────────────────────────────────────────────────

  _slotById(id) { return this.slots.find(s => s.id === id); },
  _slotIndexById(id) { return this.slots.findIndex(s => s.id === id); },

  // ── Public API ──────────────────────────────────────────────────

  addChart() {
    if (this.slots.length >= this.maxSlots) return;
    const id = this._nextId++;
    const slot = { id, source: 'berry', xField: 'daysPostCrush', yField: 'brix', chartType: 'scatter', groupBy: 'variety', showLines: false, expanded: false, selectedLots: [] };
    this.slots.push(slot);
    this._injectSlotDOM(slot);
    this.renderSlot(slot.id);
  },

  removeChart(id) {
    const idx = this._slotIndexById(id);
    if (idx === -1) return;
    Charts.destroy('explorerChart_' + id);
    const el = document.getElementById('explorer-slot-' + id);
    if (el) el.remove();
    this.slots.splice(idx, 1);
  },

  toggleConfig(id) {
    const panel = document.getElementById('explorer-config-panel-' + id);
    const btn = document.getElementById('explorer-toggle-btn-' + id);
    if (!panel) return;
    const hidden = panel.style.display === 'none';
    panel.style.display = hidden ? '' : 'none';
    if (btn) btn.textContent = hidden ? '\u25B2 Configurar' : '\u25BC Configurar';
  },

  toggleLines(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    slot.showLines = !slot.showLines;
    const btn = document.querySelector(`#explorer-slot-${id} .explorer-line-toggle`);
    if (btn) btn.classList.toggle('active', slot.showLines);
    // Update existing chart in-place to preserve hidden dataset state
    const chart = Charts.instances['explorerChart_' + id];
    if (chart) {
      const show = slot.chartType === 'line' || slot.showLines;
      chart.data.datasets.forEach(ds => {
        ds.showLine = show;
        ds.borderWidth = show ? (CONFIG.chartDefaults.borderWidth || 2) : 0;
      });
      chart.update();
    } else {
      this.renderSlot(id);
    }
  },

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

  onSourceChange(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    const sourceEl = document.getElementById('explorer-source-' + id);
    if (!sourceEl) return;
    slot.source = sourceEl.value;
    // Reset fields to first available
    const metrics = CONFIG.explorerMetrics[slot.source];
    const keys = Object.keys(metrics);
    slot.xField = keys[0] || 'daysPostCrush';
    slot.yField = keys.length > 1 ? keys[1] : keys[0];
    // Repopulate dropdowns
    this._populateDropdowns(slot);
    // Reset groupBy
    const groups = CONFIG.explorerGroupBy[slot.source];
    slot.groupBy = groups && groups.length ? groups[0].value : 'variety';
    const groupEl = document.getElementById('explorer-group-' + id);
    if (groupEl) groupEl.value = slot.groupBy;
  },

  onChartTypeChange(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    const typeEl = document.getElementById('explorer-type-' + id);
    if (!typeEl) return;
    slot.chartType = typeEl.value;
    // Disable X dropdown for bar charts
    const xEl = document.getElementById('explorer-x-' + id);
    if (xEl) xEl.disabled = (slot.chartType === 'bar');
  },

  onGroupByChange(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    const groupEl = document.getElementById('explorer-group-' + id);
    if (groupEl) slot.groupBy = groupEl.value;
    const isLot = slot.groupBy === 'lotCode' || slot.groupBy === 'codigoBodega';
    const picker = document.getElementById('explorer-lot-picker-' + id);
    if (picker) picker.style.display = isLot ? '' : 'none';
    if (isLot && !slot.selectedLots.length) {
      this._populateLotPicker(slot);
    }
  },

  renderSlot(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    // Read current values from DOM
    const sourceEl = document.getElementById('explorer-source-' + id);
    const xEl = document.getElementById('explorer-x-' + id);
    const yEl = document.getElementById('explorer-y-' + id);
    const typeEl = document.getElementById('explorer-type-' + id);
    const groupEl = document.getElementById('explorer-group-' + id);
    if (sourceEl) slot.source = sourceEl.value;
    if (xEl) slot.xField = xEl.value;
    if (yEl) slot.yField = yEl.value;
    if (typeEl) slot.chartType = typeEl.value;
    if (groupEl) slot.groupBy = groupEl.value;

    const canvasId = 'explorerChart_' + id;
    const data = this._getData(slot);
    let enriched = this._computeDerived(data, slot.source);

    // Filter by selected lots when grouping by lot
    const isLot = slot.groupBy === 'lotCode' || slot.groupBy === 'codigoBodega';
    if (isLot && slot.selectedLots.length) {
      const selected = new Set(slot.selectedLots);
      enriched = enriched.filter(d => selected.has(d[slot.groupBy]));
    }

    // Show/hide lot picker and populate if needed
    const picker = document.getElementById('explorer-lot-picker-' + id);
    if (picker) picker.style.display = isLot ? '' : 'none';
    if (isLot) this._populateLotPicker(slot);
    const metrics = CONFIG.explorerMetrics[slot.source] || {};
    const xMeta = metrics[slot.xField] || { label: slot.xField, unit: '' };
    const yMeta = metrics[slot.yField] || { label: slot.yField, unit: '' };
    const xLabel = xMeta.unit ? `${xMeta.label} (${xMeta.unit})` : xMeta.label;
    const yLabel = yMeta.unit ? `${yMeta.label} (${yMeta.unit})` : yMeta.label;
    const colorResolver = this._getColorResolver(slot.groupBy, slot.source);

    if (slot.chartType === 'bar') {
      Charts.createExplorerBar(canvasId, enriched, slot.yField, yMeta.label, slot.groupBy, colorResolver);
    } else {
      const opts = { showLine: slot.chartType === 'line' || slot.showLines };
      Charts.createExplorerChart(canvasId, enriched, slot.xField, slot.yField, xLabel, yLabel, slot.groupBy, colorResolver, opts);
    }

    // Update summary text, legend, and export title
    this._updateSummary(slot, xMeta, yMeta);
    this._renderSlotLegend(slot, canvasId);
    const exportBtn = document.querySelector(`#explorer-slot-${id} .chart-export-btn`);
    if (exportBtn) {
      const title = slot.chartType === 'bar'
        ? `${yMeta.label} por ${(CONFIG.explorerGroupBy[slot.source] || []).find(g => g.value === slot.groupBy)?.label || slot.groupBy}`
        : `${yMeta.label} vs ${xMeta.label}`;
      exportBtn.dataset.chartTitle = title;
    }
  },

  refreshAll() {
    this.slots.forEach(slot => this.renderSlot(slot.id));
  },

  destroyAll() {
    this.slots.forEach(slot => Charts.destroy('explorerChart_' + slot.id));
  },

  init() {
    if (this.slots.length === 0) {
      this.addChart();
    }
  },

  // ── Private ─────────────────────────────────────────────────────

  _getData(slot) {
    if (slot.source === 'wine') {
      return Filters.getFilteredWine ? Filters.getFilteredWine() : (DataStore.wineRecepcion || []);
    }
    return Filters.getFiltered ? Filters.getFiltered() : (DataStore.berryData || []);
  },

  _computeDerived(data, source) {
    if (source !== 'berry') return data;
    return data.map(d => {
      const out = Object.assign({}, d);
      // Maturity Index = Brix / TA
      if (typeof d.brix === 'number' && typeof d.ta === 'number' && d.ta > 0) {
        out.maturityIndex = Math.round((d.brix / d.ta) * 100) / 100;
      } else {
        out.maturityIndex = null;
      }
      // GDD
      if (WeatherStore && d.sampleDate) {
        out.gdd = WeatherStore.getCumulativeGDD ? WeatherStore.getCumulativeGDD(d.sampleDate, d.appellation) : null;
      } else {
        out.gdd = null;
      }
      // ANT Extractability — requires wine match
      out.antExtractability = null;
      if (typeof d.tANT === 'number' && d.lotCode && CONFIG.berryToWine[d.lotCode]) {
        const wineLots = CONFIG.berryToWine[d.lotCode];
        const wineData = DataStore.wineRecepcion || [];
        for (const wl of wineLots) {
          const wine = wineData.find(w => w.codigoBodega === wl && typeof w.antoWX === 'number');
          if (wine) {
            out.antExtractability = Math.round((wine.antoWX / d.tANT) * 1000) / 10;
            break;
          }
        }
      }
      return out;
    });
  },

  _getColorResolver(groupField, source) {
    if (groupField === 'appellation' || groupField === 'proveedor') {
      return (name) => CONFIG.resolveOriginColor(name);
    }
    if (groupField === 'variety' || groupField === 'variedad') {
      return (name) => CONFIG.varietyColors[name] || CONFIG._hashColor(name);
    }
    if (groupField === 'lotCode' || groupField === 'codigoBodega') {
      return (name) => CONFIG._hashColor(String(name));
    }
    // Vintage
    return (name) => {
      const vintageColors = { 2022: '#E06070', 2023: '#9B59B6', 2024: '#60A8C0', 2025: '#C4A060', 2026: '#7EC87A' };
      return vintageColors[name] || vintageColors[Number(name)] || CONFIG._hashColor(String(name));
    };
  },

  _updateSummary(slot, xMeta, yMeta) {
    const el = document.getElementById('explorer-summary-' + slot.id);
    if (!el) return;
    const typeMeta = CONFIG.explorerChartTypes.find(t => t.value === slot.chartType);
    const typeLabel = typeMeta ? typeMeta.label : slot.chartType;
    if (slot.chartType === 'bar') {
      const groups = CONFIG.explorerGroupBy[slot.source] || [];
      const groupMeta = groups.find(g => g.value === slot.groupBy);
      el.textContent = `${yMeta.label} por ${groupMeta ? groupMeta.label : slot.groupBy} \u2014 ${typeLabel}`;
    } else {
      el.textContent = `${yMeta.label} vs ${xMeta.label} \u2014 ${typeLabel}`;
    }
  },

  _populateLotPicker(slot) {
    const data = this._getData(slot);
    const field = slot.groupBy === 'codigoBodega' ? 'codigoBodega' : 'lotCode';
    const lots = [...new Set(data.map(d => d[field]).filter(Boolean))].sort();
    const listEl = document.getElementById('lot-list-' + slot.id);
    if (!listEl) return;
    listEl.innerHTML = lots.map(lot => {
      const checked = slot.selectedLots.includes(lot) ? ' checked' : '';
      return `<label class="lot-picker-item" data-lot="${lot}"><input type="checkbox" class="lot-checkbox" data-slot="${slot.id}" data-lot="${lot}"${checked}><span>${lot}</span></label>`;
    }).join('');
    this._updateLotCount(slot);
  },

  _filterLotPicker(id, query) {
    const listEl = document.getElementById('lot-list-' + id);
    if (!listEl) return;
    const q = query.toLowerCase();
    listEl.querySelectorAll('.lot-picker-item').forEach(item => {
      item.style.display = item.dataset.lot.toLowerCase().includes(q) ? '' : 'none';
    });
  },

  _toggleLotItem(id, lotCode, checked) {
    const slot = this._slotById(id);
    if (!slot) return;
    if (checked && !slot.selectedLots.includes(lotCode)) {
      slot.selectedLots.push(lotCode);
    } else if (!checked) {
      slot.selectedLots = slot.selectedLots.filter(l => l !== lotCode);
    }
    this._updateLotCount(slot);
  },

  _selectAllLots(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    const listEl = document.getElementById('lot-list-' + id);
    if (!listEl) return;
    slot.selectedLots = [];
    listEl.querySelectorAll('.lot-picker-item').forEach(item => {
      if (item.style.display !== 'none') {
        slot.selectedLots.push(item.dataset.lot);
        item.querySelector('input').checked = true;
      }
    });
    this._updateLotCount(slot);
  },

  _clearAllLots(id) {
    const slot = this._slotById(id);
    if (!slot) return;
    slot.selectedLots = [];
    const listEl = document.getElementById('lot-list-' + id);
    if (listEl) listEl.querySelectorAll('input').forEach(cb => { cb.checked = false; });
    this._updateLotCount(slot);
  },

  _updateLotCount(slot) {
    const el = document.getElementById('lot-count-' + slot.id);
    if (el) el.textContent = `${slot.selectedLots.length} seleccionados`;
  },

  _renderSlotLegend(slot, canvasId) {
    const el = document.getElementById('explorerLegend_' + slot.id);
    if (!el) return;
    const chart = Charts.instances[canvasId];
    if (!chart || !chart.data || !chart.data.datasets) { el.innerHTML = ''; return; }
    el.innerHTML = chart.data.datasets.map((ds, i) => {
      const color = ds.borderColor || ds.backgroundColor || '#888';
      const dimmed = chart.getDatasetMeta(i).hidden ? ' dimmed' : '';
      return `<span class="legend-item${dimmed}" data-slot="${slot.id}" data-ds-index="${i}" role="button" tabindex="0">` +
             `<span class="legend-dot" style="background-color:${color}"></span>${ds.label || ''}</span>`;
    }).join('');
  },

  _injectSlotDOM(slot) {
    const container = document.getElementById('explorer-charts');
    if (!container) return;

    const metrics = CONFIG.explorerMetrics[slot.source] || {};
    const groups = CONFIG.explorerGroupBy[slot.source] || [];

    const div = document.createElement('div');
    div.id = 'explorer-slot-' + slot.id;
    div.className = 'explorer-slot';
    const sid = slot.id;
    div.innerHTML = `
      <div class="explorer-slot-header">
        <button class="explorer-toggle-btn" id="explorer-toggle-btn-${sid}" data-slot="${sid}">\u25BC Configurar</button>
        <span class="explorer-summary" id="explorer-summary-${sid}"></span>
        <div class="explorer-slot-actions">
          <button class="chart-toggle explorer-line-toggle" data-slot="${sid}" title="Conectar puntos con lineas">Conectar Lineas</button>
          <button class="chart-toggle explorer-expand-toggle" data-slot="${sid}" title="Expandir grafico">\u26F6</button>
          <button class="chart-export-btn" data-slot="${sid}" data-chart-id="explorerChart_${sid}" data-chart-title="" title="Exportar grafico">&#x2913;</button>
          <button class="explorer-remove-btn" data-slot="${sid}" title="Eliminar">\u00D7</button>
        </div>
      </div>
      <div class="explorer-config-panel" id="explorer-config-panel-${sid}" style="display:none">
        <div class="explorer-config-row">
          <label class="explorer-config-label">Fuente
            <select id="explorer-source-${sid}" class="explorer-select explorer-source-select" data-slot="${sid}">
              <option value="berry" ${slot.source === 'berry' ? 'selected' : ''}>Bayas</option>
              <option value="wine" ${slot.source === 'wine' ? 'selected' : ''}>Vino</option>
            </select>
          </label>
          <label class="explorer-config-label">Eje X
            <select id="explorer-x-${sid}" class="explorer-select" ${slot.chartType === 'bar' ? 'disabled' : ''}>
              ${Object.entries(metrics).map(([k, v]) => `<option value="${k}" ${k === slot.xField ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </label>
          <label class="explorer-config-label">Eje Y
            <select id="explorer-y-${sid}" class="explorer-select">
              ${Object.entries(metrics).map(([k, v]) => `<option value="${k}" ${k === slot.yField ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </label>
          <label class="explorer-config-label">Tipo
            <select id="explorer-type-${sid}" class="explorer-select explorer-type-select" data-slot="${sid}">
              ${CONFIG.explorerChartTypes.map(t => `<option value="${t.value}" ${t.value === slot.chartType ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </label>
          <label class="explorer-config-label">Agrupar por
            <select id="explorer-group-${sid}" class="explorer-select explorer-group-select" data-slot="${sid}">
              ${groups.map(g => `<option value="${g.value}" ${g.value === slot.groupBy ? 'selected' : ''}>${g.label}</option>`).join('')}
            </select>
          </label>
          <button class="explorer-render-btn" data-slot="${sid}">Actualizar</button>
        </div>
        <div class="explorer-lot-picker" id="explorer-lot-picker-${sid}" style="display:none" data-slot="${sid}">
          <div class="lot-picker-header">
            <input type="text" class="lot-picker-search" id="lot-search-${sid}" placeholder="Buscar lote..." data-slot="${sid}">
            <span class="lot-picker-count" id="lot-count-${sid}">0 seleccionados</span>
            <button class="lot-picker-btn lot-picker-all" data-slot="${sid}">Todo</button>
            <button class="lot-picker-btn lot-picker-none" data-slot="${sid}">Limpiar</button>
          </div>
          <div class="lot-picker-list" id="lot-list-${sid}"></div>
        </div>
      </div>
      <div class="explorer-canvas-wrap" style="height:280px">
        <canvas id="explorerChart_${sid}"></canvas>
      </div>
      <div class="explorer-legend" id="explorerLegend_${sid}"></div>
    `;
    container.appendChild(div);
  },

  _populateDropdowns(slot) {
    const metrics = CONFIG.explorerMetrics[slot.source] || {};
    const groups = CONFIG.explorerGroupBy[slot.source] || [];

    const xEl = document.getElementById('explorer-x-' + slot.id);
    const yEl = document.getElementById('explorer-y-' + slot.id);
    const groupEl = document.getElementById('explorer-group-' + slot.id);

    const optionsHtml = Object.entries(metrics).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

    if (xEl) {
      xEl.innerHTML = optionsHtml;
      xEl.value = slot.xField;
    }
    if (yEl) {
      yEl.innerHTML = optionsHtml;
      yEl.value = slot.yField;
    }
    if (groupEl) {
      groupEl.innerHTML = groups.map(g => `<option value="${g.value}">${g.label}</option>`).join('');
      groupEl.value = slot.groupBy;
    }
  }
};
