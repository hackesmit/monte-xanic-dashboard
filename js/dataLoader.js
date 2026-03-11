// ── Data Loader: SheetJS Excel parsing + Supabase queries + state management ──

const DataStore = {
  berryData: [],
  wineRecepcion: [],
  winePreferment: [],
  loaded: { berry: false, wine: false },
  supabase: null,        // Supabase client instance (set by initSupabase)
  _supabaseReady: false, // true once credentials have been fetched

  // Initialise the Supabase client by fetching credentials from /api/config.
  // Falls back to localStorage dev keys when running locally without the API.
  async initSupabase() {
    if (this._supabaseReady) return !!this.supabase;
    try {
      let url, anonKey;

      // Primary: Vercel serverless function
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const cfg = await res.json();
          url     = cfg.supabaseUrl;
          anonKey = cfg.supabaseAnonKey;
        }
      } catch (_) { /* offline or local dev without vercel dev */ }

      // Fallback: manually-stored dev keys (localStorage only, never committed)
      if (!url || !anonKey) {
        url     = localStorage.getItem('xanic_dev_supabase_url');
        anonKey = localStorage.getItem('xanic_dev_supabase_key');
      }

      if (url && anonKey && window.supabase) {
        this.supabase = window.supabase.createClient(url, anonKey);
        this._supabaseReady = true;
        return true;
      }
    } catch (e) {
      console.warn('[DataStore] Supabase init failed:', e);
    }
    this._supabaseReady = true; // mark attempted so we don't retry endlessly
    return false;
  },

  // Map a Supabase wine_samples row → DataStore.berryData JS object
  _rowToBerry(row) {
    const obj = {};
    const map = CONFIG.supabaseToBerryJS;
    for (const col in map) {
      if (col in row) obj[map[col]] = row[col];
    }
    obj.lotCode   = this.extractLotCode(obj.sampleId);
    obj.grapeType = this.getGrapeType(obj.variety);
    return obj;
  },

  // Map a Supabase wine_samples row → DataStore.wineRecepcion JS object
  _rowToWine(row) {
    const obj = {};
    const map = CONFIG.supabaseToWineJS;
    for (const col in map) {
      if (col in row) obj[map[col]] = row[col];
    }
    obj.grapeType = this.getGrapeType(obj.variedad);
    return obj;
  },

  // Map a Supabase prefermentativos row → DataStore.winePreferment JS object
  _rowToPrefWine(row) {
    const obj = {};
    const map = CONFIG.supabasePrefToWineJS;
    for (const col in map) {
      if (col in row) obj[map[col]] = row[col];
    }
    // batch_code is a better display key than report_code
    if (row.batch_code) obj.codigoBodega = row.batch_code;
    obj.sampleType = 'Must';
    obj.grapeType  = this.getGrapeType(obj.variedad);
    return obj;
  },

  // Query Supabase and populate berryData / wineRecepcion / winePreferment.
  // Returns true if berry data was loaded successfully.
  async loadFromSupabase() {
    if (!this.supabase) return false;
    try {
      // Fetch all wine_samples in one query (typically < 5000 rows)
      const { data: samples, error: sErr } = await this.supabase
        .from('wine_samples')
        .select('*')
        .order('sample_date', { ascending: true });

      if (sErr) { console.warn('[DataStore] wine_samples query failed:', sErr.message); return false; }

      this.berryData    = (samples || []).filter(r => r.sample_type === 'Berries').map(r => this._rowToBerry(r));
      this.wineRecepcion = (samples || []).filter(r => r.sample_type !== 'Berries').map(r => this._rowToWine(r));

      // Fetch prefermentativos for winePreferment supplement
      const { data: prefs, error: pErr } = await this.supabase
        .from('prefermentativos')
        .select('*')
        .order('measurement_date', { ascending: true });

      if (!pErr && prefs && prefs.length) {
        const prefWine = prefs.map(r => this._rowToPrefWine(r));
        // Merge: Must rows from wine_samples + prefermentativos
        const mustRows = this.wineRecepcion.filter(r => r.sampleType === 'Must');
        this.winePreferment = [...mustRows, ...prefWine];
      } else {
        this.winePreferment = this.wineRecepcion.filter(r => r.sampleType === 'Must');
      }

      this.loaded.berry = this.berryData.length > 0;
      this.loaded.wine  = this.wineRecepcion.length > 0;

      if (this.loaded.berry || this.loaded.wine) this.cacheData();
      return this.loaded.berry;
    } catch (e) {
      console.warn('[DataStore] loadFromSupabase error:', e);
      return false;
    }
  },

  parseValue(v) {
    if (v === '-' || v === '—' || v === '' || v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const n = parseFloat(v);
    return isNaN(n) ? v : n;
  },

  parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) {
      const m = v.getMonth() + 1;
      const d = v.getDate();
      const y = v.getFullYear();
      return `${m}/${d}/${y}`;
    }
    return String(v);
  },

  parseBerrySheet(rows) {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0];
    const data = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const obj = {};
      let hasData = false;
      headers.forEach((h, idx) => {
        const key = CONFIG.berryColumns[h];
        if (key) {
          let val = row[idx];
          if (['brix','pH','ta','tANT','berryCount','berryWeight','berryFW',
               'colorL','colorA','colorB','colorI','colorT','daysPostCrush'].includes(key)) {
            val = this.parseValue(val);
          } else if (key === 'sampleDate') {
            val = this.parseDate(val);
          } else if (key === 'vintage') {
            val = this.parseValue(val);
          } else {
            val = val === '-' || val === '—' ? null : val;
          }
          obj[key] = val;
          if (val !== null && val !== undefined && val !== '') hasData = true;
        }
      });
      if (hasData && obj.sampleId) {
        // Extract lot code (strip vintage prefix for matching)
        obj.lotCode = this.extractLotCode(obj.sampleId);
        // Determine grape type
        obj.grapeType = this.getGrapeType(obj.variety);
        data.push(obj);
      }
    }
    return data;
  },

  parseWineSheet(rows, sheetName) {
    if (!rows || rows.length < 1) return [];
    const headers = rows[0];
    const data = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const obj = { _sheet: sheetName };
      let hasData = false;
      headers.forEach((h, idx) => {
        const hStr = String(h).trim();
        const key = CONFIG.wineColumns[hStr];
        if (key) {
          let val = row[idx];
          if (['brix','pH','at','ag','am','av','so2l','nfa','temp','solidos',
               'polifWX','antoWX','poliSpica','antoSpica','iptSpica'].includes(key)) {
            val = this.parseValue(val);
          } else if (key === 'fecha') {
            val = this.parseDate(val);
          } else {
            val = val === '-' || val === '—' ? null : val;
          }
          obj[key] = val;
          if (val !== null && val !== undefined && val !== '') hasData = true;
        }
      });
      if (hasData) data.push(obj);
    }
    return data;
  },

  extractLotCode(sampleId) {
    if (!sampleId) return '';
    let code = String(sampleId);
    // Remove vintage prefix (24 or 25)
    code = code.replace(/^(24|25)/, '');
    // Remove _BERRIES, _RECEPCION suffixes
    code = code.replace(/_(BERRIES|RECEPCION)$/i, '');
    return code;
  },

  getGrapeType(variety) {
    if (!variety) return 'unknown';
    if (CONFIG.grapeTypes.white.includes(variety)) return 'white';
    if (CONFIG.grapeTypes.red.includes(variety)) return 'red';
    return 'red'; // default to red for unknown
  },

  async loadFile(file) {
    return new Promise((resolve, reject) => {
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          if (isCSV) {
            // Fix unquoted commas in CSV headers (e.g. "Total Phenolics Index (IPT, d-less)")
            let text = e.target.result;
            text = text.replace(
              'Total Phenolics Index (IPT, d-less)',
              '"Total Phenolics Index (IPT, d-less)"'
            );
            const workbook = XLSX.read(text, { type: 'string', cellDates: true });
            resolve(workbook);
          } else {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            resolve(workbook);
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      if (isCSV) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  },

  sheetToArray(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  },

  // Detect if headers belong to a WineXRay export
  isWineXRayFormat(headers) {
    if (!headers || headers.length === 0) return false;
    const headerSet = new Set(headers.map(h => String(h).trim()));
    return headerSet.has('Sample Sequence Number') && headerSet.has('Sample Type');
  },

  // Parse wine-type rows from WineXRay format
  parseWineFromXRay(rows) {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0];
    const data = [];
    const numericKeys = ['antoWX','freeANT','boundANT','pTAN','iRPs','iptSpica',
                         'brix','pH','at','daysPostCrush',
                         'colorL','colorA','colorB','colorI','colorT'];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const obj = {};
      let hasData = false;
      headers.forEach((h, idx) => {
        const key = CONFIG.wineXRayColumns[h];
        if (key) {
          let val = row[idx];
          if (numericKeys.includes(key)) {
            val = this.parseValue(val);
          } else if (key === 'fecha') {
            val = this.parseDate(val);
          } else if (key === 'vintage') {
            val = this.parseValue(val);
          } else {
            val = val === '-' || val === '—' ? null : val;
          }
          obj[key] = val;
          if (val !== null && val !== undefined && val !== '') hasData = true;
        }
      });
      if (hasData && obj.codigoBodega) {
        // Skip DELETE entries
        if (String(obj.codigoBodega).toUpperCase().includes('DELETE')) continue;
        // Determine grape type
        obj.grapeType = this.getGrapeType(obj.variedad);
        data.push(obj);
      }
    }
    return data;
  },

  // Process a single WineXRay file that contains both berry and wine data
  async processWineXRayFile(file) {
    const wb = await this.loadFile(file);
    const sheetName = wb.SheetNames[0];
    const rows = this.sheetToArray(wb, sheetName);
    if (!rows || rows.length < 2) return { berry: 0, wine: 0 };

    const headers = rows[0];
    // Find Sample Type column index
    const typeIdx = headers.indexOf('Sample Type');
    if (typeIdx === -1) return { berry: 0, wine: 0 };

    // Split rows by Sample Type
    const berryRows = [headers];
    const wineRows = [headers];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const sampleType = String(row[typeIdx] || '').trim();
      if (sampleType === 'Berries') {
        berryRows.push(row);
      } else if (sampleType && sampleType !== '') {
        wineRows.push(row);
      }
    }

    // Parse berry data using existing berry parser
    this.berryData = this.parseBerrySheet(berryRows);
    this.loaded.berry = this.berryData.length > 0;

    // Parse wine data using new WineXRay parser
    const allWine = this.parseWineFromXRay(wineRows);
    // Split into recepcion (non-Must) and preferment (Must)
    this.wineRecepcion = allWine.filter(d => d.sampleType !== 'Must');
    this.winePreferment = allWine.filter(d => d.sampleType === 'Must');
    this.loaded.wine = allWine.length > 0;

    return { berry: this.berryData.length, wine: allWine.length };
  },

  async processBerryFile(file) {
    const wb = await this.loadFile(file);
    const sheetName = wb.SheetNames[0];
    const rows = this.sheetToArray(wb, sheetName);
    this.berryData = this.parseBerrySheet(rows);
    this.loaded.berry = true;
    return this.berryData.length;
  },

  async processWineFile(file) {
    const wb = await this.loadFile(file);
    const sheets = wb.SheetNames;
    for (const name of sheets) {
      const rows = this.sheetToArray(wb, name);
      if (name.toLowerCase().includes('recep') || name.toLowerCase().includes('2025')) {
        if (!name.toLowerCase().includes('preferm')) {
          this.wineRecepcion = this.parseWineSheet(rows, name);
        }
      }
      if (name.toLowerCase().includes('preferm')) {
        this.winePreferment = this.parseWineSheet(rows, name);
      }
    }
    if (this.wineRecepcion.length === 0 && sheets.length > 0) {
      const rows = this.sheetToArray(wb, sheets[0]);
      this.wineRecepcion = this.parseWineSheet(rows, sheets[0]);
    }
    if (this.winePreferment.length === 0 && sheets.length > 1) {
      const rows = this.sheetToArray(wb, sheets[1]);
      this.winePreferment = this.parseWineSheet(rows, sheets[1]);
    }
    this.loaded.wine = true;
    return this.wineRecepcion.length + this.winePreferment.length;
  },

  // Get unique sorted values from berry data
  getUniqueValues(field) {
    const vals = new Set();
    this.berryData.forEach(d => { if (d[field]) vals.add(d[field]); });
    return [...vals].sort();
  },

  // Get filtered berry data
  getFilteredBerry(filters) {
    return this.berryData.filter(d => {
      if (filters.vintages && filters.vintages.size > 0 && !filters.vintages.has(d.vintage)) return false;
      if (filters.varieties && filters.varieties.size > 0 && !filters.varieties.has(d.variety)) return false;
      if (filters.origins && filters.origins.size > 0 && !filters.origins.has(d.appellation)) return false;
      if (filters.lots && filters.lots.size > 0 && !filters.lots.has(d.sampleId)) return false;
      if (filters.grapeType && filters.grapeType !== 'all' && d.grapeType !== filters.grapeType) return false;
      return true;
    });
  },

  // Get wine data (filtered by varietal if applicable) — legacy
  getFilteredWine(filters) {
    return this.wineRecepcion.filter(d => {
      if (filters.varieties && filters.varieties.size > 0 && !filters.varieties.has(d.variedad)) return false;
      return true;
    });
  },

  // Advanced wine filtering (varietal + origin/proveedor + grape type)
  getFilteredWineAdvanced(wineState) {
    return this.wineRecepcion.filter(d => {
      if (wineState.varieties && wineState.varieties.size > 0 && !wineState.varieties.has(d.variedad)) return false;
      if (wineState.origins && wineState.origins.size > 0 && !wineState.origins.has(d.proveedor)) return false;
      if (wineState.grapeType && wineState.grapeType !== 'all') {
        const grapeType = this.getGrapeType(d.variedad);
        if (grapeType !== wineState.grapeType) return false;
      }
      return true;
    });
  },

  getFilteredPrefermentAdvanced(wineState) {
    return this.winePreferment.filter(d => {
      if (wineState.varieties && wineState.varieties.size > 0 && !wineState.varieties.has(d.variedad)) return false;
      if (wineState.grapeType && wineState.grapeType !== 'all') {
        const grapeType = this.getGrapeType(d.variedad);
        if (grapeType !== wineState.grapeType) return false;
      }
      return true;
    });
  },

  // Cache data to localStorage
  cacheData() {
    try {
      const cache = {
        berry: this.berryData,
        wineR: this.wineRecepcion,
        wineP: this.winePreferment,
        ts: Date.now()
      };
      localStorage.setItem('xanic_data_cache', JSON.stringify(cache));
    } catch (e) {
      console.warn('Cache write failed:', e);
    }
  },

  // Load from cache
  loadCache() {
    try {
      const raw = localStorage.getItem('xanic_data_cache');
      if (!raw) return false;
      const cache = JSON.parse(raw);
      // Cache for 7 days
      if (Date.now() - cache.ts > 7 * 24 * 60 * 60 * 1000) return false;
      this.berryData = cache.berry || [];
      this.wineRecepcion = cache.wineR || [];
      this.winePreferment = cache.wineP || [];
      this.loaded.berry = this.berryData.length > 0;
      this.loaded.wine = this.wineRecepcion.length > 0;
      return this.loaded.berry;
    } catch (e) {
      return false;
    }
  },

  clearCache() {
    localStorage.removeItem('xanic_data_cache');
  },

  // Load from pre-extracted JSON files (served via HTTP)
  async loadFromJSON() {
    try {
      const [berryRes, wineRRes, winePRes] = await Promise.all([
        fetch('data/berry_data.json').then(r => r.ok ? r.json() : []),
        fetch('data/wine_recepcion.json').then(r => r.ok ? r.json() : []),
        fetch('data/wine_preferment.json').then(r => r.ok ? r.json() : [])
      ]);
      this.berryData = berryRes;
      this.wineRecepcion = wineRRes;
      this.winePreferment = winePRes;
      this.loaded.berry = this.berryData.length > 0;
      this.loaded.wine = this.wineRecepcion.length > 0;
      this.cacheData();
      return this.loaded.berry;
    } catch (e) {
      console.warn('JSON load failed:', e);
      return false;
    }
  }
};
