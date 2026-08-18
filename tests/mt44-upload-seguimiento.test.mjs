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
  it('REFUSES the committed fixture, naming the out-of-order 07.01 column', async () => {
    const file = await committedFixture();
    await assert.rejects(() => seguimientoParser.parse(file), (err) => {
      assert.match(err.message, /07\.01/, 'error must name the offending column value');
      assert.match(err.message, /fuera de orden|orden cronológico/i, 'error must explain the ordering break');
      assert.match(err.message, /columna 18/, 'error must name the column position');
      return true;
    });
  });

  it('does NOT auto-correct: no rows are produced from the typo file', async () => {
    const file = await committedFixture();
    // The whole file is refused — nothing lands, per "do not silently accept".
    await assert.rejects(() => seguimientoParser.parse(file));
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
    assert.equal(a.variety, 'SB');
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

  it('missing metric (a metric row with a blank Lote drops it)', () =>
    rejectsWith((aoa) => { aoa[9][3] = null; }, /26AAAA1A-C/, /°Brix/, /no tiene la m[eé]trica/));

  it('unknown Análisis label', () =>
    rejectsWith((aoa) => { const row = [...aoa[9]]; row[8] = 'YAN'; aoa.splice(15, 0, row); },
      /YAN/, /no reconocida/));

  it('non-contiguous lot block (lot A repeated at the end)', () =>
    rejectsWith((aoa) => { const blk = aoa.slice(8, 15).map(r => [...r]); for (const r of blk) aoa.push(r); },
      /26AAAA1A-C/, /no contiguos/));

  it('non-numeric TONS cell', () =>
    rejectsWith((aoa) => { aoa[8][26] = 'ABC'; }, /TONS/, /no num[eé]rico/));
});
