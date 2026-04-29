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
    assert.equal(result.targets[2].conflictKey, 'report_code');
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

  // Regression for Round 30: the live `Recepcion_de_Tanque_2025.xlsx` stores
  // the Fecha column as real Excel date cells under a DMY format code.
  // Under `raw: false` the parser used to emit `"12/8/2025"` etc. straight
  // to Postgres, which rejected day=15 with "date/time field value out of
  // range". Both sheets (Recepción + Prefermentativos) must yield ISO dates.
  it('parses real Excel date cells on both Recepción + Prefermentativos sheets', async () => {
    const XLSX = await import('xlsx');

    // Recepción sheet — header at row 1 (matches the live file's layout)
    const recAoa = [
      ['','FL 8.5.8 rev 2','','ANÁLISIS DE RECEPCIÓN EN TANQUE'],
      ['Reporte','Fecha','Lote de viñedo 1','Código (lote de bodega)','Tanque','Variedad'],
      ['RRT-100', new Date(Date.UTC(2025, 7, 8)),  'SBMX-2A', '25SBVDG-100', 'TK-A', 'Sauvignon Blanc'],
      ['RRT-101', new Date(Date.UTC(2025, 7, 15)), 'SBMX-1C', '25SBVDG-101', 'TK-B', 'Sauvignon Blanc'],
    ];
    const recSheet = XLSX.utils.aoa_to_sheet(recAoa);
    // Force DMY display so the legacy raw:false path would have produced
    // "8/8/2025" / "15/8/2025" — exactly the values that broke prod.
    for (const addr of ['B3','B4']) {
      const c = recSheet[addr]; if (c) c.z = 'dd/mm/yyyy';
    }

    // Prefermentativos sheet — title at row 0, headers at row 1 (matches the
    // live `Recepcion_de_Tanque_2025.xlsx` layout). One header has trailing
    // whitespace ('Reporte ') to lock in the whitespace-collapsing fix.
    const prefAoa = [
      ['FL 8.5.8 rev 2','','ANÁLISIS PREFERMENTATIVOS','',''],
      ['Reporte ','Fecha','Código (lote de bodega)','Tanque','Variedad'],
      ['RRT-100', new Date(Date.UTC(2025, 7, 11)), '25SBVDG-100', 'TK-A', 'Sauvignon Blanc'],
      ['RRT-101', new Date(Date.UTC(2025, 7, 15)), '25SBVDG-101', 'TK-B', 'Sauvignon Blanc'],
    ];
    const prefSheet = XLSX.utils.aoa_to_sheet(prefAoa);
    for (const addr of ['B3','B4']) {
      const c = prefSheet[addr]; if (c) c.z = 'dd/mm/yyyy';
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, recSheet,  'Recepción 2025');
    XLSX.utils.book_append_sheet(wb, prefSheet, 'Prefermentativos 2025');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
    const file = asFakeFile(Buffer.from(buf), 'live_recepcion.xlsx');

    const result = await recepcionParser.parse(file);
    const recRow0 = result.targets[0].rows.find(r => r.report_code === 'RRT-100');
    const recRow1 = result.targets[0].rows.find(r => r.report_code === 'RRT-101');
    assert.equal(recRow0.reception_date, '2025-08-08',
      'Recepción reception_date must be ISO, not "8/8/2025"');
    assert.equal(recRow1.reception_date, '2025-08-15',
      'day=15 row that today fails Postgres parsing must succeed');

    const prefRow0 = result.targets[2].rows.find(r => r.report_code === 'RRT-100');
    const prefRow1 = result.targets[2].rows.find(r => r.report_code === 'RRT-101');
    assert.equal(prefRow0.measurement_date, '2025-08-11',
      'Prefermentativos measurement_date must be ISO');
    assert.equal(prefRow1.measurement_date, '2025-08-15');
  });

  // Round 33 — PostgREST rejects mixed-shape arrays with "All object keys
  // must match". Both Recepción and Prefermentativos branches conditionally
  // assign vintage_year, so a row with empty / non-digit-prefixed batch_code
  // currently lands without that key while sibling rows carry it. Test
  // both branches in one fixture.
  it('produces uniform key sets across rows on Recepción + Prefermentativos branches', async () => {
    const XLSX = await import('xlsx');

    const recAoa = [
      ['','FL 8.5.8 rev 2','','ANÁLISIS DE RECEPCIÓN'],
      ['Reporte','Fecha','Lote de viñedo 1','Código (lote de bodega)','Tanque','Variedad'],
      ['RRT-200', new Date(Date.UTC(2025, 7, 8)),  'SBMX-2A', '25SBVDG-200', 'TK-A', 'Sauvignon Blanc'],
      ['RRT-201', new Date(Date.UTC(2025, 7, 9)),  'SBMX-2B', null,           'TK-B', 'Sauvignon Blanc'],
    ];
    const recSheet = XLSX.utils.aoa_to_sheet(recAoa);

    const prefAoa = [
      ['FL 8.5.8 rev 2','','ANÁLISIS PREFERMENTATIVOS','',''],
      ['Reporte','Fecha','Código (lote de bodega)','Tanque','Variedad'],
      ['RRT-200', new Date(Date.UTC(2025, 7, 11)), '25SBVDG-200', 'TK-A', 'Sauvignon Blanc'],
      ['RRT-201', new Date(Date.UTC(2025, 7, 12)), null,           'TK-B', 'Sauvignon Blanc'],
    ];
    const prefSheet = XLSX.utils.aoa_to_sheet(prefAoa);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, recSheet,  'Recepción 2025');
    XLSX.utils.book_append_sheet(wb, prefSheet, 'Prefermentativos 2025');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
    const file = asFakeFile(Buffer.from(buf), 'mixed_keys.xlsx');

    const result = await recepcionParser.parse(file);
    const recRows = result.targets[0].rows;
    const prefRows = result.targets[2].rows;

    assert.equal(recRows.length, 2);
    assert.deepEqual(Object.keys(recRows[0]).sort(), Object.keys(recRows[1]).sort(),
      'tank_receptions rows must share the same key set');
    assert.ok(Object.keys(recRows[0]).includes('vintage_year'));
    const rec201 = recRows.find(r => r.report_code === 'RRT-201');
    assert.equal(rec201.vintage_year, null,
      'row with no batch_code must have vintage_year=null, not absent');

    assert.equal(prefRows.length, 2);
    assert.deepEqual(Object.keys(prefRows[0]).sort(), Object.keys(prefRows[1]).sort(),
      'prefermentativos rows must share the same key set — this is the user-reported bug');
    assert.ok(Object.keys(prefRows[0]).includes('vintage_year'));
    const pref201 = prefRows.find(r => r.report_code === 'RRT-201');
    assert.equal(pref201.vintage_year, null);
  });
});
