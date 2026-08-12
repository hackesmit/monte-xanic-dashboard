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
import { panelConsensus } from '../classification.js';

// mediciones_tecnicas columns whose values must be ISO YYYY-MM-DD.
const DATE_COLUMNS = new Set(['reception_date', 'medicion_date', 'lab_date']);


function normalizeHeader(h) {
  return String(h ?? '').trim().replace(/\s+/g, ' ');
}

// Picks the real header row by content, not by density.
//
// Counting non-null cells is not enough: Vendimia 2026 added seven evaluator
// labels to the banner row, pushing it over any density threshold, so the
// first-row-with-N-cells rule selected the banner and the parse failed with
// every required header missing. Scoring candidates by how many cells actually
// resolve to a known column makes the choice about meaning instead, and a
// banner row scores zero however wide it grows.
function findHeaderRow(rows, columnLookup, minNonNull = 5) {
  let bestIdx = -1;
  let bestScore = 0;
  let fallbackIdx = -1;

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] || [];
    const nn = row.filter(v => v !== null && String(v).trim() !== '').length;
    if (nn < minNonNull) continue;
    if (fallbackIdx < 0) fallbackIdx = i;

    const score = row.reduce((acc, cell) => {
      const h = normalizeHeader(cell);
      return acc + (h && columnLookup[h] ? 1 : 0);
    }, 0);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  // A recognised header row must carry several known columns, not one stray
  // match. Below that, fall back to the old density rule so an unfamiliar
  // workbook still reaches the explicit required-headers error, which names
  // what is missing, rather than a bare "no header row found".
  if (bestScore >= minNonNull) return bestIdx;
  return fallbackIdx;
}

// Vendimia 2026 heads the evaluator columns on the banner row above the main
// header row, leaving the main header blank underneath them. Fill each blank
// header from the nearest non-blank cell in the rows above it, so a banner
// label becomes that column's header only where the column has none of its own.
// Banner labels that sit above a properly headed column ('Laboratorio',
// 'Estado de bayas') are therefore ignored, which is what we want.
function mergeBannerHeaders(rows, headerIdx) {
  const width = Math.max(...rows.slice(0, headerIdx + 1).map(r => (r ? r.length : 0)), 0);
  const headers = [];
  for (let c = 0; c < width; c++) {
    let label = normalizeHeader(rows[headerIdx]?.[c]);
    for (let r = headerIdx - 1; r >= 0 && !label; r--) {
      label = normalizeHeader(rows[r]?.[c]);
    }
    headers.push(label);
  }
  return headers;
}

// Locates the evaluator columns and groups them by position, so
// 'Sanidad (visual) Evaluador 2' and 'Madurez fenólica Evaluador 2' are
// understood as two axes graded by the same person.
function findEvaluatorColumns(headers) {
  const { sanidad, madurez } = CONFIG.preReceptionEvaluatorHeaders;
  const byPosition = new Map();
  const slot = (n) => {
    if (!byPosition.has(n)) byPosition.set(n, { sanidad: null, madurez: null });
    return byPosition.get(n);
  };

  headers.forEach((h, idx) => {
    const s = sanidad.exec(h);
    if (s) { slot(Number(s[1])).sanidad = idx; return; }
    const m = madurez.exec(h);
    if (m) { slot(Number(m[1])).madurez = idx; }
  });

  // Ordered by the evaluator number printed on the sheet, so the panel keeps
  // the workbook's ordering rather than column-scan order.
  return [...byPosition.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([position, cols]) => ({ position, ...cols }));
}

// Builds the panel for one row, dropping evaluators who graded neither axis.
// A blank cell stays null rather than becoming a zero: on the sanitary scale
// zero is 'Contaminado', a real and damning grade, not an absence of one.
function readEvaluatorPanel(row, evaluatorCols) {
  const panel = [];
  for (const { sanidad, madurez } of evaluatorCols) {
    const s = sanidad === null ? null : normalizeValue(row[sanidad]);
    const m = madurez === null ? null : normalizeValue(row[madurez]);
    if (s === null && m === null) continue;
    panel.push({
      evaluador: null,          // the workbook numbers evaluators, never names them
      sanidad: s === null ? null : String(s).trim(),
      madurez: m === null ? null : String(m).trim(),
    });
  }
  return panel;
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

    const columnLookup = buildColumnLookup();
    const headerIdx = findHeaderRow(allRows, columnLookup);
    if (headerIdx < 0) {
      throw new Error('No se encontró la fila de encabezados en la hoja Pre-recepción.');
    }

    const headers = mergeBannerHeaders(allRows, headerIdx);
    const evaluatorCols = findEvaluatorColumns(headers);

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

      // Vendimia 2026 evaluator panel.
      //
      // Emitted only when the workbook actually has evaluator columns, and
      // then for every row so the batch keeps one key set (PostgREST rejects
      // mixed-shape arrays). A pre-2026 workbook has no opinion about these
      // three columns, so it must not send them at all: the upsert conflicts
      // on medicion_code, and a null in the payload would overwrite a grade a
      // winemaker had entered through the form. Silence leaves it untouched.
      if (evaluatorCols.length) {
        const panel = readEvaluatorPanel(row, evaluatorCols);
        obj.evaluaciones = panel;
        // Consensus scalars for the readers that predate the panel. Within a
        // 2026 workbook these columns belong to the sheet, so a row nobody
        // graded correctly clears them.
        const consensus = panelConsensus(panel);
        obj.health_grade = consensus.health_grade;
        obj.phenolic_maturity = consensus.phenolic_maturity;
        if (panel.length) hasData = true;
      }

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
      // Lot codes arrive in the spreadsheet dialect ('TEKMP-S1', 'SYUC-L5');
      // store the berry dialect ('KTE-S1', 'SYDA-L5') so the classification
      // join matches without read-side fixups.
      if (obj.lot_code) obj.lot_code = CONFIG.normalizeFieldLotCode(obj.lot_code);

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
