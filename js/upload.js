// ── Upload Manager: File → Supabase pipeline ──
// Auto-detects file type: .csv = WineXRay, .xlsx = Recepción de Tanque
// All user-facing messages are in Spanish.

const UploadManager = {
  _uploading: false,

  _belowDetectionRe: /^<\s*\d+(\.\d+)?$/,
  _aboveDetectionRe: /^>\s*(\d+(\.\d+)?)$/,
  _labTestRe: /\b(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)\b/i,

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

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
    // Validate that headers match WineXRay format
    const knownHeaders = Object.keys(CONFIG.wxToSupabase);
    const matchCount = headers.filter(h => knownHeaders.includes(h)).length;
    if (matchCount === 0) return { error: 'no_headers' };
    const typeIdx = headers.indexOf('Sample Type');
    const result = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const sampleType = typeIdx !== -1 ? String(row[typeIdx] || '').trim() : '';
      if (sampleType === 'Control Wine') continue;

      // Skip lab extraction tests and non-grape fruit samples
      const sampleIdRaw = headers.indexOf('Sample Id') !== -1 ? String(row[headers.indexOf('Sample Id')] || '').trim() : '';
      if (this._labTestRe.test(sampleIdRaw) || this._labTestRe.test(sampleType)) continue;

      // Skip experimental, California, and specifically excluded samples
      if (CONFIG.isSampleExcluded(sampleIdRaw)) continue;

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
        } else if (this._aboveDetectionRe.test(str)) {
          const m = str.match(this._aboveDetectionRe);
          obj[col] = m ? parseFloat(m[1]) : null;
        } else {
          obj[col] = this._normalizeValue(val);
        }
      });

      if (obj.sample_id) {
        if (obj.variety) obj.variety = CONFIG.normalizeVariety(obj.variety);
        if (obj.appellation) obj.appellation = CONFIG.normalizeAppellation(obj.appellation, obj.sample_id);
        if (obj.appellation === 'California') continue;
        if (!obj.vintage_year && obj.sample_id) {
          const vm = String(obj.sample_id).match(/^(\d{2})/);
          if (vm) {
            const y = 2000 + parseInt(vm[1], 10);
            obj.vintage_year = (y >= 2015 && y <= 2040) ? y : null;
          }
        }
        result.push(obj);
      }
    }

    // Assign sample_seq deterministically via shared Identity module
    Identity.canonicalSeqAssign(result);

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
          if (hasData && obj.report_code) {
            if (obj.batch_code && !obj.vintage_year) {
              const vm = String(obj.batch_code).match(/^(\d{2})/);
              if (vm) {
                const y = 2000 + parseInt(vm[1], 10);
                obj.vintage_year = (y >= 2015 && y <= 2040) ? y : null;
              }
            }
            preferment.push(obj);
          }
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
            if (m) {
              const y = 2000 + parseInt(m[1], 10);
              obj.vintage_year = (y >= 2015 && y <= 2040) ? y : null;
            }
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
  // Check how many rows already exist in the DB (for new vs update preview)
  // keyCols: array of column names forming the composite conflict key
  async _detectDuplicates(table, rows, keyCols) {
    if (!rows.length || !DataStore.supabase) return { updateCount: 0 };
    if (!Array.isArray(keyCols)) keyCols = [keyCols];
    try {
      const primaryCol = keyCols[0];
      const keys = [...new Set(rows.map(r => r[primaryCol]).filter(Boolean))];
      if (!keys.length) return { updateCount: 0 };
      // Query existing rows matching the primary key column, then composite-match locally
      const { data, error } = await DataStore.supabase
        .from(table)
        .select(keyCols.join(','))
        .in(primaryCol, keys);
      if (error || !data) return { updateCount: 0 };
      if (keyCols.length === 1) return { updateCount: data.length };
      // Composite key — build set of "col1|col2|..." for matching
      const toKey = r => keyCols.map(c => r[c] ?? '').join('|');
      const existing = new Set(data.map(toKey));
      const matches = rows.filter(r => existing.has(toKey(r)));
      return { updateCount: matches.length };
    } catch (_) {
      return { updateCount: 0 };
    }
  },

  async upsertRows(table, rows) {
    if (!rows.length) return { count: 0, error: null };

    // Route through server-side endpoint for role validation
    const token = Auth.getToken();
    if (!token) return { count: 0, error: 'No autorizado — inicie sesión' };

    let total = 0;
    // Batch into chunks of 500
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      try {
        const resp = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': token
          },
          body: JSON.stringify({ table, rows: chunk })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          return { count: total, error: data.error || 'Error al insertar datos' };
        }
        total += data.count || chunk.length;
      } catch (err) {
        return { count: total, error: err.message };
      }
    }
    return { count: total, error: null };
  },

  // Main entry point — called when a file is dropped on the DB upload zone
  async handleUpload(file, statusEl) {
    if (this._uploading) {
      this._setStatus(statusEl, 'error', 'Carga en progreso, espere...');
      return;
    }

    // Server-side role check will enforce this, but fail fast on client
    if (!Auth.canUpload()) {
      this._setStatus(statusEl, 'error', '✗ Sin permisos para subir datos.');
      return;
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      this._setStatus(statusEl, 'error', '✗ Archivo demasiado grande (máx 10 MB).');
      return;
    }

    const type = this.getFileType(file);

    if (type === 'unknown') {
      this._setStatus(statusEl, 'error', '✗ Formato no reconocido. Use .csv (WineXRay) o .xlsx (Recepción de Tanque).');
      return;
    }

    if (!DataStore.supabase) {
      this._setStatus(statusEl, 'error', '✗ Base de datos no disponible. Verifique la configuración de Supabase.');
      return;
    }

    this._uploading = true;

    this._setStatus(statusEl, 'pending', `⏳ Leyendo ${this._esc(file.name)}...`);

    try {
      const wb = await DataStore.loadFile(file);

      if (type === 'winexray') {
        const sheetName = wb.SheetNames[0];
        const rows = DataStore.sheetToArray(wb, sheetName);
        const samples = this.parseWineXRay(rows);

        if (samples && samples.error === 'no_headers') {
          this._setStatus(statusEl, 'error', '✗ Archivo sin encabezados reconocidos. Verifique el formato WineXRay.');
          return;
        }

        if (!samples || !samples.length) {
          this._setStatus(statusEl, 'error', '✗ No se encontraron muestras en el archivo.');
          return;
        }

        const berryCount = samples.filter(s => s.sample_type === 'Berries').length;
        const wineCount  = samples.length - berryCount;

        // Detect duplicates before upsert
        const dupInfo = await this._detectDuplicates('wine_samples', samples, ['sample_id', 'sample_date', 'sample_seq']);
        const newCount = samples.length - dupInfo.updateCount;
        this._setStatus(statusEl, 'pending',
          `⏳ ${samples.length} muestras (${newCount} nuevas, ${dupInfo.updateCount} actualizadas). Guardando...`);

        const { count, error } = await this.upsertRows('wine_samples', samples);
        if (error) {
          this._setStatus(statusEl, 'error', '✗ Error al cargar datos. Verificar formato del archivo.');
          console.error('[upload] wine_samples error:', error);
          return;
        }

        const successMsg = dupInfo.updateCount > 0
          ? `✓ ${count} muestras procesadas (${newCount} nuevas, ${dupInfo.updateCount} actualizadas).`
          : `✓ ${count} muestras agregadas correctamente.`;
        this._setStatus(statusEl, 'success', successMsg);
        this._refreshDashboard();

      } else if (type === 'recepcion') {
        const { receptions, lots, preferment } = this.parseRecepcion(wb);
        const total = receptions.length + preferment.length;

        if (!total) {
          this._setStatus(statusEl, 'error', '✗ No se encontraron datos en el archivo. Verifique las hojas del Excel.');
          return;
        }

        // Detect duplicates
        const recDup = await this._detectDuplicates('tank_receptions', receptions, ['report_code']);
        const prefDup = await this._detectDuplicates('prefermentativos', preferment, ['report_code', 'measurement_date']);
        const newRec = receptions.length - recDup.updateCount;
        const newPref = preferment.length - prefDup.updateCount;
        this._setStatus(statusEl, 'pending',
          `⏳ ${receptions.length} recepciones (${newRec} nuevas), ${preferment.length} prefermentativos (${newPref} nuevos). Guardando...`);

        // 1 — Insert receptions
        const { count: rCount, error: rErr } = await this.upsertRows('tank_receptions', receptions);
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
            // Delete old lots before inserting new ones
            const receptionIds = Object.values(codeToId);
            if (receptionIds.length) {
              await DataStore.supabase.from('reception_lots').delete().in('reception_id', receptionIds);
            }
            const lotRows = lots
              .filter(l => codeToId[l.report_code])
              .map(l => ({ reception_id: codeToId[l.report_code], lot_code: l.lot_code, lot_position: l.lot_position }));
            if (lotRows.length) {
              const { error: lotErr } = await this.upsertRows('reception_lots', lotRows);
              if (lotErr) console.error('[upload] reception_lots error:', lotErr);
            }
          }
        }

        // 3 — Insert prefermentativos
        const { count: pCount, error: pErr } = await this.upsertRows('prefermentativos', preferment);
        if (pErr) {
          this._setStatus(statusEl, 'error', '✗ Error al cargar datos. Verificar formato del archivo.');
          console.error('[upload] prefermentativos error:', pErr);
          return;
        }

        const totalUpdates = recDup.updateCount + prefDup.updateCount;
        const recSuccessMsg = totalUpdates > 0
          ? `✓ ${rCount + pCount} registros procesados (${newRec + newPref} nuevos, ${totalUpdates} actualizados).`
          : `✓ ${rCount + pCount} registros agregados correctamente.`;
        this._setStatus(statusEl, 'success', recSuccessMsg);
        this._refreshDashboard();
      }

    } catch (err) {
      console.error('[upload] unexpected error:', err);
      this._setStatus(statusEl, 'error', '✗ Error al cargar datos. Verificar formato del archivo.');
    } finally {
      this._uploading = false;
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
  },

  async cleanupLabSamples() {
    if (this._uploading) { console.warn('Upload in progress — cleanup skipped'); return; }
    if (!DataStore.supabase) { console.error('Supabase not connected'); return; }
    this._uploading = true;
    const sb = DataStore.supabase;
    let total = 0;

    try {
      // 1 — Delete by sample_id ILIKE patterns (lab tests, non-grape fruit, test runs)
      const patterns = [
        'COLORPRO%', 'CRUSH%', 'WATER%',
        '%BLUEBERRY%', '%RASPBERRY%', '%RASBERRY%', '%BLACKBERRY%', '%BLKBERRY%',
        '%EXPERIMENT%', '%EXPERIMENTO%'
      ];
      for (const p of patterns) {
        const { data, error } = await sb
          .from('wine_samples').delete()
          .ilike('sample_id', p)
          .select('id');
        if (error) { console.error(`Delete ${p} failed:`, error.message); continue; }
        if (data && data.length) { total += data.length; console.log(`Deleted ${data.length} rows matching sample_id ILIKE '${p}'`); }
      }

      // 1b — Delete exact-match 'NORMAL' sample_id
      {
        const { data, error } = await sb
          .from('wine_samples').delete()
          .eq('sample_id', 'NORMAL')
          .select('id');
        if (error) { console.error('Delete NORMAL failed:', error.message); }
        else if (data && data.length) { total += data.length; console.log(`Deleted ${data.length} rows with sample_id = 'NORMAL'`); }
      }

      // 2 — Delete specifically excluded sample IDs
      const excludedIds = [...CONFIG._excludedSamples];
      if (excludedIds.length) {
        const { data, error } = await sb
          .from('wine_samples').delete()
          .in('sample_id', excludedIds)
          .select('id');
        if (error) { console.error('Delete excluded IDs failed:', error.message); }
        else if (data && data.length) { total += data.length; console.log(`Deleted ${data.length} specifically excluded samples`); }
      }

      // 3 — Delete California appellation samples
      const { data: caData, error: caErr } = await sb
        .from('wine_samples').delete()
        .eq('appellation', 'California')
        .select('id');
      if (caErr) { console.error('Delete California failed:', caErr.message); }
      else if (caData && caData.length) { total += caData.length; console.log(`Deleted ${caData.length} California samples`); }

      console.log(`Total deleted: ${total} lab/test/excluded samples`);
      if (total > 0) {
        DataStore.clearCache();
        await this._refreshDashboard();
      }
      return total;
    } finally {
      this._uploading = false;
    }
  }
};
