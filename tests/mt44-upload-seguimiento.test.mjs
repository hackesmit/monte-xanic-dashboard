// MT.44 — Seguimiento de Maduración parser: the 2026 pivoted-calendar workbook
// that replaces WineXRay as the berry-maturity source. Unpivots (lot, metric,
// date) into wine_samples (sample_type='Berries', the table the dashboard reads)
// + a per-lot seguimiento_lotes row, refuses the whole file on any structural
// corruption (out-of-order/duplicate/empty/impossible date header, duplicate or
// missing or unknown metric row, non-contiguous lot block, non-numeric TONS),
// and keeps the forecast (cantidad_proyectada) and the workbook TONS distinct.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { seguimientoParser } from '../js/upload/seguimiento.js';
import { ALLOWED_TABLES } from '../api/upload.js';
import { CONFIG } from '../js/config.js';
import { buildAoa } from './fixtures/make-seguimiento-fixture.mjs';

function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

// The committed fixture preserves the 07.01 typo. For happy-path assertions we
// build the same shape with the typo corrected to 07.07 (mirrors mt14's inline
// workbook idiom), so the structure under test stays identical bar the defect.
function correctedFile(mutate) {
  const aoa = buildAoa().map(r => (r ? [...r] : r));
  const hdr = aoa[5];
  const typoIdx = hdr.findIndex(v => v instanceof Date);
  hdr[typoIdx] = '07.07';
  if (mutate) mutate(aoa, typoIdx);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Uva');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Flujo Tons');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return asFakeFile(Buffer.from(buf), 'seguimiento_corrected.xlsx');
}

async function committedFixture() {
  const buf = await readFile(new URL('./fixtures/seguimiento_maduracion_sample.xlsx', import.meta.url));
  return asFakeFile(buf, 'seguimiento_maduracion_sample.xlsx');
}

describe('MT.44 — Seguimiento de Maduración parser', () => {
  it('has the expected parser interface', () => {
    assert.equal(seguimientoParser.id, 'seguimiento');
    assert.deepEqual(seguimientoParser.acceptedExtensions, ['.xlsx']);
  });

  // ── The non-negotiable defect guard ──
  // The column-18 defect is a date-formatted cell holding serial 7.07, which
  // Excel shows as "07.01". The serial still carries the month that was typed,
  // so the parser recovers 07.07 rather than bouncing the file, and says so.
  it('RECOVERS the committed fixture\'s column-18 date-formatted header as 07.07', async () => {
    const file = await committedFixture();
    const res = await seguimientoParser.parse(file);
    const warn = res.warnings.find(w => /Columna 18/.test(w));
    assert.ok(warn, `a warning must name column 18; got ${JSON.stringify(res.warnings)}`);
    assert.match(warn, /7\.07/, 'the warning must quote the stored number');
    assert.match(warn, /"07\.01"/, 'the warning must quote what Excel displays');
    assert.match(warn, /07\.07/, 'the warning must state the interpretation');
  });

  it('recovery is not a guess: the typo file yields byte-identical rows to the corrected file', async () => {
    const typo = await seguimientoParser.parse(await committedFixture());
    const fixed = await seguimientoParser.parse(correctedFile());
    assert.equal(typo.targets.length, fixed.targets.length);
    for (let i = 0; i < typo.targets.length; i++) {
      assert.equal(typo.targets[i].table, fixed.targets[i].table);
      assert.deepEqual(typo.targets[i].rows, fixed.targets[i].rows,
        `${typo.targets[i].table} must match the hand-corrected file exactly`);
    }
  });

  it('recovery never fires silently: the corrected file produces no column warning', async () => {
    const res = await seguimientoParser.parse(correctedFile());
    assert.equal(res.warnings.filter(w => /Columna \d+: el encabezado de fecha/.test(w)).length, 0);
  });

  it('accepts the same file once the date order is fixed', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    assert.equal(result.targets.length, 2);
    // Issue ONE: chemistry lands in wine_samples (sample_type='Berries') — the
    // table the dashboard actually reads — NOT the dead-end berry_samples.
    assert.equal(result.targets[0].table, 'wine_samples');
    assert.equal(result.targets[1].table, 'seguimiento_lotes');
    assert.equal(result.targets[0].conflictKey, 'sample_id,sample_date,sample_seq');
    assert.equal(result.targets[1].conflictKey, 'lot_code,vintage_year');
  });

  // ── Unpivot into wine_samples (sample_type 'Berries') ──
  it('unpivots per-(lot,date) chemistry into wine_samples, skipping blanks and dashes', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    const berry = result.targets[0].rows;
    // 4 sanitized lots: A→3 dates, B→2, C→2, D→1 (its blank/dash date is skipped)
    assert.equal(berry.length, 8);

    const a = berry.find(r => r.sample_id === '26AAAA1A-C' && r.sample_date === '2026-07-16');
    assert.ok(a, 'expected a berry row for lot A on 2026-07-16');
    assert.equal(a.sample_type, 'Berries');
    assert.equal(a.vintage_year, 2026);
    // Issue ONE: the workbook stores the abbreviation "SB"; the parser expands it
    // through CONFIG.varietyAbbr to the full name the dashboard read path expects.
    assert.equal(a.variety, 'Sauvignon Blanc');
    assert.equal(a.brix, 20.5);
    assert.equal(a.ph, 3.10);
    assert.equal(a.ta, 10.8);
    assert.equal(a.malic_acid, 4.5);
    assert.equal(a.below_detection, false);
    // dates with no chemistry at all must not produce a row
    assert.ok(!berry.some(r => r.sample_id === '26CCCC3A' && r.sample_date === '2026-07-16' && r.brix === null && r.ph === null && r.ta === null && r.malic_acid === null && r.berry_anthocyanins === null));
  });

  it('maps every chemistry metric onto the wine_samples columns the dashboard reads', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    const berry = result.targets[0].rows;
    // supabaseToBerryJS reads: brix, ph, ta, berry_weight→berryFW,
    // berry_anthocyanins→anthocyanins. malic_acid is stored (no chart field yet).
    assert.ok(berry.some(r => typeof r.malic_acid === 'number'), 'Ac. Málico must land in malic_acid');
    assert.ok(berry.some(r => typeof r.berry_anthocyanins === 'number'), 'Antocianos must land in berry_anthocyanins');
    // never the mixed-up berry_samples column names (would silently strip/not chart)
    for (const r of berry) {
      assert.ok(!('berry_anthocyanins_mg_100b' in r), 'must not use the berry_samples anthocyanin column');
      assert.ok(!('berries_weight_g' in r), 'must not use the whole-sample weight column');
      assert.ok(!('berry_fresh_weight_g' in r), 'must not use a non-wine_samples column');
    }
  });

  // Issue TWO: Peso baya is a PER-BERRY weight (~1.5 g), not the whole-sample
  // weight (~272 g). On wine_samples the whitelisted+charted per-berry column
  // (supabaseToBerryJS berry_weight→berryFW, "Peso Baya (g)") is berry_weight.
  it('maps Peso baya into berry_weight (per-berry), never berries_weight_g (whole-sample)', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    const berry = result.targets[0].rows;
    // fixture lot A carries Peso baya = 1.42 g on 2026-07-25 (offset O3)
    const a = berry.find(r => r.sample_id === '26AAAA1A-C' && r.sample_date === '2026-07-25');
    assert.ok(a, 'expected a berry row for lot A on 2026-07-25');
    assert.equal(a.berry_weight, 1.42, 'Peso baya must land in berry_weight');
    assert.equal(a.berries_weight_g ?? null, null, 'Peso baya must NOT land in berries_weight_g');
  });

  it('derives vintage_year from the 26 lot-code prefix', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    for (const r of result.targets[0].rows) assert.equal(r.vintage_year, 2026);
    for (const r of result.targets[1].rows) assert.equal(r.vintage_year, 2026);
  });

  it('skips the stray TONS row and the repeated header row — exactly the 4 real lots', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    const lots = result.targets[1].rows.map(r => r.lot_code).sort();
    assert.deepEqual(lots, ['26AAAA1A-C', '26AAAA1B', '26BBBB2A', '26CCCC3A']);
  });

  // ── The TONS finding: two distinct fields, recomputed, disagreement surfaced ──
  it('keeps cantidad_proyectada (forecast) and tons_seguimiento (running total) as DISTINCT fields', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    const b = result.targets[1].rows.find(r => r.lot_code === '26AAAA1B');
    // forecast 12, recomputed running total 5+2=7 — these must not collapse
    assert.equal(b.cantidad_proyectada, 12);
    assert.equal(b.tons_seguimiento, 7);
    assert.notEqual(b.cantidad_proyectada, b.tons_seguimiento);
  });

  it('recomputes tons_seguimiento from the dated cells and surfaces cache disagreement', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    const b = result.targets[1].rows.find(r => r.lot_code === '26AAAA1B');
    // cached formula (10) is stale vs the recomputed sum (7)
    assert.equal(b.tons_seguimiento, 7);
    assert.equal(b.tons_seguimiento_cached, 10);
    assert.equal(b.tons_mismatch, true);
    assert.ok(result.warnings.some(w => /26AAAA1B/.test(w) && /no coincide/.test(w)),
      'a mismatch must be surfaced as a warning, not silently reconciled');

    const a = result.targets[1].rows.find(r => r.lot_code === '26AAAA1A-C');
    // cached (10) agrees with recomputed (7+3=10)
    assert.equal(a.tons_seguimiento, 10);
    assert.equal(a.tons_mismatch, false);
  });

  it('carries the workbook Status through rather than inferring it', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    const a = result.targets[1].rows.find(r => r.lot_code === '26AAAA1A-C');
    const b = result.targets[1].rows.find(r => r.lot_code === '26AAAA1B');
    assert.equal(a.status, 'Recibido');
    assert.equal(b.status, 'No Recibido');
  });

  // ── Weighting-leak guard: seguimiento tonnage must never reach a berry row,
  //    which the tonnage-weighted means read. ──
  it('never puts a tonnage/forecast field on a berry row', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    for (const r of result.targets[0].rows) {
      for (const k of ['tons_seguimiento', 'tons_seguimiento_cached', 'cantidad_proyectada', 'tons_mismatch']) {
        assert.ok(!(k in r), `berry_samples row must not carry ${k}`);
      }
    }
  });

  // ── Round 33: uniform key sets so PostgREST accepts the bulk upsert ──
  it('produces uniform key sets across rows in both targets', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    for (const t of result.targets) {
      const shapes = new Set(t.rows.map(r => Object.keys(r).sort().join(',')));
      assert.equal(shapes.size, 1, `${t.table} rows must share one key set`);
    }
  });

  it('throws a Spanish error when the Uva sheet is missing', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'SUMMARY');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await assert.rejects(() => seguimientoParser.parse(asFakeFile(Buffer.from(buf), 'no_uva.xlsx')), /Uva/);
  });

  // ── API whitelist wiring ──
  it('registers seguimiento_lotes in the API whitelist with the parser conflict key', () => {
    const cfg = ALLOWED_TABLES.seguimiento_lotes;
    assert.ok(cfg, 'seguimiento_lotes missing from ALLOWED_TABLES');
    assert.equal(cfg.conflict, 'lot_code,vintage_year');
    assert.deepEqual(cfg.required, ['lot_code']);
    for (const col of ['cantidad_proyectada', 'tons_seguimiento', 'tons_seguimiento_cached', 'tons_mismatch', 'status']) {
      assert.ok(cfg.columns.has(col), `${col} missing from seguimiento_lotes whitelist`);
    }
  });

  it('the wine_samples whitelist covers every chemistry column the parser writes', () => {
    // Issue ONE: chemistry targets wine_samples now, so the columns it emits
    // must all be whitelisted (unlisted columns are silently stripped by the API).
    const cols = ALLOWED_TABLES.wine_samples.columns;
    for (const col of ['brix', 'ph', 'ta', 'berry_weight', 'berry_anthocyanins', 'malic_acid']) {
      assert.ok(cols.has(col), `${col} missing from wine_samples whitelist`);
    }
  });
});

// ── Issue NINE: the committed fixture's lot blocks are all perfectly formed,
// so none of the refusal paths are exercised by the happy-path tests above.
// These build the same corrected shape and inject ONE defect each, asserting
// the WHOLE file is refused with a Spanish error that names the offender. The
// non-negotiable refusal rule: a corrupt source never yields partial data. ──
describe('MT.44 — generated mutations each refuse the whole file, naming the offender', () => {
  // The typo slot lives at date offset O1_TYPO=8 (07.07 → col index 17, col 18).
  // Offsets used by the fixture: 16.07=col 26, 17.07=col 27, 20.07=col 30.
  const buildMutated = (mutate) => {
    const aoa = buildAoa().map(r => (r ? [...r] : r));
    const hdr = aoa[5];
    const typoIdx = hdr.findIndex(v => v instanceof Date);
    hdr[typoIdx] = '07.07';
    mutate(aoa, typoIdx);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Uva');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return asFakeFile(Buffer.from(buf), 'seguimiento_mutated.xlsx');
  };
  const rejectsWith = (mutate, ...patterns) =>
    assert.rejects(() => seguimientoParser.parse(buildMutated(mutate)), (err) => {
      for (const p of patterns) assert.match(err.message, p, `message must match ${p}`);
      return true;
    });

  it('duplicate date header (16.07 twice)', () =>
    rejectsWith((aoa) => { aoa[5][27] = '16.07'; }, /16\.07/, /se repite/));

  it('empty date header among the dates', () =>
    rejectsWith((aoa) => { aoa[5][27] = null; aoa[9][27] = 88.8; }, /vac[ií]o/, /columna 28/));

  it('impossible calendar date (31.06)', () =>
    rejectsWith((aoa) => { aoa[5][11] = '31.06'; }, /31\.06/, /calendario/));

  it('duplicate metric row for one lot', () =>
    rejectsWith((aoa) => { const dup = [...aoa[9]]; aoa.splice(15, 0, dup); }, /°Brix/, /repetida/));

  it('a metric row with a blank Lote breaks the seven-consecutive-rows block (issue THREE)', () =>
    // Blanking the Lote turns row into a metadata-carrying blank-Lote row that no
    // longer joins the block; the next metric row is then non-contiguous.
    rejectsWith((aoa) => { aoa[9][3] = null; }, /26AAAA1A-C/, /no es contigua|consecutivas/));

  it('unknown Análisis label', () =>
    rejectsWith((aoa) => { const row = [...aoa[9]]; row[8] = 'YAN'; aoa.splice(15, 0, row); },
      /YAN/, /no reconocida/));

  it('non-contiguous lot block (lot A repeated at the end)', () =>
    rejectsWith((aoa) => { const blk = aoa.slice(8, 15).map(r => [...r]); for (const r of blk) aoa.push(r); },
      /26AAAA1A-C/, /no contiguos/));

  it('non-numeric TONS cell', () =>
    rejectsWith((aoa) => { aoa[8][26] = 'ABC'; }, /TONS/, /no num[eé]rico/));

  // Serial recovery is deliberately narrow. It fires only on a date cell whose
  // serial lands in the Excel 1900 phantom range AND whose two-decimal fraction
  // is a real month. Everything else still refuses the whole file.

  it('a midnight 1900 date header carries no month and is still refused', () =>
    // Serial 7.00: the cell holds the bare number 7. Nothing says which month,
    // so there is nothing to recover and the ordering guard must still fire.
    rejectsWith((aoa, typoIdx) => { aoa[5][typoIdx] = new Date(Date.UTC(1900, 0, 7)); },
      /07\.01/, /fuera de orden/));

  it('a genuine out-of-order TEXT header is still refused (no recovery path)', () =>
    rejectsWith((aoa) => { aoa[5][27] = '05.07'; }, /05\.07/, /fuera de orden/, /columna 28/));

  it('a serial that only ROUNDS to a DD.MM is refused, not rounded into a date', () =>
    // Lucy round 1, BLOCKER: 7.074 is not a DD.MM payload. An earlier toFixed(2)
    // read it as 07.07, continuity then passed, and a whole column landed on a
    // day nobody typed. The serial must BE two decimals, not round to two.
    rejectsWith((aoa, typoIdx) => {
      aoa[5][typoIdx] = new Date(Date.UTC(1899, 11, 31) + 7.074 * 86400000);
    }, /fuera de orden|calendario|continuidad/));

  it('a 1900 serial whose fraction is not a month is still refused', () =>
    // Serial 7.50 would mean "month 50". Unrecoverable, so the file is refused.
    rejectsWith((aoa, typoIdx) => {
      aoa[5][typoIdx] = new Date(Date.UTC(1899, 11, 31) + 7.5 * 86400000);
    }, /fuera de orden|calendario/),
  );

  it('a real (non-1900) date header is read as a date, not reinterpreted', () =>
    // A genuine 2026 date cell in the wrong slot must break ordering, proving
    // recovery cannot reach a 5-digit serial.
    rejectsWith((aoa, typoIdx) => { aoa[5][typoIdx] = new Date(Date.UTC(2026, 7, 20)); },
      /20\.08/, /fuera de orden|continuidad/));

  it('a trailing-zero month survives the recovery (serial 7.1 is 07.10, not 07.01)', async () => {
    // 07.10 typed into a date-formatted cell stores serial 7.1. Read as a Date
    // that is 7 Jan; read as the number it is, it is 7 October. Put it in the
    // 07.10 slot, where only the correct reading keeps the daily run intact.
    const aoa = buildAoa().map(r => (r ? [...r] : r));
    const hdr = aoa[5];
    hdr[hdr.findIndex(v => v instanceof Date)] = '07.07';
    const octIdx = hdr.indexOf('07.10');
    assert.ok(octIdx > 0, 'fixture must contain a 07.10 column');
    hdr[octIdx] = new Date(Date.UTC(1899, 11, 31) + 7.1 * 86400000);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Uva');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const res = await seguimientoParser.parse(asFakeFile(Buffer.from(buf), 'seguimiento_oct.xlsx'));
    const warn = res.warnings.find(w => new RegExp(`Columna ${octIdx + 1}:`).test(w));
    assert.ok(warn, 'the October column must warn');
    assert.match(warn, /Se interpretó como 07\.10/);
  });
});

// ── Round-2 review (xd-6r7): one test per fix ONE..SIX. The workbook Variedad
// column holds abbreviations; the read path expects full names; the vintage is
// stated by the workbook, not voted from lot prefixes; a lot is seven PHYSICALLY
// consecutive rows; a populated column needs a valid date header; a non-numeric
// CACHED TONS is a corruption; and a file with no lot block is not "success". ──
describe('MT.44 — round-2 review fixes (xd-6r7)', () => {
  // Build a corrected (07.01→07.07) file with an optional mutation. The file name
  // deliberately carries NO "Vendimia" token, so a passing vintage proves the
  // parser read it from the workbook TITLE, not the file name.
  const corrected = (mutate) => {
    const aoa = buildAoa().map(r => (r ? [...r] : r));
    const hdr = aoa[5];
    hdr[hdr.findIndex(v => v instanceof Date)] = '07.07';
    if (mutate) mutate(aoa);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Uva');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return asFakeFile(Buffer.from(buf), 'seguimiento_sin_nombre.xlsx');
  };

  // ── ONE: variety abbreviation → full name the read path expects ──
  const WORKBOOK_CODES = ['CAL', 'CB', 'CF', 'CH', 'CS', 'DU', 'GRE', 'MAL', 'MAR', 'ME', 'PV', 'SB', 'SY', 'TEM'];
  it('ONE: every workbook Variedad code resolves to a name in CONFIG.grapeTypes', () => {
    const known = new Set([...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white]);
    for (const code of WORKBOOK_CODES) {
      const full = CONFIG.varietyAbbr[code];
      assert.ok(full, `CONFIG.varietyAbbr is missing the workbook code "${code}"`);
      assert.ok(known.has(full), `"${code}" → "${full}" is not a grapeTypes varietal name`);
    }
    // Resolved from the workbook's own lot codes, not guessed.
    assert.equal(CONFIG.varietyAbbr.MAL, 'Malbec');
    assert.equal(CONFIG.varietyAbbr.MAR, 'Marselan');
  });

  it('ONE: the parser stores the full varietal name, not the abbreviation', async () => {
    const res = await seguimientoParser.parse(corrected());
    const sb = res.targets[0].rows.find(r => r.sample_id === '26AAAA1A-C');
    assert.equal(sb.variety, 'Sauvignon Blanc', 'SB must expand to Sauvignon Blanc');
    const cs = res.targets[1].rows.find(r => r.lot_code === '26BBBB2A');
    assert.equal(cs.variety, 'Cabernet Sauvignon', 'CS must expand on the lot row too');
    // and it must classify white, so the Tintas/Blancas toggle keeps it a white
    assert.equal(CONFIG.grapeTypes.white.includes(sb.variety), true);
  });

  // ── TWO: vintage from the workbook, not a vote; disagreeing lot rejected ──
  it('TWO: a lot whose prefix disagrees with the workbook vintage is rejected by name', async () => {
    // Lot A becomes a 25-prefixed block; the title still says Vendimia 2026.
    const res = await seguimientoParser.parse(corrected((aoa) => {
      for (let i = 8; i < 15; i++) aoa[i][3] = '25AAAA1A-C';
    }));
    assert.ok(res.rejected.some(r => /25AAAA1A-C/.test(r.motivo_rechazo) &&
      /2025/.test(r.motivo_rechazo) && /2026/.test(r.motivo_rechazo)),
      'the mistyped lot must be rejected naming both years');
    assert.ok(!res.targets[1].rows.some(r => r.lot_code === '25AAAA1A-C'),
      'the disagreeing lot must not land');
    // the agreeing lots still land under 2026
    assert.ok(res.targets[1].rows.every(r => r.vintage_year === 2026));
  });

  it('TWO: a file with no "Vendimia AAAA" anywhere is refused, not guessed', async () => {
    const aoa = buildAoa().map(r => (r ? [...r] : r));
    aoa[5][aoa[5].findIndex(v => v instanceof Date)] = '07.07';
    aoa[0] = ['SEGUIMIENTO DE MADURACIÓN   FL 8.5.1  REV 5']; // year stripped from title
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Uva');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await assert.rejects(
      () => seguimientoParser.parse(asFakeFile(Buffer.from(buf), 'archivo_sin_anio.xlsx')),
      /vendimia/i);
  });

  it('TWO: the vintage is read from the file name when the title lacks it', async () => {
    const aoa = buildAoa().map(r => (r ? [...r] : r));
    aoa[5][aoa[5].findIndex(v => v instanceof Date)] = '07.07';
    aoa[0] = ['SEGUIMIENTO DE MADURACIÓN   FL 8.5.1  REV 5']; // no year in the title
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Uva');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const res = await seguimientoParser.parse(
      asFakeFile(Buffer.from(buf), 'Seguimiento de maduración Vendimia 2026.xlsx'));
    assert.ok(res.targets[1].rows.length > 0);
    assert.ok(res.targets[1].rows.every(r => r.vintage_year === 2026));
  });

  // ── THREE: seven PHYSICALLY consecutive rows ──
  it('THREE: a blank row between two metric rows of a lot refuses the file', async () => {
    await assert.rejects(
      () => seguimientoParser.parse(corrected((aoa) => {
        aoa.splice(11, 0, new Array(aoa[5].length).fill(null)); // blank row mid lot A
      })),
      /no es contigua|consecutivas/);
  });

  it('THREE: a repeated header row between two metric rows refuses the file', async () => {
    await assert.rejects(
      () => seguimientoParser.parse(corrected((aoa) => {
        aoa.splice(11, 0, [...aoa[7]]); // repeated header inside lot A
      })),
      /no es contigua|consecutivas/);
  });

  // ── FOUR: a populated column needs a valid date header ──
  it('FOUR: a populated column with a blank trailing date header refuses the file', async () => {
    await assert.rejects(
      () => seguimientoParser.parse(corrected((aoa) => {
        const last = aoa[5].length;
        aoa[5][last] = null; aoa[5][last + 1] = null;
        aoa[9][last + 1] = 55.5; // a real value under a headerless column
      })),
      /vac[ií]o/);
  });

  // ── FIVE: a non-numeric CACHED TONS (col 7) is a corruption, not a null ──
  it('FIVE: a non-numeric cached TONS cell refuses the file, naming the lot', async () => {
    await assert.rejects(
      () => seguimientoParser.parse(corrected((aoa) => { aoa[8][7] = 'ABC'; })),
      (err) => {
        assert.match(err.message, /26AAAA1A-C/);
        assert.match(err.message, /no num[eé]rico/);
        return true;
      });
  });

  // ── SIX: at least one lot block; blank-Lote content is surfaced ──
  it('SIX: a structurally valid file with zero lot blocks is refused', async () => {
    await assert.rejects(
      () => seguimientoParser.parse(corrected((aoa) => { aoa.splice(8); })),
      /ning[uú]n bloque de lote/);
  });

  it('SIX: a blank-Lote row carrying lot metadata is surfaced, not silently dropped', async () => {
    // A metadata-bearing row with its Lote dropped, appended AFTER the last lot
    // (so contiguity does not fire) must still be rejected, not skipped.
    const res = await seguimientoParser.parse(corrected((aoa) => {
      const orphan = [...aoa[35]]; // lot D's last row, full metadata
      orphan[3] = null;
      aoa.push(orphan);
    }));
    assert.ok(res.rejected.some(r => /sin código de Lote/.test(r.motivo_rechazo)),
      'the orphaned metadata row must appear in rejected');
  });

  it('SIX: the legit stray daily-TONS aggregate row (no metadata) is skipped cleanly', async () => {
    // Row 6 of the real workbook is a per-day TONS totals row: blank Lote, a known
    // "TONS" label, dated totals, no lot metadata. It must NOT be rejected.
    const res = await seguimientoParser.parse(corrected((aoa) => {
      aoa[6][10] = 14; aoa[6][11] = 8; // give the stray TONS row real daily totals
    }));
    assert.ok(!res.rejected.some(r => /Fila 7/.test(r.motivo_rechazo)),
      'the stray daily-TONS aggregate row must be skipped, not rejected');
    assert.equal(res.targets[1].rows.length, 4, 'still exactly the 4 real lots');
  });
});
