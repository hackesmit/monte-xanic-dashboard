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

  // Regression for Round 30: live workbooks store dates as real Excel date
  // cells (not ISO text). With `raw: false` SheetJS used to return locale-
  // formatted strings ("21/08/2024"), which Postgres rejected as
  // "date/time field value out of range". The parser must now route date
  // columns through normalizeDate so real date cells emerge as ISO strings
  // regardless of the workbook's locale format code.
  it('parses real Excel date cells to ISO YYYY-MM-DD (DMY-formatted workbook)', async () => {
    const XLSX = await import('xlsx');
    const headers = [
      'Vintrace','No. Reporte','Fecha recepción de uva','Fecha medición técnica',
      'Total','Bins/Jabas','Toneladas totales','Proveedor','Variedad',
      'Lote de campo','Fecha análisis laboratorio',
    ];
    const aoa = [
      ['MEDICIÓN TÉCNICA DE LA UVA','','','','','','','','','',''],
      ['','','','','','','','','','',''],
      headers,
      ['VT-1','MT-25-001', new Date(Date.UTC(2024, 7, 20)), new Date(Date.UTC(2024, 7, 21)),
        18,'bins',5.5,'Monte Xanic','Cabernet Sauvignon','25CSMX-1', new Date(Date.UTC(2024, 7, 22))],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    // Force a DMY format code on the date columns so the bug path (raw:false
    // would have rendered "20/08/2024") is exercised by the test.
    for (const cellAddr of ['C4','D4','K4']) {
      const cell = sheet[cellAddr];
      if (cell) cell.z = 'dd/mm/yyyy';
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Pre-recepción');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
    const file = asFakeFile(Buffer.from(buf), 'live_dmy.xlsx');

    const result = await prerecepcionParser.parse(file);
    const row = result.targets[0].rows.find(r => r.report_code === 'MT-25-001');
    assert.ok(row, 'MT-25-001 row missing');
    assert.equal(row.reception_date, '2024-08-20',
      'reception_date must be ISO YYYY-MM-DD, not the workbook-locale display string');
    assert.equal(row.medicion_date, '2024-08-21',
      'medicion_date must be ISO YYYY-MM-DD');
    assert.equal(row.lab_date, '2024-08-22',
      'lab_date must be ISO YYYY-MM-DD');
  });

  it('parses real Excel date cells from MDY-formatted workbooks identically (locale-independent)', async () => {
    // Same Date underlying value, but stored under an MDY format code (the
    // shape Round 30 saw in `Xanic info/prerecepcion_actualizado (1).xlsx`).
    // Result must match the DMY case above — proving the fix uses the
    // underlying date, not the locale format string.
    const XLSX = await import('xlsx');
    const headers = ['Vintrace','No. Reporte','Fecha recepción de uva','Fecha medición técnica','Total','Bins/Jabas','Toneladas totales','Proveedor','Variedad','Lote de campo'];
    const aoa = [
      ['MEDICIÓN TÉCNICA DE LA UVA','','','','','','','','',''],
      ['','','','','','','','','',''],
      headers,
      ['VT-2','MT-25-002', new Date(Date.UTC(2024, 7, 20)), new Date(Date.UTC(2024, 7, 21)),
        18,'bins',5.5,'Monte Xanic','Merlot','25MEMX-1'],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    for (const cellAddr of ['C4','D4']) {
      const cell = sheet[cellAddr];
      if (cell) cell.z = 'm/d/yy';
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Pre-recepción');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
    const file = asFakeFile(Buffer.from(buf), 'live_mdy.xlsx');

    const result = await prerecepcionParser.parse(file);
    const row = result.targets[0].rows.find(r => r.report_code === 'MT-25-002');
    assert.ok(row, 'MT-25-002 row missing');
    assert.equal(row.reception_date, '2024-08-20');
    assert.equal(row.medicion_date, '2024-08-21');
  });

  // Regression for Round 32: live `prerecepcion_actualizado (1).xlsx` row
  // MT-24-011 has total_bins=37.5 (a half-bin / mixed-lot value). Schema is
  // being widened from INT to NUMERIC to preserve the value. The parser must
  // pass the fractional number through unchanged — not silently round, not
  // reject — so the schema is the single source of truth for what's valid.
  it('passes fractional total_bins through unchanged (no rounding, no reject)', async () => {
    const XLSX = await import('xlsx');
    const headers = ['Vintrace','No. Reporte','Fecha medición técnica','Total','Bins/Jabas','Variedad','Lote de campo'];
    const aoa = [
      ['MEDICIÓN TÉCNICA DE LA UVA','','','','','',''],
      ['','','','','','',''],
      headers,
      ['VT-11','MT-24-011', new Date(Date.UTC(2024, 7, 21)), 37.5, 'bins', 'Cabernet Sauvignon', '24CSMX-11'],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Pre-recepción');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
    const file = asFakeFile(Buffer.from(buf), 'fractional_total_bins.xlsx');

    const result = await prerecepcionParser.parse(file);
    const row = result.targets[0].rows.find(r => r.report_code === 'MT-24-011');
    assert.ok(row, 'MT-24-011 row should be in targets[0].rows, not rejected');
    assert.equal(row.total_bins, 37.5,
      'total_bins must be preserved verbatim — schema NUMERIC accepts it');
    assert.equal(result.rejected.find(r => r.row['No. Reporte'] === 'MT-24-011'), undefined,
      'MT-24-011 must not be in rejected');
  });

  // Round 32 Option B — defense-in-depth: a row whose INT-typed column is
  // fractional (here health_madura=150.5) must be rejected at the parser
  // layer with a Spanish motivo_rechazo naming the column. Without this
  // check the row would reach Postgres and trigger an opaque
  // "invalid input syntax for type integer" rejection that blocks the
  // whole batch — the same failure mode that drove Round 32.
  it('rejects rows where an INT-typed column has a fractional value', async () => {
    const XLSX = await import('xlsx');
    const headers = ['Vintrace','No. Reporte','Fecha medición técnica','Variedad','Lote de campo','Bayas Maduras'];
    const aoa = [
      ['MEDICIÓN TÉCNICA','','','','',''],
      ['','','','','',''],
      headers,
      ['VT-50','MT-24-050', new Date(Date.UTC(2024, 7, 21)), 'Cabernet Sauvignon', '24CSMX-50', 150.5],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Pre-recepción');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
    const file = asFakeFile(Buffer.from(buf), 'fractional_int.xlsx');

    const result = await prerecepcionParser.parse(file);
    assert.equal(result.targets[0].rows.find(r => r.report_code === 'MT-24-050'), undefined,
      'MT-24-050 must NOT be in targets[0].rows — fractional INT must be rejected');
    const rejected = result.rejected.find(r => r.row['No. Reporte'] === 'MT-24-050');
    assert.ok(rejected, 'MT-24-050 must appear in rejected[]');
    assert.match(rejected.motivo_rechazo, /health_madura/,
      'motivo_rechazo must name the offending column for the user to fix it');
    assert.match(rejected.motivo_rechazo, /entero|integer/i,
      'motivo_rechazo must indicate the value is not an integer');
  });
});
