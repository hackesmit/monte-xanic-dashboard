// js/upload/winexray.js
// WineXRay CSV parser.
//
// Emits two targets:
//   wine_samples  ← rows with Sample Type in {Must, Young Wine, Aging Wine, Bottled Wine}
//   berry_samples ← rows with Sample Type = 'Berries'
//
// Control Wine and lab-test rows are excluded silently.
// Unknown Sample Type, missing Sample Id → rejected with motivo_rechazo.

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';
import { normalizeValue, normalizeDate } from './normalize.js';

const BELOW_DETECTION_RE = /^<\s*\d+(\.\d+)?$/;
const ABOVE_DETECTION_RE = /^>\s*(\d+(\.\d+)?)$/;
// Matches lab-test markers anywhere in sample_id (no word boundary — handles compounds like WATERBLUEBERRY)
const LAB_TEST_RE = /(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)/i;

// WineXRay CSV columns whose values must be ISO YYYY-MM-DD. The tool emits
// US-format slash dates ("2/27/2026"), so we hint MDY for disambiguation.
const DATE_COLUMNS = new Set(['sample_date', 'crush_date']);

// INT-typed columns in wine_samples / berry_samples. Fractional source
// values would trigger Postgres "invalid input syntax for type integer"
// (Round 32 pattern) — catch at the parser instead with a row+column-aware
// reject. vintage_year is parser-derived from sample_id when absent, so it
// can never be fractional via that path; including it here covers the
// 'Vintage' source-column path.
const INT_COLUMNS = new Set(['vintage_year', 'days_post_crush', 'berry_count']);

async function fileToRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
}

function shapeRow(headers, row, columnMap) {
  const obj = {};
  let belowDetection = false;
  headers.forEach((h, idx) => {
    const col = columnMap[h];
    if (!col) return;
    const val = row[idx];
    const str = val !== null && val !== undefined ? String(val).trim() : '';
    if (BELOW_DETECTION_RE.test(str)) {
      belowDetection = true;
      obj[col] = null;
    } else if (ABOVE_DETECTION_RE.test(str)) {
      const m = str.match(ABOVE_DETECTION_RE);
      obj[col] = m ? parseFloat(m[1]) : null;
    } else if (DATE_COLUMNS.has(col)) {
      obj[col] = normalizeDate(val, { dateOrder: 'mdy' });
    } else {
      obj[col] = normalizeValue(val);
    }
  });
  obj.below_detection = belowDetection;
  return obj;
}

function applyNormalization(obj) {
  if (obj.variety) obj.variety = CONFIG.normalizeVariety(obj.variety);
  if (obj.appellation !== undefined) {
    obj.appellation = CONFIG.normalizeAppellation(obj.appellation, obj.sample_id);
  }
  // Ensure vintage_year is always a key on obj — PostgREST rejects bulk
  // inserts with "All object keys must match" if rows differ (Round 33).
  // Covers the case where the CSV has no `Vintage` column at all.
  if (obj.vintage_year === undefined) obj.vintage_year = null;
  if (!obj.vintage_year && obj.sample_id) {
    const m = String(obj.sample_id).match(/^(\d{2})/);
    if (m) {
      const y = 2000 + parseInt(m[1], 10);
      obj.vintage_year = (y >= 2015 && y <= 2040) ? y : null;
    }
  }
  return obj;
}

export const winexrayParser = {
  id: 'winexray',
  label: 'WineXRay',
  acceptedExtensions: ['.csv'],

  async parse(file) {
    const rows = await fileToRows(file);
    if (!rows || rows.length < 2) {
      throw new Error('El archivo no contiene filas de datos.');
    }
    const headers = rows[0].map(h => String(h || '').trim());

    const knownHeaders = new Set([
      ...Object.keys(CONFIG.wxToSupabase),
      ...Object.keys(CONFIG.wxToBerry),
    ]);
    const matchCount = headers.filter(h => knownHeaders.has(h)).length;
    if (matchCount < 3) {
      throw new Error('Este archivo no parece ser un export de WineXRay: faltan columnas requeridas (Sample Id, Sample Type, Sample Date).');
    }

    const sampleIdIdx = headers.indexOf('Sample Id');
    const sampleTypeIdx = headers.indexOf('Sample Type');

    const wineRows = [];
    const berryRows = [];
    const excluded = { control_wine: 0, lab_test: 0, california: 0, hard_excluded: 0 };
    const rejected = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0 || row.every(c => c === null || c === '')) continue;

      const sampleId = sampleIdIdx >= 0 ? (row[sampleIdIdx] ?? '').toString().trim() : '';
      const sampleType = sampleTypeIdx >= 0 ? (row[sampleTypeIdx] ?? '').toString().trim() : '';

      // 1. Missing sample_id → rejected
      if (!sampleId) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: 'Sample Id faltante',
        });
        continue;
      }

      // 2. Lab test exclusion (checked before generic isSampleExcluded so it gets its own counter)
      // Use local LAB_TEST_RE (no \b) to match compound tokens like WATERBLUEBERRY
      if (LAB_TEST_RE.test(sampleId) || LAB_TEST_RE.test(sampleType)) {
        excluded.lab_test++;
        continue;
      }

      // 3. Hard exclusions (named samples + EXP/EXPERIMENTO/NORMAL patterns)
      if (CONFIG._excludedSamples.has(sampleId) || CONFIG._excludeRe.test(sampleId)) {
        excluded.hard_excluded++;
        continue;
      }

      // 4. Routing
      const dest = CONFIG.sampleTypeRouting[sampleType];
      if (dest === 'skip') {
        if (sampleType === 'Control Wine') excluded.control_wine++;
        continue;
      }
      if (!dest) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: `Sample Type no reconocido: ${sampleType || '(vacío)'}`,
        });
        continue;
      }

      // Shape + normalize
      const columnMap = dest === 'berry_samples' ? CONFIG.wxToBerry : CONFIG.wxToSupabase;
      const obj = shapeRow(headers, row, columnMap);
      applyNormalization(obj);

      // California late-filter
      if (obj.appellation === 'California') {
        excluded.california++;
        continue;
      }

      // INT-typed column validation (Round 32 Option B). Run AFTER
      // applyNormalization so a vintage_year derived from sample_id is also
      // checked. First offender wins so the user sees a deterministic message.
      let intReject = null;
      for (const col of INT_COLUMNS) {
        const v = obj[col];
        if (typeof v === 'number' && !Number.isInteger(v)) {
          intReject = `${col}=${v}: debe ser entero`;
          break;
        }
      }
      if (intReject) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: intReject,
        });
        continue;
      }

      if (dest === 'berry_samples') berryRows.push(obj);
      else wineRows.push(obj);
    }

    return {
      targets: [
        { table: 'wine_samples',  rows: wineRows,  conflictKey: 'sample_id,sample_date,sample_seq' },
        { table: 'berry_samples', rows: berryRows, conflictKey: 'sample_id,sample_date,sample_seq' },
      ],
      excluded,
      rejected,
      meta: { totalRows: rows.length - 1, filename: file.name },
    };
  },
};
