// tests/fixtures/make-seguimiento-fixture.mjs
//
// Generates tests/fixtures/seguimiento_maduracion_sample.xlsx — a SANITIZED,
// synthetic slice of the winery's "Seguimiento de Maduración Vendimia 2026"
// workbook. The real file is the winery's live 2026 harvest plan (supplier
// names, projected tonnages, the full maturity series) and is deliberately
// kept OUT of this public repo (it lives at hq/state/fixtures-private/). This
// generator builds an equivalent-shaped fixture from scratch so the parser
// tests can run anywhere without publishing commercial data.
//
// What is preserved EXACTLY, because the tests verify it:
//   - the row-0..4 title/band rows and the real header at row 5
//   - the 9 metadata columns + one column PER DAY from 29.06 through 08.11
//   - the seven-rows-per-lot metric block keyed by the Análisis column
//     (TONS, °Brix, pH, AT, Peso baya, Ac. Málico, Antocianos)
//   - the stray TONS row (row 6) and the repeated header row (row 7)
//   - CRUCIALLY the column-18 defect sitting between 06.07 and 08.07: in the
//     real file that cell is DATE-formatted, so the typed "07.07" was stored
//     as the number 7.07 and Excel displays it as "07.01". We reproduce the
//     exact serial (see REAL_TYPO_DATE) so the recovery and the ordering
//     guard are both exercised against the real shape, not a stand-in.
//
// What is sanitized: supplier and lot codes are placeholders, and the maturity
// values are invented (not the winery's real readings).
//
// Regenerate with:  node tests/fixtures/make-seguimiento-fixture.mjs
// If you change the shape, update tests/mt44-upload-seguimiento.test.mjs to
// match: it asserts exact bucket counts and the column-18 recovery.

import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';

// ── Date header row (col 9 onward): daily 29.06 → 08.11, DD.MM text, EXCEPT
// the 07.07 slot, which holds the real file's column-18 defect as a date cell. ──
// The real workbook's column-18 defect, reproduced exactly.
//
// That one cell carries a DD.MM *date* number format while its neighbours are
// text. Typing "07.07" into it made Excel read the keystrokes as the NUMBER
// 7.07, store serial 7.07 and render it through the format as "07.01". So the
// cell is a date cell whose value sits 7.07 days past the pre-leap-bug epoch
// (1899-12-31), that is 1900-01-07T01:40:48Z, NOT a clean midnight. The
// fraction is the whole point: it is the month the winery typed, still intact,
// and it is what the parser recovers. A midnight Date (serial 7.00) carries no
// month at all and is a different, unrecoverable defect with its own test.
export const REAL_TYPO_SERIAL = 7.07;
export const REAL_TYPO_DATE = new Date(Date.UTC(1899, 11, 31) + REAL_TYPO_SERIAL * 86400000);

export function buildDateHeaders() {
  const headers = [];
  const start = new Date(Date.UTC(2026, 5, 29)); // 29 June 2026
  const end = new Date(Date.UTC(2026, 10, 8));   // 08 Nov 2026
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    if (dd === '07' && mm === '07') {
      headers.push(REAL_TYPO_DATE);
    } else {
      headers.push(`${dd}.${mm}`); // text "DD.MM", no year — as in the source
    }
  }
  return headers;
}

const METRICS = ['TONS', '°Brix', 'pH', 'AT', 'Peso baya', 'Ac. Málico', 'Antocianos'];

// A lot = 7 consecutive rows (one per metric). `values` maps metric -> {colOffset: value}
// where colOffset is the 0-based index into the date columns.
function lotBlock(meta, values) {
  return METRICS.map(metric => {
    const row = [
      meta.variedad, meta.status, meta.proveedor, meta.lote,
      meta.antTarget ?? null, meta.codigo ?? null,
      meta.cantidadProyectada, meta.tonsCached, metric,
    ];
    const dateVals = values[metric] || {};
    const dateCount = DATE_HEADERS.length;
    for (let i = 0; i < dateCount; i++) {
      row.push(i in dateVals ? dateVals[i] : null);
    }
    return row;
  });
}

const DATE_HEADERS = buildDateHeaders();

// Column offsets we drop values on (arbitrary but valid dates, avoiding the
// typo slot). Offsets are into the date columns; 17 = 16.07, 21 = 20.07, etc.
const O1 = 17, O2 = 21, O3 = 26;

export function buildAoa() {
  const aoa = [];
  // The workbook states its vintage in the title (issue TWO: the parser derives
  // the vintage from this "Vendimia AAAA" token, not from a vote over lot codes).
  aoa[0] = ['SEGUIMIENTO DE MADURACIÓN VENDIMIA 2026   FL 8.5.1  REV 5'];
  aoa[1] = [];
  aoa[2] = ['Mes'];
  aoa[3] = [null, null, null, null, null, null, null, null, null, 'SEM 27'];
  aoa[4] = [null, null, null, null, null, null, null, null, null, 'Lu', 'Ma', 'Mi'];
  // Row 5: the real header
  aoa[5] = [
    'Variedad', 'Status', 'Proveedor', 'Lote', 'ANT Target', 'Código',
    'Cantidad proyectada', 'TONS', 'Análisis', ...DATE_HEADERS,
  ];
  // Row 6: stray TONS aggregate row with no lot metadata and all-ZERO dated
  // cells, exactly as in the real file (its 133 date cells are 0). It is a legit
  // template/aggregate stub that must be skipped: a blank-Lote row of zeros
  // carries no lot data, so issue SIX must NOT reject it (a zero is treated like
  // a blank, unlike a real non-zero reading under a missing Lote).
  aoa[6] = [null, null, null, null, null, null, null, null, 'TONS',
    ...DATE_HEADERS.map(() => 0)];
  // Row 7: repeated header inside the data region (note 'Pendiente' + dashes)
  aoa[7] = [
    'Variedad', 'Status', 'Proveedor', 'Lote', 'ANT Target', 'Pendiente',
    'Cantidad proyectada', 'TONS', 'Análisis', ...DATE_HEADERS.map(() => '-'),
  ];

  const lots = [
    // Lot A — Recibido. tons cached (10) == recomputed dated cells (7+3=10).
    lotBlock(
      { variedad: 'SB', status: 'Recibido', proveedor: 'PROV1', lote: '26AAAA1A-C',
        cantidadProyectada: 10, tonsCached: 10 },
      {
        TONS: { [O1]: 7, [O2]: 3 },
        '°Brix': { [O1]: 20.5, [O2]: 22.4, [O3]: 23.6 },
        pH: { [O1]: 3.10, [O2]: 3.22, [O3]: 3.28 },
        AT: { [O1]: 10.8, [O2]: 9.4, [O3]: 8.9 },
        'Peso baya': { [O3]: 1.42 },
        'Ac. Málico': { [O1]: 4.5, [O2]: 3.6, [O3]: 3.2 },
        Antocianos: { [O3]: 18.7 },
      },
    ),
    // Lot B — No Recibido. tons cached (10) DISAGREES with recomputed (5+2=7):
    // a stale cached formula → tons_mismatch must be surfaced.
    lotBlock(
      { variedad: 'SB', status: 'No Recibido', proveedor: 'PROV1', lote: '26AAAA1B',
        cantidadProyectada: 12, tonsCached: 10 },
      {
        TONS: { [O1]: 5, [O2]: 2 },
        '°Brix': { [O1]: 19.4, [O2]: 20.6 },
        pH: { [O1]: 3.05, [O2]: 3.18 },
        AT: { [O1]: 11.2, [O2]: 9.9 },
        'Ac. Málico': { [O1]: 4.8, [O2]: 3.9 },
      },
    ),
    // Lot C — Recibido, cached == recomputed (4). Antocianos + Peso baya blank.
    lotBlock(
      { variedad: 'CS', status: 'Recibido', proveedor: 'PROV2', lote: '26BBBB2A',
        cantidadProyectada: 4, tonsCached: 4 },
      {
        TONS: { [O2]: 4 },
        '°Brix': { [O1]: 21.1, [O3]: 24.0 },
        pH: { [O1]: 3.12, [O3]: 3.40 },
        AT: { [O1]: 12.0, [O3]: 7.8 },
        'Ac. Málico': { [O1]: 4.9, [O3]: 2.4 },
      },
    ),
    // Lot D — Recibido, all-blank on many dates (only one reading) to exercise
    // blank/dash skipping. Uses explicit dash markers on some cells.
    lotBlock(
      { variedad: 'ME', status: 'Recibido', proveedor: 'PROV2', lote: '26CCCC3A',
        cantidadProyectada: 6, tonsCached: 6 },
      {
        TONS: { [O3]: 6 },
        '°Brix': { [O1]: '-', [O3]: 22.9 },
        pH: { [O3]: 3.30 },
        AT: { [O3]: 8.5 },
        'Ac. Málico': { [O3]: 3.0 },
      },
    ),
  ];

  let r = 8;
  for (const block of lots) {
    for (const row of block) aoa[r++] = row;
  }
  return aoa;
}

// aoa_to_sheet keeps each JS value's native type, so "29.06" stays a text cell
// and the Date stays a date cell — exactly the mixed shape the parser must
// tolerate. cellDates on write is not needed (Dates serialize as date cells).
function writeFixture(path) {
  const aoa = buildAoa();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Uva');
  // Empty 'Flujo Tons' + a derived 'SUMMARY' pivot, present but ignored by the
  // parser (mirrors the real workbook's three sheets).
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Flujo Tons');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SUMMARY (derivado)']]), 'SUMMARY');
  writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// Run directly → (re)write the committed fixture.
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL('./seguimiento_maduracion_sample.xlsx', import.meta.url);
  writeFixture(out.pathname);
  console.log(`Wrote ${out.pathname}`);
}

export { writeFixture };
