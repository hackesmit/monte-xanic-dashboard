// MT.13 — WineXRay parser: classifies rows, shapes wine/berry payloads,
// categorizes exclusions and rejections.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { winexrayParser } from '../js/upload/winexray.js';

// Helper: wrap a Buffer as a File-like object the parser can consume.
function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

async function loadFixture() {
  const buf = await readFile(new URL('./fixtures/winexray_mixed.csv', import.meta.url));
  return asFakeFile(buf, 'winexray_mixed.csv');
}

describe('MT.13 — WineXRay parser', () => {
  it('has the expected parser interface', () => {
    assert.equal(winexrayParser.id, 'winexray');
    assert.equal(winexrayParser.label, 'WineXRay');
    assert.deepEqual(winexrayParser.acceptedExtensions, ['.csv']);
    assert.equal(typeof winexrayParser.parse, 'function');
  });

  it('parses the mixed fixture and emits two targets', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    assert.equal(result.targets.length, 2);
    const wine = result.targets.find(t => t.table === 'wine_samples');
    const berry = result.targets.find(t => t.table === 'berry_samples');
    assert.ok(wine, 'wine_samples target missing');
    assert.ok(berry, 'berry_samples target missing');
    assert.equal(wine.conflictKey, 'sample_id,sample_date,sample_seq');
    assert.equal(berry.conflictKey, 'sample_id,sample_date,sample_seq');
  });

  it('routes sample types correctly', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;
    const berry = result.targets.find(t => t.table === 'berry_samples').rows;

    // Row 1 Aging Wine, Row 2 Must, Row 3 Young Wine → 3 wine rows
    assert.equal(wine.length, 3);
    // Row 4 Berries (row 5 is rejected for missing sample_id)
    assert.equal(berry.length, 1);
  });

  it('rejects rows with missing sample_id', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const missing = result.rejected.find(r => r.motivo_rechazo === 'Sample Id faltante');
    assert.ok(missing, 'expected rejection for row with empty sample_id');
  });

  it('rejects rows with unknown sample_type', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const unknown = result.rejected.find(r =>
      r.motivo_rechazo.startsWith('Sample Type no reconocido'));
    assert.ok(unknown, 'expected rejection for row with sample_type=E2');
    assert.match(unknown.motivo_rechazo, /E2/);
  });

  it('excludes Control Wine rows without marking them rejected', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    assert.equal(result.excluded.control_wine, 1);
    const controlInRejected = result.rejected.find(r =>
      r.row['Sample Id'] === '25CSMX-CW');
    assert.equal(controlInRejected, undefined,
      'Control Wine must not appear in rejected');
  });

  it('excludes lab-test rows (sample_id containing WATERBLUEBERRY)', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    assert.equal(result.excluded.lab_test, 1);
  });

  it('sets below_detection=true for <50 brix values', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;
    // The <50 brix row is lab-excluded, so below_detection won't leak to wine rows.
    assert.ok(wine.every(r => r.below_detection === false));
  });

  it('shapes berry rows with berry-specific columns populated', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const berry = result.targets.find(t => t.table === 'berry_samples').rows[0];
    assert.equal(berry.sample_id, '25CSMX-3');
    assert.equal(berry.sample_type, 'Berries');
    assert.equal(berry.berry_count, 200);
    // Wine-only columns should not be on berry rows
    assert.equal(berry.alcohol, undefined);
    assert.equal(berry.va, undefined);
  });

  it('normalizes variety', async () => {
    const file = await loadFixture();
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;
    assert.ok(wine.every(r => ['Cabernet Sauvignon', 'Merlot'].includes(r.variety)));
  });

  it('throws a Spanish error when headers are missing', async () => {
    const junk = asFakeFile(Buffer.from('foo,bar\n1,2\n'), 'junk.csv');
    await assert.rejects(
      () => winexrayParser.parse(junk),
      /no parece ser un export de WineXRay/i
    );
  });

  // Regression for Round 30: WineXRay CSV exports always use M/D/YYYY
  // (US-format slash dates). Under the legacy `raw:false` + non-date-aware
  // normalizeValue, those strings reached Postgres verbatim. With `date`
  // columns the rows would land only because Postgres' default DateStyle is
  // MDY — fragile and silently wrong if the server style ever changes.
  // The parser must convert slash dates to ISO YYYY-MM-DD itself.
  it('converts WineXRay slash-format dates (MDY) to ISO YYYY-MM-DD', async () => {
    const csv = [
      'Sample Id,Sample Type,Sample Date,CrushDate (yyyy-mm-dd),Vintage,Variety,Appellation',
      '25CSMX-100,Aging Wine,2/27/2026,9/15/2025,2025,Cabernet Sauvignon,Valle de Guadalupe',
      '25MEMX-100,Berries,8/21/2024,9/1/2024,2024,Merlot,Valle de Guadalupe',
    ].join('\n');
    const file = asFakeFile(Buffer.from(csv), 'live_dates.csv');
    const result = await winexrayParser.parse(file);
    const wine  = result.targets.find(t => t.table === 'wine_samples').rows[0];
    const berry = result.targets.find(t => t.table === 'berry_samples').rows[0];
    assert.equal(wine.sample_id,  '25CSMX-100');
    assert.equal(wine.sample_date, '2026-02-27',
      'sample_date must be ISO YYYY-MM-DD, not "2/27/2026"');
    assert.equal(wine.crush_date,  '2025-09-15',
      'crush_date must be ISO YYYY-MM-DD, not "9/15/2025"');
    assert.equal(berry.sample_id,   '25MEMX-100');
    assert.equal(berry.sample_date, '2024-08-21');
    assert.equal(berry.crush_date,  '2024-09-01');
  });

  // Round 32 Option B — defense-in-depth: a row whose INT-typed column
  // (here days_post_crush=12.5) is fractional must be rejected at the
  // parser layer with a Spanish motivo_rechazo naming the column. Without
  // this check the row would reach Postgres and trigger an opaque
  // "invalid input syntax for type integer" rejection blocking the batch.
  it('rejects rows where an INT-typed column has a fractional value', async () => {
    const csv = [
      'Sample Id,Sample Type,Sample Date,CrushDate (yyyy-mm-dd),DaysPostCrush (number),Vintage,Variety,Appellation',
      '25CSMX-300,Aging Wine,2/27/2026,2/15/2026,12.5,2025,Cabernet Sauvignon,Valle de Guadalupe',
      '25CSMX-301,Aging Wine,2/27/2026,2/15/2026,12,2025,Cabernet Sauvignon,Valle de Guadalupe',
    ].join('\n');
    const file = asFakeFile(Buffer.from(csv), 'fractional_int.csv');
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;

    assert.equal(wine.find(r => r.sample_id === '25CSMX-300'), undefined,
      '25CSMX-300 with fractional days_post_crush must be rejected');
    assert.ok(wine.find(r => r.sample_id === '25CSMX-301'),
      '25CSMX-301 with integer days_post_crush must pass');

    const rejected = result.rejected.find(r => r.row['Sample Id'] === '25CSMX-300');
    assert.ok(rejected, 'fractional INT row must appear in rejected[]');
    assert.match(rejected.motivo_rechazo, /days_post_crush/);
    assert.match(rejected.motivo_rechazo, /entero|integer/i);
  });

  // Round 34 — defense-in-depth: a non-numeric string (e.g. a section label
  // typed into a brix cell) in a NUMERIC-typed column must be rejected at
  // the parser with a Spanish motivo_rechazo naming the column. Without this
  // check the value reaches Postgres as "invalid input syntax for type
  // numeric" and aborts the whole batch.
  it('rejects rows where a NUMERIC-typed column has a non-numeric string', async () => {
    const csv = [
      'Sample Id,Sample Type,Sample Date,Brix (degrees %w/w: (gr sucrose/100 gr juice)*100),Vintage,Variety,Appellation',
      '25CSMX-400,Aging Wine,2/27/2026,SEGUIMIENTO MADURACIÓN,2025,Cabernet Sauvignon,Valle de Guadalupe',
      '25CSMX-401,Aging Wine,2/27/2026,24.3,2025,Cabernet Sauvignon,Valle de Guadalupe',
    ].join('\n');
    const file = asFakeFile(Buffer.from(csv), 'numeric_string.csv');
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;

    assert.equal(wine.find(r => r.sample_id === '25CSMX-400'), undefined,
      '25CSMX-400 with non-numeric brix must be rejected');
    assert.ok(wine.find(r => r.sample_id === '25CSMX-401'),
      '25CSMX-401 with numeric brix must pass');

    const rejected = result.rejected.find(r => r.row['Sample Id'] === '25CSMX-400');
    assert.ok(rejected, 'non-numeric NUMERIC row must appear in rejected[]');
    assert.match(rejected.motivo_rechazo, /brix/);
    assert.match(rejected.motivo_rechazo, /numérico|numeric/i);
  });

  // Round 34 — string in an INT column is the symmetric case: e.g. a
  // section-header label in the Vintage cell.
  it('rejects rows where an INT-typed column has a non-numeric string', async () => {
    const csv = [
      'Sample Id,Sample Type,Sample Date,Vintage,Variety,Appellation',
      'NOPREFIX-CSMX-500,Aging Wine,2/27/2026,SEGUIMIENTO MADURACIÓN,Cabernet Sauvignon,Valle de Guadalupe',
    ].join('\n');
    const file = asFakeFile(Buffer.from(csv), 'int_string.csv');
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;
    assert.equal(wine.find(r => r.sample_id === 'NOPREFIX-CSMX-500'), undefined,
      'row with non-numeric vintage must be rejected');
    const rejected = result.rejected.find(r => r.row['Sample Id'] === 'NOPREFIX-CSMX-500');
    assert.ok(rejected, 'non-numeric INT row must appear in rejected[]');
    assert.match(rejected.motivo_rechazo, /vintage_year/);
    assert.match(rejected.motivo_rechazo, /entero|integer/i);
  });

  // Round 33 — PostgREST rejects mixed-shape arrays with "All object keys
  // must match". `applyNormalization` only assigns vintage_year inside an
  // `if (m)` block, so a sample_id whose first chars don't match \d{2}
  // currently lands without the vintage_year key while sibling rows carry it.
  it('produces uniform key sets across rows even when vintage_year is not derivable', async () => {
    const csv = [
      'Sample Id,Sample Type,Sample Date,CrushDate (yyyy-mm-dd),Variety,Appellation',
      '25CSMX-400,Aging Wine,2/27/2026,2/15/2026,Cabernet Sauvignon,Valle de Guadalupe',
      'XYMX-001,Aging Wine,2/27/2026,2/15/2026,Merlot,Valle de Guadalupe',
    ].join('\n');
    const file = asFakeFile(Buffer.from(csv), 'mixed_keys.csv');
    const result = await winexrayParser.parse(file);
    const wine = result.targets.find(t => t.table === 'wine_samples').rows;

    assert.equal(wine.length, 2, 'both rows must be accepted');
    assert.deepEqual(Object.keys(wine[0]).sort(), Object.keys(wine[1]).sort(),
      'wine_samples rows must share the same key set');
    assert.ok(Object.keys(wine[0]).includes('vintage_year'));

    const xy = wine.find(r => r.sample_id === 'XYMX-001');
    assert.equal(xy.vintage_year, null,
      'sample_id without 2-digit prefix must yield vintage_year=null, not absent');
  });
});
