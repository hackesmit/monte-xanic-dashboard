// ── Filter System ──

const Filters = {
  state: {
    vintages: new Set(),
    varieties: new Set(),
    origins: new Set(),
    lots: new Set(),
    grapeType: 'all',  // 'all', 'red', 'white'
    colorBy: 'variety'  // 'variety', 'origin'
  },

  // Wine-specific filter state
  wineState: {
    varieties: new Set(),
    origins: new Set(),
    grapeType: 'all'
  },

  init() {
    this.buildVintageChips();
    this.buildVarietyChips();
    this.buildOriginChips();
    this.buildLotChips();
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
    App.refresh();
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
    App.refresh();
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
    const lotSearch = document.getElementById('lot-search');
    if (lotSearch) lotSearch.value = '';
    this.filterLotSearch('');
    App.refresh();
  },

  clearAllWine() {
    ['varieties', 'origins'].forEach(f => this.wineState[f].clear());
    this.wineState.grapeType = 'all';
    ['btn-wine-type-all', 'btn-wine-type-red', 'btn-wine-type-white'].forEach(id => {
      document.getElementById(id)?.classList.remove('active-all', 'active-red', 'active-white');
    });
    document.getElementById('btn-wine-type-all')?.classList.add('active-all');
    document.querySelectorAll('#wine-variety-chips .variety-chip').forEach(c => { c.style.display = ''; });
    document.querySelectorAll('#wine-variety-chips .chip, #wine-origin-chips .chip').forEach(c => c.classList.remove('active'));
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
    App.refresh();
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
    App.refresh();
  },

  setColorBy(mode) {
    this.state.colorBy = mode;
    document.querySelectorAll('.color-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.color-mode-btn[data-mode="${mode}"]`)?.classList.add('active');
    App.refresh();
  },

  getFiltered() {
    return DataStore.getFilteredBerry(this.state);
  },

  getFilteredWine() {
    return DataStore.getFilteredWineAdvanced(this.wineState);
  },

  getFilteredPreferment() {
    return DataStore.getFilteredPrefermentAdvanced(this.wineState);
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
