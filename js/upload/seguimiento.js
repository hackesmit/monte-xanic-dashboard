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
// The date columns run 29.06 through 08.11 as DD.MM text with no year. The
// header must be a full, gap-free, strictly-increasing daily run; any hole
// (a repeat, an empty header among the dates, an impossible calendar date, a
// missing day) REFUSES the whole file with a Spanish error naming the column,
// per the non-negotiable refusal rule. A wrong guess lands a sample in the
// wrong month; a silent accept lands it adrift.
//
// DESTINATION TABLE (xd-6r7 author round): the dashboard reads berry maturity
// from `wine_samples` (dataLoader.loadFromSupabase fetches wine_samples and
// splits sample_type in {Berries,Berry} into berryData via CONFIG.supabaseToBerryJS).
// It does NOT read `berry_samples`. So the per-(lot,date) chemistry is unpivoted
// INTO wine_samples with sample_type='Berries', using the columns supabaseToBerryJS
// actually reads (brix, ph, ta, berry_weight→berryFW, berry_anthocyanins→anthocyanins),
// so 2026 data shares the historical WineXRay timeline the charts render. The
// per-LOT forecast/tonnage/status has no home in wine_samples and lands in the
// new seguimiento_lotes table (see the design note on xd-6r7).

import * as XLSX from 'xlsx';
import { CONFIG } from '../config.js';
import { normalizeValue, validateColumnTypes } from './normalize.js';
import { COLUMN_TYPES } from '../validation.js';

const HEADER_ROW = 5;      // 0-based index of the real header row
const DATE_COL_START = 9;  // first date column (col index 9)
const MS_PER_DAY = 86400000;

// Normalize an Análisis label for matching: strip the degree sign U+00B0 AND
// the ordinal indicator U+00BA (a lookalike the source uses for "ºBrix"),
// dots, spaces and accents, then lowercase. '°Brix'/'ºBrix' → 'brix',
// 'Ac. Málico' → 'acmalico'.
function normMetric(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[°º.\s]/g, '')
    .toLowerCase();
}

// Chemistry metrics → wine_samples columns the dashboard actually reads.
// supabaseToBerryJS maps: brix→brix, ph→pH, ta→ta, berry_weight→berryFW
// (the per-berry "Peso Baya (g)" column, NOT the whole-sample berries_weight_g),
// berry_anthocyanins→anthocyanins. malic_acid is a real wine_samples column
// (stored on the timeline; it has no berry chart field yet). TONS is handled
// separately (it is tonnage, not berry chemistry) and is not in this map.
const METRIC_TO_BERRY = {
  brix:       'brix',
  ph:         'ph',
  at:         'ta',
  pesobaya:   'berry_weight',
  acmalico:   'malic_acid',
  antocianos: 'berry_anthocyanins',
};
const BERRY_COLUMNS = Object.values(METRIC_TO_BERRY);

// The seven metric rows every lot block must carry, exactly once each. A block
// missing one, carrying a duplicate, or carrying an unknown label is a
// corrupted block and refuses the file rather than emitting partial chemistry.
const CANONICAL_METRICS = ['tons', 'brix', 'ph', 'at', 'pesobaya', 'acmalico', 'antocianos'];
const METRIC_LABELS = {
  tons: 'TONS', brix: '°Brix', ph: 'pH', at: 'AT',
  pesobaya: 'Peso baya', acmalico: 'Ac. Málico', antocianos: 'Antocianos',
};

function pad2(n) { return String(n).padStart(2, '0'); }

function isBlank(cell) {
  return cell === null || cell === undefined || String(cell).trim() === '';
}

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

// Build the list of date columns and enforce the full-header invariant:
//   - the date region is DATE_COL_START..lastNonBlankHeader; trailing padding
//     columns (the real file has null columns after the last date) are ignored,
//     but a blank header BETWEEN dates is a hole and REFUSES the file (its
//     values would otherwise vanish silently);
//   - every header in the region is a recognizable, calendar-valid DD.MM date
//     (a UTC round-trip rejects 31.06 and friends);
//   - the sequence is strictly increasing (a `<=` comparison catches an exact
//     repeat as well as a backwards jump like the 07.01 typo);
//   - the run is daily-continuous (exactly one day between adjacent columns).
// Any violation throws a Spanish error naming the offending column.
function buildDateColumns(header, vintage) {
  let lastCol = -1;
  for (let c = DATE_COL_START; c < header.length; c++) {
    if (!isBlank(header[c])) lastCol = c;
  }
  if (lastCol < DATE_COL_START) {
    throw new Error('El archivo no contiene columnas de fecha en la fila de encabezado.');
  }

  const cols = [];
  for (let c = DATE_COL_START; c <= lastCol; c++) {
    const cell = header[c];
    if (isBlank(cell)) {
      throw new Error(
        `El encabezado de fecha está vacío en la columna ${c + 1}, entre columnas de fecha. ` +
        `Toda columna de fecha debe tener un encabezado DD.MM; complete o elimine la columna y vuelva a subir el archivo.`,
      );
    }
    const parsed = parseDateHeader(cell);
    if (!parsed) {
      throw new Error(`Encabezado de fecha no reconocido en la columna ${c + 1}: "${String(cell).trim()}". Se esperaba el formato DD.MM.`);
    }
    // Real calendar validity via a UTC round-trip: 31.06 → 1 July, so the month
    // or day comes back changed. Rejects impossible dates the DD.MM regex passes.
    const probe = new Date(Date.UTC(vintage, parsed.month - 1, parsed.day));
    if (probe.getUTCMonth() + 1 !== parsed.month || probe.getUTCDate() !== parsed.day) {
      throw new Error(
        `La columna de fecha "${parsed.label}" (columna ${c + 1}) no es una fecha válida del calendario. ` +
        `Corrija el encabezado en el archivo y vuelva a subirlo.`,
      );
    }
    cols.push({ colIdx: c, month: parsed.month, day: parsed.day, label: parsed.label, utc: probe.getTime() });
  }

  for (let i = 1; i < cols.length; i++) {
    const prev = cols[i - 1];
    const cur = cols[i];
    if (cur.utc <= prev.utc) {
      const how = cur.utc === prev.utc ? 'se repite' : 'aparece fuera de orden cronológico';
      throw new Error(
        `La columna de fecha "${cur.label}" (columna ${cur.colIdx + 1}) ${how} después de "${prev.label}". ` +
        `Es un error de captura (por ejemplo 07.01 en lugar de 07.07). ` +
        `Corrija el encabezado en el archivo y vuelva a subirlo.`,
      );
    }
    const gapDays = (cur.utc - prev.utc) / MS_PER_DAY;
    if (gapDays !== 1) {
      throw new Error(
        `Falta continuidad diaria en las columnas de fecha: entre "${prev.label}" y "${cur.label}" ` +
        `(columna ${cur.colIdx + 1}) hay un salto de ${gapDays} día(s). Debe haber una columna por día. ` +
        `Corrija el archivo y vuelva a subirlo.`,
      );
    }
  }
  return cols;
}

function sheetToArray(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
}

// Group the seven-rows-per-lot blocks and validate their structure. A block is
// a run of consecutive rows sharing the same Lote code. Rows with an empty Lote
// (the stray TONS row 6, the trailing template blocks) and repeated header rows
// are skipped rather than treated as lots. Refuses the whole file on: a lot in
// non-contiguous blocks, a duplicate metric row, an unknown Análisis label, or
// a block missing any canonical metric (which is also how a blank-Lote metric
// row is caught — it is skipped, leaving its lot short a metric).
function buildBlocks(rows) {
  const blocks = [];
  const seenLots = new Set();
  let current = null;

  const assertComplete = (block) => {
    for (const m of CANONICAL_METRICS) {
      if (!(m in block.metricRows)) {
        throw new Error(
          `El lote "${block.lote}" no tiene la métrica "${METRIC_LABELS[m]}" (debe tener exactamente ` +
          `las 7 métricas: ${CANONICAL_METRICS.map(k => METRIC_LABELS[k]).join(', ')}). ` +
          `Puede deberse a una fila con la métrica pero sin código de Lote. Corrija el archivo y vuelva a subirlo.`,
        );
      }
    }
  };

  for (let i = HEADER_ROW + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === null || String(c).trim() === '')) continue;

    // Repeated header row (row 7 and any like it).
    if (String(row[0] ?? '').trim() === 'Variedad' || normMetric(row[8]) === 'analisis') continue;

    const lote = String(row[3] ?? '').trim();
    // No lot code: the stray TONS row and the trailing empty template blocks.
    // A blank-Lote row that sits mid-block leaves its lot short a metric, which
    // assertComplete catches — so skipping here is safe, not silent.
    if (!lote) continue;

    const metric = normMetric(row[8]);
    if (!CANONICAL_METRICS.includes(metric)) {
      throw new Error(
        `Etiqueta de Análisis no reconocida "${String(row[8] ?? '').trim()}" en el lote "${lote}" (fila ${i + 1}). ` +
        `Cada lote debe tener exactamente: ${CANONICAL_METRICS.map(k => METRIC_LABELS[k]).join(', ')}. ` +
        `Corrija el archivo y vuelva a subirlo.`,
      );
    }

    if (!current || current.lote !== lote) {
      if (seenLots.has(lote)) {
        throw new Error(
          `El lote "${lote}" aparece en bloques separados (no contiguos) en la hoja (fila ${i + 1}). ` +
          `Cada lote debe ocupar siete filas consecutivas. Corrija el archivo y vuelva a subirlo.`,
        );
      }
      if (current) assertComplete(current);
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
      seenLots.add(lote);
      blocks.push(current);
    }

    if (metric in current.metricRows) {
      throw new Error(
        `El lote "${lote}" tiene la métrica "${METRIC_LABELS[metric]}" repetida (fila ${i + 1}). ` +
        `Cada métrica debe aparecer una sola vez por lote. Corrija el archivo y vuelva a subirlo.`,
      );
    }
    current.metricRows[metric] = row;
  }
  if (current) assertComplete(current);
  return blocks;
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

    // Group + structurally validate the lot blocks (refuses on corruption).
    const blocks = buildBlocks(rows);

    // Derive the workbook vintage ONCE, by majority vote across the lot codes
    // (issue SEVEN). One workbook is one vintage; a single mistyped prefix must
    // be the outlier that gets rejected, not the value that flips the whole book
    // — so the mode, not the first lot, wins. Ties break to the first seen.
    let workbookVintage = null;
    {
      const counts = new Map();
      for (const block of blocks) {
        const v = vintageFromLot(block.lote);
        if (v === null) continue;
        if (!counts.has(v)) counts.set(v, 0);
        counts.set(v, counts.get(v) + 1);
      }
      let best = -1;
      for (const [v, n] of counts) {
        if (n > best) { best = n; workbookVintage = v; }
      }
    }

    // Validate the date-column headers (needs the vintage for the calendar
    // round-trip). Refuses the file on any hole in the daily run.
    const dateCols = buildDateColumns(header, workbookVintage ?? 2026);

    const berryRows = [];
    const lotRows = [];
    const rejected = [];
    const warnings = [];

    for (const block of blocks) {
      const vintage = vintageFromLot(block.lote);
      if (vintage === null) {
        rejected.push({
          row: { Lote: block.lote },
          motivo_rechazo: `Lote "${block.lote}": no se pudo derivar el año de vendimia del prefijo del código`,
        });
        continue;
      }
      // One workbook = one vintage. A lot whose prefix disagrees is a capture
      // error; reject it rather than emit its series under the wrong year.
      if (vintage !== workbookVintage) {
        rejected.push({
          row: { Lote: block.lote },
          motivo_rechazo: `Lote "${block.lote}": el prefijo del código implica la vendimia ${vintage}, pero el libro es de la vendimia ${workbookVintage}. Un libro no puede mezclar vendimias.`,
        });
        continue;
      }

      // ── wine_samples (sample_type 'Berries'): one row per (lot, date) with
      //    any chemistry value. This is the table the maturity charts read. ──
      for (const dc of dateCols) {
        const chem = {};
        let hasValue = false;
        for (const [metric, col] of Object.entries(METRIC_TO_BERRY)) {
          const mRow = block.metricRows[metric];
          const val = mRow ? normalizeValue(mRow[dc.colIdx]) : null;
          chem[col] = val;
          if (val !== null) hasValue = true;
        }
        if (!hasValue) continue;

        // Fixed key set across every berry row (Round 33: PostgREST rejects
        // mixed-shape batches). sample_seq is assigned by the controller.
        const obj = {
          sample_id: block.lote,
          sample_date: `${workbookVintage}-${pad2(dc.month)}-${pad2(dc.day)}`,
          sample_type: 'Berries',
          vintage_year: workbookVintage,
          variety: block.variety ?? null,
          below_detection: false,
          brix: null, ph: null, ta: null,
          berry_weight: null, malic_acid: null, berry_anthocyanins: null,
        };
        for (const col of BERRY_COLUMNS) obj[col] = chem[col];

        const reject = validateColumnTypes(obj, COLUMN_TYPES.wine_samples);
        if (reject) {
          rejected.push({ row: { Lote: block.lote, Fecha: obj.sample_date }, motivo_rechazo: reject });
          continue;
        }
        berryRows.push(obj);
      }

      // ── seguimiento_lotes: one row per lot ──
      // Recompute the TONS running total from the dated cells rather than
      // trusting the cached +SUM(...) formula result (a workbook can be saved
      // stale). A non-numeric dated TONS cell is a corruption, not an absence —
      // refuse the file rather than silently drop it.
      let recomputed = 0;
      let sawTons = false;
      const tonsRow = block.metricRows['tons'];
      if (tonsRow) {
        for (const dc of dateCols) {
          const raw = tonsRow[dc.colIdx];
          const v = normalizeValue(raw); // blank / '-' / '—' / NA → null
          if (v === null) continue;
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            throw new Error(
              `El lote "${block.lote}" tiene un valor de TONS no numérico ("${String(raw).trim()}") ` +
              `en la columna de fecha "${dc.label}". Corrija el archivo y vuelva a subirlo.`,
            );
          }
          recomputed += v;
          sawTons = true;
        }
      }
      // Round to cents to avoid float-accumulation noise on the sum.
      const tonsSeguimiento = sawTons ? Math.round(recomputed * 100) / 100 : null;
      const cachedNum = (typeof block.tons_cached === 'number' && Number.isFinite(block.tons_cached))
        ? block.tons_cached : null;
      // A disagreement is: recomputed != cached (cent tolerance so a rounded sum
      // does not fight the cached value), OR a NON-ZERO cached total with no
      // dated cells to recompute from (a stale cache with nothing to back it —
      // a cached 0 with no cells is consistent, not a disagreement).
      let mismatch = false;
      if (cachedNum !== null) {
        if (tonsSeguimiento === null) mismatch = Math.abs(cachedNum) > 0.01;
        else if (Math.abs(cachedNum - tonsSeguimiento) > 0.01) mismatch = true;
      }
      if (mismatch) {
        warnings.push(
          tonsSeguimiento === null
            ? `Lote "${block.lote}": la hoja almacena un TONS (${cachedNum}) pero no hay celdas de TONS por fecha para recalcularlo.`
            : `Lote "${block.lote}": TONS recalculado (${tonsSeguimiento}) no coincide con el valor almacenado en la hoja (${cachedNum}).`,
        );
      }

      const lotObj = {
        lot_code: block.lote,
        vintage_year: workbookVintage,
        variety: block.variety ?? null,
        proveedor: block.proveedor ?? null,
        status: block.status ?? null,
        ant_target: block.ant_target ?? null,
        codigo: block.codigo ?? null,
        cantidad_proyectada: block.cantidad_proyectada ?? null,
        tons_seguimiento: tonsSeguimiento,
        tons_seguimiento_cached: cachedNum,
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
        { table: 'wine_samples',      rows: berryRows, conflictKey: 'sample_id,sample_date,sample_seq' },
        { table: 'seguimiento_lotes', rows: lotRows,   conflictKey: 'lot_code,vintage_year' },
      ],
      excluded: {},
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
