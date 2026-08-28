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
import { normalizeValue, normalizeDate, validateColumnTypes } from './normalize.js';
import { COLUMN_TYPES } from '../validation.js';
import { Identity } from '../identity.js';

const BELOW_DETECTION_RE = /^<\s*\d+(\.\d+)?$/;
const ABOVE_DETECTION_RE = /^>\s*(\d+(\.\d+)?)$/;
// Matches lab-test markers anywhere in sample_id (no word boundary — handles compounds like WATERBLUEBERRY)
const LAB_TEST_RE = /(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)/i;

// WineXRay CSV columns whose values must be ISO YYYY-MM-DD. The tool emits
// US-format slash dates ("2/27/2026"), so we hint MDY for disambiguation.
const DATE_COLUMNS = new Set(['sample_date', 'crush_date']);


// WineXRay exports the Total Phenolics Index header UNQUOTED with an embedded
// comma: `Total Phenolics Index (IPT, d-less)`. A CSV reader splits that one
// header cell into two, and because SheetJS pads every row out to the widest
// row, the header and data-row field counts stay equal (e.g. 59 == 59) while
// every column after IPT silently shifts one position: tANT reads fANT's
// number, fANT reads bANT's, and so on down the phenolics/color/berry columns.
// The result is plausible-but-wrong berry chemistry with no visible error — the
// worst failure mode on this surface. dataLoader.loadFile guards the legacy
// path by quoting the header in the raw CSV text before it reaches SheetJS;
// this parser reads the bytes directly, so it must apply the same repair. Note
// a field-count check would NOT catch this — the counts match after padding;
// the repair has to happen on the raw text, before the split is normalized away.
const IPT_MALFORMED_HEADER = 'Total Phenolics Index (IPT, d-less)';

// Decode the raw bytes to text. Two things this must not get wrong.
//
// Encoding: the previous array-mode path let SheetJS sniff the codepage. Reading
// bytes ourselves means we own that, and decoding a Windows-1252 export as UTF-8
// turns every accented character into U+FFFD, which silently mangles varieties
// and appellations ("Peña"). So: honour a UTF-16 BOM, and decode UTF-8 in fatal
// mode so a non-UTF-8 file throws rather than corrupting quietly, then fall back
// to Windows-1252, which is what the tool emits when it is not UTF-8.
function decodeBytes(buf) {
  const b = new Uint8Array(buf);
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function decodeCsv(buf) {
  let text = decodeBytes(buf);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM

  // Repair the malformed header on the HEADER RECORD ONLY. Two reasons this is
  // scoped rather than a whole-document replace. A document-wide search can hit
  // the same phrase inside a quoted data cell and inject quotes into it, and the
  // old "skip if the quoted form appears anywhere" guard meant one quoted
  // occurrence in the data would skip the repair and leave the header broken.
  const nl = text.indexOf('\n');
  const head = nl === -1 ? text : text.slice(0, nl);
  const rest = nl === -1 ? '' : text.slice(nl);
  if (head.includes(IPT_MALFORMED_HEADER) && !head.includes(`"${IPT_MALFORMED_HEADER}"`)) {
    return head.replace(IPT_MALFORMED_HEADER, `"${IPT_MALFORMED_HEADER}"`) + rest;
  }
  return text;
}

async function fileToRows(file) {
  const buf = await file.arrayBuffer();
  // The parser is chosen by a UI button, not by file extension, so a binary
  // workbook can still be handed to this parser. Those carry no malformed CSV
  // header to repair, and decoding ZIP bytes as text would yield garbage, so
  // keep the original array-mode read for them. Text goes through the repair.
  const bytes = new Uint8Array(buf);
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B &&
                (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  // Parse from repaired text (type:'string'), matching dataLoader.loadFile, so
  // the IPT header repair above is applied before SheetJS collapses field counts.
  const wb = isZip
    ? XLSX.read(buf, { type: 'array', cellDates: true })
    : XLSX.read(decodeCsv(buf), { type: 'string', cellDates: true });
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

      // Type validation (Round 32 INT + Round 34 NUMERIC). Run AFTER
      // applyNormalization so a vintage_year derived from sample_id is also
      // checked. First offender wins so the user sees a deterministic message.
      const reject = validateColumnTypes(obj, COLUMN_TYPES.wine_samples);
      if (reject) {
        rejected.push({
          row: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          motivo_rechazo: reject,
        });
        continue;
      }

      if (dest === 'berry_samples') berryRows.push(obj);
      else wineRows.push(obj);
    }

    // Assign the upsert-key disambiguator. The natural key is
    // (sample_id, sample_date, sample_seq); without this every row lands on the
    // DB default (1 for wine_samples, 0 for berry_samples), so two genuinely
    // distinct same-day samples sharing a sample_id collide — PostgREST aborts
    // the batch (ON CONFLICT twice, 21000), or a later upload silently
    // overwrites an earlier one. canonicalSeqAssign numbers each
    // (sample_id, sample_date) group deterministically (a re-upload in any row
    // order yields the same seq), so the assignment is safe to own here in the
    // parser rather than depend on the caller remembering to run it.
    Identity.canonicalSeqAssign(wineRows);
    Identity.canonicalSeqAssign(berryRows);

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
