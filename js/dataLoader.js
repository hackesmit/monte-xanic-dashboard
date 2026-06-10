// ── Data Loader: SheetJS Excel parsing + Supabase queries + state management ──
import { CONFIG } from './config.js';
import { Identity } from './identity.js';
import { weightedMean } from './aggregations.js';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

export const DataStore = {
  berryData: [],
  wineRecepcion: [],
  winePreferment: [],
  medicionesData: [],
  harvestTargetOverrides: [],
  receptionData: [],        // tank_receptions rows (snake_case, internal use)
  receptionLotsData: [],    // reception_lots rows (snake_case, internal use)
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
        const _token = localStorage.getItem('xanic_session_token');
        const res = await fetch('/api/config', {
          headers: _token ? { 'x-session-token': _token } : {}
        });
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

      if (url && anonKey) {
        this.supabase = createClient(url, anonKey);
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
    // Filter excluded samples
    if (CONFIG.isSampleExcluded(obj.sampleId)) return null;
    obj.variety      = CONFIG.normalizeVariety(obj.variety);
    obj.appellation  = CONFIG.normalizeAppellation(obj.appellation, obj.sampleId);
    // Filter California
    if (obj.appellation === 'California') return null;
    obj.lotCode      = Identity.extractLotCode(obj.sampleId);
    obj.grapeType    = this.getGrapeType(obj.variety);
    return obj;
  },

  // Map a Supabase wine_samples row → DataStore.wineRecepcion JS object
  _rowToWine(row) {
    const obj = {};
    const map = CONFIG.supabaseToWineJS;
    for (const col in map) {
      if (col in row) obj[map[col]] = row[col];
    }
    // Filter excluded samples
    if (CONFIG.isSampleExcluded(obj.codigoBodega)) return null;
    obj.variedad  = CONFIG.normalizeVariety(obj.variedad);
    obj.proveedor = CONFIG.normalizeAppellation(obj.proveedor, obj.codigoBodega);
    if (obj.proveedor === 'California') return null;
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
    if (row.batch_code) obj.codigoBodega = row.batch_code;
    if (CONFIG.isSampleExcluded(obj.codigoBodega)) return null;
    obj.variedad   = CONFIG.normalizeVariety(obj.variedad);
    obj.sampleType = 'Must';
    obj.grapeType  = this.getGrapeType(obj.variedad);
    // Extract vintage from batch_code if not mapped from DB
    if (!obj.vintage && obj.codigoBodega) {
      const vm = String(obj.codigoBodega).match(/^(\d{2})/);
      if (vm) obj.vintage = 2000 + parseInt(vm[1], 10);
    }
    return obj;
  },

  _rowToMedicion(row) {
    return {
      id: row.id,
      code: row.medicion_code,
      date: row.medicion_date,
      vintage: row.vintage_year,
      variety: CONFIG.normalizeVariety(row.variety),
      appellation: CONFIG.normalizeAppellation(row.appellation, row.lot_code),
      // Spreadsheet lot dialect ('TEKMP-S1') → berry dialect ('KTE-S1') so
      // the classification join can match. Covers rows uploaded before the
      // parser normalized at ingestion.
      lotCode: CONFIG.normalizeFieldLotCode(row.lot_code),
      tons: row.tons_received ? parseFloat(row.tons_received) : null,
      berryCount: row.berry_count_sample,
      berryWeight: row.berry_avg_weight_g ? parseFloat(row.berry_avg_weight_g) : null,
      berryDiameter: row.berry_diameter_mm ? parseFloat(row.berry_diameter_mm) : null,
      healthGrade: row.health_grade,
      healthMadura: row.health_madura || 0,
      healthInmadura: row.health_inmadura || 0,
      healthSobremadura: row.health_sobremadura || 0,
      healthPicadura: row.health_picadura || 0,
      healthEnfermedad: row.health_enfermedad || 0,
      healthQuemadura: row.health_quemadura || 0,
      phenolicMaturity: row.phenolic_maturity || null,
      measuredBy: row.measured_by,
      notes: row.notes,
      lastEditedAt: row.last_edited_at || null,
      lastEditedBy: row.last_edited_by || null,
      source:       row.source || 'form',
    };
  },

  // Paginated fetch — Supabase defaults to 1000 rows max per query
  async _fetchAll(table, orderCol = 'id') {
    const PAGE = 1000;
    let all = [], from = 0;
    while (true) {
      const { data, error } = await this.supabase
        .from(table).select('*')
        .order(orderCol, { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  },

  // Query Supabase and populate berryData / wineRecepcion / winePreferment.
  // Returns true if berry data was loaded successfully.
  async loadFromSupabase() {
    if (!this.supabase) return false;
    try {
      const samples = await this._fetchAll('wine_samples', 'sample_date');

      // Fetch prefermentativos for winePreferment supplement
      let prefs = [], pErr = null;
      try { prefs = await this._fetchAll('prefermentativos', 'measurement_date'); }
      catch (e) { pErr = e; }

      // Fetch tank_receptions + reception_lots for the quality-classification
      // engine's av/ag/polyphenols inputs. Failure is non-fatal — the engine's
      // partial-data guard handles missing params gracefully.
      let receptions = [], receptionLots = [];
      try {
        receptions = await this._fetchAll('tank_receptions', 'reception_date');
      } catch (_) { receptions = []; }
      try {
        receptionLots = await this._fetchAll('reception_lots', 'reception_id');
      } catch (_) { receptionLots = []; }

      // Demo mode may have been enabled while these fetches were in flight —
      // discard the result rather than clobbering the demo overlay.
      if (this._demoActive) return true;

      this.berryData    = (samples || []).filter(r => r.sample_type === 'Berries' || r.sample_type === 'Berry').map(r => this._rowToBerry(r)).filter(Boolean);
      this.wineRecepcion = (samples || []).filter(r => r.sample_type !== 'Berries' && r.sample_type !== 'Berry').map(r => this._rowToWine(r)).filter(Boolean);

      if (!pErr && prefs && prefs.length) {
        const prefWine = prefs.map(r => this._rowToPrefWine(r)).filter(Boolean);
        // Merge: Must rows from wine_samples + prefermentativos
        const mustRows = this.wineRecepcion.filter(r => r.sampleType === 'Must');
        this.winePreferment = [...mustRows, ...prefWine];
      } else {
        this.winePreferment = this.wineRecepcion.filter(r => r.sampleType === 'Must');
      }

      this.receptionData = receptions;
      this.receptionLotsData = receptionLots;

      this.loaded.berry = this.berryData.length > 0;
      this.loaded.wine  = this.wineRecepcion.length > 0;

      // Re-enrich so receptions join into berry rows
      this._enrichData();

      if (this.loaded.berry || this.loaded.wine) this.cacheData();
      return this.loaded.berry;
    } catch (e) {
      console.warn('[DataStore] loadFromSupabase error:', e);
      return false;
    }
  },

  async loadMediciones() {
    if (!this.supabase) return;
    try {
      const rows = await this._fetchAll('mediciones_tecnicas', 'medicion_date');
      if (this._demoActive) return;  // demo enabled mid-fetch — keep overlay
      this.medicionesData = (rows || []).map(r => this._rowToMedicion(r));
      // Re-run join so existing berryData picks up the new medicion rows.
      this.joinBerryWithMediciones();
      // Re-tag tonnage weights too: loadMediciones races loadFromSupabase at
      // boot, and if mediciones resolve last the _enrichData pass has already
      // run with an empty weight map.
      this._tagSampleWeights();
    } catch (e) {
      console.error('[DataStore] loadMediciones failed:', e);
    }
  },

  async loadHarvestTargetOverrides() {
    if (!this.supabase) { this.harvestTargetOverrides = []; return; }
    try {
      const rows = await this._fetchAll('harvest_target_overrides', 'id');
      if (this._demoActive) return;  // demo enabled mid-fetch — keep overlay
      this.harvestTargetOverrides = rows || [];
    } catch (e) {
      console.error('[DataStore] loadHarvestTargetOverrides failed:', e);
      this.harvestTargetOverrides = [];
    }
  },

  async upsertHarvestTargetOverride(row) {
    const token = (typeof localStorage !== 'undefined' && localStorage)
      ? (localStorage.getItem('xanic_session_token') || '')
      : '';
    const res = await fetch('/api/row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify({
        table: 'harvest_target_overrides',
        action: 'upsert',
        row,
      }),
    });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    // Refresh local cache
    await this.loadHarvestTargetOverrides();
    return data.row;
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
        obj.lotCode = Identity.extractLotCode(obj.sampleId);
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
            let text = e.target.result;
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
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
        reader.readAsText(file, 'UTF-8');
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
    const newBerry = this.parseBerrySheet(berryRows);
    this.berryData = this.berryData.concat(newBerry);
    this.loaded.berry = this.berryData.length > 0;

    // Parse wine data using new WineXRay parser
    const allWine = this.parseWineFromXRay(wineRows);
    // Split into recepcion (non-Must) and preferment (Must)
    this.wineRecepcion = this.wineRecepcion.concat(allWine.filter(d => d.sampleType !== 'Must'));
    this.winePreferment = this.winePreferment.concat(allWine.filter(d => d.sampleType === 'Must'));
    this.loaded.wine = this.wineRecepcion.length > 0 || this.winePreferment.length > 0;

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
  // Read-only existence probe for the upload preview: returns the key
  // columns of rows whose primary key column matches one of `primaryKeys`,
  // or null on error. Keeps Supabase access inside dataLoader.
  async fetchExistingKeys(table, keyCols, primaryKeys) {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
      .from(table)
      .select(keyCols.join(','))
      .in(keyCols[0], primaryKeys);
    return (error || !data) ? null : data;
  },

  getUniqueValues(field) {
    const vals = new Set();
    this.berryData.forEach(d => { if (d[field]) vals.add(d[field]); });
    // Numeric fields (vintage) sort numerically; default sort() would
    // compare them lexicographically.
    return [...vals].sort((a, b) =>
      (typeof a === 'number' && typeof b === 'number')
        ? a - b
        : String(a).localeCompare(String(b)));
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
      if (wineState.vintages && wineState.vintages.size > 0 && !wineState.vintages.has(d.vintage)) return false;
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
      if (wineState.vintages && wineState.vintages.size > 0 && !wineState.vintages.has(d.vintage)) return false;
      if (wineState.varieties && wineState.varieties.size > 0 && !wineState.varieties.has(d.variedad)) return false;
      if (wineState.grapeType && wineState.grapeType !== 'all') {
        const grapeType = this.getGrapeType(d.variedad);
        if (grapeType !== wineState.grapeType) return false;
      }
      return true;
    });
  },

  // Enrich loaded data with computed fields (lotCode, grapeType, normalization)
  _enrichData() {
    this.berryData.forEach(d => {
      if (d.sampleId && !d.lotCode) d.lotCode = Identity.extractLotCode(d.sampleId);
      if (d.lotCode) d.lotCode = CONFIG.normalizeFieldLotCode(d.lotCode);
      if (d.variety) d.variety = CONFIG.normalizeVariety(d.variety);
      if (d.appellation) d.appellation = CONFIG.normalizeAppellation(d.appellation, d.sampleId);
      if (!d.grapeType) d.grapeType = this.getGrapeType(d.variety);
    });
    this.wineRecepcion.forEach(d => {
      if (d.variedad) d.variedad = CONFIG.normalizeVariety(d.variedad);
      if (d.proveedor) d.proveedor = CONFIG.normalizeAppellation(d.proveedor, d.codigoBodega);
    });
    this.winePreferment.forEach(d => {
      if (d.variedad) d.variedad = CONFIG.normalizeVariety(d.variedad);
      if (d.proveedor) d.proveedor = CONFIG.normalizeAppellation(d.proveedor, d.codigoBodega);
    });
    // Enrich berry rows with their matching medicion (if loaded).
    // Idempotent — safe to call before or after loadMediciones().
    this.joinBerryWithMediciones();
    // Same pattern for tank_receptions → supplies av/ag/polyphenols.
    this.joinBerryWithReceptions();
    // Tag every berry + wine sample with _weight from mediciones.tons_received
    // for use by tonnage-weighted aggregations across KPIs/charts/maps.
    this._tagSampleWeights();
  },

  // Attach each berry row's matching mediciones_tecnicas entry as row.medicion,
  // translating camelCase DB-side fields to the snake_case contract the
  // classification engine expects (see js/classification.js / MT.11 tests).
  // Lookup key: (lotCode, vintage). Unmatched rows get medicion: null.
  joinBerryWithMediciones() {
    const medIndex = new Map();
    for (const m of (this.medicionesData || [])) {
      if (!m.lotCode || m.vintage == null) continue;
      const medPayload = {
        health_grade:       m.healthGrade,
        health_madura:      m.healthMadura,
        health_inmadura:    m.healthInmadura,
        health_sobremadura: m.healthSobremadura,
        health_picadura:    m.healthPicadura,
        health_enfermedad:  m.healthEnfermedad,
        health_quemadura:   m.healthQuemadura,
        tons_received:      m.tons,
        phenolic_maturity:  m.phenolicMaturity
      };
      // Multi-lot mediciones ('SBVDG-2A/2B') cover several field lots; index
      // under each expansion. Exact codes are set first and never overwritten.
      for (const code of this._expandLotCode(m.lotCode)) {
        const key = `${code}||${m.vintage}`;
        if (!medIndex.has(key)) medIndex.set(key, medPayload);
      }
    }
    for (const b of (this.berryData || [])) {
      if (!b.lotCode || b.vintage == null) { b.medicion = null; continue; }
      b.medicion = medIndex.get(`${b.lotCode}||${b.vintage}`) || null;
    }
    return this.berryData;
  },

  // Expand a multi-lot code ('SBVDG-2A/2B', 'GREVA-3A,4A') into per-lot
  // codes sharing the head: ['SBVDG-2A/2B', 'SBVDG-2A', 'SBVDG-2B'].
  // The verbatim code stays first so exact matches always win.
  _expandLotCode(code) {
    if (!code) return [];
    const c = String(code);
    if (!/[/,]/.test(c)) return [c];
    const dash = c.indexOf('-');
    if (dash < 0) return [c];
    const head = c.slice(0, dash);
    const parts = c.slice(dash + 1).split(/[/,]/).map(x => x.trim()).filter(Boolean);
    return [c, ...parts.map(x => `${head}-${x}`)];
  },

  // Normalize a lot code for cross-table matching.
  // Berry side has "CSMX-5B-1" (seq kept), reception_lots side has "CSMX-5B".
  // Also tolerates accidental vintage prefix ("25CSMX-5B") on either side.
  _normalizeLotCode(s) {
    if (s === null || s === undefined) return '';
    return String(s).trim().toUpperCase()
      .replace(/^(\d{2})-?/, '')       // strip 2-digit vintage prefix
      .replace(/_(BERRIES|RECEPCION)$/i, '');
  },

  // Tag each berry + wine sample row with _weight from its matching
  // mediciones_tecnicas.tons_received (Map<lotCode, tons>). Samples
  // without a matching medicion get _weight = null (callers fall back
  // to 1 via aggregations.weightedMean's fallbackWeight option).
  // Idempotent — safe to call multiple times. See Wave 1 #1 dispatch.
  _tagSampleWeights() {
    // Key on (lotCode, vintage) like joinBerryWithMediciones — keying on
    // lotCode alone let one vintage's tons overwrite every other vintage's
    // weight for the same lot.
    const weightByLot = new Map();
    for (const m of (this.medicionesData || [])) {
      if (m.lotCode && m.vintage != null && typeof m.tons === 'number' && m.tons > 0) {
        weightByLot.set(`${m.lotCode}||${m.vintage}`, m.tons);
      }
    }
    for (const b of (this.berryData || [])) {
      b._weight = (b.lotCode && b.vintage != null)
        ? (weightByLot.get(`${b.lotCode}||${b.vintage}`) ?? null)
        : null;
    }
    for (const w of (this.wineRecepcion || [])) {
      // Wine rows key on codigoBodega; the lot prefix matches mediciones lotCode
      // when stripped of vintage-prefix + suffix. Reuse the existing normalizer.
      const lot = w.lotCode || (w.codigoBodega ? this._normalizeLotCode(w.codigoBodega) : null);
      w._weight = (lot && w.vintage != null)
        ? (weightByLot.get(`${lot}||${w.vintage}`) ?? null)
        : null;
    }
  },

  // Enrich berry rows with av / ag / polyphenols averaged across any
  // tank_receptions whose reception_lots entry matches (lot_code, vintage).
  // Written only onto berry rows; no DB writes, no mutation of reception data.
  // Idempotent: running this twice yields the same result.
  joinBerryWithReceptions() {
    // Build reception lookups. reception_lots rows uploaded since
    // migration_reception_lots_upsert carry report_code with reception_id
    // NULL ("the reception_id path never worked" — see that migration), so
    // report_code is the primary key here; reception_id is kept as fallback
    // for legacy/demo rows. Requiring reception_id silently dropped EVERY
    // uploaded lot → av/ag/polifenoles never reached the berries → the
    // calidad map could not grade anything (impSum < 60).
    const recByReport = new Map();
    const recById = new Map();
    for (const r of (this.receptionData || [])) {
      if (!r) continue;
      if (r.report_code) recByReport.set(r.report_code, r);
      if (r.id != null) recById.set(r.id, r);
    }

    // Build lot-code-key → [receptions...] index, seeded from reception_lots.
    // Key is `${normLot(lot_code)}||${vintage_year}`.
    const lotIndex = new Map();
    for (const rl of (this.receptionLotsData || [])) {
      if (!rl || !rl.lot_code) continue;
      const rec = (rl.report_code != null ? recByReport.get(rl.report_code) : null)
               ?? (rl.reception_id != null ? recById.get(rl.reception_id) : null);
      if (!rec || rec.vintage_year == null) continue;
      // Strip the vintage prefix BEFORE dialect normalization — reception
      // files write '25TEKMP-S1' and the dialect rules anchor on letters.
      const base = CONFIG.normalizeFieldLotCode(this._normalizeLotCode(rl.lot_code));
      for (const code of this._expandLotCode(base)) {
        const key = `${this._normalizeLotCode(code)}||${rec.vintage_year}`;
        if (!lotIndex.has(key)) lotIndex.set(key, []);
        lotIndex.get(key).push(rec);
      }
    }

    const avgField = (recs, primary, fallback) => {
      // Normalize to a numeric-only array of { v, _weight: 1 } shape so
      // weightedMean can consume it. Receptions don't carry per-row weights,
      // so this is an unweighted mean equivalent to the prior implementation.
      const rows = recs.map(r => {
        let v = r[primary];
        if ((v === null || v === undefined || v === '') && fallback) v = r[fallback];
        const num = v === null || v === undefined || v === '' ? NaN : Number(v);
        return { v: Number.isFinite(num) ? num : null, _weight: 1 };
      });
      return weightedMean(rows, 'v');
    };

    for (const b of (this.berryData || [])) {
      if (!b.lotCode || b.vintage == null) continue;
      const normBerry = this._normalizeLotCode(b.lotCode);
      // Try exact, then with trailing seq (e.g. "CSMX-5B-1" → "CSMX-5B") stripped
      let recs = lotIndex.get(`${normBerry}||${b.vintage}`);
      if (!recs || !recs.length) {
        const stripped = normBerry.replace(/-\d+$/, '');
        if (stripped && stripped !== normBerry) {
          recs = lotIndex.get(`${stripped}||${b.vintage}`);
        }
      }
      if (!recs || !recs.length) continue;

      const av = avgField(recs, 'av');
      const ag = avgField(recs, 'ag');
      const poly = avgField(recs, 'polifenoles_wx', 'poli_spica');

      if (av !== null) b.av = av;
      if (ag !== null) b.ag = ag;
      if (poly !== null) b.polyphenols = poly;
    }
    return this.berryData;
  },

  // Cache data to localStorage
  cacheData() {
    try {
      const cache = {
        berry: this.berryData,
        wineR: this.wineRecepcion,
        wineP: this.winePreferment,
        recs:  this.receptionData,
        recL:  this.receptionLotsData,
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
      this.receptionData = cache.recs || [];
      this.receptionLotsData = cache.recL || [];
      this._enrichData();
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
      this._enrichData();
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
