// js/upload/prerecepcion.js
// Pre-recepción XLSX parser.
//
// Reads one sheet named "Pre-recepción" (case-insensitive substring match).
// Header row is NOT at row 0 in the source files — it's typically row 2.
// Parser scans the first ~10 rows for a row with ≥5 non-null cells as header.
//
// Rejects rows where medicion_code is missing or 'PENDIENTE'.
// Round 35: target is mediciones_tecnicas (unified with the form). Every
// emitted row carries source='upload'; form-entered rows carry source='form'.

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';
import { normalizeValue, normalizeDate, validateColumnTypes } from './normalize.js';
import { COLUMN_TYPES } from '../validation.js';

// mediciones_tecnicas columns whose values must be ISO YYYY-MM-DD.
const DATE_COLUMNS = new Set(['reception_date', 'medicion_date', 'lab_date']);


function normalizeHeader(h) {
  return String(h ?? '').trim().replace(/\s+/g, ' ');
}

function findHeaderRow(rows, minNonNull = 5) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const nn = rows[i].filter(v => v !== null && String(v).trim() !== '').length;
    if (nn >= minNonNull) return i;
  }
  return -1;
}

// Build a lookup that trims config keys so trailing spaces in the mapping
// don't prevent matches when headers are trimmed from the worksheet.
function buildColumnLookup() {
  const raw = CONFIG.preReceptionsToSupabase;
  const lookup = {};
  for (const [key, col] of Object.entries(raw)) {
    lookup[key.trim().replace(/\s+/g, ' ')] = col;
  }
  return lookup;
}

export const prerecepcionParser = {
  id: 'prerecepcion',
  label: 'Pre-recepción',
  acceptedExtensions: ['.xlsx', '.xls'],

  async parse(file) {
    const buf = await file.arrayBuffer();
    // cellDates:true keeps real Excel date cells as Date objects; raw:true
    // below then surfaces them un-formatted. Together they bypass the
    // workbook's locale format code so dates stay locale-independent.
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });

    // Find the Pre-recepción sheet (case-insensitive substring match on 'prerecep')
    const sheetName = wb.SheetNames.find(n =>
      n.toLowerCase().replace(/[^a-záéíóúñ]/g, '').includes('prerecep'));
    if (!sheetName) {
      throw new Error('Falta la hoja "Pre-recepción" en el archivo.');
    }

    const allRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, defval: null, raw: true,
    });

    const headerIdx = findHeaderRow(allRows);
    if (headerIdx < 0) {
      throw new Error('No se encontró la fila de encabezados en la hoja Pre-recepción.');
    }

    const headers = allRows[headerIdx].map(normalizeHeader);
    const columnLookup = buildColumnLookup();

    // Validate key headers
    const requiredHeaders = ['No. Reporte', 'Fecha medición técnica', 'Variedad', 'Lote de campo'];
    const missing = requiredHeaders.filter(h => !headers.includes(h));
    if (missing.length) {
      throw new Error(`Encabezados faltantes en Pre-recepción: ${missing.join(', ')}`);
    }

    const out = [];
    const rejected = [];

    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row || row.every(c => c === null || String(c).trim() === '')) continue;

      const obj = {};
      let hasData = false;
      headers.forEach((h, idx) => {
        const col = columnLookup[h];
        if (!col) return;
        const val = DATE_COLUMNS.has(col)
          ? normalizeDate(row[idx])
          : normalizeValue(row[idx]);
        obj[col] = val;
        if (val !== null) hasData = true;
      });

      if (!hasData) continue;

      const rc = obj.medicion_code;
      if (!rc) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: 'Reporte faltante',
        });
        continue;
      }
      if (String(rc).trim().toUpperCase() === 'PENDIENTE') {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: 'Reporte pendiente',
        });
        continue;
      }
      // Type validation (Round 32 INT + Round 34 NUMERIC). Run after the
      // identity guards so a missing/pendiente medicion_code is surfaced first.
      const typeReject = validateColumnTypes(obj, COLUMN_TYPES.mediciones_tecnicas);
      if (typeReject) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: typeReject,
        });
        continue;
      }

      if (obj.variety && CONFIG.normalizeVariety) {
        obj.variety = CONFIG.normalizeVariety(obj.variety);
      }

      // Initialize vintage_year so all rows share the same key set —
      // PostgREST rejects mixed-shape arrays with "All object keys must
      // match" (Round 33). Block below overwrites when derivable.
      obj.vintage_year = null;
      const dateStr = obj.medicion_date || obj.reception_date;
      if (dateStr) {
        const y = new Date(dateStr).getFullYear();
        if (y >= 2015 && y <= 2040) obj.vintage_year = y;
      }

      // Provenance flag (Round 35). Set unconditionally so every row in
      // the batch shares the same key set as form-entered rows, which
      // also carry `source` (set in mediciones.js).
      obj.source = 'upload';

      out.push(obj);
    }

    return {
      targets: [
        { table: 'mediciones_tecnicas', rows: out, conflictKey: 'medicion_code' },
      ],
      excluded: {},
      rejected,
      meta: { totalRows: allRows.length - headerIdx - 1, filename: file.name },
    };
  },
};
