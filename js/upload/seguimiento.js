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

// Expand a workbook Variedad code (SB, CS, MAL…) to the full varietal name the
// dashboard's read path expects. Historical wine_samples rows carry full names
// (Sauvignon Blanc, Cabernet Sauvignon…) and DataStore.getGrapeType / the
// Tintas-Blancas toggle / the variety chips all key on those names —
// CONFIG.normalizeVariety on the read side only maps Petite Sirah, it does NOT
// expand abbreviations. So the parser must store the full name, or every 2026
// lot splits from history and mis-classifies (SB → 'red', hidden under Blancas).
// An unrecognized code passes through unchanged (a warning is emitted upstream)
// rather than refusing the file, so a new abbreviation never stops ingestion.
function expandVariety(raw) {
  const v = normalizeValue(raw);          // blank markers → null
  if (v === null) return null;
  const code = String(v).trim();
  const full = CONFIG.varietyAbbr[code] ?? code;
  return CONFIG.normalizeVariety(full);
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

// Derive the workbook's vintage from the workbook ITSELF, not from a vote over
// the lot prefixes (issue TWO). A majority/first-seen vote breaks on a tie and
// lets a single mistyped prefix become authoritative; the winery's own workbook
// states the vintage as "Vendimia AAAA" — in the preamble title of the Uva sheet
// and in the file name. That string is authoritative; every lot prefix is then
// checked AGAINST it and a disagreeing lot is rejected by name. Returns null
// when no "Vendimia AAAA" can be found anywhere, so the caller refuses the file
// rather than falling back to a guessed year.
function extractVintage(rows, filename) {
  const re = /vendimia\s*(\d{4})/i;
  for (let r = 0; r <= HEADER_ROW; r++) {
    for (const cell of (rows[r] || [])) {
      if (cell == null) continue;
      const m = String(cell).match(re);
      if (m) return { year: parseInt(m[1], 10), source: `el título de la hoja` };
    }
  }
  const mf = String(filename || '').match(re);
  if (mf) return { year: parseInt(mf[1], 10), source: `el nombre del archivo` };
  return null;
}

// Excel epoch for serials below the 1900-02-29 phantom leap day. For serial < 60
// SheetJS anchors the day count at 1899-12-31, so this inverse is exact there.
// Every DD.MM value is at most 31.12, well inside that range, so the recovery
// below never has to reason about the leap-day bug.
const EXCEL_1900_EPOCH = Date.UTC(1899, 11, 31);
const MS_PER_HUNDREDTH_DAY = 864000;     // 0.01 day, the DD.MM payload's resolution
const MIN_HUNDREDTHS = 100;              // serial 1.00
const MAX_HUNDREDTHS = 3200;             // serial 32.00: past 31.12, short of the
                                         // phantom leap day at 60
const SERIAL_TOLERANCE_MS = 1000;        // storage noise only, never a real digit

// Recover the DD.MM a date-formatted header cell was really given.
//
// The winery's date row is text, EXCEPT wherever a cell got retyped while it
// carried a DD.MM *date* number format. Typing "07.07" there does not make
// Excel store 7 July: it reads the keystrokes as the NUMBER 7.07, stores serial
// 7.07 and renders it through the DD.MM format as "07.01" (7 Jan 1900). The
// 2026 workbook ships exactly that in column 18. Nothing is lost: the serial
// IS the DD.MM that was typed, so read it back instead of bouncing the file:
// integer part = day, the two-decimal fraction = month. The serial is read as a
// whole number of hundredths of a day, so the trailing zero survives: 07.10
// arrives as serial 7.1, that is 710 hundredths, and comes back as month 10.
//
// Only serials in the 1900 phantom range qualify. A real vintage date is a
// 5-digit serial, so this can never reinterpret a genuine date cell.
function recoverSerialDate(date) {
  // Integer milliseconds throughout: a DD.MM payload is an exact whole number of
  // hundredths of a day, so this never has to round a float into a date. Do NOT
  // reintroduce toFixed(2) here: it would quietly turn an arbitrary serial like
  // 7.074 into "07.07" and land a whole column on a day nobody typed.
  const ms = date.getTime() - EXCEL_1900_EPOCH;
  const hundredths = Math.round(ms / MS_PER_HUNDREDTH_DAY);
  if (hundredths < MIN_HUNDREDTHS || hundredths >= MAX_HUNDREDTHS) return null;
  // The serial must BE a two-decimal value, not merely round to one. Anything
  // further off than storage noise carries digits the DD.MM reading would
  // discard, which means we do not actually know what was typed: refuse and let
  // the ordering guard reject the file.
  if (Math.abs(ms - hundredths * MS_PER_HUNDREDTH_DAY) > SERIAL_TOLERANCE_MS) return null;
  const day = Math.floor(hundredths / 100);
  const month = hundredths % 100;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stored = `${day}.${pad2(month)}`;
  // What Excel puts on screen for that serial, so the warning can quote it.
  const shown = `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}`;
  return { label: `${pad2(day)}.${pad2(month)}`, month, day, recoveredFrom: stored, shownAs: shown };
}

// Parse one date header cell into {label, month, day}. Handles the text "DD.MM"
// form, a genuine date-typed cell, and the date-formatted cell that swallowed a
// typed DD.MM as a bare number (recoverSerialDate above). A recovered column
// carries `recoveredFrom` so the caller can warn about it; it is NOT trusted on
// its own. It still has to clear the calendar, ordering and daily-continuity
// checks in buildDateColumns like every other column.
function parseDateHeader(cell) {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const recovered = recoverSerialDate(cell);
    if (recovered) return recovered;
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
//
// A header recovered from a date-formatted cell (parseDateHeader ->
// recoverSerialDate) is validated by all three rules exactly like a text
// header, so the recovery can never smuggle a wrong date past this function;
// it only stops the file being refused over a lossless Excel artifact. Each
// recovery appends a warning so the winery can repair the cell.
function buildDateColumns(header, vintage, rows, warnings = []) {
  let lastHeaderCol = -1;
  for (let c = DATE_COL_START; c < header.length; c++) {
    if (!isBlank(header[c])) lastHeaderCol = c;
  }
  if (lastHeaderCol < DATE_COL_START) {
    throw new Error('El archivo no contiene columnas de fecha en la fila de encabezado.');
  }

  // Issue FOUR: the occupied extent is taken from the SHEET, not just the header
  // row. A populated data column whose header is blank at the end of the range
  // was previously discarded as padding; find the last column any data row
  // populates so a value under a headerless trailing column is caught, not lost.
  let maxDataCol = -1;
  for (let r = HEADER_ROW + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = row.length - 1; c > maxDataCol; c--) {
      if (c >= DATE_COL_START && normalizeValue(row[c]) !== null) { maxDataCol = c; break; }
    }
  }
  const extent = Math.max(lastHeaderCol, maxDataCol);
  const columnPopulated = (c) => {
    for (let r = HEADER_ROW + 1; r < rows.length; r++) {
      if (rows[r] && normalizeValue(rows[r][c]) !== null) return true;
    }
    return false;
  };

  const cols = [];
  for (let c = DATE_COL_START; c <= extent; c++) {
    const cell = header[c];
    if (isBlank(cell)) {
      // A blank header BETWEEN dates (c ≤ last header) or ABOVE populated data
      // (c > last header, but a data row fills it) is a hole: its values would
      // vanish silently. Refuse, naming the column. A blank header with no data
      // beyond the last date is trailing padding and never reaches here (extent
      // caps the scan at the last populated/headed column).
      const reason = c <= lastHeaderCol ? 'entre columnas de fecha'
        : columnPopulated(c) ? 'pero hay datos en esa columna'
        : 'antes de una columna con datos sin encabezado';
      throw new Error(
        `El encabezado de fecha está vacío en la columna ${c + 1}, ${reason}. ` +
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
    if (parsed.recoveredFrom !== undefined) {
      warnings.push(
        `Columna ${c + 1}: el encabezado de fecha está en una celda con formato de fecha, ` +
        `así que Excel guardó lo tecleado como el número ${parsed.recoveredFrom} y lo muestra como ` +
        `"${parsed.shownAs}". Se interpretó como ${parsed.label}. ` +
        `Dé formato de texto a esa celda para eliminar la ambigüedad.`,
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

const META_COLS = [0, 1, 2, 4, 5, 6, 7]; // every column except Lote(3) and Análisis(8)

// Does a blank-Lote row carry a MEANINGFUL dated value? The real file's stray
// TONS row (row 6) is a template aggregate whose dated cells are all 0 — that
// carries no lot data to lose, so a 0 (like a blank/dash) does not count as
// content; only a non-zero number or a non-numeric string does. A genuine data
// row with a real reading under a missing Lote is thus still surfaced.
function hasDatedValue(row) {
  for (let c = DATE_COL_START; c < row.length; c++) {
    const v = normalizeValue(row[c]);
    if (v !== null && v !== 0) return true;
  }
  return false;
}

// Classify a blank-Lote row's payload for issue SIX. Two blank-Lote shapes are
// LEGITIMATE in this workbook and must be skipped: the stray per-day TONS totals
// row (row 6 — no lot metadata, a known "TONS" label, and dated total cells) and
// the trailing empty template blocks (a known label, nothing else). Every real
// lot row repeats its full metadata (Variedad/Status/Proveedor/forecast) on all
// seven rows, so a genuine data row whose Lote was dropped still carries that
// metadata — which is how it is told apart from the aggregate stub. A blank-Lote
// row is therefore an anomaly to surface (not silently drop) only when it carries
// lot metadata, an UNKNOWN Análisis label, or dated values under NO recognizable
// metric label (data that cannot be attributed to any metric or lot).
function blankLoteAnomaly(row) {
  if (META_COLS.some(c => !isBlank(row[c]))) return 'metadata';
  const label = String(row[8] ?? '').trim();
  const knownLabel = label !== '' && CANONICAL_METRICS.includes(normMetric(row[8]));
  if (label !== '' && !knownLabel) return 'una métrica no reconocida';
  if (!knownLabel && hasDatedValue(row)) return 'valores por fecha sin una métrica reconocida';
  return null; // no metadata + a known metric label (or nothing) → a legit stub
}

// Group the seven-rows-per-lot blocks and validate their structure. A block is
// a run of SEVEN PHYSICALLY CONSECUTIVE rows sharing one Lote code. The known
// preamble (fully-blank rows, the stray TONS row 6, the repeated header row 7)
// is allowed ONLY before the first lot block; once the first lot row is seen,
// every accepted metric row must sit exactly one physical row after the previous
// (issue THREE) — a blank row, a repeated header or a blank-Lote row between two
// metric rows would otherwise let seven NON-consecutive rows satisfy the
// exactly-seven invariant, and the intervening row's data would vanish. Refuses
// the whole file on: a non-contiguous / duplicate metric row, a duplicate or
// non-contiguous lot, an unknown Análisis label, or a block missing any metric.
// Blank-Lote rows carrying real content (issue SIX) are pushed to `rejected`.
function buildBlocks(rows, rejected) {
  const blocks = [];
  const seenLots = new Set();
  let current = null;
  let firstLotSeen = false;
  let prevMetricRowIdx = -1;

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

    // Repeated header row (row 7 and any like it) — a non-metric row; skipping
    // it does not advance prevMetricRowIdx, so if it sits inside the data region
    // the contiguity check below refuses the file at the next metric row.
    if (String(row[0] ?? '').trim() === 'Variedad' || normMetric(row[8]) === 'analisis') continue;

    const lote = String(row[3] ?? '').trim();
    // No lot code: the stray TONS row and the trailing empty template blocks.
    // A legit stub (only a known metric label) is skipped; anything carrying
    // metadata, an unknown label or dated values is surfaced (issue SIX) rather
    // than silently dropped. Either way it is NOT an accepted metric row, so it
    // leaves a physical gap the contiguity check catches if it is mid-block.
    if (!lote) {
      const anomaly = blankLoteAnomaly(row);
      if (anomaly) {
        rejected.push({
          row: { Fila: i + 1 },
          motivo_rechazo: `Fila ${i + 1}: fila sin código de Lote que contiene ${anomaly}. ` +
            `No se puede asignar a ningún lote; corrija el archivo (agregue el código de Lote o elimine la fila).`,
        });
      }
      continue;
    }

    const metric = normMetric(row[8]);
    if (!CANONICAL_METRICS.includes(metric)) {
      throw new Error(
        `Etiqueta de Análisis no reconocida "${String(row[8] ?? '').trim()}" en el lote "${lote}" (fila ${i + 1}). ` +
        `Cada lote debe tener exactamente: ${CANONICAL_METRICS.map(k => METRIC_LABELS[k]).join(', ')}. ` +
        `Corrija el archivo y vuelva a subirlo.`,
      );
    }

    // Physical contiguity (issue THREE): once the first lot row is seen, every
    // accepted metric row must be exactly one row after the previous one.
    if (firstLotSeen && i !== prevMetricRowIdx + 1) {
      throw new Error(
        `La fila ${i + 1} (lote "${lote}", métrica "${METRIC_LABELS[metric]}") no es contigua con la fila anterior del bloque: ` +
        `una fila en blanco, un encabezado repetido o una fila sin Lote interrumpe las siete filas consecutivas del lote. ` +
        `Cada lote debe ocupar siete filas consecutivas. Corrija el archivo y vuelva a subirlo.`,
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
        varietyCode: (normalizeValue(row[0]) != null) ? String(normalizeValue(row[0])).trim() : null,
        variety:  expandVariety(row[0]),
        status:   row[1] != null ? String(row[1]).trim() : null,
        proveedor: row[2] != null ? String(row[2]).trim() : null,
        ant_target: normalizeValue(row[4]),
        codigo:   row[5] != null ? String(row[5]).trim() : null,
        cantidad_proyectada: normalizeValue(row[6]),
        tons_cached: normalizeValue(row[7]),
        tons_cached_raw: row[7],
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
    firstLotSeen = true;
    prevMetricRowIdx = i;
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

    const rejected = [];
    const warnings = [];

    // Group + structurally validate the lot blocks (refuses on corruption;
    // blank-Lote rows carrying real content are pushed to `rejected`).
    const blocks = buildBlocks(rows, rejected);

    // Issue SIX: a structurally valid file with ZERO lot blocks would otherwise
    // parse successfully into two empty targets. Require at least one lot block.
    if (blocks.length === 0) {
      throw new Error(
        'El archivo no contiene ningún bloque de lote (siete filas por lote bajo el encabezado). ' +
        'No hay datos que cargar; verifique que subió el archivo correcto.',
      );
    }

    // Issue TWO: derive the workbook vintage from the workbook itself
    // ("Vendimia AAAA" in the title or the file name), NOT from a vote over the
    // lot prefixes. If it cannot be found, refuse the file rather than guessing.
    const vintageInfo = extractVintage(rows, file.name);
    if (!vintageInfo) {
      throw new Error(
        'No se pudo determinar la vendimia del archivo: no se encontró "Vendimia AAAA" ni en el título de la hoja ' +
        'ni en el nombre del archivo. Corrija el archivo o su nombre y vuelva a subirlo.',
      );
    }
    const workbookVintage = vintageInfo.year;

    // Validate the date-column headers (needs the vintage for the calendar
    // round-trip). Refuses the file on any hole in the daily run OR a populated
    // column under a blank/invalid header (issue FOUR).
    const dateCols = buildDateColumns(header, workbookVintage, rows, warnings);

    const berryRows = [];
    const lotRows = [];

    for (const block of blocks) {
      // Issue ONE (safety net): a Variedad code the map does not know is stored
      // raw (a full name it might already be) but flagged, so an unmapped code is
      // never silent. The workbook's known set is fully covered by CONFIG.varietyAbbr.
      if (block.varietyCode &&
          !(block.varietyCode in CONFIG.varietyAbbr) &&
          !CONFIG.grapeTypes.red.includes(block.varietyCode) &&
          !CONFIG.grapeTypes.white.includes(block.varietyCode)) {
        warnings.push(
          `Lote "${block.lote}": la abreviatura de variedad "${block.varietyCode}" no está en el catálogo (CONFIG.varietyAbbr); ` +
          `se guardó sin expandir y puede aparecer separada del historial. Agregue la abreviatura al catálogo.`,
        );
      }

      const vintage = vintageFromLot(block.lote);
      if (vintage === null) {
        rejected.push({
          row: { Lote: block.lote },
          motivo_rechazo: `Lote "${block.lote}": no se pudo derivar el año de vendimia del prefijo del código`,
        });
        continue;
      }
      // One workbook = one vintage, taken from the workbook itself (issue TWO).
      // A lot whose prefix disagrees is a capture error; reject it by name rather
      // than emit its series under the wrong year.
      if (vintage !== workbookVintage) {
        rejected.push({
          row: { Lote: block.lote },
          motivo_rechazo: `Lote "${block.lote}": el prefijo del código implica la vendimia ${vintage}, pero según ${vintageInfo.source} el libro es de la vendimia ${workbookVintage}. Un libro no puede mezclar vendimias.`,
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
      // Issue FIVE: the cached TONS cell (col 7, the +SUM formula's stored value)
      // was previously coerced to null when non-numeric ("ABC"), silently losing
      // a corruption. If it is non-blank and does not normalize to a finite
      // number, refuse the file naming the lot rather than nulling it.
      if (!isBlank(block.tons_cached_raw) &&
          (typeof block.tons_cached !== 'number' || !Number.isFinite(block.tons_cached))) {
        throw new Error(
          `El lote "${block.lote}" tiene un valor de TONS (almacenado en la hoja) no numérico ` +
          `("${String(block.tons_cached_raw).trim()}"). Corrija el archivo y vuelva a subirlo.`,
        );
      }
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
