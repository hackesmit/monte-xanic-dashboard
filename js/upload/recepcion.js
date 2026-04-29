// js/upload/recepcion.js
// Recepción de Tanque XLSX parser.
//
// Reads two sheets:
//   - Recepción <year>        → tank_receptions + reception_lots (up to 4 lots per row)
//   - Prefermentativos <year> → prefermentativos
//
// Lot rows are emitted with report_code (NOT reception_id) per the
// migration in sql/migration_reception_lots_upsert.sql.

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';
import { normalizeValue, normalizeDate, validateColumnTypes } from './normalize.js';

// Date columns in tank_receptions and prefermentativos tables.
const RECEPCION_DATE_COLUMNS = new Set(['reception_date']);
const PREFERMENT_DATE_COLUMNS = new Set(['measurement_date']);

// INT- and NUMERIC-typed columns per destination table. Non-numeric values
// (a fractional INT, or a label string typed into a numeric cell) would
// otherwise reach Postgres as "invalid input syntax for type integer/numeric"
// and abort the whole batch (Round 34, generalizing Round 32). We surface
// the offending row+column with a Spanish motivo_rechazo instead.
const RECEPCION_INT_COLUMNS = new Set(['vintage_year']);
const RECEPCION_NUMERIC_COLUMNS = new Set([
  'brix', 'ph', 'ta', 'ag', 'am', 'av', 'so2', 'nfa',
  'temperature', 'solidos_pct',
  'polifenoles_wx', 'antocianinas_wx',
  'poli_spica', 'anto_spica', 'ipt_spica', 'p010_kg',
]);
const PREFERMENT_INT_COLUMNS = new Set(['vintage_year']);
const PREFERMENT_NUMERIC_COLUMNS = new Set([
  'brix', 'ph', 'ta', 'temperature', 'tant',
]);

function sheetToArray(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
}

function findHeaderRow(rows, minNonNull = 5) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const nn = rows[i].filter(v => v !== null && String(v).trim() !== '').length;
    if (nn >= minNonNull) return i;
  }
  return -1;
}

export const recepcionParser = {
  id: 'recepcion',
  label: 'Recepción de Tanque',
  acceptedExtensions: ['.xlsx', '.xls'],

  async parse(file) {
    const buf = await file.arrayBuffer();
    // cellDates:true returns Date objects for date-typed cells regardless of
    // the workbook's locale format code; raw:true on sheet_to_json keeps
    // them unformatted so normalizeDate can produce ISO YYYY-MM-DD.
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });

    let recepcionSheet = null;
    let prefermSheet = null;
    for (const name of wb.SheetNames) {
      const lower = name.toLowerCase();
      if (lower.includes('preferm')) prefermSheet = name;
      else if (lower.includes('recep')) recepcionSheet = name;
    }

    if (!recepcionSheet) {
      throw new Error('Falta la hoja "Recepción" en el archivo.');
    }
    if (!prefermSheet) {
      throw new Error('Falta la hoja "Prefermentativos" en el archivo.');
    }

    const receptions = [];
    const lots = [];
    const preferment = [];
    const rejected = [];

    // ── Recepción sheet ──
    const recRows = sheetToArray(wb, recepcionSheet);
    const recHeaderIdx = findHeaderRow(recRows);
    if (recHeaderIdx < 0) throw new Error('No se encontró la fila de encabezados en la hoja Recepción.');
    const recHeaders = recRows[recHeaderIdx].map(h => String(h ?? '').trim().replace(/\s+/g, ' '));

    for (let i = recHeaderIdx + 1; i < recRows.length; i++) {
      const row = recRows[i];
      if (!row || row.every(c => c === null || String(c).trim() === '')) continue;

      const obj = {};
      let hasData = false;
      recHeaders.forEach((h, idx) => {
        const col = CONFIG.recepcionToSupabase[h];
        if (!col) return;
        const val = RECEPCION_DATE_COLUMNS.has(col)
          ? normalizeDate(row[idx])
          : normalizeValue(row[idx]);
        obj[col] = val;
        if (val !== null) hasData = true;
      });

      if (!hasData || !obj.report_code) continue;

      // Initialize vintage_year so every row shares the same key set —
      // PostgREST rejects bulk inserts with "All object keys must match"
      // when keys differ (Round 33). The block below overwrites it when
      // batch_code yields a derivable year.
      obj.vintage_year = null;
      if (obj.batch_code) {
        const m = String(obj.batch_code).match(/^(\d{2})/);
        if (m) {
          const y = 2000 + parseInt(m[1], 10);
          if (y >= 2015 && y <= 2040) obj.vintage_year = y;
        }
      }

      // Type validation (Round 34). Reject rows whose numeric/int cells
      // hold non-numeric strings before they reach Postgres. Lot columns
      // are still text so they're stripped after validation runs.
      const recReject = validateColumnTypes(obj, {
        intCols: RECEPCION_INT_COLUMNS,
        numericCols: RECEPCION_NUMERIC_COLUMNS,
      });
      if (recReject) {
        rejected.push({
          row: Object.fromEntries(recHeaders.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: recReject,
        });
        continue;
      }

      const reportCode = obj.report_code;
      for (let pos = 1; pos <= 4; pos++) {
        const key = `_lot${pos}`;
        if (obj[key]) {
          lots.push({ report_code: reportCode, lot_code: obj[key], lot_position: pos });
        }
        delete obj[key];
      }

      receptions.push(obj);
    }

    // ── Prefermentativos sheet ──
    // Live `Recepcion_de_Tanque_2025.xlsx` puts a title row at row 0 and the
    // actual headers at row 1, so we auto-detect via findHeaderRow (same as
    // the Recepción branch above). Headers also get whitespace collapsed so
    // a column like 'Reporte ' (trailing space) still matches the config.
    const prefRows = sheetToArray(wb, prefermSheet);
    const prefHeaderIdx = findHeaderRow(prefRows);
    if (prefHeaderIdx >= 0) {
      const prefHeaders = prefRows[prefHeaderIdx].map(h => String(h ?? '').trim().replace(/\s+/g, ' '));
      for (let i = prefHeaderIdx + 1; i < prefRows.length; i++) {
        const row = prefRows[i];
        if (!row || row.every(c => c === null || String(c).trim() === '')) continue;

        const obj = {};
        let hasData = false;
        prefHeaders.forEach((h, idx) => {
          const col = CONFIG.prefermentToSupabase[h];
          if (!col) return;
          const val = PREFERMENT_DATE_COLUMNS.has(col)
            ? normalizeDate(row[idx])
            : normalizeValue(row[idx]);
          obj[col] = val;
          if (val !== null) hasData = true;
        });

        if (!hasData || !obj.report_code) continue;

        // Initialize vintage_year for the same reason as the recepción
        // branch above — uniform key set across rows (Round 33).
        obj.vintage_year = null;
        if (obj.batch_code) {
          const m = String(obj.batch_code).match(/^(\d{2})/);
          if (m) {
            const y = 2000 + parseInt(m[1], 10);
            if (y >= 2015 && y <= 2040) obj.vintage_year = y;
          }
        }

        const prefReject = validateColumnTypes(obj, {
          intCols: PREFERMENT_INT_COLUMNS,
          numericCols: PREFERMENT_NUMERIC_COLUMNS,
        });
        if (prefReject) {
          rejected.push({
            row: Object.fromEntries(prefHeaders.map((h, idx) => [h, row[idx]])),
            motivo_rechazo: prefReject,
          });
          continue;
        }
        preferment.push(obj);
      }
    }

    return {
      targets: [
        { table: 'tank_receptions',  rows: receptions, conflictKey: 'report_code' },
        { table: 'reception_lots',   rows: lots,       conflictKey: 'report_code,lot_position' },
        { table: 'prefermentativos', rows: preferment, conflictKey: 'report_code' },
      ],
      excluded: {},
      rejected,
      meta: { totalRows: recRows.length + prefRows.length - 2, filename: file.name },
    };
  },
};
