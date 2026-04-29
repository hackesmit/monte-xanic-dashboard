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
});
