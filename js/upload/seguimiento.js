// js/upload/seguimiento.js
// "Seguimiento de Maduración Vendimia 2026" XLSX parser.
//
// Replaces WineXRay as the 2026 berry-maturity source (the WineXRay parser
// stays in the tree, working and unused — do not remove it). The workbook's
// "Uva" sheet is a PIVOTED CALENDAR, not the one-row-per-sample shape WineXRay
// used, so this parser unpivots it.
//
// Layout (row indices 0-based):
//   rows 0-4  title / month / week-band / weekday rows
//   row  5    header: Variedad | Status | Proveedor | Lote | ANT Target |
//             Código | Cantidad proyectada | TONS | Análisis | <one col PER DAY>
//   row  6    a stray TONS row with no lot (skipped)
//   row  7    a repeated header row inside the data region (skipped)
//   row  8+   each lot occupies SEVEN consecutive rows, one per metric named in
//             the Análisis column: TONS, °Brix, pH, AT, Peso baya, Ac. Málico,
//             Antocianos. A cell is (lot, metric, date).
//
// The date columns run 29.06 through 08.11 as DD.MM text with no year. One
// header ("07.01", a typo for 07.07) breaks chronological order; per the bead
// we DETECT it and REFUSE the file rather than silently correcting or accepting
// it — a wrong guess lands a sample in the wrong month, a silent accept lands
// it six months adrift.
//
// Emits two targets:
//   berry_samples    ← per-(lot,date) maturity chemistry (the dashboard's
//                      maturity home; unifies WineXRay + 2026 on one timeline)
//   seguimiento_lotes ← per-lot forecast/tonnage/status that berry_samples has
//                       no columns for (see the design note on xd-6r7)

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';
import { normalizeValue, validateColumnTypes } from './normalize.js';
import { COLUMN_TYPES } from '../validation.js';

const HEADER_ROW = 5;      // 0-based index of the real header row
const DATE_COL_START = 9;  // first date column (col index 9)

// Normalize an Análisis label for matching: strip degree sign, dots, spaces
// and accents, lowercase. '°Brix' → 'brix', 'Ac. Málico' → 'acmalico'.
function normMetric(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00b0.\s]/g, '')
    .toLowerCase();
}

// Chemistry metrics → berry_samples columns. TONS is handled separately (it is
// tonnage, not berry chemistry) and is intentionally NOT in this map.
const METRIC_TO_BERRY = {
  brix:       'brix',
  ph:         'ph',
  at:         'ta',
  pesobaya:   'berries_weight_g',
  acmalico:   'malic_acid',
  antocianos: 'berry_anthocyanins_mg_100b',
};
const BERRY_COLUMNS = Object.values(METRIC_TO_BERRY);

function pad2(n) { return String(n).padStart(2, '0'); }

// Derive vintage_year from a lot code's 2-digit prefix (26 → 2026), consistent
// with the existing rule. Returns null when the code has no plausible prefix.
function vintageFromLot(lotCode) {
  const m = String(lotCode || '').match(/^(\d{2})/);
  if (!m) return null;
  const y = 2000 + parseInt(m[1], 10);
  return (y >= 2015 && y <= 2040) ? y : null;
}

// Parse one date header cell into {label, month, day}. Handles both the text
// "DD.MM" form and the Date object the typo cell deserializes to.
function parseDateHeader(cell) {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const month = cell.getUTCMonth() + 1;
    const day = cell.getUTCDate();
    return { label: `${pad2(day)}.${pad2(month)}`, month, day };
  }
  const str = String(cell ?? '').trim();
  const m = str.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { label: str, month, day };
}

// Build the list of date columns and enforce chronological (monotonic) order.
// Throws a Spanish error naming the offending column when a header moves
// backwards in time (the 07.01 typo). Ordinal = month*100+day is strictly
// increasing across a valid single-vintage Jun→Nov run.
function buildDateColumns(header) {
  const cols = [];
  for (let c = DATE_COL_START; c < header.length; c++) {
    const cell = header[c];
    if (cell === null || cell === undefined || String(cell).trim() === '') continue;
    const parsed = parseDateHeader(cell);
    if (!parsed) {
      throw new Error(`Encabezado de fecha no reconocido en la columna ${c + 1}: "${String(cell).trim()}". Se esperaba el formato DD.MM.`);
    }
    cols.push({ colIdx: c, ...parsed, ord: parsed.month * 100 + parsed.day });
  }
  for (let i = 1; i < cols.length; i++) {
    if (cols[i].ord < cols[i - 1].ord) {
      throw new Error(
        `El archivo tiene una columna de fecha fuera de orden cronológico: "${cols[i].label}" ` +
        `(columna ${cols[i].colIdx + 1}) aparece después de "${cols[i - 1].label}". ` +
        `Es un error de captura, probablemente debería ser 07.07. ` +
        `Corrija el encabezado en el archivo y vuelva a subirlo.`,
      );
    }
  }
  return cols;
}

function sheetToArray(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
}

export const seguimientoParser = {
  id: 'seguimiento',
  label: 'Seguimiento de Maduración',
  acceptedExtensions: ['.xlsx'],

  async parse(file) {
    const buf = await file.arrayBuffer();
    // cellDates:true so date-typed cells (including the typo header) come back
    // as Date objects; raw:true keeps everything else unformatted.
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });

    const uvaName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'uva');
    if (!uvaName) {
      throw new Error('Falta la hoja "Uva" en el archivo de Seguimiento de Maduración.');
    }
    // 'Flujo Tons' (empty) and 'SUMMARY' (a derived pivot) are intentionally
    // ignored — only 'Uva' is a source of truth.

    const rows = sheetToArray(wb, uvaName);
    const header = rows[HEADER_ROW];
    if (!header || String(header[3] ?? '').trim() !== 'Lote' ||
        normMetric(header[8]) !== 'analisis') {
      throw new Error('Este archivo no parece ser un Seguimiento de Maduración: no se encontró el encabezado esperado (Lote / Análisis) en la fila 6.');
    }

    // Enforce chronological order of date columns — refuses the 07.01 typo.
    const dateCols = buildDateColumns(header);

    // ── Group the seven-rows-per-lot blocks ──
    // A block is a run of consecutive rows sharing the same Lote code. Rows
    // with an empty Lote (the stray TONS row 6, the trailing template blocks)
    // and repeated header rows are skipped rather than treated as lots.
    const blocks = [];
    let current = null;
    for (let i = HEADER_ROW + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => c === null || String(c).trim() === '')) continue;

      // Repeated header row (row 7 and any like it): col 0 = 'Variedad' or the
      // Análisis cell literally reads the header label.
      if (String(row[0] ?? '').trim() === 'Variedad' || normMetric(row[8]) === 'analisis') continue;

      const lote = String(row[3] ?? '').trim();
      if (!lote) continue; // stray / template rows carry no lot code

      const metric = normMetric(row[8]);
      if (metric !== 'tons' && !(metric in METRIC_TO_BERRY)) continue; // unknown Análisis

      if (!current || current.lote !== lote) {
        current = {
          lote,
          variety:  normalizeValue(row[0]),
          status:   row[1] != null ? String(row[1]).trim() : null,
          proveedor: row[2] != null ? String(row[2]).trim() : null,
          ant_target: normalizeValue(row[4]),
          codigo:   row[5] != null ? String(row[5]).trim() : null,
          cantidad_proyectada: normalizeValue(row[6]),
          tons_cached: normalizeValue(row[7]),
          metricRows: {},
        };
        blocks.push(current);
      }
      current.metricRows[metric] = row;
    }

    const berryRows = [];
    const lotRows = [];
    const rejected = [];
    const warnings = [];
    let berrySkippedBlank = 0;

    for (const block of blocks) {
      const vintage = vintageFromLot(block.lote);
      if (vintage === null) {
        rejected.push({
          row: { Lote: block.lote },
          motivo_rechazo: `Lote "${block.lote}": no se pudo derivar el año de vendimia del prefijo del código`,
        });
        continue;
      }

      // ── berry_samples: one row per (lot, date) with any chemistry value ──
      for (const dc of dateCols) {
        const chem = {};
        let hasValue = false;
        for (const [metric, col] of Object.entries(METRIC_TO_BERRY)) {
          const mRow = block.metricRows[metric];
          const val = mRow ? normalizeValue(mRow[dc.colIdx]) : null;
          chem[col] = val;
          if (val !== null) hasValue = true;
        }
        if (!hasValue) { continue; }

        // Fixed key set across every berry row (Round 33: PostgREST rejects
        // mixed-shape batches). sample_seq is assigned by the controller.
        const obj = {
          sample_id: block.lote,
          sample_date: `${vintage}-${pad2(dc.month)}-${pad2(dc.day)}`,
          sample_type: 'Berries',
          vintage_year: vintage,
          variety: block.variety ?? null,
          below_detection: false,
          brix: null, ph: null, ta: null,
          berries_weight_g: null, malic_acid: null, berry_anthocyanins_mg_100b: null,
        };
        for (const col of BERRY_COLUMNS) obj[col] = chem[col];

        const reject = validateColumnTypes(obj, COLUMN_TYPES.berry_samples);
        if (reject) {
          rejected.push({ row: { Lote: block.lote, Fecha: obj.sample_date }, motivo_rechazo: reject });
          continue;
        }
        berryRows.push(obj);
      }

      // ── seguimiento_lotes: one row per lot ──
      // Recompute the TONS running total from the dated cells rather than
      // trusting the cached +SUM(...) formula result (a workbook can be saved
      // stale). Surface any disagreement; never silently reconcile.
      let recomputed = 0;
      let sawTons = false;
      const tonsRow = block.metricRows['tons'];
      if (tonsRow) {
        for (const dc of dateCols) {
          const v = normalizeValue(tonsRow[dc.colIdx]);
          if (typeof v === 'number' && Number.isFinite(v)) { recomputed += v; sawTons = true; }
        }
      }
      // Round to cents to avoid float-accumulation noise on the sum.
      const tonsSeguimiento = sawTons ? Math.round(recomputed * 100) / 100 : null;
      const cached = block.tons_cached;
      const mismatch = (typeof cached === 'number' && tonsSeguimiento !== null)
        ? Math.abs(cached - tonsSeguimiento) > 1e-6
        : false;
      if (mismatch) {
        warnings.push(
          `Lote "${block.lote}": TONS recalculado (${tonsSeguimiento}) no coincide con el valor almacenado en la hoja (${cached}).`,
        );
      }

      const lotObj = {
        lot_code: block.lote,
        vintage_year: vintage,
        variety: block.variety ?? null,
        proveedor: block.proveedor ?? null,
        status: block.status ?? null,
        ant_target: block.ant_target ?? null,
        codigo: block.codigo ?? null,
        cantidad_proyectada: block.cantidad_proyectada ?? null,
        tons_seguimiento: tonsSeguimiento,
        tons_seguimiento_cached: (typeof cached === 'number') ? cached : null,
        tons_mismatch: mismatch,
      };
      const lotReject = validateColumnTypes(lotObj, COLUMN_TYPES.seguimiento_lotes);
      if (lotReject) {
        rejected.push({ row: { Lote: block.lote }, motivo_rechazo: lotReject });
        continue;
      }
      lotRows.push(lotObj);
    }

    return {
      targets: [
        { table: 'berry_samples',     rows: berryRows, conflictKey: 'sample_id,sample_date,sample_seq' },
        { table: 'seguimiento_lotes', rows: lotRows,   conflictKey: 'lot_code,vintage_year' },
      ],
      excluded: { blank_measurements: berrySkippedBlank },
      rejected,
      warnings,
      meta: {
        filename: file.name,
        lots: lotRows.length,
        measurements: berryRows.length,
        tonsMismatches: warnings.length,
      },
    };
  },
};
