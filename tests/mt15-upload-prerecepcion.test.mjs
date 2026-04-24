// MT.15 — Pre-recepción parser: XLSX → pre_receptions.
// Header row auto-detected; PENDIENTE and missing reporte → rejected.
// Never touches mediciones_tecnicas.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prerecepcionParser } from '../js/upload/prerecepcion.js';

function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

async function loadFixture() {
  const buf = await readFile(new URL('./fixtures/prerecepcion_sample.xlsx', import.meta.url));
  return asFakeFile(buf, 'prerecepcion_sample.xlsx');
}

describe('MT.15 — Pre-recepción parser', () => {
  it('targets pre_receptions, not mediciones_tecnicas', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0].table, 'pre_receptions');
    assert.equal(result.targets[0].conflictKey, 'report_code');
  });

  it('auto-detects the header row', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const rows = result.targets[0].rows;
    // 4 data rows in fixture; 2 valid (MT-24-001, MT-24-002), 2 rejected
    assert.equal(rows.length, 2);
  });

  it('rejects rows where report_code is missing', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const missing = result.rejected.find(r => r.motivo_rechazo === 'Reporte faltante');
    assert.ok(missing);
  });

  it('rejects rows where report_code is PENDIENTE', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const pendiente = result.rejected.find(r => r.motivo_rechazo === 'Reporte pendiente');
    assert.ok(pendiente);
  });

  it('maps all source columns correctly on a valid row', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const first = result.targets[0].rows.find(r => r.report_code === 'MT-24-001');
    assert.ok(first, 'MT-24-001 row missing');
    assert.equal(first.variety, 'Chardonnay');
    assert.equal(first.supplier, 'Monte Xanic');
    assert.equal(first.lot_code, '24CHMX-1B');
    assert.equal(first.total_bins, 18);
    assert.equal(first.bin_unit, 'bins');
    assert.equal(first.tons_received, 5.863);
    assert.equal(first.brix, 16.8);
    assert.equal(first.ph, 3.47);
    assert.equal(first.at, 8.55);
    assert.equal(first.health_madura, 150);
    assert.equal(first.vintage_year, 2024);
  });

  it('extracts vintage_year from medicion_date or reception_date', async () => {
    const file = await loadFixture();
    const result = await prerecepcionParser.parse(file);
    const rows = result.targets[0].rows;
    assert.ok(rows.every(r => r.vintage_year === 2024));
  });

  it('throws a Spanish error when the Pre-recepción sheet is missing', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['foo'],['bar']]), 'OtroSheet');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const file = asFakeFile(Buffer.from(buf), 'wrongsheet.xlsx');
    await assert.rejects(() => prerecepcionParser.parse(file), /Pre-recepci/i);
  });
});
