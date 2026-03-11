// ── Upload Manager: File → Supabase pipeline ──
// Auto-detects file type: .csv = WineXRay, .xlsx = Recepción de Tanque
// All user-facing messages are in Spanish.

const UploadManager = {

  // Regex for WineXRay below-detection values: <50, <10, >50, etc.
  _belowDetectionRe: /^[<>]\s*\d+(\.\d+)?$/,

  getFileType(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) return 'winexray';
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'recepcion';
    return 'unknown';
  },

  // Normalize a raw cell value for numeric Supabase columns
  _normalizeValue(val) {
    if (val === null || val === undefined) return null;
    if (val instanceof Date) return val.toISOString().split('T')[0];
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    if (str === '' || str === '-' || str === '—' || str === 'NA' || str === 'N/A') return null;
    const n = parseFloat(str);
    return isNaN(n) ? str : n;
  },

  // Parse WineXRay CSV/XLSX rows into wine_samples insert payloads
  parseWineXRay(rows) {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0].map(h => String(h || '').trim());
    const typeIdx = headers.indexOf('Sample Type');
    const result = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const sampleType = typeIdx !== -1 ? String(row[typeIdx] || '').trim() : '';
      if (sampleType === 'Control Wine') continue;

      const obj = { below_detection: false };

      headers.forEach((h, idx) => {
        const col = CONFIG.wxToSupabase[h];
        if (!col) return;

        let val = row[idx];
        const str = val !== null && val !== undefined ? String(val).trim() : '';

        // Detect below-detection strings like <50, <10
        if (this._belowDetectionRe.test(str)) {
          obj.below_detection = true;
          obj[col] = null;
        } else {
          obj[col] = this._normalizeValue(val);
        }
      });

      if (obj.sample_id) result.push(obj);
    }
    return result;
  },

  // Parse Recepción de Tanque Excel workbook
  // Returns { receptions, lots, preferment }
  parseRecepcion(wb) {
    const receptions = [];
    const lots = [];
    const preferment = [];

    for (const sheetName of wb.SheetNames) {
      const lower = sheetName.toLowerCase();
      const rows = DataStore.sheetToArray(wb, sheetName);
      if (!rows || rows.length < 2) continue;

      const headers = rows[0].map(h => String(h || '').trim());

      if (lower.includes('preferm')) {
        // ── Prefermentativos sheet ──
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const obj = {};
          let hasData = false;
          headers.forEach((h, idx) => {
            const col = CONFIG.prefermentToSupabase[h];
            if (!col) return;
            const val = this._normalizeValue(row[idx]);
            obj[col] = val;
            if (val !== null) hasData = true;
          });
          if (hasData && obj.report_code) preferment.push(obj);
        }

      } else if (lower.includes('recep')) {
        // ── Recepción sheet ──
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const obj = {};
          let hasData = false;
          headers.forEach((h, idx) => {
            const col = CONFIG.recepcionToSupabase[h];
            if (!col) return;
            const val = this._normalizeValue(row[idx]);
            obj[col] = val;
            if (val !== null) hasData = true;
          });
          if (!hasData || !obj.report_code) continue;

          // Extract vintage_year from batch_code prefix (25 → 2025)
          if (obj.batch_code) {
            const m = String(obj.batch_code).match(/^(\d{2})/);
            if (m) obj.vintage_year = 2000 + parseInt(m[1], 10);
          }

          // Pull lot columns out before insert
          const reportCode = obj.report_code;
          for (let pos = 1; pos <= 4; pos++) {
            const lotKey = `_lot${pos}`;
            if (obj[lotKey]) {
              lots.push({ report_code: reportCode, lot_code: obj[lotKey], lot_position: pos });
            }
            delete obj[lotKey];
          }

          receptions.push(obj);
        }
      }
    }

    return { receptions, lots, preferment };
  },

  // Upsert rows to a Supabase table in batches of 500
  async upsertRows(table, rows, conflictCol) {
    if (!rows.length) return { count: 0, error: null };
    const sb = DataStore.supabase;
    if (!sb) return { count: 0, error: 'Supabase no inicializado' };

    let total = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await sb.from(table).upsert(chunk, { onConflict: conflictCol });
      if (error) return { count: total, error: error.message };
      total += chunk.length;
    }
    return { count: total, error: null };
  },

  // Main entry point — called when a file is dropped on the DB upload zone
  async handleUpload(file, statusEl) {
    const type = this.getFileType(file);

    if (type === 'unknown') {
      this._setStatus(statusEl, 'error', '✗ Formato no reconocido. Use .csv (WineXRay) o .xlsx (Recepción de Tanque).');
      return;
    }

    if (!DataStore.supabase) {
      this._setStatus(statusEl, 'error', '✗ Base de datos no disponible. Verifique la configuración de Supabase.');
      return;
    }

    this._setStatus(statusEl, 'pending', `⏳ Leyendo ${file.name}...`);

    try {
      const wb = await DataStore.loadFile(file);

      if (type === 'winexray') {
        const sheetName = wb.SheetNames[0];
        const rows = DataStore.sheetToArray(wb, sheetName);
        const samples = this.parseWineXRay(rows);

        if (!samples.length) {
          this._setStatus(statusEl, 'error', '✗ No se encontraron muestras en el archivo.');
          return;
        }

        const berryCount = samples.filter(s => s.sample_type === 'Berries').length;
        const wineCount  = samples.length - berryCount;
        this._setStatus(statusEl, 'pending', `⏳ ${samples.length} muestras (${berryCount} bayas, ${wineCount} vinos). Guardando...`);

        const { count, error } = await this.upsertRows('wine_samples', samples, 'sample_id');
        if (error) {
          this._setStatus(statusEl, 'error', '✗ Error al cargar datos. Verificar formato del archivo.');
          console.error('[upload] wine_samples error:', error);
          return;
        }

        this._setStatus(statusEl, 'success', `✓ ${count} muestras agregadas correctamente.`);
        this._refreshDashboard();

      } else if (type === 'recepcion') {
        const { receptions, lots, preferment } = this.parseRecepcion(wb);
        const total = receptions.length + preferment.length;

        if (!total) {
          this._setStatus(statusEl, 'error', '✗ No se encontraron datos en el archivo. Verifique las hojas del Excel.');
          return;
        }

        this._setStatus(statusEl, 'pending',
          `⏳ ${receptions.length} recepciones, ${preferment.length} prefermentativos. Guardando...`);

        // 1 — Insert receptions
        const { count: rCount, error: rErr } = await this.upsertRows('tank_receptions', receptions, 'report_code');
        if (rErr) {
          this._setStatus(statusEl, 'error', '✗ Error al cargar datos. Verificar formato del archivo.');
          console.error('[upload] tank_receptions error:', rErr);
          return;
        }

        // 2 — Insert reception_lots (requires reception IDs)
        if (lots.length) {
          const reportCodes = [...new Set(lots.map(l => l.report_code))];
          const { data: inserted, error: fetchErr } = await DataStore.supabase
            .from('tank_receptions')
            .select('id, report_code')
            .in('report_code', reportCodes);

          if (!fetchErr && inserted) {
            const codeToId = {};
            inserted.forEach(r => { codeToId[r.report_code] = r.id; });
            const lotRows = lots
              .filter(l => codeToId[l.report_code])
              .map(l => ({ reception_id: codeToId[l.report_code], lot_code: l.lot_code, lot_position: l.lot_position }));
            await this.upsertRows('reception_lots', lotRows, 'reception_id,lot_code');
          }
        }

        // 3 — Insert prefermentativos
        const { count: pCount, error: pErr } = await this.upsertRows('prefermentativos', preferment, 'report_code');
        if (pErr) {
          this._setStatus(statusEl, 'error', '✗ Error al cargar datos. Verificar formato del archivo.');
          console.error('[upload] prefermentativos error:', pErr);
          return;
        }

        this._setStatus(statusEl, 'success', `✓ ${rCount + pCount} registros agregados correctamente.`);
        this._refreshDashboard();
      }

    } catch (err) {
      console.error('[upload] unexpected error:', err);
      this._setStatus(statusEl, 'error', '✗ Error al cargar datos. Verificar formato del archivo.');
    }
  },

  _setStatus(el, type, msg) {
    if (!el) return;
    const cls = type === 'success' ? 'upload-success' : type === 'error' ? 'upload-error' : 'upload-pending';
    el.innerHTML = `<span class="${cls}">${msg}</span>`;
  },

  async _refreshDashboard() {
    const loaded = await DataStore.loadFromSupabase();
    if (loaded && App.initialized) App.refresh();
  }
};
