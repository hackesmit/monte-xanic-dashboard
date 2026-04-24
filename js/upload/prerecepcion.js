// js/upload/prerecepcion.js
// Pre-recepción XLSX parser.
//
// Reads one sheet named "Pre-recepción" (case-insensitive substring match).
// Header row is NOT at row 0 in the source files — it's typically row 2.
// Parser scans the first ~10 rows for a row with ≥5 non-null cells as header.
//
// Rejects rows where report_code is missing or 'PENDIENTE'.
// Target is pre_receptions only. mediciones_tecnicas is never touched.

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';

function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (str === '' || str === '-' || str === '—' || str === 'NA' || str === 'N/A') return null;
  const n = Number(str);
  return isNaN(n) ? str : n;
}

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
    const wb = XLSX.read(buf, { type: 'array' });

    // Find the Pre-recepción sheet (case-insensitive substring match on 'prerecep')
    const sheetName = wb.SheetNames.find(n =>
      n.toLowerCase().replace(/[^a-záéíóúñ]/g, '').includes('prerecep'));
    if (!sheetName) {
      throw new Error('Falta la hoja "Pre-recepción" en el archivo.');
    }

    const allRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, defval: null, raw: false,
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
        const val = normalizeValue(row[idx]);
        obj[col] = val;
        if (val !== null) hasData = true;
      });

      if (!hasData) continue;

      const rc = obj.report_code;
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

      if (obj.variety && CONFIG.normalizeVariety) {
        obj.variety = CONFIG.normalizeVariety(obj.variety);
      }

      const dateStr = obj.medicion_date || obj.reception_date;
      if (dateStr) {
        const y = new Date(dateStr).getFullYear();
        if (y >= 2015 && y <= 2040) obj.vintage_year = y;
      }

      out.push(obj);
    }

    return {
      targets: [
        { table: 'pre_receptions', rows: out, conflictKey: 'report_code' },
      ],
      excluded: {},
      rejected,
      meta: { totalRows: allRows.length - headerIdx - 1, filename: file.name },
    };
  },
};
