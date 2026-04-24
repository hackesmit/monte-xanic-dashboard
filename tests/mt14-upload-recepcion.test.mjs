// MT.14 — Recepción de Tanque parser: 2-sheet XLSX → tank_receptions +
// reception_lots + prefermentativos. Lot rows use report_code, not reception_id.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recepcionParser } from '../js/upload/recepcion.js';

function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

async function loadFixture() {
  const buf = await readFile(new URL('./fixtures/recepcion_sample.xlsx', import.meta.url));
  return asFakeFile(buf, 'recepcion_sample.xlsx');
}

describe('MT.14 — Recepción parser', () => {
  it('has the expected parser interface', () => {
    assert.equal(recepcionParser.id, 'recepcion');
    assert.deepEqual(recepcionParser.acceptedExtensions, ['.xlsx', '.xls']);
  });

  it('parses into three targets in correct order', async () => {
    const file = await loadFixture();
    const result = await recepcionParser.parse(file);
    assert.equal(result.targets.length, 3);
    assert.equal(result.targets[0].table, 'tank_receptions');
    assert.equal(result.targets[1].table, 'reception_lots');
    assert.equal(result.targets[2].table, 'prefermentativos');
  });

  it('uses conflict keys matching the API whitelist', async () => {
    const file = await loadFixture();
    const result = await recepcionParser.parse(file);
    assert.equal(result.targets[0].conflictKey, 'report_code');
    assert.equal(result.targets[1].conflictKey, 'report_code,lot_position');
    assert.equal(result.targets[2].conflictKey, 'report_code,measurement_date');
  });

  it('emits lot rows with report_code (no reception_id)', async () => {
    const file = await loadFixture();
    const result = await recepcionParser.parse(file);
    const lots = result.targets[1].rows;
    assert.ok(lots.length > 0);
    for (const lot of lots) {
      assert.ok(lot.report_code, 'lot missing report_code');
      assert.ok(lot.lot_code, 'lot missing lot_code');
      assert.equal(lot.reception_id, undefined, 'lot should not carry reception_id');
    }
  });

  it('expands lot columns _lot1.._lot4 into separate rows', async () => {
    const file = await loadFixture();
    const result = await recepcionParser.parse(file);
    const receptions = result.targets[0].rows;
    const lots = result.targets[1].rows;
    const r001Lots = lots.filter(l => l.report_code === 'R-001');
    const r002Lots = lots.filter(l => l.report_code === 'R-002');
    assert.equal(r001Lots.length, 2);
    assert.equal(r002Lots.length, 1);
    assert.equal(r001Lots[0].lot_position, 1);
    assert.equal(r001Lots[1].lot_position, 2);
    assert.equal(receptions[0]._lot1, undefined);
  });

  it('throws a Spanish error when a required sheet is missing', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['foo'],['bar']]), 'Prefermentativos 2025');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const file = asFakeFile(Buffer.from(buf), 'incomplete.xlsx');
    await assert.rejects(() => recepcionParser.parse(file), /Recep/i);
  });
});
