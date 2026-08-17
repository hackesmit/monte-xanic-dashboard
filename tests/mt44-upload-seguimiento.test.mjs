// MT.44 — Seguimiento de Maduración parser: the 2026 pivoted-calendar workbook
// that replaces WineXRay as the berry-maturity source. Unpivots (lot, metric,
// date) into berry_samples + a per-lot seguimiento_lotes row, refuses the file
// when a date column breaks chronological order (the 07.01 typo), and keeps the
// forecast (cantidad_proyectada) and the workbook TONS as two distinct fields.

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
    assert.equal(result.targets[0].table, 'berry_samples');
    assert.equal(result.targets[1].table, 'seguimiento_lotes');
    assert.equal(result.targets[0].conflictKey, 'sample_id,sample_date,sample_seq');
    assert.equal(result.targets[1].conflictKey, 'lot_code,vintage_year');
  });

  // ── Unpivot into berry_samples ──
  it('unpivots per-(lot,date) chemistry into berry_samples, skipping blanks and dashes', async () => {
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
    assert.ok(!berry.some(r => r.sample_id === '26CCCC3A' && r.sample_date === '2026-07-16' && r.brix === null && r.ph === null && r.ta === null && r.malic_acid === null && r.berry_anthocyanins_mg_100b === null));
  });

  it('maps Ac. Málico into the new malic_acid column and Antocianos into anthocyanins', async () => {
    const result = await seguimientoParser.parse(correctedFile());
    const berry = result.targets[0].rows;
    assert.ok(berry.some(r => typeof r.malic_acid === 'number'), 'Ac. Málico must land in malic_acid');
    assert.ok(berry.some(r => typeof r.berry_anthocyanins_mg_100b === 'number'), 'Antocianos must land in berry_anthocyanins_mg_100b');
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

  // ── Weighting-leak guard: seguimiento tonnage must never reach the maturity
  //    table the tonnage-weighted means read. berry_samples is that table. ──
  it('never puts a tonnage/forecast field on a berry_samples row', async () => {
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

  it('whitelists the new berry_samples.malic_acid column', () => {
    assert.ok(ALLOWED_TABLES.berry_samples.columns.has('malic_acid'));
  });
});
