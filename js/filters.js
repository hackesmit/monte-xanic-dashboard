// ── Filter System ──
import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { App } from './app.js';

export const Filters = {
  state: {
    vintages: new Set(),
    varieties: new Set(),
    origins: new Set(),
    lots: new Set(),
    grapeType: 'all',  // 'all', 'red', 'white'
    colorBy: 'variety',  // 'variety', 'origin'
    weatherLocation: 'VDG'  // 'VDG', 'VON', 'SV'
  },

  // Wine-specific filter state
  wineState: {
    vintages: new Set(),
    varieties: new Set(),
    origins: new Set(),
    grapeType: 'all'
  },

  _debounceTimer: null,
  _debouncedRefresh() {
    if (App._isMobile && App._isMobile()) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => App.refresh(), 200);
    } else {
      App.refresh();
    }
  },

  init() {
    this.buildVintageChips();
    this.buildVarietyChips();
    this.buildOriginChips();
    this.buildLotChips();
    this.buildWineVintageChips();
    this.buildWineVarietyChips();
    this.buildWineOriginChips();
    this.bindEvents();
    // Set "Todas" as visually active by default
    document.getElementById('btn-type-all')?.classList.add('active-all');
    document.getElementById('btn-wine-type-all')?.classList.add('active-all');
  },

  buildVintageChips() {
    const container = document.getElementById('vintage-chips');
    if (!container) return;
    container.innerHTML = '';
    const vintages = DataStore.getUniqueValues('vintage');
    vintages.forEach(v => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = v;
      chip.dataset.value = v;
      chip.onclick = () => this.toggleFilter('vintages', v, chip);
      container.appendChild(chip);
    });
  },

  buildVarietyChips() {
    const container = document.getElementById('variety-chips');
    if (!container) return;
    container.innerHTML = '';
    const varieties = DataStore.getUniqueValues('variety');
    varieties.forEach(v => {
      const chip = document.createElement('button');
      const color = CONFIG.varietyColors[v] || '#888';
      const isRed = CONFIG.grapeTypes.red.includes(v);
      chip.className = `chip variety-chip ${isRed ? 'type-red' : 'type-white'}`;
      chip.style.setProperty('--chip-color', color);
      chip.style.setProperty('--chip-bg', color + '18');
      chip.textContent = v;
      chip.dataset.value = v;
      chip.dataset.type = isRed ? 'red' : 'white';
      chip.onclick = () => this.toggleFilter('varieties', v, chip);
      container.appendChild(chip);
    });
  },

  shortenOrigin(name) {
    // New ranch-first format is already display-ready
    return name || '';
  },

  buildOriginChips() {
    const container = document.getElementById('origin-chips');
    if (!container) return;
    container.innerHTML = '';
    const origins = DataStore.getUniqueValues('appellation');
    origins.forEach(v => {
      const chip = document.createElement('button');
      const color = CONFIG.resolveOriginColor(v);
      chip.className = 'chip origin-chip';
      chip.style.setProperty('--chip-color', color);
      chip.style.setProperty('--chip-bg', color + '18');
      chip.textContent = this.shortenOrigin(v);
      chip.title = v;
      chip.dataset.value = v;
      chip.onclick = () => this.toggleFilter('origins', v, chip);
      container.appendChild(chip);
    });
  },

  buildLotChips() {
    const container = document.getElementById('lot-chips');
    if (!container) return;
    container.innerHTML = '';
    const lots = DataStore.getUniqueValues('sampleId');
    lots.forEach(v => {
      const chip = document.createElement('button');
      chip.className = 'chip lot-chip';
      chip.textContent = v;
      chip.dataset.value = v;
      chip.onclick = () => this.toggleFilter('lots', v, chip);
      container.appendChild(chip);
    });
  },

  // ── Wine-specific chip builders ──
  buildWineVintageChips() {
    const container = document.getElementById('wine-vintage-chips');
    if (!container) return;
    container.innerHTML = '';
    const vintages = new Set();
    DataStore.wineRecepcion.forEach(d => { if (d.vintage) vintages.add(d.vintage); });
    DataStore.winePreferment.forEach(d => { if (d.vintage) vintages.add(d.vintage); });
    [...vintages].sort().forEach(v => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = v;
      chip.dataset.value = v;
      chip.onclick = () => this.toggleWineFilter('vintages', v, chip);
      container.appendChild(chip);
    });
  },

  buildWineVarietyChips() {
    const container = document.getElementById('wine-variety-chips');
    if (!container) return;
    container.innerHTML = '';
    const varieties = new Set();
    DataStore.wineRecepcion.forEach(d => { if (d.variedad) varieties.add(d.variedad); });
    [...varieties].sort().forEach(v => {
      const chip = document.createElement('button');
      const color = CONFIG.varietyColors[v] || '#888';
      const isRed = CONFIG.grapeTypes.red.includes(v);
      chip.className = `chip variety-chip ${isRed ? 'type-red' : 'type-white'}`;
      chip.style.setProperty('--chip-color', color);
      chip.style.setProperty('--chip-bg', color + '18');
      chip.textContent = v;
      chip.dataset.value = v;
      chip.dataset.type = isRed ? 'red' : 'white';
      chip.onclick = () => this.toggleWineFilter('varieties', v, chip);
      container.appendChild(chip);
    });
  },

  buildWineOriginChips() {
    const container = document.getElementById('wine-origin-chips');
    if (!container) return;
    container.innerHTML = '';
    const origins = new Set();
    DataStore.wineRecepcion.forEach(d => { if (d.proveedor) origins.add(d.proveedor); });
    DataStore.winePreferment.forEach(d => { if (d.proveedor) origins.add(d.proveedor); });
    [...origins].sort().forEach(v => {
      const chip = document.createElement('button');
      const color = CONFIG.resolveOriginColor(v);
      chip.className = 'chip origin-chip';
      chip.style.setProperty('--chip-color', color);
      chip.style.setProperty('--chip-bg', color + '18');
      chip.textContent = this.shortenOrigin(v);
      chip.title = v;
      chip.dataset.value = v;
      chip.onclick = () => this.toggleWineFilter('origins', v, chip);
      container.appendChild(chip);
    });
  },

  // ── Toggle handlers ──
  toggleFilter(field, value, chipEl) {
    const set = this.state[field];
    if (set.has(value)) {
      set.delete(value);
      chipEl.classList.remove('active');
    } else {
      set.add(value);
      chipEl.classList.add('active');
    }
    this._debouncedRefresh();
  },

  toggleWineFilter(field, value, chipEl) {
    const set = this.wineState[field];
    if (set.has(value)) {
      set.delete(value);
      chipEl.classList.remove('active');
    } else {
      set.add(value);
      chipEl.classList.add('active');
    }
    this._debouncedRefresh();
  },

  clearAll() {
    ['vintages', 'varieties', 'origins', 'lots'].forEach(f => this.state[f].clear());
    this.state.grapeType = 'all';
    this.state.colorBy = 'variety';
    ['btn-type-all', 'btn-type-red', 'btn-type-white'].forEach(id => {
      document.getElementById(id)?.classList.remove('active-all', 'active-red', 'active-white');
    });
    document.getElementById('btn-type-all')?.classList.add('active-all');
    document.querySelectorAll('#variety-chips .variety-chip').forEach(c => { c.style.display = ''; });
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.color-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.color-mode-btn[data-mode="variety"]')?.classList.add('active');
    this.state.weatherLocation = 'VDG';
    const valleySelect = document.getElementById('weather-valley-select');
    if (valleySelect) valleySelect.value = 'VDG';
    const sectionTitle = document.getElementById('weather-section-title');
    if (sectionTitle) sectionTitle.textContent = 'Clima durante la Vendimia — Valle de Guadalupe';
    const lotSearch = document.getElementById('lot-search');
    if (lotSearch) lotSearch.value = '';
    this.filterLotSearch('');
    App.refresh();
  },

  clearAllWine() {
    ['vintages', 'varieties', 'origins'].forEach(f => this.wineState[f].clear());
    this.wineState.grapeType = 'all';
    ['btn-wine-type-all', 'btn-wine-type-red', 'btn-wine-type-white'].forEach(id => {
      document.getElementById(id)?.classList.remove('active-all', 'active-red', 'active-white');
    });
    document.getElementById('btn-wine-type-all')?.classList.add('active-all');
    document.querySelectorAll('#wine-variety-chips .variety-chip').forEach(c => { c.style.display = ''; });
    document.querySelectorAll('#wine-vintage-chips .chip, #wine-variety-chips .chip, #wine-origin-chips .chip').forEach(c => c.classList.remove('active'));
    App.refresh();
  },

  clearFilter(field) {
    this.state[field].clear();
    if (field === 'varieties') {
      this.state.grapeType = 'all';
      ['btn-type-all', 'btn-type-red', 'btn-type-white'].forEach(id => {
        document.getElementById(id)?.classList.remove('active-all', 'active-red', 'active-white');
      });
      document.getElementById('btn-type-all')?.classList.add('active-all');
      document.querySelectorAll('#variety-chips .variety-chip').forEach(c => { c.style.display = ''; });
    }
    const containerId = {
      vintages: 'vintage-chips',
      varieties: 'variety-chips',
      origins: 'origin-chips',
      lots: 'lot-chips'
    }[field];
    if (containerId) {
      document.querySelectorAll(`#${containerId} .chip`).forEach(c => c.classList.remove('active'));
    }
    App.refresh();
  },

  clearWineFilter(field) {
    this.wineState[field].clear();
    if (field === 'varieties') {
      this.wineState.grapeType = 'all';
      ['btn-wine-type-all', 'btn-wine-type-red', 'btn-wine-type-white'].forEach(id => {
        document.getElementById(id)?.classList.remove('active-all', 'active-red', 'active-white');
      });
      document.getElementById('btn-wine-type-all')?.classList.add('active-all');
      document.querySelectorAll('#wine-variety-chips .variety-chip').forEach(c => { c.style.display = ''; });
    }
    const containerId = {
      varieties: 'wine-variety-chips',
      origins: 'wine-origin-chips'
    }[field];
    if (containerId) {
      document.querySelectorAll(`#${containerId} .chip`).forEach(c => c.classList.remove('active'));
    }
    App.refresh();
  },

  setGrapeType(type) {
    this.state.grapeType = type;
    // Update UI - clear all first
    ['btn-type-all', 'btn-type-red', 'btn-type-white'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active-all', 'active-red', 'active-white');
    });
    if (type === 'all') {
      document.getElementById('btn-type-all')?.classList.add('active-all');
    } else if (type === 'red') {
      document.getElementById('btn-type-red')?.classList.add('active-red');
    } else if (type === 'white') {
      document.getElementById('btn-type-white')?.classList.add('active-white');
    }
    // Also filter variety chips visibility
    document.querySelectorAll('#variety-chips .variety-chip').forEach(chip => {
      if (type === 'all') {
        chip.style.display = '';
      } else {
        chip.style.display = chip.dataset.type === type ? '' : 'none';
      }
    });
    // Prune selected varieties that don't match the new type
    if (type !== 'all') {
      const valid = CONFIG.grapeTypes[type] || [];
      for (const v of this.state.varieties) {
        if (!valid.includes(v)) { this.state.varieties.delete(v); }
      }
    }
    this._debouncedRefresh();
  },

  setWineGrapeType(type) {
    this.wineState.grapeType = type;
    ['btn-wine-type-all', 'btn-wine-type-red', 'btn-wine-type-white'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active-all', 'active-red', 'active-white');
    });
    if (type === 'all') {
      document.getElementById('btn-wine-type-all')?.classList.add('active-all');
    } else if (type === 'red') {
      document.getElementById('btn-wine-type-red')?.classList.add('active-red');
    } else if (type === 'white') {
      document.getElementById('btn-wine-type-white')?.classList.add('active-white');
    }
    // Filter wine variety chips visibility
    document.querySelectorAll('#wine-variety-chips .variety-chip').forEach(chip => {
      if (type === 'all') {
        chip.style.display = '';
      } else {
        chip.style.display = chip.dataset.type === type ? '' : 'none';
      }
    });
    // Prune selected wine varieties that don't match the new type
    if (type !== 'all') {
      const valid = CONFIG.grapeTypes[type] || [];
      for (const v of this.wineState.varieties) {
        if (!valid.includes(v)) { this.wineState.varieties.delete(v); }
      }
    }
    this._debouncedRefresh();
  },

  setColorBy(mode) {
    this.state.colorBy = mode;
    document.querySelectorAll('.color-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.color-mode-btn[data-mode="${mode}"]`)?.classList.add('active');
    App.refresh();
  },

  getFiltered() {
    // Validate lot selections against data filtered without lot filter
    if (this.state.lots.size > 0) {
      const withoutLots = { ...this.state, lots: new Set() };
      const available = new Set(DataStore.getFilteredBerry(withoutLots).map(d => d.sampleId));
      let cleared = false;
      for (const lot of this.state.lots) {
        if (!available.has(lot)) { this.state.lots.delete(lot); cleared = true; }
      }
      if (cleared) {
        document.querySelectorAll('#lot-chips .chip').forEach(c => {
          if (!this.state.lots.has(c.dataset.value)) c.classList.remove('active');
        });
      }
    }
    return DataStore.getFilteredBerry(this.state);
  },

  getFilteredWine() {
    return DataStore.getFilteredWineAdvanced(this.wineState);
  },

  getFilteredPreferment() {
    return DataStore.getFilteredPrefermentAdvanced(this.wineState);
  },

  // Re-sync chip active classes with current filter state on view return
  syncChipUI() {
    const syncSet = (containerId, stateSet) => {
      document.querySelectorAll(`#${containerId} .chip`).forEach(c => {
        c.classList.toggle('active', stateSet.has(c.dataset.value));
      });
    };
    syncSet('vintage-chips', this.state.vintages);
    syncSet('variety-chips', this.state.varieties);
    syncSet('origin-chips', this.state.origins);
    syncSet('lot-chips', this.state.lots);
    syncSet('wine-vintage-chips', this.wineState.vintages);
    syncSet('wine-variety-chips', this.wineState.varieties);
    syncSet('wine-origin-chips', this.wineState.origins);
  },

  filterLotSearch(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#lot-chips .chip').forEach(chip => {
      chip.style.display = chip.dataset.value.toLowerCase().includes(q) ? '' : 'none';
    });
  },

  bindEvents() {
    const lotSearch = document.getElementById('lot-search');
    if (lotSearch) {
      lotSearch.addEventListener('input', (e) => this.filterLotSearch(e.target.value));
    }
  },

  // Get color for a data point based on current color mode
  getColor(dataPoint) {
    if (this.state.colorBy === 'origin') {
      return CONFIG.resolveOriginColor(dataPoint.appellation);
    }
    return CONFIG.varietyColors[dataPoint.variety] || CONFIG._hashColor(dataPoint.variety || '');
  },

  // Get legend items for current color mode
  getLegendItems(data) {
    const field = this.state.colorBy === 'origin' ? 'appellation' : 'variety';
    const unique = [...new Set(data.map(d => d[field]).filter(Boolean))].sort();
    if (this.state.colorBy === 'origin') {
      return unique.map(v => ({ label: v, color: CONFIG.resolveOriginColor(v) }));
    }
    return unique.map(v => ({ label: v, color: CONFIG.varietyColors[v] || CONFIG._hashColor(v) }));
  }
};
