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
import { normalizeValue, normalizeDate, validateColumnTypes } from './normalize.js';

// pre_receptions table columns whose values must be ISO YYYY-MM-DD.
const DATE_COLUMNS = new Set(['reception_date', 'medicion_date', 'lab_date']);

// pre_receptions INT-typed columns. Postgres integer rejects any fractional
// value with an opaque "invalid input syntax for type integer" message that
// blocks the whole upload batch — Round 32 traced exactly this against
// total_bins=37.5. We catch it at the parser instead so the user sees a
// row+column-aware Spanish reject message.
//
// total_bins is intentionally NOT in this set: it was widened to NUMERIC
// (sql/migration_total_bins_numeric.sql) so half-bin / mixed-lot values
// like 37.5 are legitimate and must pass through unchanged.
const INT_COLUMNS = new Set([
  'vintage_year',
  'health_madura', 'health_inmadura', 'health_sobremadura', 'health_picadura',
  'health_enfermedad', 'health_pasificada', 'health_aceptable', 'health_no_aceptable',
]);

// pre_receptions NUMERIC-typed columns. Same defense-in-depth as INT_COLUMNS:
// reject non-numeric strings at the parser so the whole batch doesn't fail
// with Postgres' opaque "invalid input syntax for type numeric" (Round 34).
// total_bins is included here (NUMERIC after migration_total_bins_numeric.sql).
const NUMERIC_COLUMNS = new Set([
  'total_bins', 'tons_received', 'bin_temp_c', 'truck_temp_c',
  'bunch_avg_weight_g', 'berry_length_avg_cm', 'berries_200_weight_g', 'berry_avg_weight_g',
  'brix', 'ph', 'at', 'ag', 'am', 'polifenoles', 'catequinas', 'antocianos',
]);

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
      // Type validation (Round 32 INT + Round 34 NUMERIC). Run after the
      // identity guards so a missing/pendiente report_code is surfaced first.
      const typeReject = validateColumnTypes(obj, {
        intCols: INT_COLUMNS,
        numericCols: NUMERIC_COLUMNS,
      });
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
