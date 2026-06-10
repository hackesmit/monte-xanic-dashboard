// tests/mt37-partial-grading.test.mjs
// MT.37 — Partial classification + pre-recepción field mappings.
//
// (1) scoreLot grades with core berry chemistry (brix+pH+ta) plus medicion
//     even when reception chemistry (av/ag/polifenoles/antocianinas) is
//     missing — flagged `partial: true` so the UI warns. Without the core
//     chemistry it still refuses to grade.
// (2) _rowToMedicion derives berry diameter from the file's
//     'Longitud promedio por baya (cm)' (berry_length_avg_cm → mm) and the
//     origin from 'Proveedor' (supplier abbreviation → full appellation),
//     falling back to the ranch resolved from the lot code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLot } from '../js/classification.js';
import { DataStore } from '../js/dataLoader.js';

const medicion = {
  health_grade: 'Bueno', health_madura: 90, health_inmadura: 5,
  health_sobremadura: 2, health_picadura: 1, health_enfermedad: 1,
  health_quemadura: 1, phenolic_maturity: null,
};

test('MT.37 scoreLot: grades without reception chemistry, flagged partial', () => {
  const lot = {
    variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
    vintage: 2025, lotCode: 'CSMX-5B',
    brix: 24.0, pH: 3.55, ta: 6.0, berryFW: 1.0,   // no av/ag/poly/ant
    medicion,
  };
  const r = scoreLot(lot);
  assert.notEqual(r.grade, null, `expected a grade, got ${r.reason}`);
  assert.equal(r.partial, true, 'must be flagged partial');
  assert.ok(r.missing.includes('av') && r.missing.includes('polyphenols'),
    `missing list must name reception params: ${r.missing}`);
});

test('MT.37 scoreLot: full data is NOT flagged partial', () => {
  const lot = {
    variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
    vintage: 2025, lotCode: 'CSMX-5B',
    brix: 24.0, pH: 3.55, ta: 6.0, berryFW: 1.0,
    av: 0.0, ag: 0.02, polyphenols: 2200, anthocyanins: 850,
    medicion,
  };
  const r = scoreLot(lot);
  assert.notEqual(r.grade, null);
  assert.equal(r.partial, false);
});

test('MT.37 scoreLot: still refuses without core chemistry', () => {
  const lot = {
    variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
    vintage: 2025, lotCode: 'CSMX-5B',
    pH: 3.55, ta: 6.0,    // no brix
    medicion,
  };
  const r = scoreLot(lot);
  assert.equal(r.grade, null);
  assert.equal(r.reason, 'Datos insuficientes');
});

test('MT.37 _rowToMedicion: diameter from berry_length_avg_cm and origin from supplier', () => {
  const m = DataStore._rowToMedicion({
    id: 1, medicion_code: 'MT-25-001', medicion_date: '2025-09-20',
    vintage_year: 2025, variety: 'Tempranillo', lot_code: 'TEKMP-S1',
    supplier: 'KMP', berry_length_avg_cm: 1.344, berry_avg_weight_g: '1.27',
  });
  assert.equal(m.berryDiameter, 13.4, 'cm → mm conversion');
  assert.equal(m.appellation, 'Kompali (VON)', 'supplier abbr → appellation');
  // Explicit diameter wins over derived length
  const m2 = DataStore._rowToMedicion({
    id: 2, medicion_code: 'MT-25-002', lot_code: 'CSMX-5B',
    berry_diameter_mm: 12.5, berry_length_avg_cm: 1.1,
  });
  assert.equal(m2.berryDiameter, 12.5);
  // No supplier/appellation → ranch resolved from the lot code
  const m3 = DataStore._rowToMedicion({
    id: 3, medicion_code: 'MT-25-003', lot_code: 'SYUC-L5', vintage_year: 2025,
  });
  assert.equal(m3.appellation, 'Dominio de las Abejas (VON)');
  // 'DOMINIO' spelled out (as the 2025 file does)
  const m4 = DataStore._rowToMedicion({
    id: 4, medicion_code: 'MT-25-004', lot_code: 'SYUC-L13,14', supplier: 'DOMINIO',
  });
  assert.equal(m4.appellation, 'Dominio de las Abejas (VON)');
});
